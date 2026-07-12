import type { BridgeLifecycle, UniversalAdapterOptions } from "../shared/adapter-utils.js";
import {
  createBuildToolBridgeLifecycle,
  withUniversalBuildTool,
  type BuildToolConfig,
  type BuildToolDevServerLike,
} from "./create-build-adapter.js";

export type RspackDevServerLike = BuildToolDevServerLike;
export type RspackConfig<TMiddlewares extends unknown[] = unknown[]> =
  BuildToolConfig<TMiddlewares>;

export type RspackUniversalOptions = UniversalAdapterOptions;

export function createRspackBridgeLifecycle(
  options: RspackUniversalOptions = {},
): BridgeLifecycle {
  return createBuildToolBridgeLifecycle(options);
}

export function withUniversalRspack<
  TMiddlewares extends unknown[],
  TConfig extends RspackConfig<TMiddlewares>,
>(
  config: TConfig,
  options: RspackUniversalOptions = {},
): TConfig & RspackConfig<TMiddlewares> {
  return withUniversalBuildTool<TMiddlewares, RspackDevServerLike, TConfig>(
    config,
    options,
  );
}

