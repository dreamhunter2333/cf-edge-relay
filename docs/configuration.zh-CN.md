# 配置与部署

[English](configuration.md) | **简体中文** · [快速开始](../README.zh-CN.md)

## Tunnel

创建或复用一条具名 Cloudflare Tunnel，通过 Tunnel UUID 直绑到 Worker。`cloudflared` 至少使用 2025.7.0，并通过 QUIC 连接 Cloudflare。防火墙需允许出站 UDP 7844。 [Cloudflare Tunnel 要求](https://developers.cloudflare.com/workers-vpc/configuration/tunnel/)

目标地址从 `cloudflared` 所在的网络解析和连接。若 `cloudflared` 运行在容器内，`localhost` 指向该容器。

## 配置变量

复制仓库根目录的模板为 `wrangler.jsonc`。通过 Actions 部署时，将同样的配置放进相应的 Secret。 [配置模板](../wrangler.jsonc.example)

| 配置项 | 类型 | 用途 |
| --- | --- | --- |
| `name` | 字符串 | Worker 名称，用于生成 `workers.dev` 地址。 |
| `vpc_networks[0].tunnel_id` | UUID 字符串 | 直绑的 Tunnel ID，绑定名称为 `TUNNEL`。 |
| `vars.TARGET_URL` | URL 字符串 | 单一目标，支持 `http://`、`https://` 和 `ssh://`。 |
| `vars.ALLOWED_IPS` | 字符串数组，可选 | 来源 IP 白名单。示例 `["198.51.100.10", "203.0.113.0/24", "2001:db8::/32"]`。 |

`TARGET_URL` 不能包含用户名、密码、查询参数或片段。设置 `ALLOWED_IPS` 后，Hono 中间件会在 HTTP(S) 转发或 SSH 升级前检查 Cloudflare 的 `CF-Connecting-IP`。白名单接受单个 IPv4、IPv6 和 CIDR 网段。未设置时允许所有来源，空数组拒绝所有来源。

## HTTP(S)

直接浏览 Worker 的 HTTPS 地址。目标可带基础路径，例如 `http://10.0.0.10:8080/base` 会把 `/items?q=1` 转发到 `/base/items?q=1`。

转发保留请求方法、认证头、Cookie 和请求体，支持流式响应、SSE 和 WebSocket 升级。指向目标 origin 的重定向改为 Worker 的公网 origin。Cookie 和页面内容保持原样，请求不自动重试。

## SSH

将 `TARGET_URL` 设为 `ssh://ssh.internal.example:22` 一类的 SSH 地址。省略端口时使用 `22`。客户端通过 `/ssh` 建立二进制 WebSocket，目标 VM 验证 SSH 登录。

在仓库根目录运行连接测试。将域名、用户名和密钥路径换成实际值；下例使用 Google OS Login。代理脚本使用 Node.js 内置的 WebSocket 客户端，也支持换成 `websocat -b`。

```sh
ssh -v -i ~/.ssh/google_compute_engine \
  -o 'ProxyCommand node scripts/ssh-ws.mjs wss://my-service.example.workers.dev/ssh' \
  OS_LOGIN_USERNAME@ssh-relay hostname
```

## GitHub Actions

在仓库的 **Settings → Secrets and variables → Actions** 配置所需的 Secret。每份 Wrangler 配置部署一个 Worker，`main` 路径相对于仓库根目录。真实配置与 Token 存在 Secrets 中。

| Secret | 内容 | 部署范围 |
| --- | --- | --- |
| `WRANGLER_CONFIG` | 完整 Wrangler JSONC 配置 | 默认 Worker |
| `CLOUDFLARE_API_TOKEN` | Cloudflare 部署 Token | 默认 Worker |
| `WRANGLER_CONFIGS` | 服务名到完整 Wrangler 配置的 JSON 对象 | 其他 Worker |
| `CLOUDFLARE_API_TOKENS` | 服务名到部署 Token 的 JSON 对象 | 其他 Worker |

Token 需要 **Workers Scripts Edit** 和直绑 Tunnel 所需的 **Connectivity Directory Admin**。需要查看 Tunnel 时再加 **Cloudflare Tunnel Read**。将权限范围限定到部署账号。

### 多 Worker 配置

在两个 JSON Secret 中使用相同的服务名。服务名可包含字母、数字、下划线和连字符。同一账号下的 Worker 使用不同的 Wrangler `name`，各自配置目标、Tunnel 和可选白名单。权限允许时可以复用 Token。

下面是 `WRANGLER_CONFIGS` 的示例值。

```json
{
  "api": {
    "name": "api",
    "main": "src/index.ts",
    "compatibility_date": "2026-11-05",
    "workers_dev": true,
    "vpc_networks": [
      {
        "binding": "TUNNEL",
        "tunnel_id": "00000000-0000-4000-8000-000000000001"
      }
    ],
    "vars": {
      "TARGET_URL": "http://10.0.0.10:8080"
    }
  }
}
```

下面是配套的 `CLOUDFLARE_API_TOKENS` 值。

```json
{
  "api": "YOUR_CLOUDFLARE_API_TOKEN"
}
```

配置条目也可使用包含完整 JSONC 文本的字符串，以保留注释或尾随逗号。默认配置直接接受 JSONC。

### 触发与日志

Actions 先检查 TypeScript，再部署默认 Worker 和 JSON 集合中的服务。缺少 Token、配置无效或部署失败时停止，已成功的部署会保留。只有 Token 而没有配置的条目会被忽略。删除条目后，该 Worker 停止参与后续部署，现有实例仍由 Cloudflare 保留。

源码、依赖、TypeScript 配置或 workflow 的相关改动推到 `main` 会触发部署。修改 Secret 后，在 **Actions → Deploy → Run workflow** 手动触发。

每次部署写入仅所有者可读写的临时 `wrangler.jsonc`，调用 `pnpm exec wrangler deploy` 后清理。Actions 日志只记录部署结果，Wrangler 诊断输出、磁盘日志和遥测均关闭。需要诊断细节时，在可信本机环境运行 Wrangler。

## 本地开发与排查

运行 `pnpm run dev`。本地访问实际私网服务时，给 VPC 绑定设置 `remote: true`，或使用远程开发模式。 [VPC 配置](https://developers.cloudflare.com/workers-vpc/configuration/vpc-networks/)

| 现象 | 检查项 |
| --- | --- |
| HTTP `403` | `ALLOWED_IPS` 是否涵盖客户端的公网出口 IP。 |
| HTTP `426` | SSH 客户端是否用 WebSocket 升级请求访问 `/ssh`。 |
| HTTP `500` | 检查 `TARGET_URL`、`TUNNEL` 绑定或 `ALLOWED_IPS` 格式。 |
| HTTP `502` 或 SSH WebSocket 关闭码 `1011` | 检查 Tunnel 状态、QUIC 连接和目标服务是否可达。 |
