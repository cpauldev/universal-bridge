import {
  type RsbuildConfig,
  type RsbuildUniversaOptions,
  withUniversaRsbuild,
} from "./adapters/build/rsbuild.js";
import {
  type RspackConfig,
  type RspackUniversaOptions,
  withUniversaRspack,
} from "./adapters/build/rspack.js";
import {
  type WebpackDevServerConfig,
  type WebpackUniversaOptions,
  withUniversaWebpackDevServer,
} from "./adapters/build/webpack.js";
import {
  type AngularCliUniversaOptions,
  type AngularCliUniversaProxyConfig,
  createUniversaAngularCliProxyConfig,
  startUniversaAngularCliBridge,
  withUniversaAngularCliProxyConfig,
} from "./adapters/framework/angular-cli.js";
import {
  type AstroUniversaOptions,
  createUniversaAstroIntegration,
} from "./adapters/framework/astro.js";
import {
  type UniversaNextOptions,
  withUniversaNext,
} from "./adapters/framework/next.js";
import {
  type UniversaNuxtOptions,
  createUniversaNuxtModule,
} from "./adapters/framework/nuxt.js";
import {
  type BunBridgeHandle,
  type BunUniversaOptions,
  attachUniversaToBunServe,
} from "./adapters/server/bun.js";
import {
  type FastifyBridgeHandle,
  type FastifyLikeInstance,
  type FastifyUniversaOptions,
  attachUniversaToFastify,
} from "./adapters/server/fastify.js";
import {
  type HonoBridgeHandle,
  type HonoNodeServer,
  type HonoUniversaOptions,
  attachUniversaToHonoNodeServer,
} from "./adapters/server/hono.js";
import {
  type NodeBridgeHandle,
  type NodeUniversaOptions,
  attachUniversaToNodeServer,
} from "./adapters/server/node.js";
import {
  type UniversaVitePluginOptions,
  createUniversaVitePlugin,
} from "./adapters/shared/plugin.js";
import {
  buildBridgeRewriteSource,
  normalizeBridgePathPrefix,
} from "./bridge/prefix.js";
import {
  type UniversaCompositionMode,
  type UniversaPresetOptions,
  type UniversaPresetRegistration,
  registerUniversaPreset,
  resolveFrameworkComposition,
} from "./preset-registry.js";

export type {
  UniversaCompositionMode,
  UniversaPresetIdentity,
  UniversaPresetOptions,
} from "./preset-registry.js";

export interface UniversaPreset {
  vite: (
    options?: UniversaVitePluginOptions,
  ) =>
    | ReturnType<typeof createUniversaVitePlugin>
    | ReturnType<typeof createUniversaVitePlugin>[];
  next: <T extends object>(nextConfig: T, options?: UniversaNextOptions) => T;
  nuxt: (
    options?: UniversaNuxtOptions,
  ) => ReturnType<typeof createUniversaNuxtModule>;
  astro: (
    options?: AstroUniversaOptions,
  ) => ReturnType<typeof createUniversaAstroIntegration>;
  angularCli: {
    startBridge: (
      options?: AngularCliUniversaOptions,
    ) => ReturnType<typeof startUniversaAngularCliBridge>;
    createProxyConfig: (
      options?: AngularCliUniversaOptions,
    ) => ReturnType<typeof createUniversaAngularCliProxyConfig>;
    withProxyConfig: (
      existingProxyConfig?: AngularCliUniversaProxyConfig,
      options?: AngularCliUniversaOptions,
    ) => ReturnType<typeof withUniversaAngularCliProxyConfig>;
  };
  bun: {
    attach: (options?: BunUniversaOptions) => Promise<BunBridgeHandle>;
  };
  node: {
    attach: (
      server: Parameters<typeof attachUniversaToNodeServer>[0],
      options?: NodeUniversaOptions,
    ) => Promise<NodeBridgeHandle>;
  };
  fastify: {
    attach: (
      fastify: FastifyLikeInstance,
      options?: FastifyUniversaOptions,
    ) => Promise<FastifyBridgeHandle>;
  };
  hono: {
    attach: (
      server: HonoNodeServer,
      options?: HonoUniversaOptions,
    ) => Promise<HonoBridgeHandle>;
  };
  webpack: {
    withDevServer: <
      TMiddlewares extends unknown[],
      TConfig extends WebpackDevServerConfig<TMiddlewares>,
    >(
      config: TConfig,
      options?: WebpackUniversaOptions,
    ) => TConfig & WebpackDevServerConfig<TMiddlewares>;
  };
  rsbuild: {
    withDevServer: <
      TMiddlewares extends unknown[],
      TConfig extends RsbuildConfig<TMiddlewares>,
    >(
      config: TConfig,
      options?: RsbuildUniversaOptions,
    ) => TConfig & RsbuildConfig<TMiddlewares>;
  };
  rspack: {
    withDevServer: <
      TMiddlewares extends unknown[],
      TConfig extends RspackConfig<TMiddlewares>,
    >(
      config: TConfig,
      options?: RspackUniversaOptions,
    ) => TConfig & RspackConfig<TMiddlewares>;
  };
}

