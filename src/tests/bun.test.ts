import { describe, expect, it } from "bun:test";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { WebSocket } from "ws";

import {
  type UniversalBunSocketData,
  attachUniversalToBunServe,
  withUniversalBunServeFetch,
  withUniversalBunServeWebSocketHandlers,
} from "../adapters/server/bun.js";

const fixtureRuntimeScript = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "./fixtures/runtime-websocket-server.cjs",
);

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
}

function waitForMessage(socket: WebSocket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    socket.once("message", (message) => resolve(toBuffer(message)));
    socket.once("error", reject);
  });
}

function toBuffer(data: unknown): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data));
  if (Array.isArray(data)) return Buffer.concat(data);
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  return Buffer.from(String(data));
}

describe("bun adapter", () => {
  it("proxies bridge routes and falls through for non-bridge routes", async () => {
    const handle = await attachUniversalToBunServe({ autoStart: false });
    const server = {
      upgrade: () => false,
    };
    const fetchHandler = handle.createFetchHandler(async () => {
      return new Response("app");
    });

    const appResponse = await fetchHandler(
      new Request("http://localhost:3000/app"),
      server,
    );
    expect(appResponse).toBeDefined();
    expect(await appResponse?.text()).toBe("app");

    const healthResponse = await fetchHandler(
      new Request("http://localhost:3000/__universal/health"),
      server,
    );
    expect(healthResponse).toBeDefined();
    expect(healthResponse?.status).toBe(200);
    const healthJson = await healthResponse?.json();
    expect(healthJson.ok).toBe(true);
    expect(healthJson.bridge).toBe(true);

    await handle.close();
  });

  it("upgrades websocket requests for bridge events route", async () => {
    const handle = await attachUniversalToBunServe({ autoStart: false });
    const upgrades: unknown[] = [];
    const server = {
      upgrade: (
        _request: Request,
        options: { data: UniversalBunSocketData },
      ) => {
        upgrades.push(options.data);
        return true;
      },
    };
    const fetchHandler = handle.createFetchHandler(async () => {
      return new Response("app");
    });

    const upgradeResponse = await fetchHandler(
      new Request("http://localhost:3000/__universal/events?source=ui", {
        headers: {
          upgrade: "websocket",
        },
      }),
      server,
    );

    expect(upgradeResponse).toBeUndefined();
    expect(upgrades.length).toBe(1);
    expect(upgrades[0]).toHaveProperty("__universal");

    await handle.close();
  });

  it("proxies runtime WebSockets through a real Bun server", async () => {
    const handle = await attachUniversalToBunServe({
      command: process.execPath,
      args: [fixtureRuntimeScript],
      startTimeoutMs: 5_000,
      runtimeWebSocketGateway: { path: "/socket" },
    });
    const server = Bun.serve({
      port: 0,
      fetch: withUniversalBunServeFetch(
        async () => new Response("app"),
        handle,
      ),
      websocket:
        withUniversalBunServeWebSocketHandlers<UniversalBunSocketData>(handle),
    });

    try {
      expect(
        handle.bridge.getState().capabilities.hasRuntimeWebSocketGateway,
      ).toBe(true);
      const events = new WebSocket(
        `ws://127.0.0.1:${server.port}/__universal/events`,
      );
      await waitForOpen(events);
      expect(events.protocol).toBe("");
      expect((await waitForMessage(events)).toString()).toContain(
        "bridge-state",
      );
      events.close();

      const socket = new WebSocket(
        `ws://127.0.0.1:${server.port}/__universal/runtime/ws?via=bun`,
        ["runtime.v1"],
      );
      await waitForOpen(socket);
      expect(socket.protocol).toBe("runtime.v1");
      expect((await waitForMessage(socket)).toString()).toContain("via=bun");

      const echoed = waitForMessage(socket);
      socket.send("first-frame");
      expect((await echoed).toString()).toBe("first-frame");
      socket.close();
    } finally {
      server.stop(true);
      await handle.close();
    }
  });

  it("delegates websocket handlers for non-universal-bridge sockets", async () => {
    const handle = await attachUniversalToBunServe({ autoStart: false });
    const calls = {
      open: 0,
      message: 0,
      close: 0,
      error: 0,
    };
    const handlers = handle.createWebSocketHandlers({
      open: () => {
        calls.open += 1;
      },
      message: () => {
        calls.message += 1;
      },
      close: () => {
        calls.close += 1;
      },
      error: () => {
        calls.error += 1;
      },
    });

    const socket = {
      data: {},
      send: () => {},
      close: () => {},
    };

    handlers.open?.(socket);
    handlers.message?.(socket, "ping");
    handlers.close?.(socket, 1000, "done");
    handlers.error?.(socket, new Error("oops"));

    expect(calls).toEqual({
      open: 1,
      message: 1,
      close: 1,
      error: 1,
    });

    await handle.close();
  });
});
