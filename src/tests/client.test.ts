import { afterEach, describe, expect, it } from "bun:test";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { WebSocket } from "ws";

import {
  type StandaloneBridgeServer,
  startStandaloneUniversalBridgeServer,
} from "../bridge/standalone.js";
import {
  UniversalClientError,
  createUniversalClient,
} from "../client/client.js";
import type { UniversalBridgeEvent } from "../types.js";

const fixtureRuntimeScript = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "./fixtures/runtime-e2e-server.cjs",
);

const standaloneServers = new Set<StandaloneBridgeServer>();

afterEach(async () => {
  await Promise.all(
    [...standaloneServers].map(async (server) => {
      await server.close();
    }),
  );
  standaloneServers.clear();
});

async function waitForEvent(
  events: UniversalBridgeEvent[],
  predicate: (event: UniversalBridgeEvent) => boolean,
  timeoutMs = 4000,
): Promise<UniversalBridgeEvent> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const match = events.find(predicate);
    if (match) {
      return match;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error("Timed out waiting for bridge event");
}

describe("universal-bridge client", () => {
  it("resolves namespaced bridge routes from namespaceId", async () => {
    const server = await startStandaloneUniversalBridgeServer({
      autoStart: false,
      bridgePathPrefix: "/__universal/tests-client",
    });
    standaloneServers.add(server);

    const client = createUniversalClient({
      baseUrl: server.baseUrl,
      namespaceId: "tests-client",
    });
    const health = await client.getHealth();

    expect(health.ok).toBe(true);
    expect(health.bridge).toBe(true);
  });

  it("reads health and bridge state", async () => {
    const server = await startStandaloneUniversalBridgeServer({
      autoStart: false,
    });
    standaloneServers.add(server);

    const client = createUniversalClient({
      baseUrl: server.baseUrl,
    });
    const health = await client.getHealth();
    const state = await client.getState();

    expect(health.ok).toBe(true);
    expect(health.bridge).toBe(true);
    expect(health.protocolVersion).toBe("2");
    expect(state.protocolVersion).toBe("2");
    expect(state.runtime.phase).toBe("stopped");
  });

  it("constructs the stable runtime WebSocket gateway URL", () => {
    const client = createUniversalClient({
      baseUrl: "https://bridge.example.dev/app/",
      namespaceId: "tests-client",
    });
    expect(
      client.getRuntimeWebSocketUrl({ query: { session: "one", retry: 2 } }),
    ).toBe(
      "wss://bridge.example.dev/__universal/tests-client/runtime/ws?session=one&retry=2",
    );
  });

  it("controls runtime lifecycle through the typed client", async () => {
    const server = await startStandaloneUniversalBridgeServer({
      autoStart: false,
      command: process.execPath,
      args: [fixtureRuntimeScript],
      startTimeoutMs: 5000,
    });
    standaloneServers.add(server);

    const client = createUniversalClient({
      baseUrl: server.baseUrl,
    });

    const started = await client.startRuntime();
    expect(started.phase).toBe("running");

    const status = await client.getRuntimeStatus();
    expect(status.phase).toBe("running");

    const restarted = await client.restartRuntime();
    expect(restarted.phase).toBe("running");

    const stopped = await client.stopRuntime();
    expect(stopped.phase).toBe("stopped");
  });

  it("throws a typed client error for failed runtime start", async () => {
    const server = await startStandaloneUniversalBridgeServer({
      autoStart: false,
    });
    standaloneServers.add(server);

    const client = createUniversalClient({
      baseUrl: server.baseUrl,
    });

    let error: unknown = null;
    try {
      await client.startRuntime();
    } catch (caughtError) {
      error = caughtError;
    }

    expect(error).toBeInstanceOf(UniversalClientError);
    const typedError = error as UniversalClientError;
    expect(typedError.statusCode).toBe(503);
    expect(typedError.response?.error.code).toBe("runtime_start_failed");
  });

  it("subscribes to bridge events", async () => {
    const server = await startStandaloneUniversalBridgeServer({
      autoStart: false,
      command: process.execPath,
      args: [fixtureRuntimeScript],
      startTimeoutMs: 5000,
    });
    standaloneServers.add(server);

    const events: UniversalBridgeEvent[] = [];
    const client = createUniversalClient({
      baseUrl: server.baseUrl,
      webSocketFactory: (url, protocols) =>
        new WebSocket(url, protocols) as unknown as {
          close: () => void;
          on: (event: string, listener: (...args: unknown[]) => void) => void;
          off: (event: string, listener: (...args: unknown[]) => void) => void;
        },
    });

    const unsubscribe = client.subscribeEvents((event) => {
      events.push(event);
    });

    await client.startRuntime();
    const runningEvent = await waitForEvent(
      events,
      (event) =>
        event.type === "bridge-state" &&
        event.state.runtime.phase === "running",
    );
    expect(runningEvent.protocolVersion).toBe("2");

    unsubscribe();
  });
});
