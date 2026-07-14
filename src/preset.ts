import {
  type RsbuildConfig,
  type RsbuildUniversalOptions,
  withUniversalRsbuild,
} from "./adapters/build/rsbuild.js";
import {
  type RspackConfig,
  type RspackUniversalOptions,
  withUniversalRspack,
} from "./adapters/build/rspack.js";
import {
  type WebpackDevServerConfig,
  type WebpackUniversalOptions,
  withUniversalWebpackDevServer,
} from "./adapters/build/webpack.js";
import {
  type ViteClientEntryPlugin,
  createUniversalClientEntryVitePlugin,
} from "./adapters/client-entry.js";
import {
  type AngularCliUniversalOptions,
  type AngularCliUniversalProxyConfig,
  createUniversalAngularCliProxyConfig,
  startUniversalAngularCliBridge,
  withUniversalAngularCliProxyConfig,
} from "./adapters/framework/angular-cli.js";
import {
  type AstroUniversalOptions,
  createUniversalAstroIntegration,
} from "./adapters/framework/astro.js";
import {
  type UniversalNextOptions,
  withUniversalNext,
} from "./adapters/framework/next.js";
import {
  type UniversalNuxtOptions,
  createUniversalNuxtModule,
} from "./adapters/framework/nuxt.js";
import {
  type BunBridgeHandle,
  type BunUniversalOptions,
  attachUniversalToBunServe,
} from "./adapters/server/bun.js";
import {
  type ExpressBridgeHandle,
  type ExpressLikeApp,
  type ExpressUniversalMiddleware,
  type ExpressUniversalOptions,
  attachUniversalToExpress,
  createUniversalExpressMiddleware,
} from "./adapters/server/express.js";
import {
  type FastifyBridgeHandle,
  type FastifyLikeInstance,
  type FastifyUniversalOptions,
  attachUniversalToFastify,
} from "./adapters/server/fastify.js";
import {
  type HonoBridgeHandle,
  type HonoNodeServer,
  type HonoUniversalOptions,
  attachUniversalToHonoNodeServer,
} from "./adapters/server/hono.js";
import {
  type NodeBridgeHandle,
  type NodeUniversalOptions,
  attachUniversalToNodeServer,
} from "./adapters/server/node.js";
import {
  type UniversalVitePluginOptions,
  createUniversalVitePlugin,
} from "./adapters/shared/plugin.js";
import {
  buildBridgeRewriteSource,
  normalizeBridgePathPrefix,
} from "./bridge/prefix.js";
import {
  type UniversalCompositionMode,
  type UniversalPresetOptions,
  type UniversalPresetRegistration,
  registerUniversalPreset,
  resolveFrameworkClientEntries,
  resolveFrameworkComposition,
} from "./preset-registry.js";

export type {
  UniversalClientEntry,
  UniversalCompositionMode,
  UniversalPresetIdentity,
  UniversalPresetClientOptions,
  UniversalPresetOptions,
} from "./preset-registry.js";

