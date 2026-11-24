# Configuration and deployment

**English** | [简体中文](configuration.zh-CN.md) · [Quick start](../README.md)

## Tunnel

Create or reuse a named Cloudflare Tunnel and bind it to the Worker by Tunnel UUID. Workers VPC requires `cloudflared` 2025.7.0 or later with an active QUIC connection. Allow outbound UDP port 7844. [Cloudflare Tunnel requirements](https://developers.cloudflare.com/workers-vpc/configuration/tunnel/)

`cloudflared` resolves and connects to the target from its own network. If it runs in a container, `localhost` refers to that container.

## Worker configuration

Copy the repository template to `wrangler.jsonc`. For Actions deployments, store the same configuration in the corresponding Secret. [Configuration template](../wrangler.jsonc.example)

| Key | Type | Purpose |
| --- | --- | --- |
| `name` | String | Worker name used in the generated `workers.dev` address. |
| `vpc_networks[0].tunnel_id` | UUID string | Tunnel UUID for the direct binding named `TUNNEL`. |
| `vars.TARGET_URL` | URL string | Single target using `http://`, `https://`, or `ssh://`. |
| `vars.ALLOWED_IPS` | Optional array of strings | Source IP allowlist, for example `["198.51.100.10", "203.0.113.0/24", "2001:db8::/32"]`. |

`TARGET_URL` accepts an address without credentials, a query string, or a fragment. When you set `ALLOWED_IPS`, Hono checks Cloudflare's `CF-Connecting-IP` before forwarding HTTP(S) or upgrading to SSH over WebSocket. The list accepts IPv4 and IPv6 addresses and CIDR ranges. Omitting the list allows all source addresses. An empty list denies all sources.

## HTTP(S)

Open the Worker's HTTPS address. HTTP(S) targets may have a base path. For example, the target `http://10.0.0.10:8080/base` forwards `/items?q=1` to `/base/items?q=1`.

The relay preserves request methods, authentication headers, cookies, bodies, streaming responses including SSE, and WebSocket upgrades. Redirects to the target origin use the Worker's public origin. Cookies and page content pass through unchanged. The relay makes one attempt per request.

## SSH

Set `TARGET_URL` to an SSH address such as `ssh://ssh.internal.example:22`. The port defaults to `22`. The client opens a binary WebSocket connection on `/ssh`, and the target VM authenticates the SSH login.

Run the connection test from the repository root. Replace the URL hostname, Linux username, and key path with your own values. The example uses Google OS Login. The proxy script uses Node.js's built-in WebSocket client, and `websocat -b` also works.

```sh
ssh -v -i ~/.ssh/google_compute_engine \
  -o 'ProxyCommand node scripts/ssh-ws.mjs wss://my-service.example.workers.dev/ssh' \
  OS_LOGIN_USERNAME@ssh-relay hostname
```

## GitHub Actions

Set the required repository secrets under **Settings → Secrets and variables → Actions**. Each Wrangler configuration deploys one Worker, and `main` is relative to the repository root. Store real configuration and tokens in Secrets.

| Secret | Value | Deployment |
| --- | --- | --- |
| `WRANGLER_CONFIG` | Complete Wrangler JSONC configuration | Default Worker |
| `CLOUDFLARE_API_TOKEN` | Cloudflare deployment token | Default Worker |
| `WRANGLER_CONFIGS` | JSON object mapping service names to complete Wrangler configurations | Additional Workers |
| `CLOUDFLARE_API_TOKENS` | JSON object mapping service names to deployment tokens | Additional Workers |

The token needs **Workers Scripts Edit** and **Connectivity Directory Admin** for direct Tunnel binding. Add **Cloudflare Tunnel Read** if it needs to inspect the Tunnel. Scope the permissions to the deployment account.

### Multiple Workers

Use the same service name in both JSON secrets. Service names can contain letters, digits, underscores, and hyphens. Workers in the same account need distinct Wrangler `name` values. Each Worker can have its own target, Tunnel, and optional allowlist. Tokens can be reused where their permissions allow it.

Example `WRANGLER_CONFIGS` value.

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

Corresponding `CLOUDFLARE_API_TOKENS` value.

```json
{
  "api": "YOUR_CLOUDFLARE_API_TOKEN"
}
```

Configuration entries can also be strings containing complete JSONC text to preserve comments or trailing commas. The default configuration accepts JSONC directly.

### Triggers and logs

Actions checks TypeScript, deploys the optional default Worker, and then deploys the entries in the JSON collection. A missing token, invalid configuration, or deployment failure stops the workflow. Earlier successful deployments stay live. Actions ignores tokens with no matching configuration. Removing an entry excludes that Worker from future deployments and leaves the deployed Worker in Cloudflare.

GitHub triggers deployment for pushes to `main` that change source, dependencies, TypeScript configuration, or the workflow. After editing Secrets, use **Actions → Deploy → Run workflow**.

Each deployment writes an owner-only temporary `wrangler.jsonc`, runs `pnpm exec wrangler deploy`, and removes the file. Actions reports deployment status. Wrangler diagnostics, disk logs, and telemetry are suppressed. Run Wrangler in a trusted local environment if you need the diagnostics.

## Local development and troubleshooting

Run `pnpm run dev`. To reach a real private service locally, set `remote: true` on the VPC binding or use remote development. [VPC configuration](https://developers.cloudflare.com/workers-vpc/configuration/vpc-networks/)

| Symptom | Check |
| --- | --- |
| HTTP `403` | Verify that `ALLOWED_IPS` includes the client's public egress address. |
| HTTP `426` | Verify that the SSH client sends a WebSocket upgrade request to `/ssh`. |
| HTTP `500` | Check `TARGET_URL`, the `TUNNEL` binding, and the format of `ALLOWED_IPS`. |
| HTTP `502` or SSH WebSocket close code `1011` | Check Tunnel health, QUIC connectivity, and target reachability. |
