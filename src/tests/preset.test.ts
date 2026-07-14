import { afterEach, describe, expect, it } from "bun:test";

import {
  UNIVERSAL_NEXT_BRIDGE_GLOBAL_KEY,
  type UniversalRewriteSpec,
} from "../adapters/shared/adapter-utils.js";
import { getUniversalRegisteredPresets } from "../preset-registry.js";
import { createUniversalPreset } from "../preset.js";

type StandaloneBridgeLike = {
  baseUrl: string;
  bridge: unknown;
  close?: () => Promise<void>;
};

const bridgeGlobal = globalThis as typeof globalThis & {
  [key: string]: unknown;
};
const registryGlobal = globalThis as typeof globalThis & {
  [key: symbol]: unknown;
};
const registrySymbol = Symbol.for("universal.preset.registry");
const frameworkActivationSymbol = Symbol.for("universal.framework.activation");
const createdKeys = new Set<string>();

function seedStandaloneBridge(key: string, baseUrl: string): void {
  bridgeGlobal[key] = Promise.resolve({
    baseUrl,
    bridge: {} as never,
    close: async () => undefined,
  } satisfies StandaloneBridgeLike);
  createdKeys.add(key);
}

async function clearSeededStandaloneBridges(): Promise<void> {
  const cleanupTasks: Promise<void>[] = [];

  for (const key of createdKeys) {
    const bridgePromise = bridgeGlobal[key] as
      Promise<StandaloneBridgeLike> | undefined;
    if (bridgePromise) {
      cleanupTasks.push(
        (async () => {
          try {
            const bridge = await bridgePromise;
            await bridge.close?.();
          } catch {
            // Ignore cleanup failures for seeded bridge stubs.
          }
        })(),
      );
    }
    delete bridgeGlobal[key];
  }

  createdKeys.clear();
  await Promise.all(cleanupTasks);
}

afterEach(async () => {
  await clearSeededStandaloneBridges();
  delete registryGlobal[registrySymbol];
  delete registryGlobal[frameworkActivationSymbol];
  delete process.env.NEXT_PUBLIC_UNIVERSAL_CLIENT_CONTEXTS;
});