type FrameworkAdapterKind =
  | "vite"
  | "next"
  | "nuxt"
  | "astro"
  | "webpack"
  | "rsbuild"
  | "rspack";

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

const FRAMEWORK_ACTIVATION_SYMBOL = Symbol.for("universa.framework.activation");

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
  composition: UniversaCompositionMode,
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

type VitePlugin = ReturnType<typeof createUniversaVitePlugin>;
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

type NuxtModule = ReturnType<typeof createUniversaNuxtModule>;
type AstroIntegration = ReturnType<typeof createUniversaAstroIntegration>;

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
        : "universa-module",
    )
    .join("+");

  return Object.assign(setup, {
    meta: {
      name: `composed:${names}`,
      configKey: "universa",
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

export function createUniversaPreset(
  baseOptions: UniversaPresetOptions,
): UniversaPreset {
  const registration = registerUniversaPreset(baseOptions);

  function withLocalOptions<T extends object>(options?: Partial<T>): T {
    return mergeAdapterOptions(registration.effectiveOptions as T, options);
  }

  function getFrameworkRegistrations<T extends object>(
    options?: Partial<T>,
  ): UniversaPresetRegistration[] {
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
      const plugins = entries.map((entry) =>
        guardVitePlugin(
          "vite",
          createUniversaVitePlugin(
            withFrameworkActivation(
              entry.effectiveOptions,
              activation?.isActive,
            ),
          ),
          activation?.isActive,
          activation?.token,
        ),
      );
      return plugins.length === 1 ? plugins[0] : plugins;
    },
    next<T extends object>(
      nextConfig: T,
      options: UniversaNextOptions = {},
    ): T {
      const activation = reserveFrameworkActivation(
        "next",
        registration.composition,
      );
      const entries = getFrameworkRegistrations(options);
      return entries.reduce<T>(
        (config, entry) =>
          withUniversaNext(
            config,
            withFrameworkActivation(
              entry.effectiveOptions,
              activation?.isActive,
            ),
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
      const modules = entries.map((entry) =>
        createUniversaNuxtModule(
          withFrameworkActivation(entry.effectiveOptions, activation?.isActive),
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
      const integrations = entries.map((entry) =>
        createUniversaAstroIntegration(
          withFrameworkActivation(entry.effectiveOptions, activation?.isActive),
        ),
      );
      return guardAstroIntegration(
        composeAstroIntegrations(integrations),
        activation?.isActive,
      );
    },
    angularCli: {
      startBridge: (options = {}) =>
        startUniversaAngularCliBridge(withLocalOptions(options)),
      createProxyConfig: (options = {}) =>
        createUniversaAngularCliProxyConfig(withLocalOptions(options)),
      withProxyConfig: (existingProxyConfig = {}, options = {}) =>
        withUniversaAngularCliProxyConfig(
          existingProxyConfig,
          withLocalOptions(options),
        ),
    },
    bun: {
      attach: (options = {}) =>
        attachUniversaToBunServe(withLocalOptions(options)),
    },
    node: {
      attach: (server, options = {}) =>
        attachUniversaToNodeServer(server, withLocalOptions(options)),
    },
    fastify: {
      attach: (fastify, options = {}) =>
        attachUniversaToFastify(fastify, withLocalOptions(options)),
    },
    hono: {
      attach: (server, options = {}) =>
        attachUniversaToHonoNodeServer(server, withLocalOptions(options)),
    },
    webpack: {
      withDevServer: <
        TMiddlewares extends unknown[],
        TConfig extends WebpackDevServerConfig<TMiddlewares>,
      >(
        config: TConfig,
        options: WebpackUniversaOptions = {},
      ) => {
        const activation = reserveFrameworkActivation(
          "webpack",
          registration.composition,
        );
        const entries = getFrameworkRegistrations(options);
        let nextConfig = config as TConfig &
          WebpackDevServerConfig<TMiddlewares>;
        for (const entry of entries) {
          nextConfig = withUniversaWebpackDevServer(
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
        options: RsbuildUniversaOptions = {},
      ) => {
        const activation = reserveFrameworkActivation(
          "rsbuild",
          registration.composition,
        );
        const entries = getFrameworkRegistrations(options);
        let nextConfig = config as TConfig & RsbuildConfig<TMiddlewares>;
        for (const entry of entries) {
          nextConfig = withUniversaRsbuild(
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
        options: RspackUniversaOptions = {},
      ) => {
        const activation = reserveFrameworkActivation(
          "rspack",
          registration.composition,
        );
        const entries = getFrameworkRegistrations(options);
        let nextConfig = config as TConfig & RspackConfig<TMiddlewares>;
        for (const entry of entries) {
          nextConfig = withUniversaRspack(
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
