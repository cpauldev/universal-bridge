import {
  type UniversalBridge,
  type UniversalBridgeOptions,
  createUniversalBridge,
} from "../../bridge/bridge.js";
import {
  buildBridgeRewriteSource,
  normalizeBridgePathPrefix,
} from "../../bridge/prefix.js";
import type { BridgeMiddlewareServer } from "../../bridge/server-types.js";
import {
  type StandaloneBridgeServer,
  startStandaloneUniversalBridgeServer,
} from "../../bridge/standalone.js";

export const UNIVERSAL_DEV_ADAPTER_NAME = "universal-bridge";
export const UNIVERSAL_BRIDGE_PATH_PREFIX = "/__universal";
export const UNIVERSAL_BRIDGE_REWRITE_SOURCE = "/__universal/:path*";
export const UNIVERSAL_NEXT_BRIDGE_GLOBAL_KEY = "__UNIVERSAL_NEXT_BRIDGE__";

export interface UniversalRewriteRule {
  source: string;
  destination: string;
}

export type UniversalRewriteSpec =
  | UniversalRewriteRule[]
  | {
      beforeFiles?: UniversalRewriteRule[];
      afterFiles?: UniversalRewriteRule[];
      fallback?: UniversalRewriteRule[];
    };

export interface UniversalNormalizedRewrites {
  beforeFiles: UniversalRewriteRule[];
  afterFiles: UniversalRewriteRule[];
  fallback: UniversalRewriteRule[];
}

export interface UniversalAdapterOptions extends UniversalBridgeOptions {
  adapterName?: string;
  rewriteSource?: string;
  /** Additional rewrite sources to proxy through the bridge (e.g. "/dashboard/:path*"). */
  additionalRewriteSources?: string[];
  nextBridgeGlobalKey?: string;
  /** Internal framework-level activation guard used by preset composition. */
  _frameworkIsActive?: () => boolean;
}

interface ResolvedUniversalAdapterOptions extends UniversalBridgeOptions {
  adapterName: string;
  rewriteSource: string;
  additionalRewriteSources: string[];
  nextBridgeGlobalKey?: string;
  _frameworkIsActive?: () => boolean;
}

export type MiddlewareAdapterServer = BridgeMiddlewareServer;

export interface BridgeLifecycle {
  setup: (server: MiddlewareAdapterServer) => Promise<UniversalBridge>;
  teardown: () => Promise<void>;
  getBridge: () => UniversalBridge | null;
}

export type ViteAdapterServer = MiddlewareAdapterServer;
export type ViteBridgeLifecycle = BridgeLifecycle;

export function resolveAdapterOptions(
  options: UniversalAdapterOptions = {},
): ResolvedUniversalAdapterOptions {
  const bridgePathPrefix = normalizeBridgePathPrefix(options.bridgePathPrefix);

  return {
    ...options,
    adapterName: options.adapterName ?? UNIVERSAL_DEV_ADAPTER_NAME,
    bridgePathPrefix,
    rewriteSource: buildBridgeRewriteSource(bridgePathPrefix),
    additionalRewriteSources: options.additionalRewriteSources ?? [],
    nextBridgeGlobalKey: options.nextBridgeGlobalKey,
    _frameworkIsActive: options._frameworkIsActive,
  };
}

function toBridgeOptions(
  options: UniversalAdapterOptions,
): UniversalBridgeOptions {
  const {
    adapterName: _adapterName,
    rewriteSource: _rewriteSource,
    additionalRewriteSources,
    nextBridgeGlobalKey: _nextBridgeGlobalKey,
    _frameworkIsActive: _frameworkIsActive,
    ...bridgeOptions
  } = options;
  const additionalProxyPaths = (additionalRewriteSources ?? []).map((source) =>
    source.endsWith("/:path*") ? source.slice(0, -"/:path*".length) : source,
  );
  return { ...bridgeOptions, additionalProxyPaths };
}

export async function attachBridgeToServer(
  server: MiddlewareAdapterServer,
  options: UniversalAdapterOptions,
): Promise<UniversalBridge> {
  const bridge = await createUniversalBridge(toBridgeOptions(options));
  await bridge.attach(server);
  return bridge;
}

