# Deployment details

**English** | [简体中文](configuration.zh-CN.md) · [Usage](../README.md)

## Tunnel

Create or reuse a named Cloudflare Tunnel in your account. It only needs to reach the target service; a published application hostname is not required.

Workers VPC requires `cloudflared` 2025.7.0 or later and an active QUIC connection. Allow outbound UDP port 7844. See the [Cloudflare Tunnel guide](https://developers.cloudflare.com/workers-vpc/configuration/tunnel/).

`TARGET_URL` is resolved and connected from the `cloudflared` side. For containers, `localhost` refers to that container, not its host. Use an address reachable from the container.

## Configuration

Copy the root [template](../wrangler.jsonc.example) to `wrangler.local.jsonc`. The only service setting is `vars.TARGET_URL`; the Tunnel UUID selects the connection. There are no host/path rules, outbound pools, or entry Workers.

Targets must use HTTP(S), without URL credentials, query strings, or fragments. An optional base path is prepended to incoming paths. For example, target `http://10.0.0.10:8080/base` and request `/items?q=1` forward to `/base/items?q=1`.

Request methods, authentication headers, cookies, and bodies pass through. Responses remain streaming, including SSE. WebSocket upgrades pass through the native Tunnel binding. Redirects to the target origin are rewritten to the public origin; cookies and page content are not rewritten. Requests are not retried automatically.

## GitHub Actions

Store one complete JSONC configuration as `WRANGLER_CONFIG` and the token separately as `CLOUDFLARE_API_TOKEN`. Include `account_id` for non-interactive deployment. The source path is relative to the repository root:

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

Replace the example identifiers and address with your own values. Never commit the real configuration. Comments and trailing commas are supported in the JSONC secret.

The token needs **Workers Scripts Edit** and **Connectivity Directory Admin** for the direct Tunnel binding. **Cloudflare Tunnel Read** allows inspecting the selected Tunnel. Keep the token scoped to the deployment account.

The workflow writes an ignored temporary configuration and runs one command:

```sh
pnpm exec wrangler deploy --config wrangler.ci.local.jsonc
```

Pushes to `main` trigger deployment only when source, dependencies, TypeScript configuration, or the workflow changes. README, `docs/`, license, and example-template changes alone do not trigger deployment. Manual dispatch remains available. The configuration is removed after deployment and sensitive values are masked in logs.

## Troubleshooting

- `500`: check `TARGET_URL` and the `TUNNEL` binding.
- `502`: check Tunnel health, QUIC connectivity, and whether `cloudflared` can reach the target.
- Private VPC access during local development requires remote bindings or remote development; see [VPC configuration](https://developers.cloudflare.com/workers-vpc/configuration/vpc-networks/).

Authentication remains with the target service or Cloudflare Access. Cloudflare Workers and Workers VPC platform limits apply.
