import { proxy } from "hono/proxy";
import type { FetchBinding, ProxyEnv, Route, Upstream } from "./types";

const readVariable = (value: unknown): unknown => typeof value === "string" ? JSON.parse(value) : value;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.length > 0);

function isRoute(value: unknown): value is Route {
  return isRecord(value) && isStringList(value.hosts) && isStringList(value.upstreams) &&
    typeof value.pathPrefix === "string" && value.pathPrefix.startsWith("/") &&
    (value.stripPrefix === undefined || typeof value.stripPrefix === "boolean") &&
    (value.rewriteLocation === undefined || typeof value.rewriteLocation === "boolean");
}

function isUpstream(value: unknown): value is Upstream {
  return isRecord(value) && typeof value.url === "string" &&
    (value.binding === undefined || (typeof value.binding === "string" && value.binding.length > 0)) &&
    (value.hostHeader === undefined || (typeof value.hostHeader === "string" && !/[\r\n]/.test(value.hostHeader)));
}

function isFetchBinding(value: unknown): value is FetchBinding {
  return typeof value === "object" && value !== null && "fetch" in value && typeof value.fetch === "function";
}

function matchesHost(hostname: string, pattern: string): boolean {
  const host = pattern.toLowerCase();
  if (host === "*") return true;
  if (host.startsWith("*.")) return hostname.endsWith(host.slice(1));
  return hostname === host;
}

const matchesPath = (pathname: string, prefix: string): boolean =>
  pathname === prefix || pathname.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`);

function selectRoute(incoming: URL, env: ProxyEnv) {
  const routes = readVariable(env.ROUTES);
  const upstreams = readVariable(env.UPSTREAMS);
  if (!Array.isArray(routes) || !isRecord(upstreams)) {
    throw new Error("ROUTES must be an array and UPSTREAMS must be an object");
  }
  for (const route of routes) {
    if (!isRoute(route)) throw new Error("Invalid route configuration");
    if (!route.hosts.some((host) => matchesHost(incoming.hostname, host)) ||
        !matchesPath(incoming.pathname, route.pathPrefix)) continue;
    const targets = route.upstreams.map((name) => {
      if (!Object.hasOwn(upstreams, name)) throw new Error("Unknown upstream");
      const upstream = upstreams[name];
      if (!isUpstream(upstream)) throw new Error("Invalid upstream configuration");
      const url = new URL(upstream.url);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new Error("Upstream must be an HTTP(S) base URL without credentials, query, or fragment");
      }
      const binding = upstream.binding ? env[upstream.binding] : undefined;
      if (upstream.binding && !isFetchBinding(binding)) throw new Error("Upstream binding is unavailable");
      return { upstream, url, binding: isFetchBinding(binding) ? binding : undefined };
    });
    return { route, ...targets[Math.floor(Math.random() * targets.length)]! };
  }
  return null;
}

export default {
  async fetch(request: Request, env: ProxyEnv): Promise<Response> {
    const incoming = new URL(request.url);
    let selected;
    try {
      selected = selectRoute(incoming, env);
    } catch (error) {
      console.error("Proxy configuration error:", error instanceof Error ? error.message : "Unknown error");
      return new Response("Proxy configuration error", { status: 500 });
    }
    if (!selected) return new Response("Not Found", { status: 404 });
    const { route, upstream, binding, url: target } = selected;
    const basePath = target.pathname.replace(/\/$/, "");
    const suffix = route.stripPrefix ? incoming.pathname.slice(route.pathPrefix.length) : incoming.pathname;
    target.pathname = basePath + (suffix.startsWith("/") ? suffix : `/${suffix}`);
    target.search = incoming.search;
    const outgoing = new Request(target, request);
    outgoing.headers.set("Host", upstream.hostHeader || target.host);
    outgoing.headers.set("X-Forwarded-Host", incoming.host);
    outgoing.headers.set("X-Forwarded-Proto", incoming.protocol.slice(0, -1));
    outgoing.headers.delete("Forwarded");
    outgoing.headers.delete("X-Forwarded-For");
    const clientIp = request.headers.get("CF-Connecting-IP");
    if (clientIp) outgoing.headers.set("X-Forwarded-For", clientIp);
    const customFetch = (input: Request) => binding ? binding.fetch(input) : fetch(input);
    try {
      if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
        return await customFetch(new Request(outgoing, { redirect: "manual" }));
      }
      const response = await proxy(target, { raw: outgoing, redirect: "manual", customFetch });
      const location = response.headers.get("Location");
      if (!location || route.rewriteLocation === false) return response;
      const redirected = new URL(location, target);
      if (redirected.origin !== target.origin) return response;
      if (route.stripPrefix && matchesPath(redirected.pathname, basePath || "/")) {
        redirected.pathname = route.pathPrefix.replace(/\/$/, "") + redirected.pathname.slice(basePath.length);
      }
      response.headers.set("Location", incoming.origin + redirected.pathname + redirected.search + redirected.hash);
      return response;
    } catch (error) {
      console.error("Proxy upstream error:", error instanceof Error ? error.message : "Unknown error");
      return new Response("Bad Gateway", { status: 502 });
    }
  },
} satisfies ExportedHandler<ProxyEnv>;
