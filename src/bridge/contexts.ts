import type { UniversalBridgeState, UniversalRuntimeStatus } from "../types.js";
import type { RuntimeProxyContext } from "./proxy.js";
import type { RuntimeControlContext } from "./runtime-control.js";

interface BridgeContextsOptions {
  shouldAutoStartRuntime: () => boolean;
  hasRuntimeControl: () => boolean;
  fallbackCommand: string;
  getState: () => UniversalBridgeState;
  getRuntimeStatus: () => UniversalRuntimeStatus;
  startRuntime: () => Promise<UniversalRuntimeStatus>;
  restartRuntime: () => Promise<UniversalRuntimeStatus>;
  stopRuntime: () => Promise<UniversalRuntimeStatus>;
  ensureRuntimeStarted: () => Promise<UniversalRuntimeStatus>;
  getRuntimeUrl: () => string | null;
  enableAutoStartRuntime: () => void;
  disableAutoStartRuntime: () => void;
  emitRuntimeError: (error: string) => void;
  writeBridgeError: (
    res: import("http").ServerResponse,
    statusCode: number,
    code:
      | "runtime_start_failed"
      | "runtime_control_failed"
      | "runtime_unavailable"
      | "bridge_proxy_failed",
    message: string,
    options?: {
      retryable?: boolean;
      details?: Record<string, unknown>;
    },
  ) => void;
}

export function createRuntimeControlContext(
  options: BridgeContextsOptions,
): RuntimeControlContext {
  return {
    shouldAutoStartRuntime: options.shouldAutoStartRuntime,
    hasRuntimeControl: options.hasRuntimeControl,
    fallbackCommand: options.fallbackCommand,
    getState: options.getState,
    getRuntimeStatus: options.getRuntimeStatus,
    startRuntime: options.startRuntime,
    restartRuntime: options.restartRuntime,
    stopRuntime: options.stopRuntime,
    enableAutoStartRuntime: options.enableAutoStartRuntime,
    disableAutoStartRuntime: options.disableAutoStartRuntime,
    emitRuntimeError: options.emitRuntimeError,
    writeBridgeError: (res, statusCode, code, message, writeOptions) => {
      options.writeBridgeError(res, statusCode, code, message, writeOptions);
    },
  };
}

export function createRuntimeProxyContext(
  options: BridgeContextsOptions,
): RuntimeProxyContext {
  return {
    shouldAutoStartRuntime: options.shouldAutoStartRuntime,
    ensureRuntimeStarted: options.ensureRuntimeStarted,
    getRuntimeUrl: options.getRuntimeUrl,
    fallbackCommand: options.fallbackCommand,
    onRuntimeError: options.emitRuntimeError,
    writeBridgeError: options.writeBridgeError,
  };
}
