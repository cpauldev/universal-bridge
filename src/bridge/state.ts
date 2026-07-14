import type {
  UniversalBridgeCapabilities,
  UniversalBridgeState,
  UniversalRuntimeStatus,
} from "../types.js";
import {
  UNIVERSAL_PROTOCOL_VERSION,
  UNIVERSAL_WS_SUBPROTOCOL,
} from "./constants.js";

export function createCapabilities(
  fallbackCommand: string,
  hasRuntimeControl: boolean,
  commandHost: UniversalBridgeCapabilities["commandHost"],
  hasRuntimeWebSocketGateway: boolean,
): UniversalBridgeCapabilities {
  return {
    commandHost,
    hasRuntimeControl,
    canStartRuntime: hasRuntimeControl,
    canRestartRuntime: hasRuntimeControl,
    canStopRuntime: hasRuntimeControl,
    hasRuntimeWebSocketGateway,
    fallbackCommand,
    wsSubprotocol: UNIVERSAL_WS_SUBPROTOCOL,
    supportedProtocolVersions: [UNIVERSAL_PROTOCOL_VERSION],
  };
}

export function toTransportState(
  runtime: UniversalRuntimeStatus,
): UniversalBridgeState["transportState"] {
  switch (runtime.phase) {
    case "running":
      return "connected";
    case "starting":
      return "runtime_starting";
    case "error":
      return "degraded";
    case "stopped":
    case "stopping":
    default:
      return "bridge_detecting";
  }
}