export function attachBridgeToViteServer(
  server: ViteAdapterServer,
  options: UniversalAdapterOptions,
): Promise<UniversalBridge> {
  return attachBridgeToServer(server, options);
}

export function createBridgeLifecycle(
  options: UniversalAdapterOptions = {},
): BridgeLifecycle {
  const resolvedOptions = resolveAdapterOptions(options);
  let bridge: UniversalBridge | null = null;
  let setupPromise: Promise<UniversalBridge> | null = null;

  return {
    async setup(server) {
      if (setupPromise) {
        return setupPromise;
      }

      setupPromise = (async () => {
        if (bridge?.isClosed()) {
          bridge = null;
        }

        if (!bridge) {
          bridge = await createUniversalBridge(
            toBridgeOptions(resolvedOptions),
          );
          await bridge.attach(server);
        }

        return bridge;
      })();

      try {
        return await setupPromise;
      } finally {
        setupPromise = null;
      }
    },
    async teardown() {
      let currentBridge = bridge;
      if (!currentBridge && setupPromise) {
        try {
          currentBridge = await setupPromise;
        } catch {
          currentBridge = null;
        }
      }

      bridge = null;
      setupPromise = null;

      if (currentBridge) {
        await currentBridge.close();
      }
    },
    getBridge() {
      return bridge;
    },
  };
}

export function createViteBridgeLifecycle(
  options: UniversalAdapterOptions = {},
): ViteBridgeLifecycle {
  return createBridgeLifecycle(options);
}

export function ensureStandaloneBridgeSingleton(
  options: UniversalAdapterOptions,
): Promise<StandaloneBridgeServer> {
  const resolvedOptions = resolveAdapterOptions(options);
  const bridgeGlobal = globalThis as typeof globalThis & {
    [key: string]: Promise<StandaloneBridgeServer> | undefined;
  };
  const globalKey =
    resolvedOptions.nextBridgeGlobalKey ?? UNIVERSAL_NEXT_BRIDGE_GLOBAL_KEY;

  if (!bridgeGlobal[globalKey]) {
    const startupPromise = startStandaloneUniversalBridgeServer(
      toBridgeOptions(resolvedOptions),
    );
    const guardedPromise = startupPromise.catch((error) => {
      if (bridgeGlobal[globalKey] === guardedPromise) {
        delete bridgeGlobal[globalKey];
      }
      throw error;
    });
    bridgeGlobal[globalKey] = guardedPromise;
  }

  const bridge = bridgeGlobal[globalKey];
  if (!bridge) {
    throw new Error("Failed to initialize standalone universal-bridge bridge");
  }

  return bridge;
}

export function normalizeRewrites(
  rewrites: UniversalRewriteSpec | undefined,
): UniversalNormalizedRewrites {
  if (!rewrites) {
    return { beforeFiles: [], afterFiles: [], fallback: [] };
  }

  if (Array.isArray(rewrites)) {
    return { beforeFiles: rewrites, afterFiles: [], fallback: [] };
  }

  return {
    beforeFiles: rewrites.beforeFiles ?? [],
    afterFiles: rewrites.afterFiles ?? [],
    fallback: rewrites.fallback ?? [],
  };
}

export function createBridgeRewriteRoute(
  baseUrl: string,
  rewriteSource = UNIVERSAL_BRIDGE_REWRITE_SOURCE,
): UniversalRewriteRule {
  const normalizedSource = buildBridgeRewriteSource(
    rewriteSource.replace(/\/:path\*$/, ""),
  );
  return {
    source: normalizedSource,
    destination: `${baseUrl}${normalizedSource}`,
  };
}

/**
 * Creates a rewrite rule for an arbitrary path prefix, bypassing bridge path
 * normalization. Use for non-bridge paths served directly by the runtime.
 */
export function createDirectRewriteRoute(
  baseUrl: string,
  rewriteSource: string,
): UniversalRewriteRule {
  const source = rewriteSource.endsWith("/:path*")
    ? rewriteSource
    : `${rewriteSource}/:path*`;
  return { source, destination: `${baseUrl}${source}` };
}

export function appendPlugin<T>(plugins: T[] | undefined, plugin: T): T[] {
  return [...(plugins ?? []), plugin];
}
