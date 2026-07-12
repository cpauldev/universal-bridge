import { normalizeBridgePathPrefix } from "../../bridge/prefix.js";
import type { StandaloneBridgeServer } from "../../bridge/standalone.js";
import {
  type UniversalAdapterOptions,
  ensureStandaloneBridgeSingleton,
  resolveAdapterOptions,
} from "../shared/adapter-utils.js";

const ANGULAR_CLI_BRIDGE_GLOBAL_KEY_PREFIX = "__UNIVERSAL_ANGULAR_CLI_BRIDGE__";
let angularCliBridgeInstanceCounter = 0;

function createDefaultAngularCliBridgeGlobalKey(): string {
  angularCliBridgeInstanceCounter += 1;
  return `${ANGULAR_CLI_BRIDGE_GLOBAL_KEY_PREFIX}:${process.pid}:${angularCliBridgeInstanceCounter}`;
}

function normalizeProxyContext(context: string): string {
  return normalizeBridgePathPrefix(context);
}

function createProxyTarget(baseUrl: string): AngularCliProxyTarget {
  return {
    target: baseUrl,
    secure: false,
    changeOrigin: false,
    ws: true,
    logLevel: "warn",
  };
}

export interface AngularCliProxyTarget {
  target: string;
  secure: boolean;
  changeOrigin: boolean;
  ws: boolean;
  logLevel: "warn";
}

export type AngularCliUniversalProxyConfig = Record<
  string,
  AngularCliProxyTarget
>;

export interface AngularCliUniversalOptions extends UniversalAdapterOptions {
  angularCliBridgeGlobalKey?: string;
  proxyContext?: string;
}

export async function startUniversalAngularCliBridge(
  options: AngularCliUniversalOptions = {},
): Promise<StandaloneBridgeServer> {
  const { angularCliBridgeGlobalKey, ...adapterOptions } = options;
  const resolvedOptions = resolveAdapterOptions(adapterOptions);
  const standaloneKey =
    angularCliBridgeGlobalKey ?? createDefaultAngularCliBridgeGlobalKey();

  return ensureStandaloneBridgeSingleton({
    ...resolvedOptions,
    nextBridgeGlobalKey: standaloneKey,
  });
}

export async function createUniversalAngularCliProxyConfig(
  options: AngularCliUniversalOptions = {},
): Promise<AngularCliUniversalProxyConfig> {
  const resolvedOptions = resolveAdapterOptions(options);
  const bridge = await startUniversalAngularCliBridge(options);
  const proxyContext = normalizeProxyContext(
    options.proxyContext ?? resolvedOptions.bridgePathPrefix ?? "/__universal",
  );
  const proxyTarget = createProxyTarget(bridge.baseUrl);

  return {
    [proxyContext]: proxyTarget,
    [`${proxyContext}/**`]: proxyTarget,
  };
}

export async function withUniversalAngularCliProxyConfig(
  existingProxyConfig: AngularCliUniversalProxyConfig = {},
  options: AngularCliUniversalOptions = {},
): Promise<AngularCliUniversalProxyConfig> {
  return {
    ...existingProxyConfig,
    ...(await createUniversalAngularCliProxyConfig(options)),
  };
}
