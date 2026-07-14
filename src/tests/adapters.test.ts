import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  type ResolvedUniversalClientEntry,
  createUniversalClientEntryVitePlugin,
} from "../adapters/client-entry.js";
import {
  createUniversalAngularCliProxyConfig,
  withUniversalAngularCliProxyConfig,
} from "../adapters/framework/angular-cli.js";
import { createUniversalAstroIntegration } from "../adapters/framework/astro.js";
import { withUniversalNext } from "../adapters/framework/next.js";
import { createUniversalNuxtModule } from "../adapters/framework/nuxt.js";
import { UNIVERSAL_NEXT_BRIDGE_GLOBAL_KEY } from "../adapters/shared/adapter-utils.js";
import { createUniversalVitePlugin } from "../adapters/shared/plugin.js";
import { createClientRuntimeContext } from "../client/runtime-context.js";
import { createMiddlewareAdapterServerFixture } from "./utils/adapter-server-fixtures.js";

const originalNodeEnv = process.env.NODE_ENV;
const clientEntries: ResolvedUniversalClientEntry[] = [
  {
    module: "@tests/client-entry",
    context: createClientRuntimeContext({
      namespaceId: "tests-client-entry",
      bridgePathPrefix: "/__universal/tests-client-entry",
    }),
  },
];

async function clearBridgeGlobals(): Promise<void> {
  const bridgeGlobal = globalThis as typeof globalThis & {
    [key: string]: unknown;
  };
  const cleanupTasks: Promise<void>[] = [];

  for (const key of Object.keys(bridgeGlobal)) {
    if (key.startsWith(UNIVERSAL_NEXT_BRIDGE_GLOBAL_KEY)) {
      const bridgePromise = bridgeGlobal[key] as
        Promise<{ close?: () => Promise<void> }> | undefined;
      if (bridgePromise) {
        cleanupTasks.push(
          (async () => {
            try {
              const standalone = await bridgePromise;
              await standalone?.close?.();
            } catch {
              // Ignore bridge teardown failures in test cleanup.
            }
          })(),
        );
      }
      delete bridgeGlobal[key];
    }
  }

  await Promise.all(cleanupTasks);
}

afterEach(async () => {
  process.env.NODE_ENV = originalNodeEnv;
  await clearBridgeGlobals();
});

