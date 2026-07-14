import { afterEach, describe, expect, it } from "bun:test";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { WebSocket } from "ws";

import {
  type StandaloneBridgeServer,
  startStandaloneUniversalBridgeServer,
} from "../../bridge/standalone.js";
import { createUniversalClient } from "../../client/client.js";

const fixtureRuntimeScript = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/runtime-websocket-server.cjs",
);
const servers = new Set<StandaloneBridgeServer>();
const sockets = new Set<WebSocket>();

afterEach(async () => {
  for (const socket of sockets) {
    socket.close();
  }
  sockets.clear();
  await Promise.all([...servers].map((server) => server.close()));
  servers.clear();
});

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
}

function waitForMessage(socket: WebSocket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    socket.once("message", (data) => resolve(toBuffer(data)));
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

function waitForClose(
  socket: WebSocket,
): Promise<{ code: number; reason: Buffer }> {
  return new Promise((resolve) => {
    socket.once("close", (code, reason) => resolve({ code, reason }));
  });
}

describe("runtime WebSocket gateway", () => {
  it("constructs gateway URLs across namespaces, HTTPS, trailing slashes, and queries", () => {
    const plain = createUniversalClient({
      baseUrl: "http://bridge.example.dev/app/",
    });
    expect(plain.getRuntimeWebSocketUrl()).toBe(
      "ws://bridge.example.dev/__universal/runtime/ws",
    );

    const namespaced = createUniversalClient({
      baseUrl: "https://bridge.example.dev/app/",
      namespaceId: "tools/acme",
    });
    expect(
      namespaced.getRuntimeWebSocketUrl({
        query: { session: "one", retry: 2, enabled: true, skip: undefined },
      }),
    ).toBe(
      "wss://bridge.example.dev/__universal/tools/acme/runtime/ws?session=one&retry=2&enabled=true",
    );
  });

  it("auto-starts the runtime and proxies query, subprotocol, text, and binary frames", async () => {
    const server = await startStandaloneUniversalBridgeServer({
      command: process.execPath,
      args: [fixtureRuntimeScript],
      startTimeoutMs: 5_000,
      runtimeWebSocketGateway: { path: "/socket" },
    });
    servers.add(server);

    const client = createUniversalClient({ baseUrl: server.baseUrl });
    expect(client.getRuntimeWebSocketUrl({ query: { session: "one" } })).toBe(
      `${server.baseUrl.replace("http://", "ws://")}/__universal/runtime/ws?session=one`,
    );

    const socket = new WebSocket(
      client.getRuntimeWebSocketUrl({ query: { session: "one" } }),
      ["runtime.v1"],
    );
    sockets.add(socket);
    await waitForOpen(socket);
    expect(socket.protocol).toBe("runtime.v1");

    const ready = JSON.parse((await waitForMessage(socket)).toString()) as {
      query: string;
    };
    expect(ready.query).toBe("session=one");

    const text = waitForMessage(socket);
    socket.send("hello");
    expect((await text).toString()).toBe("hello");

    const binary = waitForMessage(socket);
    socket.send(Buffer.from([1, 2, 3]));
    expect(await binary).toEqual(Buffer.from([1, 2, 3]));
  });

  it("reports disabled gateway capability and rejects gateway connections", async () => {
    const server = await startStandaloneUniversalBridgeServer({
      autoStart: false,
    });
    servers.add(server);
    expect(
      server.bridge.getState().capabilities.hasRuntimeWebSocketGateway,
    ).toBe(false);

    const socket = new WebSocket(
      `${server.baseUrl.replace("http://", "ws://")}/__universal/runtime/ws`,
    );
    sockets.add(socket);
    socket.on("error", () => {});
    await new Promise<void>((resolve) => {
      socket.once("error", () => resolve());
    });
  });

  it("closes only the paired gateway socket when the runtime closes", async () => {
    const server = await startStandaloneUniversalBridgeServer({
      command: process.execPath,
      args: [fixtureRuntimeScript],
      startTimeoutMs: 5_000,
      runtimeWebSocketGateway: { path: "/socket" },
    });
    servers.add(server);

    const eventSocket = new WebSocket(
      `${server.baseUrl.replace("http://", "ws://")}/__universal/events`,
      ["universal.v2+json"],
    );
    sockets.add(eventSocket);
    await waitForOpen(eventSocket);
    const bridgeErrors: unknown[] = [];
    eventSocket.on("message", (data) => {
      const event = JSON.parse(data.toString()) as { type: string };
      if (event.type === "bridge-error") bridgeErrors.push(event);
    });

    const client = createUniversalClient({ baseUrl: server.baseUrl });
    const socket = new WebSocket(client.getRuntimeWebSocketUrl(), [
      "runtime.v1",
    ]);
    sockets.add(socket);
    await waitForOpen(socket);
    await waitForMessage(socket);

    const closed = waitForClose(socket);
    socket.send("close-now");
    expect((await closed).reason.toString()).toBe("runtime complete");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(bridgeErrors).toEqual([]);
  });

  it("keeps bridge events protocol-only when runtime frames are exchanged", async () => {
    const server = await startStandaloneUniversalBridgeServer({
      command: process.execPath,
      args: [fixtureRuntimeScript],
      startTimeoutMs: 5_000,
      runtimeWebSocketGateway: { path: "/socket" },
    });
    servers.add(server);

    const events = new WebSocket(
      `${server.baseUrl.replace("http://", "ws://")}/__universal/events`,
      ["universal.v2+json"],
    );
    sockets.add(events);
    await waitForOpen(events);
    const initialEvent = JSON.parse(
      (await waitForMessage(events)).toString(),
    ) as {
      type: string;
    };
    expect(["bridge-state", "bridge-error"]).toContain(initialEvent.type);

    const receivedEventTypes: string[] = [initialEvent.type];
    events.on("message", (data) => {
      const event = JSON.parse(toBuffer(data).toString()) as { type: string };
      receivedEventTypes.push(event.type);
    });

    const client = createUniversalClient({ baseUrl: server.baseUrl });
    const socket = new WebSocket(client.getRuntimeWebSocketUrl(), [
      "runtime.v1",
    ]);
    sockets.add(socket);
    await waitForOpen(socket);
    await waitForMessage(socket);
    const echoed = waitForMessage(socket);
    socket.send("runtime-only-frame");
    expect((await echoed).toString()).toBe("runtime-only-frame");

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(receivedEventTypes.every((type) => type.startsWith("bridge-"))).toBe(
      true,
    );
  });

  it("keeps simultaneous gateway sockets independent", async () => {
    const server = await startStandaloneUniversalBridgeServer({
      command: process.execPath,
      args: [fixtureRuntimeScript],
      startTimeoutMs: 5_000,
      runtimeWebSocketGateway: { path: "/socket" },
    });
    servers.add(server);

    const client = createUniversalClient({ baseUrl: server.baseUrl });
    const first = new WebSocket(
      client.getRuntimeWebSocketUrl({ query: { socket: "first" } }),
      ["runtime.v1"],
    );
    const second = new WebSocket(
      client.getRuntimeWebSocketUrl({ query: { socket: "second" } }),
      ["runtime.v1"],
    );
    sockets.add(first);
    sockets.add(second);
    const firstReady = waitForMessage(first);
    const secondReady = waitForMessage(second);
    await Promise.all([waitForOpen(first), waitForOpen(second)]);

    expect((await firstReady).toString()).toContain("socket=first");
    expect((await secondReady).toString()).toContain("socket=second");

    const firstEcho = waitForMessage(first);
    const secondEcho = waitForMessage(second);
    first.send("from-first");
    second.send("from-second");
    expect((await firstEcho).toString()).toBe("from-first");
    expect((await secondEcho).toString()).toBe("from-second");

    const firstClosed = waitForClose(first);
    first.close();
    await firstClosed;

    const stillOpenEcho = waitForMessage(second);
    second.send("still-open");
    expect((await stillOpenEcho).toString()).toBe("still-open");
  });

  it("handles an abnormal runtime close without crashing the gateway", async () => {
    const server = await startStandaloneUniversalBridgeServer({
      command: process.execPath,
      args: [fixtureRuntimeScript],
      startTimeoutMs: 5_000,
      runtimeWebSocketGateway: { path: "/socket" },
    });
    servers.add(server);

    const client = createUniversalClient({ baseUrl: server.baseUrl });
    const first = new WebSocket(client.getRuntimeWebSocketUrl(), [
      "runtime.v1",
    ]);
    sockets.add(first);
    await waitForOpen(first);
    await waitForMessage(first);

    const closed = waitForClose(first);
    first.send("terminate-now");
    await closed;

    const second = new WebSocket(client.getRuntimeWebSocketUrl(), [
      "runtime.v1",
    ]);
    sockets.add(second);
    await waitForOpen(second);
    await waitForMessage(second);
  });

  it("reconnects through the same gateway URL after runtime restart", async () => {
    const server = await startStandaloneUniversalBridgeServer({
      command: process.execPath,
      args: [fixtureRuntimeScript],
      startTimeoutMs: 5_000,
      runtimeWebSocketGateway: { path: "/socket" },
    });
    servers.add(server);

    const client = createUniversalClient({ baseUrl: server.baseUrl });
    const url = client.getRuntimeWebSocketUrl({ query: { reconnect: "yes" } });
    const first = new WebSocket(url, ["runtime.v1"]);
    sockets.add(first);
    await waitForOpen(first);
    await waitForMessage(first);

    const closed = waitForClose(first);
    const restarted = await fetch(
      `${server.baseUrl}/__universal/runtime/restart`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
    );
    expect(restarted.ok).toBe(true);
    await closed;

    const second = new WebSocket(url, ["runtime.v1"]);
    sockets.add(second);
    await waitForOpen(second);
    const ready = JSON.parse((await waitForMessage(second)).toString()) as {
      query: string;
    };
    expect(ready.query).toBe("reconnect=yes");
  });

  it("does not auto-start a stopped runtime from a gateway connection", async () => {
    const server = await startStandaloneUniversalBridgeServer({
      command: process.execPath,
      args: [fixtureRuntimeScript],
      startTimeoutMs: 5_000,
      runtimeWebSocketGateway: { path: "/socket" },
    });
    servers.add(server);

    const client = createUniversalClient({ baseUrl: server.baseUrl });
    await client.startRuntime();
    await client.stopRuntime();
    expect((await client.getRuntimeStatus()).phase).toBe("stopped");

    const socket = new WebSocket(client.getRuntimeWebSocketUrl(), [
      "runtime.v1",
    ]);
    sockets.add(socket);
    socket.on("error", () => {});
    await new Promise<void>((resolve) => {
      socket.once("error", () => resolve());
    });
    expect((await client.getRuntimeStatus()).phase).toBe("stopped");

    await client.startRuntime();
    const next = new WebSocket(client.getRuntimeWebSocketUrl(), ["runtime.v1"]);
    sockets.add(next);
    await waitForOpen(next);
    await waitForMessage(next);
  });
});
