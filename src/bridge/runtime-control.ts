import type { ServerResponse } from "http";

import type { UniversalBridgeState, UniversalRuntimeStatus } from "../types.js";
import { writeJson } from "./http.js";

export interface RuntimeControlContext {
  shouldAutoStartRuntime: () => boolean;
  hasRuntimeControl: () => boolean;
  fallbackCommand: string;
  getState: () => UniversalBridgeState;
  getRuntimeStatus: () => UniversalRuntimeStatus;
  startRuntime: () => Promise<UniversalRuntimeStatus>;
  restartRuntime: () => Promise<UniversalRuntimeStatus>;
  stopRuntime: () => Promise<UniversalRuntimeStatus>;
  enableAutoStartRuntime: () => void;
  disableAutoStartRuntime: () => void;
  emitRuntimeError: (error: string) => void;
  writeBridgeError: (
    res: ServerResponse,
    statusCode: number,
    code: "runtime_start_failed" | "runtime_control_failed",
    message: string,
    options?: {
      retryable?: boolean;
      details?: Record<string, unknown>;
    },
  ) => void;
}

function writeMissingRuntimeCommandError(
  res: ServerResponse,
  context: RuntimeControlContext,
): void {
  context.writeBridgeError(
    res,
    503,
    "runtime_start_failed",
    "Runtime command is not configured",
    {
      retryable: true,
      details: {
        fallbackCommand: context.fallbackCommand,
        reason: "missing_command",
      },
    },
  );
}

export async function handleStateRoute(
  res: ServerResponse,
  context: RuntimeControlContext,
): Promise<void> {
  if (
    context.shouldAutoStartRuntime() &&
    context.getRuntimeStatus().phase === "stopped"
  ) {
    try {
      await context.startRuntime();
    } catch (error) {
      context.emitRuntimeError(
        error instanceof Error ? error.message : String(error),
      );
      writeJson(res, 200, context.getState());
      return;
    }
  }

  writeJson(res, 200, context.getState());
}

export function handleRuntimeStatusRoute(
  res: ServerResponse,
  context: RuntimeControlContext,
): void {
  writeJson(res, 200, context.getRuntimeStatus());
}

export async function handleRuntimeControlRoute(
  method: string,
  routePath: string,
  res: ServerResponse,
  context: RuntimeControlContext,
): Promise<boolean> {
  if (method !== "POST") {
    return false;
  }

  if (routePath === "/runtime/start") {
    if (!context.hasRuntimeControl()) {
      writeMissingRuntimeCommandError(res, context);
      return true;
    }
    await handleControlAction(res, context, "runtime_start_failed", () => {
      context.enableAutoStartRuntime();
      return context.startRuntime();
    });
    return true;
  }

  if (routePath === "/runtime/restart") {
    if (!context.hasRuntimeControl()) {
      writeMissingRuntimeCommandError(res, context);
      return true;
    }
    await handleControlAction(res, context, "runtime_start_failed", () => {
      context.enableAutoStartRuntime();
      return context.restartRuntime();
    });
    return true;
  }

  if (routePath === "/runtime/stop") {
    await handleControlAction(res, context, "runtime_control_failed", () => {
      context.disableAutoStartRuntime();
      return context.stopRuntime();
    });
    return true;
  }

  return false;
}

async function handleControlAction(
  res: ServerResponse,
  context: RuntimeControlContext,
  errorCode: "runtime_start_failed" | "runtime_control_failed",
  action: () => Promise<UniversalRuntimeStatus>,
): Promise<void> {
  try {
    const status = await action();
    writeJson(res, 200, { success: true, runtime: status });
  } catch (error) {
    context.writeBridgeError(
      res,
      errorCode === "runtime_start_failed" ? 503 : 500,
      errorCode,
      error instanceof Error ? error.message : String(error),
      {
        retryable: true,
        details: {
          fallbackCommand: context.fallbackCommand,
        },
      },
    );
  }
}
