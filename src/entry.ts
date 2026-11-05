import type { FetchBinding } from "./types";

export default {
  fetch(request: Request, env: { PROXY: FetchBinding }): Promise<Response> {
    return env.PROXY.fetch(request);
  },
} satisfies ExportedHandler<{ PROXY: FetchBinding }>;
