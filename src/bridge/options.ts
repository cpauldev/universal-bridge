import type { RuntimeHelperOptions } from "../runtime/runtime-helper.js";
import type { UniversalBridgeInstance } from "../types.js";
import {
  DEFAULT_FALLBACK_COMMAND,
  WS_HEARTBEAT_INTERVAL_MS_DEFAULT,
} from "./constants.js";
import { normalizeBridgePathPrefix } from "./prefix.js";

export interface RuntimeWebSocketGatewayOptions {
  /** WebSocket path exposed by the managed runtime (for example, "/ws"). */
  path: string;
}

export interface UniversalBridgeOptions extends RuntimeHelperOptions {
  autoStart?: boolean;
  bridgePathPrefix?: string;
  fallbackCommand?: string;
  eventHeartbeatIntervalMs?: number;
  /** Enables a same-origin WebSocket gateway to one managed runtime endpoint. */
  runtimeWebSocketGateway?: RuntimeWebSocketGatewayOptions;
  /** @internal Adapter transport support for runtime WebSocket upgrades. */
  runtimeWebSocketGatewaySupported?: boolean;
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
    | "runtimeWebSocketGatewaySupported"
  >
> &
  Omit<
    UniversalBridgeOptions,
    | "autoStart"
    | "bridgePathPrefix"
    | "fallbackCommand"
    | "eventHeartbeatIntervalMs"
    | "runtimeWebSocketGatewaySupported"
  >;

function resolveRuntimeWebSocketGateway(
  gateway: RuntimeWebSocketGatewayOptions | undefined,
): RuntimeWebSocketGatewayOptions | undefined {
  if (!gateway) return undefined;

  const path = gateway.path.trim();
  if (!path.startsWith("/") || path.startsWith("//") || /[?#]/.test(path)) {
    throw new Error(
      "runtimeWebSocketGateway.path must be an absolute runtime path without a query string or fragment.",
    );
  }

  return { path };
}

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
    runtimeWebSocketGateway: resolveRuntimeWebSocketGateway(
      options.runtimeWebSocketGateway,
    ),
    runtimeWebSocketGatewaySupported:
      options.runtimeWebSocketGatewaySupported ?? true,
  };
}
