export {
  UNIVERSAL_BRIDGE_PATH_PREFIX,
  UNIVERSAL_BRIDGE_REWRITE_SOURCE,
  UNIVERSAL_DEV_ADAPTER_NAME,
  UNIVERSAL_NEXT_BRIDGE_GLOBAL_KEY,
  appendPlugin,
  attachBridgeToServer,
  attachBridgeToViteServer,
  createBridgeRewriteRoute,
  createDirectRewriteRoute,
  createBridgeLifecycle,
  createViteBridgeLifecycle,
  ensureStandaloneBridgeSingleton,
  normalizeRewrites,
  resolveAdapterOptions,
  type BridgeLifecycle,
  type UniversalAdapterOptions,
  type UniversalNormalizedRewrites,
  type UniversalRewriteRule,
  type UniversalRewriteSpec,
  type MiddlewareAdapterServer,
  type ViteAdapterServer,
  type ViteBridgeLifecycle,
} from "./adapters/shared/adapter-utils.js";
export {
  createSetupMiddlewaresBridgeLifecycle,
  withUniversalSetupMiddlewares,
} from "./adapters/build/middleware-dev-server.js";
export type {
  SetupMiddlewaresApp,
  SetupMiddlewaresConfig,
  SetupMiddlewaresDevServerLike,
  SetupMiddlewaresHttpServer,
} from "./adapters/build/middleware-dev-server.js";
