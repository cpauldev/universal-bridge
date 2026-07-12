import { afterEach, describe, expect, it } from "bun:test";

import { UniversalBridge } from "../bridge/bridge.js";
import { UNIVERSAL_WS_SUBPROTOCOL } from "../bridge/constants.js";
import {
  type StandaloneBridgeServer,
  startStandaloneUniversalBridgeServer,
} from "../bridge/standalone.js";

const bridges: UniversalBridge[] = [];
const standaloneServers: StandaloneBridgeServer[] = [];

async function requestJson<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const payload = (await response.json()) as T;
  expect(response.ok).toBe(true);
  return payload;
}

afterEach(async () => {
  await Promise.all(
    standaloneServers.map(async (server) => {
      await server.close();
    }),
  );
  standaloneServers.length = 0;

  await Promise.all(
    bridges.map(async (bridge) => {
      await bridge.close();
    }),
  );
  bridges.length = 0;
});

describe("UniversalBridge", () => {
  it("reports runtime control as unavailable when command is not configured", () => {
    const bridge = new UniversalBridge({ autoStart: false });
    bridges.push(bridge);

    const state = bridge.getState();
    expect(state.capabilities.hasRuntimeControl).toBe(false);
    expect(state.capabilities.commandHost).toBe("host");
    expect(state.capabilities.canStartRuntime).toBe(false);
    expect(state.capabilities.canRestartRuntime).toBe(false);
    expect(state.capabilities.canStopRuntime).toBe(false);
    expect(state.runtime.phase).toBe("stopped");
    expect(state.transportState).toBe("bridge_detecting");
  });

  it("reports runtime control as available when command is configured", () => {
    const bridge = new UniversalBridge({
      autoStart: false,
      command: process.execPath,
      args: ["-e", "setTimeout(() => process.exit(0), 1000)"],
    });
    bridges.push(bridge);

    const state = bridge.getState();
    expect(state.capabilities.hasRuntimeControl).toBe(true);
    expect(state.capabilities.commandHost).toBe("hybrid");
    expect(state.capabilities.canStartRuntime).toBe(true);
    expect(state.capabilities.canRestartRuntime).toBe(true);
    expect(state.capabilities.canStopRuntime).toBe(true);
  });

  it("returns a deterministic error for runtime start without command", async () => {
    const server = await startStandaloneUniversalBridgeServer({
      autoStart: false,
    });
    standaloneServers.push(server);

    const response = await fetch(
      `${server.baseUrl}/__universal/runtime/start`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: "{}",
      },
    );
    expect(response.status).toBe(503);
    const payload = (await response.json()) as {
      success: false;
      error: {
        code: string;
        details?: {
          reason?: string;
          fallbackCommand?: string;
        };
      };
    };
    expect(payload.success).toBe(false);
    expect(payload.error.code).toBe("runtime_start_failed");
    expect(payload.error.details?.reason).toBe("missing_command");
  });

  it("requires POST for runtime control routes", async () => {
    const server = await startStandaloneUniversalBridgeServer({
      autoStart: false,
      command: process.execPath,
      args: ["-e", "setTimeout(() => process.exit(0), 1000)"],
    });
    standaloneServers.push(server);

    const response = await fetch(`${server.baseUrl}/__universal/runtime/start`);
    expect(response.status).toBe(404);
    const payload = (await response.json()) as {
      success: false;
      error: {
        code: string;
      };
    };
    expect(payload.success).toBe(false);
    expect(payload.error.code).toBe("route_not_found");
  });

  it("disables auto-start after explicit stop", async () => {
    const server = await startStandaloneUniversalBridgeServer({
      autoStart: true,
      command: process.execPath,
      args: ["-e", "setTimeout(() => process.exit(1), 10)"],
      startTimeoutMs: 250,
    });
    standaloneServers.push(server);

    const stateBeforeStop = await requestJson<{
      protocolVersion: string;
      runtime: { phase: string; lastError: string | null };
      transportState: string;
    }>(server.baseUrl, "/__universal/state");

    expect(stateBeforeStop.protocolVersion).toBe("1");
    expect(stateBeforeStop.runtime.phase).toBe("error");
    expect(stateBeforeStop.transportState).toBe("degraded");
    expect(typeof stateBeforeStop.runtime.lastError).toBe("string");

    const stopResult = await requestJson<{
      success: boolean;
      runtime: { phase: string };
    }>(server.baseUrl, "/__universal/runtime/stop", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    expect(stopResult.success).toBe(true);
    expect(stopResult.runtime.phase).toBe("stopped");

    const startedAt = Date.now();
    const stateAfterStop = await requestJson<{
      runtime: { phase: string; lastError: string | null };
      transportState: string;
    }>(server.baseUrl, "/__universal/state");
    const elapsedMs = Date.now() - startedAt;

    expect(stateAfterStop.runtime.phase).toBe("stopped");
    expect(stateAfterStop.transportState).toBe("bridge_detecting");
    expect(stateAfterStop.runtime.lastError).toBeNull();
    expect(elapsedMs).toBeLessThan(150);
  });

  it("accepts state route requests with query strings", async () => {
    const server = await startStandaloneUniversalBridgeServer({
      autoStart: false,
    });
    standaloneServers.push(server);

    const state = await requestJson<{
      protocolVersion: string;
      runtime: { phase: string };
    }>(server.baseUrl, "/__universal/state?source=test");
    expect(state.protocolVersion).toBe("1");
    expect(state.runtime.phase).toBe("stopped");
  });

  it("returns 426 response for unsupported websocket subprotocol", () => {
    const bridge = new UniversalBridge({ autoStart: false });
    bridges.push(bridge);

    let responseText = "";
    let destroyed = false;

    const socket = {
      end: (chunk?: string | Buffer) => {
        responseText =
          typeof chunk === "string"
            ? chunk
            : chunk
              ? chunk.toString("utf8")
              : "";
      },
      destroy: () => {
        destroyed = true;
      },
    } as unknown as import("stream").Duplex;

    const request = {
      url: "/__universal/events",
      headers: {
        "sec-websocket-protocol": "universal.v999+json",
      },
    } as unknown as import("http").IncomingMessage;

    bridge.handleUpgrade(request, socket, Buffer.alloc(0));

    expect(responseText).toContain("HTTP/1.1 426 Upgrade Required");
    const payload = responseText.split("\r\n\r\n")[1];
    const parsed = JSON.parse(payload) as {
      success: boolean;
      message: string;
      error: {
        code: string;
        details?: {
          wsSubprotocol?: string;
        };
      };
    };
    expect(parsed.success).toBe(false);
    expect(parsed.message).toContain("Unsupported WebSocket subprotocol");
    expect(parsed.error.code).toBe("invalid_request");
    expect(parsed.error.details?.wsSubprotocol).toBe(UNIVERSAL_WS_SUBPROTOCOL);
    expect(destroyed).toBe(false);
  });
});
