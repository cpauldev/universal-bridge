import { afterEach, describe, expect, it } from "bun:test";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

import {
  type StandaloneBridgeServer,
  startStandaloneUniversalBridgeServer,
} from "../../bridge/standalone.js";

const fixtureRuntimeScript = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/runtime-e2e-server.cjs",
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

describe("runtime control e2e", () => {
  it("starts, restarts, stops runtime and proxies API calls", async () => {
    const server = await startStandaloneUniversalBridgeServer({
      autoStart: false,
      command: process.execPath,
      args: [fixtureRuntimeScript],
      startTimeoutMs: 5000,
    });
    standaloneServers.add(server);

    const initialStatus = (await (
      await fetch(`${server.baseUrl}/__universal/runtime/status`)
    ).json()) as { phase: string };
    expect(initialStatus.phase).toBe("stopped");

    const startResult = (await (
      await fetch(`${server.baseUrl}/__universal/runtime/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    ).json()) as {
      success: boolean;
      runtime: { phase: string; pid: number | null };
    };
    expect(startResult.success).toBe(true);
    expect(startResult.runtime.phase).toBe("running");
    expect(typeof startResult.runtime.pid).toBe("number");

    const versionResponse = await fetch(
      `${server.baseUrl}/__universal/api/version`,
    );
    expect(versionResponse.ok).toBe(true);
    const versionPayload = (await versionResponse.json()) as {
      ok: boolean;
      runtime: string;
    };
    expect(versionPayload.ok).toBe(true);
    expect(versionPayload.runtime).toBe("e2e");

    const echoResponse = await fetch(`${server.baseUrl}/__universal/api/echo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hello" }),
    });
    expect(echoResponse.ok).toBe(true);
    const echoPayload = (await echoResponse.json()) as {
      method: string;
      body: string;
    };
    expect(echoPayload.method).toBe("POST");
    expect(echoPayload.body).toBe(JSON.stringify({ message: "hello" }));

    const binaryBody = new Uint8Array([0x00, 0x01, 0xff, 0xfe, 0x0a]);
    const binaryEchoResponse = await fetch(
      `${server.baseUrl}/__universal/api/echo-binary`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
        },
        body: binaryBody,
      },
    );
    expect(binaryEchoResponse.ok).toBe(true);
    const binaryEchoPayload = (await binaryEchoResponse.json()) as {
      bodyHex: string;
    };
    expect(binaryEchoPayload.bodyHex).toBe("0001fffe0a");

    const cookieResponse = await fetch(
      `${server.baseUrl}/__universal/api/cookies`,
    );
    expect(cookieResponse.ok).toBe(true);
    const responseHeaders = cookieResponse.headers as Headers & {
      getSetCookie?: () => string[];
    };
    const setCookieValues =
      typeof responseHeaders.getSetCookie === "function"
        ? responseHeaders.getSetCookie()
        : cookieResponse.headers.get("set-cookie")
          ? [cookieResponse.headers.get("set-cookie") as string]
          : [];
    expect(setCookieValues).toEqual([
      "session=abc; Path=/; HttpOnly",
      "theme=dark; Path=/",
    ]);

    const restartResult = (await (
      await fetch(`${server.baseUrl}/__universal/runtime/restart`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    ).json()) as {
      success: boolean;
      runtime: { phase: string };
    };
    expect(restartResult.success).toBe(true);
    expect(restartResult.runtime.phase).toBe("running");

    const stopResult = (await (
      await fetch(`${server.baseUrl}/__universal/runtime/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    ).json()) as {
      success: boolean;
      runtime: { phase: string };
    };
    expect(stopResult.success).toBe(true);
    expect(stopResult.runtime.phase).toBe("stopped");

    const proxyAfterStop = await fetch(
      `${server.baseUrl}/__universal/api/version`,
    );
    expect(proxyAfterStop.status).toBe(503);
    const proxyAfterStopPayload = (await proxyAfterStop.json()) as {
      success: false;
      message: string;
      error: {
        code: string;
      };
    };
    expect(proxyAfterStopPayload.success).toBe(false);
    expect(proxyAfterStopPayload.error.code).toBe("runtime_unavailable");
  });
});
