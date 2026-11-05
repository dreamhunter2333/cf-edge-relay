import { proxy } from "hono/proxy";

interface Env {
  TARGET_URL: string;
  TUNNEL: Pick<Fetcher, "fetch">;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    let target: URL;
    try {
      target = new URL(env.TARGET_URL);
      if (!["http:", "https:"].includes(target.protocol) ||
          target.username || target.password || target.search || target.hash ||
          typeof env.TUNNEL?.fetch !== "function") {
        return new Response("Invalid target or Tunnel configuration", { status: 500 });
      }
    } catch {
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
  },
} satisfies ExportedHandler<Env>;
