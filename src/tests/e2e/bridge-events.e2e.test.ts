import { afterEach, describe, expect, it } from "bun:test";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { WebSocket } from "ws";

import { UNIVERSAL_WS_SUBPROTOCOL } from "../../bridge/constants.js";
import {
  type StandaloneBridgeServer,
  startStandaloneUniversalBridgeServer,
} from "../../bridge/standalone.js";

interface RuntimeStatusEvent {
  type: "runtime-status";
  protocolVersion: string;
  eventId: number;
  timestamp: number;
  status: {
    phase: string;
  };
}

interface RuntimeErrorEvent {
  type: "runtime-error";
  protocolVersion: string;
  eventId: number;
  timestamp: number;
  error: string;
}

type BridgeEvent = RuntimeStatusEvent | RuntimeErrorEvent;

const fixtureRuntimeScript = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/runtime-e2e-server.cjs",
);

const standaloneServers = new Set<StandaloneBridgeServer>();
const sockets = new Set<WebSocket>();

afterEach(async () => {
  await Promise.all(
    [...sockets].map(
      (socket) =>
        new Promise<void>((resolve) => {
          if (socket.readyState === WebSocket.CLOSED) {
            resolve();
            return;
          }
          socket.once("close", () => resolve());
          socket.close();
        }),
    ),
  );
  sockets.clear();

  await Promise.all(
    [...standaloneServers].map(async (server) => {
      await server.close();
    }),
  );
  standaloneServers.clear();
});

function toWebSocketUrl(baseUrl: string): string {
  return baseUrl.replace(/^http/, "ws");
}

async function waitForRuntimePhase(
  socket: WebSocket,
  expectedPhase: string,
): Promise<RuntimeStatusEvent> {
  return await new Promise<RuntimeStatusEvent>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for phase: ${expectedPhase}`)),
      10000,
    );

    const onMessage = (payload: WebSocket.RawData) => {
      try {
        const event = JSON.parse(payload.toString()) as BridgeEvent;
        if (
          event.type === "runtime-status" &&
          event.status.phase === expectedPhase
        ) {
          clearTimeout(timeout);
          socket.off("message", onMessage);
          resolve(event);
        }
      } catch {
        // Ignore invalid event payloads.
      }
    };

    socket.on("message", onMessage);
  });
}

describe("bridge events e2e", () => {
  it("emits runtime-status events for start and stop", async () => {
    const server = await startStandaloneUniversalBridgeServer({
      autoStart: false,
      command: process.execPath,
      args: [fixtureRuntimeScript],
      startTimeoutMs: 5000,
    });
    standaloneServers.add(server);

    const socket = new WebSocket(
      `${toWebSocketUrl(server.baseUrl)}/__universal/events`,
      [UNIVERSAL_WS_SUBPROTOCOL],
    );
    sockets.add(socket);

    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", (error) => reject(error));
    });
    expect(socket.protocol).toBe(UNIVERSAL_WS_SUBPROTOCOL);

    const runningPhasePromise = waitForRuntimePhase(socket, "running");
    await fetch(`${server.baseUrl}/__universal/runtime/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const runningPhase = await runningPhasePromise;
    expect(runningPhase.protocolVersion).toBe("1");

    const stoppedPhasePromise = waitForRuntimePhase(socket, "stopped");
    await fetch(`${server.baseUrl}/__universal/runtime/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const stoppedPhase = await stoppedPhasePromise;
    expect(stoppedPhase.protocolVersion).toBe("1");
    expect(stoppedPhase.eventId).toBeGreaterThan(runningPhase.eventId);
  });

  it("accepts websocket when supported subprotocol is present in offered list", async () => {
    const server = await startStandaloneUniversalBridgeServer({
      autoStart: false,
    });
    standaloneServers.add(server);

    const socket = new WebSocket(
      `${toWebSocketUrl(server.baseUrl)}/__universal/events`,
      ["universal.v999+json", UNIVERSAL_WS_SUBPROTOCOL],
    );
    sockets.add(socket);

    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", (error) => reject(error));
    });

    expect(socket.protocol).toBe(UNIVERSAL_WS_SUBPROTOCOL);
  });
});
