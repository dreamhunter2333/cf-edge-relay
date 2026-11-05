export interface Route {
  hosts: string[];
  pathPrefix: string;
  upstreams: string[];
  stripPrefix?: boolean;
  rewriteLocation?: boolean;
}

export interface Upstream {
  url: string;
  binding?: string;
  hostHeader?: string;
}

export interface FetchBinding {
  fetch(request: Request): Promise<Response>;
}

export interface ProxyEnv {
  ROUTES: Route[] | string;
  UPSTREAMS: Record<string, Upstream> | string;
  [binding: string]: unknown;
}
