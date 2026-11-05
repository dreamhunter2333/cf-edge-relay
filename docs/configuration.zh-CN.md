# 部署说明

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

把一份完整 JSONC 配置存为 `WRANGLER_CONFIG`，部署 Token 单独存为 `CLOUDFLARE_API_TOKEN`。配置中包含 `account_id`，便于无交互部署；源码路径相对于仓库根目录：

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
  },
  "account_id": "YOUR_ACCOUNT_ID"
}
```

替换示例标识和地址，不要提交真实配置。JSONC Secret 支持注释和尾随逗号。

Token 需要 **Workers Scripts Edit**，以及直接绑定 Tunnel 所需的 **Connectivity Directory Admin**。**Cloudflare Tunnel Read** 用于查看所选 Tunnel，权限范围限定到部署账号。

workflow 写入已忽略的临时配置后，只执行一条命令：

```sh
pnpm exec wrangler deploy
```

Push 到 `main` 时，仅源码、依赖、TypeScript 配置或 workflow 变更会触发部署。只修改 README、`docs/`、许可证或示例模板不会触发，也可手动运行。部署后删除临时配置，日志中屏蔽敏感值。

## 排查

- `500`：检查 `TARGET_URL` 和 `TUNNEL` binding。
- `502`：检查 Tunnel 状态、QUIC 连接，以及 `cloudflared` 能否访问目标。
- 本地开发访问 VPC 私网需要远程 binding 或远程开发模式，参考 [VPC 配置](https://developers.cloudflare.com/workers-vpc/configuration/vpc-networks/)。

身份认证由目标服务或 Cloudflare Access 承担，受 Cloudflare Workers 和 Workers VPC 平台限制。
