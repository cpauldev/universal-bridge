import type { BridgeLifecycle, UniversalAdapterOptions } from "../shared/adapter-utils.js";
import {
  createBuildToolBridgeLifecycle,
  withUniversalBuildTool,
  type BuildToolConfig,
  type BuildToolDevServerLike,
} from "./create-build-adapter.js";

export type RsbuildDevServerLike = BuildToolDevServerLike;
export type RsbuildConfig<TMiddlewares extends unknown[] = unknown[]> =
  BuildToolConfig<TMiddlewares>;

export type RsbuildUniversalOptions = UniversalAdapterOptions;

export function createRsbuildBridgeLifecycle(
  options: RsbuildUniversalOptions = {},
): BridgeLifecycle {
  return createBuildToolBridgeLifecycle(options);
}

export function withUniversalRsbuild<
  TMiddlewares extends unknown[],
  TConfig extends RsbuildConfig<TMiddlewares>,
>(
  config: TConfig,
  options: RsbuildUniversalOptions = {},
): TConfig & RsbuildConfig<TMiddlewares> {
  return withUniversalBuildTool<TMiddlewares, RsbuildDevServerLike, TConfig>(
    config,
    options,
  );
}

