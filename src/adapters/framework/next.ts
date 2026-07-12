import type { StandaloneBridgeServer } from "../../bridge/standalone.js";
import {
  UNIVERSAL_NEXT_BRIDGE_GLOBAL_KEY,
  type UniversalAdapterOptions,
  type UniversalRewriteSpec,
  createBridgeRewriteRoute,
  createDirectRewriteRoute,
  ensureStandaloneBridgeSingleton,
  normalizeRewrites,
  resolveAdapterOptions,
} from "../shared/adapter-utils.js";

type MaybePromise<T> = T | Promise<T>;

export type UniversalNextOptions = UniversalAdapterOptions;

const NEXT_BRIDGE_GLOBAL_KEY_PREFIX = `${UNIVERSAL_NEXT_BRIDGE_GLOBAL_KEY}:next`;
let nextBridgeInstanceCounter = 0;

function createDefaultNextBridgeGlobalKey(): string {
  nextBridgeInstanceCounter += 1;
  return `${NEXT_BRIDGE_GLOBAL_KEY_PREFIX}:${process.pid}:${nextBridgeInstanceCounter}`;
}

function ensureBridge(
  options: UniversalNextOptions,
): Promise<StandaloneBridgeServer> {
  return ensureStandaloneBridgeSingleton(options);
}

export function withUniversalNext<T extends object>(
  nextConfig: T,
  options: UniversalNextOptions = {},
): T {
  const isDev = process.env.NODE_ENV !== "production";
  if (!isDev) {
    return nextConfig;
  }

  const resolvedOptions = resolveAdapterOptions(options);
  const isFrameworkActive = resolvedOptions._frameworkIsActive;
  const nextBridgeGlobalKey =
    options.nextBridgeGlobalKey ?? createDefaultNextBridgeGlobalKey();
  const bridgeOptions = { ...resolvedOptions, nextBridgeGlobalKey };
  const next = { ...nextConfig } as T & {
    rewrites?: () => MaybePromise<UniversalRewriteSpec>;
  };
  const originalRewrites = next.rewrites;

  next.rewrites = async () => {
    if (isFrameworkActive && !isFrameworkActive()) {
      return originalRewrites ? await originalRewrites() : [];
    }

    const bridge = await ensureBridge(bridgeOptions);
    const route = createBridgeRewriteRoute(
      bridge.baseUrl,
      bridgeOptions.rewriteSource,
    );
    const additionalRoutes = (bridgeOptions.additionalRewriteSources ?? []).map(
      (source) => createDirectRewriteRoute(bridge.baseUrl, source),
    );
    const existing = originalRewrites ? await originalRewrites() : undefined;
    const normalized = normalizeRewrites(existing);

    return {
      beforeFiles: [route, ...additionalRoutes, ...normalized.beforeFiles],
      afterFiles: normalized.afterFiles,
      fallback: normalized.fallback,
    };
  };

  return next;
}
