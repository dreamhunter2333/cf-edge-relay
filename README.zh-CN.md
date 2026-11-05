# cf-edge-relay

[English](README.md) | **简体中文**

没有自有域名，也能通过固定的 `workers.dev` 地址访问一个内网 HTTP 服务。如果已有域名，直接使用 Cloudflare Tunnel 的发布应用功能即可。

```mermaid
flowchart LR
  URL["你的 workers.dev 域名"] --> Worker["cf-edge-relay"] --> Tunnel["Cloudflare Tunnel"] --> Target["你的服务"]
```

## 使用

需要 Node.js 22+ 和 pnpm。

```sh
pnpm install --frozen-lockfile
pnpm exec wrangler login
cp wrangler.jsonc.example wrangler.local.jsonc
```

编辑 `wrangler.local.jsonc`：

- 用 `name` 设置自动生成的公网域名中的名称。
- 将 `vpc_networks[0].tunnel_id` 设置为 Tunnel UUID，binding 名称保持 `TUNNEL`。
- 将 `vars.TARGET_URL` 设置为目标服务地址，需能从 `cloudflared` 所在主机或容器访问。

```sh
pnpm run check
pnpm run deploy --config wrangler.local.jsonc
```

访问 `https://<name>.<账号子域>.workers.dev`。所有请求都转发到同一个目标，保留路径、查询参数、请求体和流式响应。

## 自动部署

在仓库 **Settings → Secrets and variables → Actions** 添加两个 Secret：

| Secret | 内容 |
| --- | --- |
| `WRANGLER_CONFIG` | 完整的 Wrangler JSONC 配置，包含 `account_id`。 |
| `CLOUDFLARE_API_TOKEN` | Cloudflare 部署 Token。 |

源码、依赖、构建配置或部署 workflow 的变更 push 到 `main` 时自动部署；只修改文档不会触发。也可在 **Actions → Deploy → Run workflow** 手动执行。

Tunnel 要求、Token 权限及配置示例见[部署说明](docs/configuration.zh-CN.md)。真实配置和凭据不要提交到 Git。

## 本地开发

```sh
pnpm run dev --config wrangler.local.jsonc
```

[MIT 许可证](LICENSE)。
