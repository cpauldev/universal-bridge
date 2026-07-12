import type {
  BridgeLifecycle,
  UniversalAdapterOptions,
} from "../shared/adapter-utils.js";
import {
  createSetupMiddlewaresBridgeLifecycle,
  withUniversalSetupMiddlewares,
  type SetupMiddlewaresConfig,
  type SetupMiddlewaresDevServerLike,
} from "./middleware-dev-server.js";

export type BuildToolDevServerLike = SetupMiddlewaresDevServerLike;
export type BuildToolConfig<TMiddlewares extends unknown[] = unknown[]> =
  SetupMiddlewaresConfig<TMiddlewares, BuildToolDevServerLike>;
export type BuildToolUniversalOptions = UniversalAdapterOptions;

export function createBuildToolBridgeLifecycle(
  options: BuildToolUniversalOptions = {},
): BridgeLifecycle {
  return createSetupMiddlewaresBridgeLifecycle(options);
}

export function withUniversalBuildTool<
  TMiddlewares extends unknown[],
  TDevServer extends BuildToolDevServerLike,
  TConfig extends SetupMiddlewaresConfig<TMiddlewares, TDevServer>,
>(
  config: TConfig,
  options: BuildToolUniversalOptions = {},
): TConfig & SetupMiddlewaresConfig<TMiddlewares, TDevServer> {
  return withUniversalSetupMiddlewares<TMiddlewares, TDevServer, TConfig>(
    config,
    options,
  );
}