export interface UniversalPreset {
  vite: (
    options?: UniversalVitePluginOptions,
  ) =>
    | ReturnType<typeof createUniversalVitePlugin>
    | (ReturnType<typeof createUniversalVitePlugin> | ViteClientEntryPlugin)[];
  next: <T extends object>(nextConfig: T, options?: UniversalNextOptions) => T;
  nuxt: (
    options?: UniversalNuxtOptions,
  ) => ReturnType<typeof createUniversalNuxtModule>;
  astro: (
    options?: AstroUniversalOptions,
  ) => ReturnType<typeof createUniversalAstroIntegration>;
  angularCli: {
    startBridge: (
      options?: AngularCliUniversalOptions,
    ) => ReturnType<typeof startUniversalAngularCliBridge>;
    createProxyConfig: (
      options?: AngularCliUniversalOptions,
    ) => ReturnType<typeof createUniversalAngularCliProxyConfig>;
    withProxyConfig: (
      existingProxyConfig?: AngularCliUniversalProxyConfig,
      options?: AngularCliUniversalOptions,
    ) => ReturnType<typeof withUniversalAngularCliProxyConfig>;
  };
  bun: {
    attach: (options?: BunUniversalOptions) => Promise<BunBridgeHandle>;
  };
  node: {
    attach: (
      server: Parameters<typeof attachUniversalToNodeServer>[0],
      options?: NodeUniversalOptions,
    ) => Promise<NodeBridgeHandle>;
  };
  fastify: {
    attach: (
      fastify: FastifyLikeInstance,
      options?: FastifyUniversalOptions,
    ) => Promise<FastifyBridgeHandle>;
  };
  express: {
    attach: (
      app: ExpressLikeApp,
      options?: ExpressUniversalOptions,
    ) => Promise<ExpressBridgeHandle>;
    middleware: (
      options?: ExpressUniversalOptions,
    ) => ExpressUniversalMiddleware;
  };
  hono: {
    attach: (
      server: HonoNodeServer,
      options?: HonoUniversalOptions,
    ) => Promise<HonoBridgeHandle>;
  };
  webpack: {
    withDevServer: <
      TMiddlewares extends unknown[],
      TConfig extends WebpackDevServerConfig<TMiddlewares>,
    >(
      config: TConfig,
      options?: WebpackUniversalOptions,
    ) => TConfig & WebpackDevServerConfig<TMiddlewares>;
  };
  rsbuild: {
    withDevServer: <
      TMiddlewares extends unknown[],
      TConfig extends RsbuildConfig<TMiddlewares>,
    >(
      config: TConfig,
      options?: RsbuildUniversalOptions,
    ) => TConfig & RsbuildConfig<TMiddlewares>;
  };
  rspack: {
    withDevServer: <
      TMiddlewares extends unknown[],
      TConfig extends RspackConfig<TMiddlewares>,
    >(
      config: TConfig,
      options?: RspackUniversalOptions,
    ) => TConfig & RspackConfig<TMiddlewares>;
  };
}

type FrameworkAdapterKind =
  "vite" | "next" | "nuxt" | "astro" | "webpack" | "rsbuild" | "rspack";

type FrameworkActivationStore = {
  counters: Map<FrameworkAdapterKind, number>;
  latestByFramework: Map<FrameworkAdapterKind, number>;
  activeByServer: WeakMap<object, Map<FrameworkAdapterKind, number>>;
};

type FrameworkActivation =
  | {
      isActive: () => boolean;
      token: number;
    }
  | undefined;

const FRAMEWORK_ACTIVATION_SYMBOL = Symbol.for(
  "universal.framework.activation",
);

function getFrameworkActivationStore(): FrameworkActivationStore {
  const runtimeGlobal = globalThis as typeof globalThis & {
    [FRAMEWORK_ACTIVATION_SYMBOL]?: FrameworkActivationStore;
  };

  if (!runtimeGlobal[FRAMEWORK_ACTIVATION_SYMBOL]) {
    runtimeGlobal[FRAMEWORK_ACTIVATION_SYMBOL] = {
      counters: new Map<FrameworkAdapterKind, number>(),
      latestByFramework: new Map<FrameworkAdapterKind, number>(),
      activeByServer: new WeakMap<object, Map<FrameworkAdapterKind, number>>(),
    };
  }

  return runtimeGlobal[FRAMEWORK_ACTIVATION_SYMBOL] as FrameworkActivationStore;
}

function reserveFrameworkActivation(
  framework: FrameworkAdapterKind,
  composition: UniversalCompositionMode,
): FrameworkActivation {
  if (composition === "local") return undefined;

  const store = getFrameworkActivationStore();
  const token = (store.counters.get(framework) ?? 0) + 1;
  store.counters.set(framework, token);
  store.latestByFramework.set(framework, token);

  return {
    isActive: () => store.latestByFramework.get(framework) === token,
    token,
  };
}

