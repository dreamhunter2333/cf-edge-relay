import { setTimeout as delay } from "node:timers/promises";

const { stdin, stdout, stderr } = process;
const url = process.argv[2];
if (!/^wss?:\/\//i.test(url ?? "")) {
  stderr.write("Usage: node scripts/ssh-ws.mjs wss://worker.example/ssh\n");
  process.exit(1);
}

const frameBytes = 64 * 1024;
const queueBytes = 1024 * 1024;
const socket = new WebSocket(url);
socket.binaryType = "arraybuffer";

let stopped = false;
let closeTimer;
const connectTimer = setTimeout(() => stop("WebSocket connection timed out"), 15_000);

function stop(message) {
  if (stopped) return;
  stopped = true;
  clearTimeout(connectTimer);
  stdin.destroy();
  if (message) {
    stderr.write(`SSH relay: ${message}\n`);
    process.exitCode = 1;
  }
  if (socket.readyState === WebSocket.CLOSED) return;
  socket.close();
  closeTimer = setTimeout(() => process.exit(process.exitCode || 1), 5_000).unref();
}

async function sendInput() {
  for await (const chunk of stdin) {
    for (let offset = 0; offset < chunk.length; offset += frameBytes) {
      while (!stopped && socket.bufferedAmount >= queueBytes) await delay(5);
      if (stopped || socket.readyState !== WebSocket.OPEN) return;
      socket.send(chunk.subarray(offset, offset + frameBytes));
    }
  }
  stop();
}

socket.addEventListener("open", () => {
  clearTimeout(connectTimer);
  void sendInput().catch((error) => stop(error.message));
});
socket.addEventListener("message", ({ data }) => {
  if (stopped) return;
  if (!(data instanceof ArrayBuffer)) {
    stop("Expected a binary WebSocket frame");
    return;
  }
  if (stdout.writableLength + data.byteLength > queueBytes) {
    stop("SSH output queue limit exceeded");
    return;
  }
  stdout.write(Buffer.from(data));
});
socket.addEventListener("error", (event) => stop(event.message || "WebSocket connection failed"));
socket.addEventListener("close", ({ code, reason }) => {
  clearTimeout(closeTimer);
  stop(code === 1000 || code === 1005 ? undefined : reason || `WebSocket closed (${code})`);
});
stdout.on("error", (error) => stop(error.code === "EPIPE" ? undefined : error.message));
