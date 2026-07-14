export type UniversalRuntimePhase =
  "stopped" | "starting" | "running" | "stopping" | "error";

export type UniversalProtocolVersion = "2";

export interface UniversalRuntimeStatus {
  phase: UniversalRuntimePhase;
  url: string | null;
  pid: number | null;
  startedAt: number | null;
  lastError: string | null;
}

export type UniversalErrorCode =
  | "invalid_request"
  | "route_not_found"
  | "runtime_start_failed"
  | "runtime_control_failed"
  | "runtime_unavailable"
  | "bridge_proxy_failed"
  | "internal_error";

export interface UniversalErrorPayload {
  code: UniversalErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export interface UniversalErrorResponse {
  success: false;
  message: string;
  error: UniversalErrorPayload;
}

export interface UniversalBridgeCapabilities {
  commandHost: "host" | "helper" | "hybrid";
  hasRuntimeControl: boolean;
  canStartRuntime: boolean;
  canRestartRuntime: boolean;
  canStopRuntime: boolean;
  hasRuntimeWebSocketGateway: boolean;
  fallbackCommand: string;
  wsSubprotocol: string;
  supportedProtocolVersions: UniversalProtocolVersion[];
}

export interface UniversalBridgeInstance {
  id: string;
  label?: string;
}

export interface UniversalBridgeState {
  protocolVersion: UniversalProtocolVersion;
  /** Monotonic revision for ordering complete bridge snapshots across REST and events. */
  revision: number;
  transportState:
    | "disconnected"
    | "bridge_detecting"
    | "runtime_starting"
    | "connected"
    | "degraded";
  runtime: UniversalRuntimeStatus;
  capabilities: UniversalBridgeCapabilities;
  instance?: UniversalBridgeInstance;
  error?: string;
}

export interface UniversalCommandRequest {
  command:
    | "sync"
    | "login"
    | "logout"
    | "translate"
    | "translate-hashes"
    | "open-file"
    | "save-file"
    | "update-translation";
  payload?: Record<string, unknown>;
}

export interface UniversalCommandResult {
  success: boolean;
  message?: string;
  operationId?: string;
  data?: Record<string, unknown>;
}

interface UniversalBridgeEventBase {
  protocolVersion: UniversalProtocolVersion;
  eventId: number;
  timestamp: number;
}

export type UniversalBridgeEvent =
  | (UniversalBridgeEventBase & {
      type: "bridge-state";
      state: UniversalBridgeState;
    })
  | (UniversalBridgeEventBase & {
      type: "bridge-error";
      error: string;
    });