function withFrameworkActivation<T extends object>(
  options: T,
  isFrameworkActive?: () => boolean,
): T {
  if (!isFrameworkActive) return options;
  return {
    ...options,
    _frameworkIsActive: isFrameworkActive,
  } as T;
}

type VitePlugin = ReturnType<typeof createUniversalVitePlugin>;
function guardVitePlugin(
  framework: FrameworkAdapterKind,
  plugin: VitePlugin,
  isFrameworkActive?: () => boolean,
  activationToken?: number,
): VitePlugin {
  if (!isFrameworkActive) return plugin;

  return {
    ...plugin,
    configureServer: async (server: unknown, ...args: unknown[]) => {
      if (
        activationToken !== undefined &&
        server !== null &&
        typeof server === "object"
      ) {
        const store = getFrameworkActivationStore();
        const serverActivations =
          store.activeByServer.get(server) ??
          new Map<FrameworkAdapterKind, number>();
        store.activeByServer.set(server, serverActivations);

        const activeToken = serverActivations.get(framework);
        if (activeToken !== undefined && activeToken !== activationToken) {
          return;
        }

        if (activeToken === undefined) {
          serverActivations.set(framework, activationToken);
        }
      } else if (!isFrameworkActive()) {
        return;
      }

      return (
        plugin as { configureServer?: (...args: unknown[]) => unknown }
      ).configureServer?.(server, ...args);
    },
  } as VitePlugin;
}

function mergeAdapterOptions<T extends object>(
  baseOptions: T,
  options?: Partial<T>,
): T {
  const merged = { ...baseOptions, ...(options ?? {}) };

  const nextBridgePathPrefix = normalizeBridgePathPrefix(
    (merged as { bridgePathPrefix?: string }).bridgePathPrefix ??
      (baseOptions as { bridgePathPrefix?: string }).bridgePathPrefix,
  );
  const nextRewriteSource = buildBridgeRewriteSource(nextBridgePathPrefix);
  (
    merged as { bridgePathPrefix?: string; rewriteSource?: string }
  ).bridgePathPrefix = nextBridgePathPrefix;
  (merged as { rewriteSource?: string }).rewriteSource = nextRewriteSource;

  return merged;
}

type NuxtModule = ReturnType<typeof createUniversalNuxtModule>;
type AstroIntegration = ReturnType<typeof createUniversalAstroIntegration>;

function guardNuxtModule(
  module: NuxtModule,
  isFrameworkActive?: () => boolean,
): NuxtModule {
  if (!isFrameworkActive) return module;

  const guardedModule = ((moduleOptions?: unknown, nuxt?: unknown) => {
    if (!isFrameworkActive()) return;
    module(moduleOptions, nuxt);
  }) as NuxtModule;

  return Object.assign(guardedModule, { meta: module.meta });
}

function composeNuxtModules(modules: NuxtModule[]): NuxtModule {
  if (modules.length === 1) return modules[0] as NuxtModule;

  const setup = ((moduleOptions?: unknown, nuxt?: unknown) => {
    for (const module of modules) {
      module(moduleOptions, nuxt);
    }
  }) as NuxtModule;

  const names = modules
    .map((module) =>
      typeof module.meta.name === "string" && module.meta.name
        ? module.meta.name
        : "universal-module",
    )
    .join("+");

  return Object.assign(setup, {
    meta: {
      name: `composed:${names}`,
      configKey: "universal",
    },
  });
}

function guardAstroIntegration(
  integration: AstroIntegration,
  isFrameworkActive?: () => boolean,
): AstroIntegration {
  if (!isFrameworkActive) return integration;

  const guardedHooks: Record<
    string,
    (options: unknown) => void | Promise<void>
  > = {};
  for (const [hookName, hookFn] of Object.entries(integration.hooks ?? {})) {
    if (typeof hookFn !== "function") continue;
    guardedHooks[hookName] = (options: unknown) => {
      if (!isFrameworkActive()) return;
      return hookFn(options);
    };
  }

  return {
    ...integration,
    hooks: guardedHooks,
  };
}

