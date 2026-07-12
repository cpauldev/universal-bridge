import type { RuntimeHelperOptions } from "../runtime/runtime-helper.js";
import type { UniversalBridgeInstance } from "../types.js";
import {
  DEFAULT_FALLBACK_COMMAND,
  WS_HEARTBEAT_INTERVAL_MS_DEFAULT,
} from "./constants.js";
import { normalizeBridgePathPrefix } from "./prefix.js";

export interface UniversalBridgeOptions extends RuntimeHelperOptions {
  autoStart?: boolean;
  bridgePathPrefix?: string;
  fallbackCommand?: string;
  eventHeartbeatIntervalMs?: number;
  proxyRuntimeWebSocket?: boolean;
  instance?: UniversalBridgeInstance;
  /** Additional URL path prefixes to proxy directly to the runtime (e.g. ["/dashboard"]). */
  additionalProxyPaths?: string[];
}

export type ResolvedBridgeOptions = Required<
  Pick<
    UniversalBridgeOptions,
    | "autoStart"
    | "bridgePathPrefix"
    | "fallbackCommand"
    | "eventHeartbeatIntervalMs"
    | "proxyRuntimeWebSocket"
  >
> &
  Omit<
    UniversalBridgeOptions,
    | "autoStart"
    | "bridgePathPrefix"
    | "fallbackCommand"
    | "eventHeartbeatIntervalMs"
    | "proxyRuntimeWebSocket"
  >;

export function resolveBridgeOptions(
  options: UniversalBridgeOptions,
): ResolvedBridgeOptions {
  return {
    ...options,
    autoStart: options.autoStart ?? true,
    bridgePathPrefix: normalizeBridgePathPrefix(options.bridgePathPrefix),
    fallbackCommand: options.fallbackCommand ?? DEFAULT_FALLBACK_COMMAND,
    eventHeartbeatIntervalMs:
      options.eventHeartbeatIntervalMs ?? WS_HEARTBEAT_INTERVAL_MS_DEFAULT,
    proxyRuntimeWebSocket: options.proxyRuntimeWebSocket ?? true,
  };
}
