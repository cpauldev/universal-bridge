import { afterEach, describe, expect, it } from "bun:test";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { WebSocket } from "ws";

import { withUniversalNext } from "../../adapters/framework/next.js";
import {
  UNIVERSAL_NEXT_BRIDGE_GLOBAL_KEY,
  type UniversalRewriteSpec,
} from "../../adapters/shared/adapter-utils.js";

const originalNodeEnv = process.env.NODE_ENV;
const testBridgeKey = `${UNIVERSAL_NEXT_BRIDGE_GLOBAL_KEY}:test-next-integration`;
const fixtureRuntimeScript = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/runtime-websocket-server.cjs",
);

type NextConfigWithRewrites = {
  rewrites?: () => Promise<UniversalRewriteSpec> | UniversalRewriteSpec;
};

function toBuffer(data: unknown): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data));
  if (Array.isArray(data)) return Buffer.concat(data);
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  return Buffer.from(String(data));
}

afterEach(async () => {
  process.env.NODE_ENV = originalNodeEnv;

  const bridgeGlobal = globalThis as typeof globalThis & {
    [key: string]: unknown;
  };
  const bridgePromise = bridgeGlobal[testBridgeKey] as
    Promise<{ close: () => Promise<void> }> | undefined;
  if (bridgePromise) {
    const standalone = await bridgePromise;
    await standalone.close();
  }
  delete bridgeGlobal[testBridgeKey];
});

describe("next integration", () => {
  it("starts standalone bridge and rewrites to it", async () => {
    process.env.NODE_ENV = "development";
    const wrapped = withUniversalNext<NextConfigWithRewrites>(
      {
        rewrites: async () => [
          {
            source: "/docs/:path*",
            destination: "/docs",
          },
        ],
      },
      { nextBridgeGlobalKey: testBridgeKey },
    );
    const rewrites = await wrapped.rewrites?.();
    if (!rewrites) {
      throw new Error("Expected rewrites to be defined");
    }

    const normalized = Array.isArray(rewrites)
      ? { beforeFiles: rewrites, afterFiles: [], fallback: [] }
      : rewrites;
    const route = normalized.beforeFiles?.[0];
    if (!route) {
      throw new Error("Expected bridge rewrite route");
    }

    expect(route?.source).toBe("/__universal/:path*");
    expect(route?.destination).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/__universal\/:path\*$/,
    );

    const baseUrl = route.destination.replace("/__universal/:path*", "");
    const response = await fetch(`${baseUrl}/__universal/health`);
    expect(response.ok).toBe(true);
    const payload = (await response.json()) as { protocolVersion: string };
    expect(payload.protocolVersion).toBe("2");
  });

  it("starts a gateway-capable standalone rewrite target", async () => {
    process.env.NODE_ENV = "development";
    const wrapped = withUniversalNext<NextConfigWithRewrites>(
      {},
      {
        nextBridgeGlobalKey: testBridgeKey,
        command: process.execPath,
        args: [fixtureRuntimeScript],
        startTimeoutMs: 5_000,
        runtimeWebSocketGateway: { path: "/socket" },
      },
    );
    const rewrites = await wrapped.rewrites?.();
    if (!rewrites) throw new Error("Expected rewrites to be defined");
    const normalized = Array.isArray(rewrites)
      ? { beforeFiles: rewrites }
      : rewrites;
    const route = normalized.beforeFiles?.[0];
    if (!route) throw new Error("Expected bridge rewrite route");

    const baseUrl = route.destination.replace("/__universal/:path*", "");
    const socket = new WebSocket(
      `${baseUrl.replace("http://", "ws://")}/__universal/runtime/ws?via=next`,
      ["runtime.v1"],
    );
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    expect(socket.protocol).toBe("runtime.v1");
    const message = await new Promise<Buffer>((resolve, reject) => {
      socket.once("message", (data) => resolve(toBuffer(data)));
      socket.once("error", reject);
    });
    expect(message.toString()).toContain("via=next");
    socket.close();
  });
});