function composeAstroIntegrations(
  integrations: AstroIntegration[],
): AstroIntegration {
  if (integrations.length === 1) return integrations[0] as AstroIntegration;

  const hooksByName = new Map<
    string,
    ((options: unknown) => void | Promise<void>)[]
  >();
  for (const integration of integrations) {
    const hooks = integration.hooks ?? {};
    for (const [hookName, hookFn] of Object.entries(hooks)) {
      if (typeof hookFn !== "function") continue;
      const existing = hooksByName.get(hookName) ?? [];
      existing.push(hookFn);
      hooksByName.set(hookName, existing);
    }
  }

  const composedHooks: Record<
    string,
    (options: unknown) => void | Promise<void>
  > = {};
  for (const [hookName, hookFns] of hooksByName.entries()) {
    composedHooks[hookName] = async (options: unknown) => {
      for (const hookFn of hookFns) {
        await hookFn(options);
      }
    };
  }

  const name = integrations.map((entry) => entry.name).join("+");
  return {
    name: `composed:${name}`,
    hooks: composedHooks,
  };
}

export function createUniversalPreset(
  baseOptions: UniversalPresetOptions,
): UniversalPreset {
  const registration = registerUniversalPreset(baseOptions);

  function withLocalOptions<T extends object>(options?: Partial<T>): T {
    return mergeAdapterOptions(registration.effectiveOptions as T, options);
  }

  function getFrameworkRegistrations<T extends object>(
    options?: Partial<T>,
  ): UniversalPresetRegistration[] {
    const entries = resolveFrameworkComposition(registration);
    return entries.map((entry) =>
      entry.id === registration.id
        ? {
            ...entry,
            effectiveOptions: mergeAdapterOptions(
              entry.effectiveOptions,
              options as Partial<typeof entry.effectiveOptions>,
            ),
          }
        : entry,
    );
  }

  return {
    vite: (options = {}) => {
      const activation = reserveFrameworkActivation(
        "vite",
        registration.composition,
      );
      const entries = getFrameworkRegistrations(options);
      const bridgePlugins = entries.map((entry) =>
        guardVitePlugin(
          "vite",
          createUniversalVitePlugin(
            withFrameworkActivation(
              entry.effectiveOptions,
              activation?.isActive,
            ),
          ),
          activation?.isActive,
          activation?.token,
        ),
      );
      const clientEntryPlugin = createUniversalClientEntryVitePlugin(
        resolveFrameworkClientEntries(entries),
      );
      if (!clientEntryPlugin) {
        return bridgePlugins.length === 1 ? bridgePlugins[0] : bridgePlugins;
      }
      return [...bridgePlugins, clientEntryPlugin];
    },
    next<T extends object>(
      nextConfig: T,
      options: UniversalNextOptions = {},
    ): T {
      const activation = reserveFrameworkActivation(
        "next",
        registration.composition,
      );
      const entries = getFrameworkRegistrations(options);
      const clientEntries = resolveFrameworkClientEntries(entries);
      return entries.reduce<T>(
        (config, entry, index) =>
          withUniversalNext(
            config,
            withFrameworkActivation(
              entry.effectiveOptions,
              activation?.isActive,
            ),
            index === 0 ? clientEntries : [],
          ),
        nextConfig,
      );
    },
    nuxt: (options = {}) => {
      const activation = reserveFrameworkActivation(
        "nuxt",
        registration.composition,
      );
      const entries = getFrameworkRegistrations(options);
      const clientEntries = resolveFrameworkClientEntries(entries);
      const modules = entries.map((entry, index) =>
        createUniversalNuxtModule(
          withFrameworkActivation(entry.effectiveOptions, activation?.isActive),
          index === 0 ? clientEntries : [],
        ),
      );
      return guardNuxtModule(composeNuxtModules(modules), activation?.isActive);
    },
    astro: (options = {}) => {
      const activation = reserveFrameworkActivation(
        "astro",
        registration.composition,
      );
      const entries = getFrameworkRegistrations(options);
      const clientEntries = resolveFrameworkClientEntries(entries);
      const integrations = entries.map((entry, index) =>
        createUniversalAstroIntegration(
          withFrameworkActivation(entry.effectiveOptions, activation?.isActive),
          index === 0 ? clientEntries : [],
        ),
      );
      return guardAstroIntegration(
        composeAstroIntegrations(integrations),
        activation?.isActive,
      );
    },
    angularCli: {
      startBridge: (options = {}) =>
        startUniversalAngularCliBridge(withLocalOptions(options)),
      createProxyConfig: (options = {}) =>
        createUniversalAngularCliProxyConfig(withLocalOptions(options)),
      withProxyConfig: (existingProxyConfig = {}, options = {}) =>
        withUniversalAngularCliProxyConfig(
          existingProxyConfig,
          withLocalOptions(options),
        ),
    },
    bun: {
      attach: (options = {}) =>
        attachUniversalToBunServe(withLocalOptions(options)),
    },
    node: {
      attach: (server, options = {}) =>
        attachUniversalToNodeServer(server, withLocalOptions(options)),
    },
    fastify: {
      attach: (fastify, options = {}) =>
        attachUniversalToFastify(fastify, withLocalOptions(options)),
    },
    express: {
      attach: (app, options = {}) =>
        attachUniversalToExpress(app, withLocalOptions(options)),
      middleware: (options = {}) =>
        createUniversalExpressMiddleware(withLocalOptions(options)),
    },
    hono: {
      attach: (server, options = {}) =>
        attachUniversalToHonoNodeServer(server, withLocalOptions(options)),
    },
    webpack: {
      withDevServer: <
        TMiddlewares extends unknown[],
        TConfig extends WebpackDevServerConfig<TMiddlewares>,
      >(
        config: TConfig,
        options: WebpackUniversalOptions = {},
      ) => {
        const activation = reserveFrameworkActivation(
          "webpack",
          registration.composition,
        );
        const entries = getFrameworkRegistrations(options);
        let nextConfig = config as TConfig &
          WebpackDevServerConfig<TMiddlewares>;
        for (const entry of entries) {
          nextConfig = withUniversalWebpackDevServer(
            nextConfig,
            withFrameworkActivation(
              entry.effectiveOptions,
              activation?.isActive,
            ),
          ) as TConfig & WebpackDevServerConfig<TMiddlewares>;
        }
        return nextConfig;
      },
    },
    rsbuild: {
      withDevServer: <
        TMiddlewares extends unknown[],
        TConfig extends RsbuildConfig<TMiddlewares>,
      >(
        config: TConfig,
        options: RsbuildUniversalOptions = {},
      ) => {
        const activation = reserveFrameworkActivation(
          "rsbuild",
          registration.composition,
        );
        const entries = getFrameworkRegistrations(options);
        let nextConfig = config as TConfig & RsbuildConfig<TMiddlewares>;
        for (const entry of entries) {
          nextConfig = withUniversalRsbuild(
            nextConfig,
            withFrameworkActivation(
              entry.effectiveOptions,
              activation?.isActive,
            ),
          ) as TConfig & RsbuildConfig<TMiddlewares>;
        }
        return nextConfig;
      },
    },
    rspack: {
      withDevServer: <
        TMiddlewares extends unknown[],
        TConfig extends RspackConfig<TMiddlewares>,
      >(
        config: TConfig,
        options: RspackUniversalOptions = {},
      ) => {
        const activation = reserveFrameworkActivation(
          "rspack",
          registration.composition,
        );
        const entries = getFrameworkRegistrations(options);
        let nextConfig = config as TConfig & RspackConfig<TMiddlewares>;
        for (const entry of entries) {
          nextConfig = withUniversalRspack(
            nextConfig,
            withFrameworkActivation(
              entry.effectiveOptions,
              activation?.isActive,
            ),
          ) as TConfig & RspackConfig<TMiddlewares>;
        }
        return nextConfig;
      },
    },
  };
}
