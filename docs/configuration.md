# Advanced deployment

**English** | [简体中文](configuration.zh-CN.md) · [Usage](../README.md)

## Tunnel

Create or reuse a named Cloudflare Tunnel in your account. It only needs to reach the target service; a published application hostname is not required.

Workers VPC requires `cloudflared` 2025.7.0 or later and an active QUIC connection. Allow outbound UDP port 7844. See the [Cloudflare Tunnel guide](https://developers.cloudflare.com/workers-vpc/configuration/tunnel/).

`TARGET_URL` is resolved and connected from the `cloudflared` side. For containers, `localhost` refers to that container, not its host. Use an address reachable from the container.

## Configuration

Copy the root [template](../wrangler.jsonc.example) to `wrangler.jsonc`. The only service setting is `vars.TARGET_URL`; the Tunnel UUID selects the connection. There are no host/path rules, outbound pools, or entry Workers.

Targets must use HTTP(S), without URL credentials, query strings, or fragments. An optional base path is prepended to incoming paths. For example, target `http://10.0.0.10:8080/base` and request `/items?q=1` forward to `/base/items?q=1`.

Request methods, authentication headers, cookies, and bodies pass through. Responses remain streaming, including SSE. WebSocket upgrades pass through the native Tunnel binding. Redirects to the target origin are rewritten to the public origin; cookies and page content are not rewritten. Requests are not retried automatically.

## GitHub Actions

Store the complete JSONC configuration as `WRANGLER_CONFIG` and the token separately as `CLOUDFLARE_API_TOKEN`. The source path is relative to the repository root:

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

Replace the example identifiers and address with your own values. Never commit the real configuration. Comments and trailing commas are supported in the JSONC secret.

The token needs **Workers Scripts Edit** and **Connectivity Directory Admin** for the direct Tunnel binding. **Cloudflare Tunnel Read** allows inspecting the selected Tunnel. Keep the token scoped to the deployment account.

Each deployment writes an ignored temporary `wrangler.jsonc` and runs:

```sh
pnpm exec wrangler deploy
```

Pushes to `main` trigger deployment only when source, dependencies, TypeScript configuration, or the workflow changes. README, `docs/`, license, and example-template changes alone do not trigger deployment. Manual dispatch remains available.

## Multiple services and tokens

Every configuration deploys one Worker with one target. Add two optional repository secrets for additional services:

| Secret | Value |
| --- | --- |
| `WRANGLER_CONFIGS` | A JSON object mapping service names to complete Wrangler configurations. |
| `CLOUDFLARE_API_TOKENS` | A JSON object mapping the same service names to deployment tokens. |

For example, `WRANGLER_CONFIGS`:

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

And `CLOUDFLARE_API_TOKENS`:

```json
{
  "api": "YOUR_CLOUDFLARE_API_TOKEN"
}
```

Add more entries under matching names such as `web` or `api2`. Service names may contain letters, digits, underscores, and hyphens. Give Workers in the same account different `name` values; each configuration can use its own target address, port, and Tunnel. Tokens may be reused when their permissions allow it.

Configurations can be JSON objects, as above, or JSON strings containing complete JSONC text when comments or trailing commas are needed. No real configurations or tokens belong in Git.

One job runs two inline shell deployment steps: the optional default pair (`WRANGLER_CONFIG` and `CLOUDFLARE_API_TOKEN`) first, then entries from the two collections. It explicitly reads only these four named secrets. Missing tokens, invalid configurations, or failed deployments stop the workflow; earlier successful deployments remain in place. Tokens without matching configurations are ignored.

To add a service, update the two collections and run **Actions → Deploy → Run workflow**. No workflow or source change is needed. Editing secrets does not automatically trigger deployment. Removing an entry stops future deployment of that service; it does not delete its existing Worker.

## Deployment logs

Wrangler's stdout and stderr are discarded; the workflow reports only deployment success or failure, with service names identifying additional deployments. Wrangler disk logs and telemetry are disabled. Shell tracing is not enabled, and raw deployment logs are not uploaded as artifacts.

Configuration files are created with owner-only permissions and removed when the step exits, with an additional cleanup step. A log level alone is not a confidentiality guarantee. Raw diagnostics are intentionally unavailable in public Actions logs; investigate failures in a trusted local environment.

## Troubleshooting

- `500`: check `TARGET_URL` and the `TUNNEL` binding.
- `502`: check Tunnel health, QUIC connectivity, and whether `cloudflared` can reach the target.
- Private VPC access during local development requires remote bindings or remote development; see [VPC configuration](https://developers.cloudflare.com/workers-vpc/configuration/vpc-networks/).

Authentication remains with the target service or Cloudflare Access. Cloudflare Workers and Workers VPC platform limits apply.
