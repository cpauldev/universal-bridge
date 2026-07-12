import { afterEach, describe, expect, it } from "bun:test";

import { withUniversalNext } from "../../adapters/framework/next.js";
import { UNIVERSAL_NEXT_BRIDGE_GLOBAL_KEY } from "../../adapters/shared/adapter-utils.js";

const originalNodeEnv = process.env.NODE_ENV;
const testBridgeKey = `${UNIVERSAL_NEXT_BRIDGE_GLOBAL_KEY}:test-next-integration`;

afterEach(async () => {
  process.env.NODE_ENV = originalNodeEnv;

  const bridgeGlobal = globalThis as typeof globalThis & {
    [key: string]: unknown;
  };
  const bridgePromise = bridgeGlobal[testBridgeKey] as
    | Promise<{ close: () => Promise<void> }>
    | undefined;
  if (bridgePromise) {
    const standalone = await bridgePromise;
    await standalone.close();
  }
  delete bridgeGlobal[testBridgeKey];
});

describe("next integration", () => {
  it("starts standalone bridge and rewrites to it", async () => {
    process.env.NODE_ENV = "development";
    const wrapped = withUniversalNext(
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
    const route = normalized.beforeFiles[0];

    expect(route?.source).toBe("/__universal/:path*");
    expect(route?.destination).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/__universal\/:path\*$/,
    );

    const baseUrl = route.destination.replace("/__universal/:path*", "");
    const response = await fetch(`${baseUrl}/__universal/health`);
    expect(response.ok).toBe(true);
    const payload = (await response.json()) as { protocolVersion: string };
    expect(payload.protocolVersion).toBe("1");
  });
});
