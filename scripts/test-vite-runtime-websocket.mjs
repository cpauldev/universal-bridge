import { once } from "node:events";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createUniversalVitePlugin } from "universal-bridge/vite";
import { createServer } from "vite";
import { WebSocket } from "ws";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeFixture = resolve(
  projectRoot,
  "src/tests/fixtures/runtime-websocket-server.cjs",
);

function withTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out`)), 10_000),
    ),
  ]);
}

const server = await createServer({
  appType: "custom",
  plugins: [
    createUniversalVitePlugin({
      command: process.execPath,
      args: [runtimeFixture],
      runtimeWebSocketGateway: { path: "/socket" },
      startTimeoutMs: 5_000,
    }),
  ],
  server: { host: "127.0.0.1", port: 0 },
});

try {
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") {
    throw new Error("Vite did not expose a TCP listening address");
  }

  const socket = new WebSocket(
    `ws://127.0.0.1:${address.port}/__universal/runtime/ws?via=vite`,
    ["runtime.v1"],
  );
  const messagePromise = once(socket, "message");
  await withTimeout(once(socket, "open"), "Vite gateway connection");
  if (socket.protocol !== "runtime.v1") {
    throw new Error(
      `Expected runtime.v1, received ${socket.protocol || "none"}`,
    );
  }
  const [message] = await withTimeout(messagePromise, "Vite gateway message");
  if (!Buffer.from(message).toString().includes("via=vite")) {
    throw new Error(
      "The Vite gateway did not forward the browser query string",
    );
  }
  socket.terminate();
  console.log("Vite runtime WebSocket gateway verified");
} finally {
  await withTimeout(server.close(), "Vite shutdown");
}
