import { Hono } from "hono";
import { ipRestriction } from "hono/ip-restriction";
import { proxy } from "hono/proxy";
import { relaySsh } from "./ssh";

interface Env {
  TARGET_URL: string;
  ALLOWED_IPS?: string[];
  TUNNEL: Pick<Fetcher, "fetch"> & {
    connect(address: SocketAddress): Promise<Socket>;
  };
}

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
  const allowList = c.env.ALLOWED_IPS;
  if (allowList === undefined) return next();
  if (!Array.isArray(allowList) ||
      allowList.some((rule) => typeof rule !== "string" || !/^[0-9a-f.:]+(?:\/\d{1,3})?$/i.test(rule))) {
    return c.text("Invalid ALLOWED_IPS configuration", 500);
  }
  if (allowList.length === 0) return c.text("Forbidden", 403);

  let restrict: ReturnType<typeof ipRestriction>;
  try {
    restrict = ipRestriction((context) => context.req.header("CF-Connecting-IP") ?? "", { allowList });
  } catch {
    return c.text("Invalid ALLOWED_IPS configuration", 500);
  }
  return restrict(c, next);
});

app.all("*", async (c) => {
  const request = c.req.raw;
  const env = c.env;
  let target: URL;
  try {
    target = new URL(env.TARGET_URL);
    if (!target.hostname || target.username || target.password || target.search || target.hash) {
      return new Response("Invalid target or Tunnel configuration", { status: 500 });
    }
  } catch {
    return new Response("Invalid target or Tunnel configuration", { status: 500 });
  }

  if (target.protocol === "ssh:") {
    if ((target.pathname && target.pathname !== "/") ||
        target.port === "0" || typeof env.TUNNEL?.connect !== "function") {
      return new Response("Invalid target or Tunnel configuration", { status: 500 });
    }
    const address = { hostname: target.hostname, port: Number(target.port || 22) };
    return relaySsh(request, c.executionCtx, () => env.TUNNEL.connect(address));
  }

  if (!["http:", "https:"].includes(target.protocol) || typeof env.TUNNEL?.fetch !== "function") {
    return new Response("Invalid target or Tunnel configuration", { status: 500 });
  }

  const incoming = new URL(request.url);
  const basePath = target.pathname.replace(/\/$/, "");
  target.pathname = basePath + incoming.pathname;
  target.search = incoming.search;
  const outgoing = new Request(target, request);
  outgoing.headers.set("Host", target.host);
  outgoing.headers.set("X-Forwarded-Host", incoming.host);
  outgoing.headers.set("X-Forwarded-Proto", incoming.protocol.slice(0, -1));
  outgoing.headers.delete("Forwarded");
  outgoing.headers.delete("X-Forwarded-For");
  const clientIp = request.headers.get("CF-Connecting-IP");
  if (clientIp) outgoing.headers.set("X-Forwarded-For", clientIp);
  try {
    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      return await env.TUNNEL.fetch(outgoing, { redirect: "manual" });
    }
    const response = await proxy(target, {
      raw: outgoing,
      redirect: "manual",
      customFetch: (input) => env.TUNNEL.fetch(input),
    });
    const location = response.headers.get("Location");
    if (!location) return response;
    const redirected = new URL(location, target);
    if (redirected.origin !== target.origin) return response;
    const pathname = basePath && (redirected.pathname === basePath || redirected.pathname.startsWith(`${basePath}/`))
      ? redirected.pathname.slice(basePath.length) || "/"
      : redirected.pathname;
    response.headers.set("Location", incoming.origin + pathname + redirected.search + redirected.hash);
    return response;
  } catch (error) {
    console.error("Tunnel request failed:", error instanceof Error ? error.message : "Unknown error");
    return new Response("Bad Gateway", { status: 502 });
  }
});

export default app satisfies ExportedHandler<Env>;
