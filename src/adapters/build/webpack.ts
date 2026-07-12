import type { BridgeLifecycle, UniversalAdapterOptions } from "../shared/adapter-utils.js";
import {
  createBuildToolBridgeLifecycle,
  withUniversalBuildTool,
  type BuildToolConfig,
  type BuildToolDevServerLike,
} from "./create-build-adapter.js";
import type {
  SetupMiddlewaresApp,
  SetupMiddlewaresHttpServer,
} from "./middleware-dev-server.js";

export type WebpackLikeApp = SetupMiddlewaresApp;
export type WebpackLikeHttpServer = SetupMiddlewaresHttpServer;
export type WebpackDevServerLike = BuildToolDevServerLike;
export type WebpackDevServerConfig<TMiddlewares extends unknown[] = unknown[]> =
  BuildToolConfig<TMiddlewares>;

export type WebpackUniversalOptions = UniversalAdapterOptions;

export function createWebpackBridgeLifecycle(
  options: WebpackUniversalOptions = {},
): BridgeLifecycle {
  return createBuildToolBridgeLifecycle(options);
}

export function withUniversalWebpackDevServer<
  TMiddlewares extends unknown[],
  TConfig extends WebpackDevServerConfig<TMiddlewares>,
>(
  config: TConfig,
  options: WebpackUniversalOptions = {},
): TConfig & WebpackDevServerConfig<TMiddlewares> {
  return withUniversalBuildTool<TMiddlewares, WebpackDevServerLike, TConfig>(
    config,
    options,
  );
}