describe("createUniversalPreset", () => {
  it("exposes all adapter surfaces from one preset object", () => {
    const preset = createUniversalPreset({
      identity: { packageName: "@tests/surfaces" },
    });

    expect(typeof preset.vite).toBe("function");
    expect(typeof preset.next).toBe("function");
    expect(typeof preset.nuxt).toBe("function");
    expect(typeof preset.astro).toBe("function");

    expect(typeof preset.angularCli.startBridge).toBe("function");
    expect(typeof preset.angularCli.createProxyConfig).toBe("function");
    expect(typeof preset.angularCli.withProxyConfig).toBe("function");

    expect(typeof preset.bun.attach).toBe("function");
    expect(typeof preset.node.attach).toBe("function");
    expect(typeof preset.express.attach).toBe("function");
    expect(typeof preset.express.middleware).toBe("function");
    expect(typeof preset.fastify.attach).toBe("function");
    expect(typeof preset.hono.attach).toBe("function");

    expect(typeof preset.webpack.withDevServer).toBe("function");
    expect(typeof preset.rsbuild.withDevServer).toBe("function");
    expect(typeof preset.rspack.withDevServer).toBe("function");
  });

  it("applies base options to next and angular-cli wrappers", async () => {
    const nextBridgeKey = `${UNIVERSAL_NEXT_BRIDGE_GLOBAL_KEY}:preset:next`;
    const angularBridgeKey = `${UNIVERSAL_NEXT_BRIDGE_GLOBAL_KEY}:preset:angular`;
    seedStandaloneBridge(nextBridgeKey, "http://127.0.0.1:40101");
    seedStandaloneBridge(angularBridgeKey, "http://127.0.0.1:40102");

    const preset = createUniversalPreset({
      identity: { packageName: "@tests/base-options" },
      unsafeOverrides: {
        nextBridgeGlobalKey: nextBridgeKey,
      },
    });

    const wrappedNextConfig = preset.next({
      rewrites: async (): Promise<UniversalRewriteSpec> => [],
    });
    const rewrites = await wrappedNextConfig.rewrites?.();
    if (!rewrites || Array.isArray(rewrites)) {
      throw new Error("Expected Next rewrites object with beforeFiles");
    }

    expect(rewrites.beforeFiles?.[0]).toEqual({
      source: "/__universal/tests-base-options/:path*",
      destination:
        "http://127.0.0.1:40101/__universal/tests-base-options/:path*",
    });

    const proxyConfig = await preset.angularCli.createProxyConfig({
      angularCliBridgeGlobalKey: angularBridgeKey,
    });
    expect(proxyConfig).toEqual({
      "/__universal/tests-base-options": {
        target: "http://127.0.0.1:40102",
        secure: false,
        changeOrigin: false,
        ws: true,
        logLevel: "warn",
      },
      "/__universal/tests-base-options/**": {
        target: "http://127.0.0.1:40102",
        secure: false,
        changeOrigin: false,
        ws: true,
        logLevel: "warn",
      },
    });
  });

  it("allows per-call option overrides on top of preset defaults", async () => {
    const baseBridgeKey = `${UNIVERSAL_NEXT_BRIDGE_GLOBAL_KEY}:preset:base`;
    const overrideBridgeKey = `${UNIVERSAL_NEXT_BRIDGE_GLOBAL_KEY}:preset:override`;
    seedStandaloneBridge(baseBridgeKey, "http://127.0.0.1:40201");
    seedStandaloneBridge(overrideBridgeKey, "http://127.0.0.1:40202");

    const preset = createUniversalPreset({
      identity: { packageName: "@tests/per-call" },
      unsafeOverrides: {
        nextBridgeGlobalKey: baseBridgeKey,
      },
    });

    const wrappedNextConfig = preset.next(
      {
        rewrites: async (): Promise<UniversalRewriteSpec> => [],
      },
      {
        nextBridgeGlobalKey: overrideBridgeKey,
        rewriteSource: "/override/:path*",
      },
    );
    const rewrites = await wrappedNextConfig.rewrites?.();
    if (!rewrites || Array.isArray(rewrites)) {
      throw new Error("Expected Next rewrites object with beforeFiles");
    }

    expect(rewrites.beforeFiles?.[0]).toEqual({
      source: "/__universal/tests-per-call/:path*",
      destination: "http://127.0.0.1:40202/__universal/tests-per-call/:path*",
    });
  });

  it("composes client entries with derived runtime contexts", () => {
    createUniversalPreset({
      identity: { packageName: "@tests/client-one" },
      client: {
        entries: [
          { module: "@tests/client-entry" },
          { module: "@tests/client-entry" },
        ],
      },
    });
    const preset = createUniversalPreset({
      identity: { packageName: "@tests/client-two" },
      client: {
        entries: [{ module: "@tests/other-client-entry" }],
      },
    });

    const registrations = getUniversalRegisteredPresets();
    expect(registrations[0]?.clientEntries).toHaveLength(1);
    expect(registrations[0]?.clientEntries[0]?.context.bridgePathPrefix).toBe(
      "/__universal/tests-client-one",
    );

    const plugins = preset.vite();
    const clientPlugin = (Array.isArray(plugins) ? plugins : [plugins]).find(
      (plugin) => plugin.name === "universal-bridge:client-entry",
    ) as { load?: (id: string) => string | null } | undefined;
    const bootstrap = clientPlugin?.load?.("\0universal-bridge:client-entry");

    expect(bootstrap).toContain("@tests/client-entry");
    expect(bootstrap).toContain("@tests/other-client-entry");
    expect(bootstrap).toContain("/__universal/tests-client-one");
    expect(bootstrap).toContain("/__universal/tests-client-two");
    expect(bootstrap).not.toContain("universal-bridge/client-runtime");
  });

  it("rejects a client module registered for multiple namespaces", () => {
    createUniversalPreset({
      identity: { packageName: "@tests/client-one" },
      client: { entries: [{ module: "@tests/client-entry" }] },
    });
    const preset = createUniversalPreset({
      identity: { packageName: "@tests/client-two" },
      client: { entries: [{ module: "@tests/client-entry" }] },
    });

    expect(() => preset.vite()).toThrow("registered for multiple namespaces");
  });
});
