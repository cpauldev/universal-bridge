export {
  createBridgeRuntimeStore,
  type BridgeRuntimeSnapshot,
  type BridgeRuntimeStore,
} from "./client/runtime-store.js";
export {
  createUniversalBridge,
  UniversalBridge,
  type RuntimeWebSocketGatewayOptions,
  type UniversalBridgeOptions,
} from "./bridge/bridge.js";
export {
  UNIVERSAL_PROTOCOL_VERSION,
  UNIVERSAL_WS_SUBPROTOCOL,
} from "./bridge/constants.js";
export {
  startStandaloneUniversalBridgeServer,
  type StandaloneBridgeServer,
} from "./bridge/standalone.js";
export {
  createUniversalVitePlugin,
  type UniversalVitePluginOptions,
} from "./adapters/shared/plugin.js";
export {
  withUniversalNext,
  type UniversalNextOptions,
} from "./adapters/framework/next.js";
export {
  createUniversalAstroIntegration,
  type AstroUniversalOptions,
} from "./adapters/framework/astro.js";
export {
  createUniversalAngularCliProxyConfig,
  startUniversalAngularCliBridge,
  withUniversalAngularCliProxyConfig,
  type AngularCliUniversalOptions,
  type AngularCliUniversalProxyConfig,
  type AngularCliProxyTarget,
} from "./adapters/framework/angular-cli.js";
export {
  createUniversalNuxtModule,
  type UniversalNuxtOptions,
} from "./adapters/framework/nuxt.js";
export {
  attachUniversalToBunServe,
  withUniversalBunServeFetch,
  withUniversalBunServeWebSocketHandlers,
  type BunBridgeHandle,
  type BunUniversalOptions,
  type BunServeFetchHandler,
  type BunServeLikeServer,
  type BunServeLikeWebSocket,
  type BunServeNextFetchHandler,
  type BunServeWebSocketHandlers,
} from "./adapters/server/bun.js";
export {
  attachUniversalToNodeServer,
  createNodeBridgeLifecycle,
  type NodeBridgeHandle,
  type NodeUniversalOptions,
} from "./adapters/server/node.js";
export {
  attachUniversalToFastify,
  type FastifyBridgeHandle,
  type FastifyUniversalOptions,
  type FastifyLikeInstance,
  type FastifyLikeReply,
  type FastifyLikeRequest,
} from "./adapters/server/fastify.js";
export {
  attachUniversalToExpress,
  createUniversalExpressMiddleware,
  type ExpressBridgeHandle,
  type ExpressLikeApp,
  type ExpressNextFunction,
  type ExpressUniversalMiddleware,
  type ExpressUniversalOptions,
} from "./adapters/server/express.js";
export {
  attachUniversalToHonoNodeServer,
  createHonoBridgeLifecycle,
  type HonoBridgeHandle,
  type HonoUniversalOptions,
  type HonoNodeServer,
} from "./adapters/server/hono.js";
export {
  createWebpackBridgeLifecycle,
  withUniversalWebpackDevServer,
  type WebpackDevServerConfig,
  type WebpackDevServerLike,
  type WebpackUniversalOptions,
  type WebpackLikeApp,
  type WebpackLikeHttpServer,
} from "./adapters/build/webpack.js";
export {
  createRsbuildBridgeLifecycle,
  withUniversalRsbuild,
  type RsbuildConfig,
  type RsbuildDevServerLike,
  type RsbuildUniversalOptions,
} from "./adapters/build/rsbuild.js";
export {
  createRspackBridgeLifecycle,
  withUniversalRspack,
  type RspackConfig,
  type RspackDevServerLike,
  type RspackUniversalOptions,
} from "./adapters/build/rspack.js";
export {
  RuntimeHelper,
  type RuntimeHelperOptions,
  type RuntimeControlSupport,
} from "./runtime/runtime-helper.js";
export {
  createDockerComposeRuntime,
  type DockerComposeRuntimeConfig,
  type DockerComposeRuntimeOptions,
} from "./runtime/docker.js";
export {
  UniversalClientError,
  createUniversalClient,
  type UniversalBridgeHealth,
  type UniversalClient,
  type UniversalClientOptions,
  type UniversalEventsSubscriptionOptions,
  type UniversalWebSocketLike,
} from "./client/client.js";
export {
  createClientRuntimeContext,
  getClientRuntimeContexts,
  registerClientRuntimeContext,
  registerClientRuntimeContexts,
  resolveClientAutoMount,
  resolveClientRuntimeContext,
  type UniversalClientRuntimeContext,
} from "./client/runtime-context.js";
export type {
  UniversalClientEntry,
  UniversalPresetClientOptions,
} from "./preset-registry.js";
export type {
  UniversalBridgeCapabilities,
  UniversalBridgeEvent,
  UniversalBridgeInstance,
  UniversalBridgeState,
  UniversalCommandRequest,
  UniversalCommandResult,
  UniversalErrorCode,
  UniversalErrorPayload,
  UniversalErrorResponse,
  UniversalProtocolVersion,
  UniversalRuntimePhase,
  UniversalRuntimeStatus,
} from "./types.js";
