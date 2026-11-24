const MAX_PENDING_BYTES = 8 * 1024 * 1024;
const MAX_FRAME_BYTES = 64 * 1024;

export function relaySsh(
  request: Request,
  ctx: ExecutionContext,
  connect: () => Promise<Socket>,
): Response {
  if (new URL(request.url).pathname !== "/ssh") {
    return new Response("Not found", { status: 404 });
  }
  if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("WebSocket upgrade required", {
      status: 426,
      headers: { Upgrade: "websocket" },
    });
  }

  const { 0: client, 1: server } = new WebSocketPair();
  let input: ReadableStreamDefaultController<Uint8Array>;
  const fromClient = new ReadableStream<Uint8Array>({
    start(controller) {
      input = controller;
    },
  }, new ByteLengthQueuingStrategy({ highWaterMark: MAX_PENDING_BYTES }));

  let socket: Socket | undefined;
  let socketClosing: Promise<void> | undefined;
  let stopped = false;

  function stop(code: number, reason: string) {
    if (stopped) return;
    stopped = true;
    input.error(new Error(reason));
    socketClosing = socket?.close().catch(() => {});
    server.close(code, reason);
  }

  server.binaryType = "arraybuffer";
  server.addEventListener("message", ({ data }) => {
    if (stopped) return;
    if (!(data instanceof ArrayBuffer)) {
      stop(1003, "Binary messages required");
      return;
    }
    if (data.byteLength > (input.desiredSize ?? 0)) {
      stop(1009, "Client queue limit exceeded");
      return;
    }
    if (data.byteLength !== 0) input.enqueue(new Uint8Array(data));
  });
  server.addEventListener("close", () => stop(1000, "Client closed"));
  server.addEventListener("error", () => stop(1011, "WebSocket error"));
  server.accept();

  async function relay() {
    try {
      socket = await connect();
      // Let the streams report errors after delivering any remaining TCP data.
      void socket.closed.catch(() => {});
      if (stopped) return;

      const toClient = new WritableStream<Uint8Array>({
        write(chunk) {
          if (stopped) return;
          for (let offset = 0; offset < chunk.byteLength; offset += MAX_FRAME_BYTES) {
            server.send(chunk.subarray(offset, offset + MAX_FRAME_BYTES));
          }
        },
      });
      await Promise.race([
        fromClient.pipeTo(socket.writable),
        socket.readable.pipeTo(toClient),
      ]);
      stop(1000, "TCP closed");
    } catch (error) {
      if (!stopped) console.error("SSH relay failed", error);
      stop(1011, "TCP error");
    } finally {
      await (socketClosing ?? socket?.close().catch(() => {}));
    }
  }

  ctx.waitUntil(relay());
  return new Response(null, { status: 101, webSocket: client });
}
