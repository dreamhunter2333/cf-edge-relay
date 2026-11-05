# 高级部署

[English](configuration.md) | **简体中文** · [使用方法](../README.zh-CN.md)

## Tunnel

在账号中创建或复用一条具名 Cloudflare Tunnel，保证它可以访问目标服务即可，无需配置发布应用域名。

Workers VPC 要求 `cloudflared` 版本至少为 2025.7.0，并实际使用 QUIC 连接。需允许出站 UDP 7844。参考 [Cloudflare Tunnel 文档](https://developers.cloudflare.com/workers-vpc/configuration/tunnel/)。

`TARGET_URL` 从 `cloudflared` 一侧解析和连接。容器中的 `localhost` 指向容器自身，不是宿主机，应填写容器能访问的地址。

## 配置

复制根目录[模板](../wrangler.jsonc.example)为 `wrangler.jsonc`。服务只设置 `vars.TARGET_URL`，Tunnel UUID 用于选择连接。不再配置域名／路径规则、出口池或入口 Worker。

目标必须使用 HTTP(S)，不能包含 URL 用户名密码、查询参数或片段。可以带基础路径：例如目标 `http://10.0.0.10:8080/base` 收到请求 `/items?q=1` 时，会转发到 `/base/items?q=1`。

请求方法、认证头、Cookie 和请求体透传。响应保持流式，包括 SSE；WebSocket 升级通过原生 Tunnel binding 透传。指向目标 origin 的重定向会改为公网 origin，Cookie 和页面内容不改写。不自动重试请求。

## GitHub Actions

把完整 JSONC 配置存为 `WRANGLER_CONFIG`，部署 Token 单独存为 `CLOUDFLARE_API_TOKEN`。源码路径相对于仓库根目录：

```json
{
  "name": "my-service",
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
```

替换示例标识和地址，不要提交真实配置。JSONC Secret 支持注释和尾随逗号。

Token 需要 **Workers Scripts Edit**，以及直接绑定 Tunnel 所需的 **Connectivity Directory Admin**。**Cloudflare Tunnel Read** 用于查看所选 Tunnel，权限范围限定到部署账号。

每次部署写入已忽略的临时 `wrangler.jsonc` 后，执行：

```sh
pnpm exec wrangler deploy
```

Push 到 `main` 时，仅源码、依赖、TypeScript 配置或 workflow 变更会触发部署。只修改 README、`docs/`、许可证或示例模板不会触发，也可手动运行。

## 多个服务与 Token

所有服务共用一个 workflow 和同一份源码，每份配置部署一个独立 Worker，只代理一个目标。同一账号下的 Worker 使用不同的 `name`，各自配置目标地址、端口和 Tunnel。

在仓库中添加后缀匹配的 Secret 配对：

| 配置 Secret | Token Secret |
| --- | --- |
| `WRANGLER_CONFIG` | `CLOUDFLARE_API_TOKEN` |
| `WRANGLER_CONFIG_MAXX` | `CLOUDFLARE_API_TOKEN_MAXX` |
| `WRANGLER_CONFIG_API` | `CLOUDFLARE_API_TOKEN_API` |

每个配置 Secret 都保存完整 JSONC，Token 必须有权限部署与其配对的配置。权限允许时，不同配对也可以使用相同 Token。

workflow 只有一个 Job，部署分成两个步骤：

1. 存在无后缀配置时，先部署默认配置。
2. 自动发现 `WRANGLER_CONFIG_*`，分别使用同后缀的 `CLOUDFLARE_API_TOKEN_*` 部署。

两个步骤都使用 inline shell，按顺序部署。无后缀配对可选，因此也支持只配置后缀配对。缺少 Token、后缀配置为空或部署失败时停止 workflow，之前成功的部署会保留。没有对应配置的 Token Secret 会被忽略。

新增服务时，添加一对 Secret，再运行 **Actions → Deploy → Run workflow**，无需修改 workflow 或源码。修改 Secret 不会自动触发部署。删除配对只会停止后续部署，不会删除已存在的 Worker。

## 部署日志

Wrangler 的标准输出和错误输出不进入 Actions 日志，workflow 只显示部署成功或失败，后缀部署使用后缀标识对应服务。关闭 Wrangler 磁盘日志和遥测，不启用 shell 跟踪，也不上传原始部署日志。

配置文件仅允许所有者读写，步骤退出时删除，并保留额外清理步骤。仅调整日志级别不能保证配置保密。公开 Actions 日志中不提供原始诊断信息，失败时应在可信本地环境排查。

## 排查

- `500`：检查 `TARGET_URL` 和 `TUNNEL` binding。
- `502`：检查 Tunnel 状态、QUIC 连接，以及 `cloudflared` 能否访问目标。
- 本地开发访问 VPC 私网需要远程 binding 或远程开发模式，参考 [VPC 配置](https://developers.cloudflare.com/workers-vpc/configuration/vpc-networks/)。

身份认证由目标服务或 Cloudflare Access 承担，受 Cloudflare Workers 和 Workers VPC 平台限制。
