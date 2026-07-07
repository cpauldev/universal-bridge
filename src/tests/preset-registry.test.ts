import { afterEach, describe, expect, it } from "bun:test";

import {
  UNIVERSA_NEXT_BRIDGE_GLOBAL_KEY,
  type UniversaRewriteSpec,
} from "../adapters/shared/adapter-utils.js";
import { getUniversaRegisteredPresets } from "../preset-registry.js";
import { createUniversaPreset } from "../preset.js";
import { createMiddlewareAdapterServerFixture } from "./utils/adapter-server-fixtures.js";

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
const registrySymbol = Symbol.for("universa.preset.registry");
const frameworkActivationSymbol = Symbol.for("universa.framework.activation");
const seededKeys = new Set<string>();

function seedBridge(key: string): void {
  bridgeGlobal[key] = Promise.resolve({
    baseUrl: "http://127.0.0.1:49999",
    bridge: {} as never,
    close: async () => undefined,
  } satisfies StandaloneBridgeLike);
  seededKeys.add(key);
}

async function cleanupSeededBridges(): Promise<void> {
  const tasks: Promise<void>[] = [];
  for (const key of seededKeys) {
    const bridgePromise = bridgeGlobal[key] as
      | Promise<StandaloneBridgeLike>
      | undefined;
    if (bridgePromise) {
      tasks.push(
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
  seededKeys.clear();
  await Promise.all(tasks);
}

function firstObjectKey(input: Record<string, unknown>): string {
  const [firstKey] = Object.keys(input);
  if (!firstKey) throw new Error("Expected object to contain at least one key");
  return firstKey;
}

afterEach(async () => {
  await cleanupSeededBridges();
  delete registryGlobal[registrySymbol];
  delete registryGlobal[frameworkActivationSymbol];
  delete process.env.NEXT_PUBLIC_UNIVERSA_CLIENT_CONTEXTS;
});

describe("preset registry + namespacing", () => {
  it("uses stable namespace-derived prefixes for identical factory options", async () => {
    const bridgeKey = `${UNIVERSA_NEXT_BRIDGE_GLOBAL_KEY}:stable`;
    seedBridge(bridgeKey);

    const first = createUniversaPreset({
      identity: { packageName: "@acme/stable-tool" },
    });
    const second = createUniversaPreset({
      identity: { packageName: "@acme/stable-tool" },
    });

    const firstProxy = await first.angularCli.createProxyConfig({
      angularCliBridgeGlobalKey: bridgeKey,
    });
    const secondProxy = await second.angularCli.createProxyConfig({
      angularCliBridgeGlobalKey: bridgeKey,
    });

    expect(firstObjectKey(firstProxy)).toBe(firstObjectKey(secondProxy));
  });

  it("isolates duplicate preset instances with unique namespace suffixes", async () => {
    const bridgeKey = `${UNIVERSA_NEXT_BRIDGE_GLOBAL_KEY}:duplicates`;
    seedBridge(bridgeKey);

    const first = createUniversaPreset({
      identity: { packageName: "@acme/duplicate-tool" },
    });
    const second = createUniversaPreset({
      identity: { packageName: "@acme/duplicate-tool" },
      instanceId: "second",
    });

    const firstProxy = await first.angularCli.createProxyConfig({
      angularCliBridgeGlobalKey: bridgeKey,
    });
    const secondProxy = await second.angularCli.createProxyConfig({
      angularCliBridgeGlobalKey: bridgeKey,
    });

    expect(firstObjectKey(firstProxy)).not.toBe(firstObjectKey(secondProxy));
  });

  it("returns composed framework plugins from the explicit registry", () => {
    const first = createUniversaPreset({
      identity: { packageName: "@acme/compose-a" },
    });
    createUniversaPreset({
      identity: { packageName: "@acme/compose-b" },
    });

    const plugins = first.vite();
    expect(Array.isArray(plugins)).toBe(true);
    if (!Array.isArray(plugins)) {
      throw new Error("Expected composed plugin list");
    }
    expect(plugins.length).toBe(2);
  });

  it("respects local composition mode", () => {
    const local = createUniversaPreset({
      identity: { packageName: "@acme/local-only" },
      composition: "local",
    });
    createUniversaPreset({
      identity: { packageName: "@acme/registry-tool" },
    });

    const localPlugins = local.vite();
    expect(Array.isArray(localPlugins)).toBe(false);
  });

  it("keeps one active Vite wiring per server when config is evaluated more than once", async () => {
    const first = createUniversaPreset({
      identity: { packageName: "@acme/latest-a" },
    });
    const second = createUniversaPreset({
      identity: { packageName: "@acme/latest-b" },
    });

    const firstPlugins = first.vite();
    const secondPlugins = second.vite();
    const stalePlugin = (
      Array.isArray(firstPlugins) ? firstPlugins : [firstPlugins]
    )[0];
    const activePlugin = (
      Array.isArray(secondPlugins) ? secondPlugins : [secondPlugins]
    )[0];

    const fixture = createMiddlewareAdapterServerFixture();
    await stalePlugin?.configureServer?.(fixture.server as never);
    expect(fixture.getMiddlewareCount()).toBe(1);

    await activePlugin?.configureServer?.(fixture.server as never);
    expect(fixture.getMiddlewareCount()).toBe(1);

    fixture.emit("close");
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("handles Nuxt event upgrades for every composed preset prefix", () => {
    createUniversaPreset({
      identity: { packageName: "@acme/nuxt-a" },
    }).nuxt();
    const activeModule = createUniversaPreset({
      identity: { packageName: "@acme/nuxt-b" },
    }).nuxt();

    const bridgePrefixes = getUniversaRegisteredPresets().map(
      (entry) => entry.effectiveOptions.bridgePathPrefix ?? "/__universa",
    );
    expect(bridgePrefixes.length).toBe(2);
    const secondPrefix = bridgePrefixes[1];
    if (!secondPrefix) {
      throw new Error("Expected second bridge prefix for composed Nuxt test");
    }

    const hooks: Record<string, ((...args: unknown[]) => void)[]> = {};
    activeModule(
      {},
      {
        options: { dev: true },
        hook: (name: string, listener: (...args: unknown[]) => void) => {
          const existing = hooks[name] ?? [];
          existing.push(listener);
          hooks[name] = existing;
        },
      },
    );

    let fallbackUpgradeCalls = 0;
    let socketDestroyed = false;
    const listenerServer = {
      on: (
        event: "upgrade" | "close",
        listener: (...args: unknown[]) => void,
      ) => {
        const existing = serverEvents[event] ?? [];
        existing.push(listener);
        serverEvents[event] = existing;
      },
      listeners: (event: "upgrade" | "close") => serverEvents[event] ?? [],
      removeAllListeners: (event: "upgrade" | "close") => {
        serverEvents[event] = [];
      },
    };

    const serverEvents: Record<
      "upgrade" | "close",
      ((...args: unknown[]) => void)[]
    > = {
      upgrade: [
        () => {
          fallbackUpgradeCalls += 1;
        },
      ],
      close: [],
    };

    for (const callback of hooks.listen ?? []) {
      callback(listenerServer);
    }

    const dispatcher = serverEvents.upgrade[0];
    if (!dispatcher)
      throw new Error("Expected Nuxt dispatcher upgrade listener");
    dispatcher(
      { url: `${secondPrefix}/events` },
      { destroy: () => (socketDestroyed = true) },
      Buffer.from(""),
    );

    expect(socketDestroyed).toBe(true);
    expect(fallbackUpgradeCalls).toBe(0);
  });

  it("keeps only the latest Next wrapper call active", async () => {
    const firstBridgeKey = `${UNIVERSA_NEXT_BRIDGE_GLOBAL_KEY}:next-latest-a`;
    const secondBridgeKey = `${UNIVERSA_NEXT_BRIDGE_GLOBAL_KEY}:next-latest-b`;
    seedBridge(firstBridgeKey);
    seedBridge(secondBridgeKey);

    const first = createUniversaPreset({
      identity: { packageName: "@acme/next-latest-a" },
      unsafeOverrides: {
        nextBridgeGlobalKey: firstBridgeKey,
      },
    });
    const second = createUniversaPreset({
      identity: { packageName: "@acme/next-latest-b" },
      unsafeOverrides: {
        nextBridgeGlobalKey: secondBridgeKey,
      },
    });

    const wrappedConfig = second.next(
      first.next({
        rewrites: async (): Promise<UniversaRewriteSpec> => [],
      }),
    );
    const rewrites = await wrappedConfig.rewrites?.();
    if (!rewrites || Array.isArray(rewrites)) {
      throw new Error("Expected Next rewrites object with beforeFiles");
    }

    expect(rewrites.beforeFiles?.length).toBe(2);
    const uniqueSources = new Set(
      rewrites.beforeFiles?.map((item) => item.source),
    );
    expect(uniqueSources.size).toBe(2);
  });

  it("keeps only the latest Astro integration call active", async () => {
    const first = createUniversaPreset({
      identity: { packageName: "@acme/astro-latest-a" },
      autoStart: false,
    });
    const second = createUniversaPreset({
      identity: { packageName: "@acme/astro-latest-b" },
      autoStart: false,
    });

    const stale = first.astro();
    const active = second.astro();
    const staleFixture = createMiddlewareAdapterServerFixture();
    const activeFixture = createMiddlewareAdapterServerFixture();

    await stale.hooks["astro:server:setup"]?.({ server: staleFixture.server });
    await active.hooks["astro:server:setup"]?.({
      server: activeFixture.server,
    });

    expect(staleFixture.getMiddlewareCount()).toBe(0);
    expect(activeFixture.getMiddlewareCount()).toBe(2);

    await stale.hooks["astro:server:done"]?.({});
    await active.hooks["astro:server:done"]?.({});
  });
});
