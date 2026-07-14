import { fileURLToPath } from "node:url";

import { isBridgeWebSocketUpgradePath } from "../../bridge/router.js";
import {
  type ResolvedUniversalClientEntry,
  createUniversalClientEntryVitePlugin,
} from "../client-entry.js";
import {
  type BridgeLifecycle,
  type MiddlewareAdapterServer,
  type UniversalAdapterOptions,
  appendPlugin,
  createBridgeLifecycle,
  resolveAdapterOptions,
} from "../shared/adapter-utils.js";

export type UniversalNuxtOptions = UniversalAdapterOptions;
export type UniversalNuxtModule = ((
  moduleOptions?: unknown,
  nuxt?: unknown,
) => void) & {
  meta: {
    name: string;
    configKey: string;
  };
};

export function createUniversalNuxtModule(
  options: UniversalNuxtOptions = {},
  clientEntries: readonly ResolvedUniversalClientEntry[] = [],
): UniversalNuxtModule {
  const resolvedOptions = resolveAdapterOptions(options);
  const lifecycle = createBridgeLifecycle(resolvedOptions);
  let lastViteServer: MiddlewareAdapterServer | null = null;

  function getGatewayAwareMiddlewareServer(
    server: MiddlewareAdapterServer,
  ): MiddlewareAdapterServer {
    if (server.httpServer) return server;

    return {
      ...server,
      httpServer: {
        on: () => undefined,
      },
    };
  }

  const bridgePlugin = {
    name: resolvedOptions.adapterName,
    enforce: "pre" as const,

    async configureServer(server: MiddlewareAdapterServer) {
      lastViteServer = getGatewayAwareMiddlewareServer(server);
      await lifecycle.setup(lastViteServer);
    },
  };
  const clientEntryPlugin = createUniversalClientEntryVitePlugin(clientEntries);
  const clientEntryPluginPath = fileURLToPath(
    new URL("../client-entry/nuxt-plugin.js", import.meta.url),
  );

  const meta = {
    name: resolvedOptions.adapterName,
    configKey: "universal",
  };

  function hasPluginWithName(
    plugins: unknown[] | undefined,
    name: string,
  ): boolean {
    if (!plugins?.length) return false;
    return plugins.some((plugin) => {
      if (!plugin || typeof plugin !== "object") return false;
      const candidate = plugin as { name?: unknown };
      return typeof candidate.name === "string" && candidate.name === name;
    });
  }

  function setup(_moduleOptions: unknown, nuxtInput: unknown) {
    const nuxt = (nuxtInput ?? {}) as {
      options?: unknown;
      hook?: unknown;
    };
    const nuxtOptions = (nuxt.options || {}) as {
      dev?: boolean;
      plugins?: Array<string | { src: string; mode?: "client" }>;
    };
    if (!nuxtOptions.dev) return;

    const hook = (nuxt.hook || (() => undefined)) as (
      name: string,
      callback: (...args: unknown[]) => void,
    ) => void;

    hook("vite:extendConfig", ((config: { plugins?: unknown[] }) => {
      if (!hasPluginWithName(config.plugins, bridgePlugin.name)) {
        config.plugins = appendPlugin(config.plugins, bridgePlugin);
      }
      if (
        clientEntryPlugin &&
        !hasPluginWithName(config.plugins, clientEntryPlugin.name)
      ) {
        config.plugins = appendPlugin(config.plugins, clientEntryPlugin);
      }
    }) as (...args: unknown[]) => void);

    if (clientEntryPlugin) {
      const plugins = (nuxtOptions.plugins ??= []);
      if (
        !plugins.some((plugin) =>
          typeof plugin === "string"
            ? plugin === clientEntryPluginPath
            : plugin.src === clientEntryPluginPath,
        )
      ) {
        plugins.push({ src: clientEntryPluginPath, mode: "client" });
      }
    }

    hook("listen", ((listenerServer: {
      on: (
        event: "upgrade" | "close",
        listener: (...args: unknown[]) => void,
      ) => void;
      listeners: (
        event: "upgrade" | "close",
      ) => ((...args: unknown[]) => void)[];
      removeAllListeners: (event: "upgrade" | "close") => void;
      __universalBridgeDispatcherInstalled?: boolean;
      __universalBridgeCloseHookInstalled?: boolean;
      __universalBridgeInitialUpgradeListeners?: ((
        ...args: unknown[]
      ) => void)[];
      __universalBridgeUpgradeSources?: Map<
        string,
        () => ReturnType<BridgeLifecycle["getBridge"]>
      >;
      __universalBridgeTeardowns?: Map<string, () => Promise<void>>;
    }) => {
      const bridgePathPrefix =
        resolvedOptions.bridgePathPrefix ?? "/__universal";
      const upgradeSources = (listenerServer.__universalBridgeUpgradeSources ??=
        new Map());
      const teardownHandlers = (listenerServer.__universalBridgeTeardowns ??=
        new Map());

      upgradeSources.set(bridgePathPrefix, () => lifecycle.getBridge());
      teardownHandlers.set(bridgePathPrefix, () => lifecycle.teardown());

      if (lastViteServer) {
        void lifecycle.setup(lastViteServer);
      }

      if (!listenerServer.__universalBridgeDispatcherInstalled) {
        listenerServer.__universalBridgeDispatcherInstalled = true;
        listenerServer.__universalBridgeInitialUpgradeListeners =
          listenerServer.listeners("upgrade");
        listenerServer.removeAllListeners("upgrade");

        listenerServer.on("upgrade", (...args: unknown[]) => {
          const [req, socket, head] = args as [
            import("http").IncomingMessage,
            import("stream").Duplex,
            Buffer,
          ];
          const requestPath = req.url || "/";

          const sources = listenerServer.__universalBridgeUpgradeSources;
          if (sources) {
            for (const [prefix, getBridge] of sources.entries()) {
              if (!isBridgeWebSocketUpgradePath(requestPath, prefix)) continue;
              const bridge = getBridge();
              if (!bridge) {
                socket.destroy();
                return;
              }
              bridge.handleUpgrade(req, socket, head);
              return;
            }
          }

          for (const listener of listenerServer.__universalBridgeInitialUpgradeListeners ??
            []) {
            listener(req, socket, head);
          }
        });
      }

      if (!listenerServer.__universalBridgeCloseHookInstalled) {
        listenerServer.__universalBridgeCloseHookInstalled = true;
        listenerServer.on("close", () => {
          const teardowns = [
            ...(listenerServer.__universalBridgeTeardowns?.values() ?? []),
          ];
          void Promise.all(teardowns.map((teardown) => teardown()));
        });
      }
    }) as (...args: unknown[]) => void);
  }

  return Object.assign(setup, { meta }) as UniversalNuxtModule;
}