describe("universal-bridge adapters", () => {
  it("withUniversalNext injects bridge rewrites first", async () => {
    process.env.NODE_ENV = "development";
    const testBridgeKey = `${UNIVERSAL_NEXT_BRIDGE_GLOBAL_KEY}:test-adapters`;
    const bridgeGlobal = globalThis as typeof globalThis & {
      [key: string]: unknown;
    };

    bridgeGlobal[testBridgeKey] = Promise.resolve({
      baseUrl: "http://127.0.0.1:41234",
      bridge: {} as never,
      close: async () => undefined,
    });

    const config = withUniversalNext(
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

    const rewrites = await config.rewrites?.();
    if (!rewrites) {
      throw new Error("Expected rewrites to be defined");
    }
    const normalized = Array.isArray(rewrites)
      ? {
          beforeFiles: rewrites,
          afterFiles: [],
          fallback: [],
        }
      : rewrites;

    expect(normalized.beforeFiles[0]).toEqual({
      source: "/__universal/:path*",
      destination: "http://127.0.0.1:41234/__universal/:path*",
    });
    expect(normalized.beforeFiles[1]).toEqual({
      source: "/docs/:path*",
      destination: "/docs",
    });

    delete bridgeGlobal[testBridgeKey];
  });

  it("withUniversalNext is a no-op in production", () => {
    process.env.NODE_ENV = "production";
    const config = { trailingSlash: true };
    const wrapped = withUniversalNext(config);
    expect(wrapped).toBe(config);
  });

  it("withUniversalNext injects development client entries through Turbopack", () => {
    process.env.NODE_ENV = "development";
    const config = withUniversalNext({}, {}, clientEntries) as {
      turbopack?: {
        rules?: Record<
          string,
          | { loaders?: Array<{ options?: { bootstrap?: string } }> }
          | Array<{ loaders?: Array<{ options?: { bootstrap?: string } }> }>
        >;
      };
    };
    const rule = config.turbopack?.rules?.["*"];
    const clientEntryRule = Array.isArray(rule) ? rule.at(-1) : rule;
    const loader = clientEntryRule?.loaders?.[0];

    expect(loader?.options?.bootstrap).toContain("@tests/client-entry");
    expect(loader?.options?.bootstrap).toContain(
      "/__universal/tests-client-entry",
    );
    expect(loader?.options?.bootstrap).not.toContain(
      "universal-bridge/client-runtime",
    );
  });

  it("withUniversalNext preserves existing Turbopack rules", () => {
    process.env.NODE_ENV = "development";
    const existingRule = { loaders: ["existing-loader"], as: "*.js" };
    const config = withUniversalNext(
      { turbopack: { rules: { "*.tsx": existingRule } } },
      {},
      clientEntries,
    ) as {
      turbopack?: { rules?: Record<string, unknown> };
    };

    expect(config.turbopack?.rules?.["*.tsx"]).toBe(existingRule);
    expect(config.turbopack?.rules?.["*"]).toBeDefined();
  });

  it("withUniversalNext creates isolated bridge instances by default", async () => {
    process.env.NODE_ENV = "development";
    const passthroughRule = { source: "/noop/:path*", destination: "/noop" };

    const first = withUniversalNext({
      rewrites: async () => [passthroughRule],
    });
    const second = withUniversalNext({
      rewrites: async () => [passthroughRule],
    });

    const firstRewrites = await first.rewrites?.();
    const secondRewrites = await second.rewrites?.();
    if (!firstRewrites || !secondRewrites) {
      throw new Error("Expected rewrites to be defined");
    }

    const firstNormalized = Array.isArray(firstRewrites)
      ? { beforeFiles: firstRewrites, afterFiles: [], fallback: [] }
      : firstRewrites;
    const secondNormalized = Array.isArray(secondRewrites)
      ? { beforeFiles: secondRewrites, afterFiles: [], fallback: [] }
      : secondRewrites;

    const firstDestination = firstNormalized.beforeFiles[0]?.destination;
    const secondDestination = secondNormalized.beforeFiles[0]?.destination;

    expect(firstDestination).toBeDefined();
    expect(secondDestination).toBeDefined();
    expect(firstDestination).not.toBe(secondDestination);
  });

  it("createUniversalNuxtModule injects plugin hook only in dev", () => {
    const module = createUniversalNuxtModule();
    const hooks: Record<string, (...args: unknown[]) => void> = {};
    module(
      {},
      {
        options: { dev: true },
        hook: (name: string, listener: (...args: unknown[]) => void) => {
          hooks[name] = listener;
        },
      },
    );

    expect(typeof hooks["vite:extendConfig"]).toBe("function");

    const config: { plugins?: unknown[] } = {};
    hooks["vite:extendConfig"]?.(config);
    expect(Array.isArray(config.plugins)).toBe(true);
    expect((config.plugins?.length || 0) > 0).toBe(true);

    const prodHooks: Record<string, (...args: unknown[]) => void> = {};
    module(
      {},
      {
        options: { dev: false },
        hook: (name: string, listener: (...args: unknown[]) => void) => {
          prodHooks[name] = listener;
        },
      },
    );
    expect(prodHooks["vite:extendConfig"]).toBeUndefined();
  });

  it("createUniversalNuxtModule registers a client entry plugin", () => {
    const module = createUniversalNuxtModule({}, clientEntries);
    const hooks: Record<string, (...args: unknown[]) => void> = {};
    const options: { dev: boolean; plugins?: Array<string | { src: string }> } =
      {
        dev: true,
      };
    module(
      {},
      {
        options,
        hook: (name: string, listener: (...args: unknown[]) => void) => {
          hooks[name] = listener;
        },
      },
    );

    expect(options.plugins?.[0]).toMatchObject({
      src: expect.stringContaining("nuxt-plugin.js"),
    });
    const config: { plugins?: Array<{ name?: string }> } = {};
    hooks["vite:extendConfig"]?.(config);
    expect(
      config.plugins?.some(
        (plugin) => plugin.name === "universal-bridge:client-entry",
      ),
    ).toBe(true);
  });

  it("client entry plugin bootstraps React Router client entries", () => {
    const plugin = createUniversalClientEntryVitePlugin(clientEntries);
    const defaultEntry = plugin?.transform(
      "export default function hydrate() {}",
      "C:/repo/node_modules/@react-router/dev/dist/config/defaults/entry.client.tsx",
    );
    const appEntry = plugin?.transform(
      "export default function hydrate() {}",
      "C:/repo/app/entry.client.tsx",
    );

    expect(defaultEntry).toContain("@tests/client-entry");
    expect(defaultEntry).toContain("/__universal/tests-client-entry");
    expect(appEntry).toContain("@tests/client-entry");
    expect(appEntry).toContain("/__universal/tests-client-entry");
  });

  it("client entry plugin resolves registered modules from the Vite project root", () => {
    const root = mkdtempSync(join(tmpdir(), "universal-client-entry-"));
    const packageDir = join(root, "node_modules", "@tests", "client-entry");
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "@tests/client-entry",
        type: "module",
        exports: "./index.js",
      }),
    );
    writeFileSync(join(packageDir, "index.js"), "export {};\n");

    try {
      const plugin = createUniversalClientEntryVitePlugin(clientEntries);
      plugin?.configResolved({ root });

      expect(plugin?.resolveId("@tests/client-entry")).toBe(
        join(packageDir, "index.js"),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("createUniversalNuxtModule keeps the runtime websocket gateway capability without a Vite httpServer", async () => {
    const module = createUniversalNuxtModule({
      autoStart: false,
      runtimeWebSocketGateway: { path: "/ws" },
    });
    const hooks: Record<string, (...args: unknown[]) => void> = {};
    module(
      {},
      {
        options: { dev: true },
        hook: (name: string, listener: (...args: unknown[]) => void) => {
          hooks[name] = listener;
        },
      },
    );

    const config: {
      plugins?: Array<{ configureServer?: (server: unknown) => Promise<void> }>;
    } = {};
    hooks["vite:extendConfig"]?.(config);
    const plugin = config.plugins?.find(
      (candidate) => candidate.configureServer,
    );
    const middlewareHandlers: Array<(...args: unknown[]) => void> = [];
    await plugin?.configureServer?.({
      middlewares: {
        use: (handler: (...args: unknown[]) => void) => {
          middlewareHandlers.push(handler);
        },
      },
      httpServer: null,
    });

    const handler = middlewareHandlers[0];
    if (!handler) throw new Error("Expected Nuxt bridge middleware");

    const responseBody = await new Promise<string>((resolve, reject) => {
      const req = {
        method: "GET",
        url: "/__universal/state",
        headers: { host: "localhost" },
      };
      let body = "";
      const res = {
        writableEnded: false,
        writeHead: () => undefined,
        end: (chunk?: string) => {
          if (chunk) body += chunk;
          res.writableEnded = true;
          resolve(body);
        },
      };
      handler(req, res, (error?: unknown) => {
        if (error) reject(error);
      });
    });

    expect(
      JSON.parse(responseBody).capabilities.hasRuntimeWebSocketGateway,
    ).toBe(true);
  });

  it("createUniversalAstroIntegration wires setup and teardown hooks", async () => {
    const integration = createUniversalAstroIntegration({
      autoStart: false,
    });
    const fixture = createMiddlewareAdapterServerFixture();

    await (
      integration.hooks["astro:server:setup"] as (context: {
        server: ReturnType<
          typeof createMiddlewareAdapterServerFixture
        >["server"];
      }) => Promise<void>
    )({ server: fixture.server });

    expect(fixture.getMiddlewareCount()).toBe(1);
    expect(fixture.getListenerCount("upgrade")).toBe(1);
    expect(fixture.getListenerCount("close")).toBe(1);

    await (integration.hooks["astro:server:done"] as () => Promise<void>)();
  });

  it("createUniversalAngularCliProxyConfig returns proxy rules for bridge routes", async () => {
    const testBridgeKey = `${UNIVERSAL_NEXT_BRIDGE_GLOBAL_KEY}:angular-cli:test`;
    const bridgeGlobal = globalThis as typeof globalThis & {
      [key: string]: unknown;
    };

    bridgeGlobal[testBridgeKey] = Promise.resolve({
      baseUrl: "http://127.0.0.1:43210",
      bridge: {} as never,
      close: async () => undefined,
    });

    const proxyConfig = await createUniversalAngularCliProxyConfig({
      angularCliBridgeGlobalKey: testBridgeKey,
    });
    expect(proxyConfig).toEqual({
      "/__universal": {
        target: "http://127.0.0.1:43210",
        secure: false,
        changeOrigin: false,
        ws: true,
        logLevel: "warn",
      },
      "/__universal/**": {
        target: "http://127.0.0.1:43210",
        secure: false,
        changeOrigin: false,
        ws: true,
        logLevel: "warn",
      },
    });

    const mergedProxyConfig = await withUniversalAngularCliProxyConfig(
      {
        "/api": {
          target: "http://127.0.0.1:5000",
          secure: false,
          changeOrigin: false,
          ws: true,
          logLevel: "warn",
        },
      },
      {
        angularCliBridgeGlobalKey: testBridgeKey,
      },
    );
    expect(Object.keys(mergedProxyConfig)).toEqual([
      "/api",
      "/__universal",
      "/__universal/**",
    ]);

    delete bridgeGlobal[testBridgeKey];
  });

  it("createUniversalVitePlugin configures Vite middleware bridge", async () => {
    const plugin = createUniversalVitePlugin({ autoStart: false });
    const pluginObject = Array.isArray(plugin) ? plugin[0] : plugin;
    const fixture = createMiddlewareAdapterServerFixture();

    expect(pluginObject?.name).toBe("universal-bridge");
    expect(pluginObject?.enforce).toBe("pre");

    await pluginObject?.configureServer?.(fixture.server as never);
    expect(fixture.getMiddlewareCount()).toBe(1);
    expect(fixture.getListenerCount("upgrade")).toBe(1);
    expect(fixture.getListenerCount("close")).toBe(1);

    fixture.emit("close");
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
