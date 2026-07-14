import { afterEach, describe, expect, it } from "bun:test";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { WebSocket } from "ws";

import {
  type StandaloneBridgeServer,
  startStandaloneUniversalBridgeServer,
} from "../bridge/standalone.js";
import type { UniversalWebSocketLike } from "../client/client.js";
import { createBridgeRuntimeStore } from "../client/runtime-store.js";

const fixtureRuntimeScript = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "./fixtures/runtime-e2e-server.cjs",
);
const servers = new Set<StandaloneBridgeServer>();

afterEach(async () => {
  await Promise.all([...servers].map((server) => server.close()));
  servers.clear();
});

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for runtime store state");
}

describe("bridge runtime store", () => {
  it("shares one store and synchronizes lifecycle actions from snapshots", async () => {
    const server = await startStandaloneUniversalBridgeServer({
      autoStart: false,
      command: process.execPath,
      args: [fixtureRuntimeScript],
      startTimeoutMs: 5_000,
    });
    servers.add(server);

    const options = {
      baseUrl: server.baseUrl,
      webSocketFactory: (url: string, protocols: string[]) =>
        new WebSocket(url, protocols) as unknown as UniversalWebSocketLike,
    };
    const first = createBridgeRuntimeStore(options);
    const second = createBridgeRuntimeStore(options);
    expect(first).toBe(second);

    const unsubscribe = first.subscribe(() => {});
    await waitFor(() => first.getSnapshot().bridgeState !== null);
    expect(first.getSnapshot().bridgeState?.runtime.phase).toBe("stopped");

    await second.start();
    await waitFor(
      () => first.getSnapshot().bridgeState?.runtime.phase === "running",
    );
    expect(first.getSnapshot().bridgeState?.transportState).toBe("connected");

    await first.stop();
    await waitFor(
      () => first.getSnapshot().bridgeState?.runtime.phase === "stopped",
    );
    expect(first.getSnapshot().bridgeState?.transportState).toBe(
      "bridge_detecting",
    );

    unsubscribe();
    first.destroy();
  });
});
