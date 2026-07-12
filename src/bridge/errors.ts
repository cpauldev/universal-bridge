import type { ServerResponse } from "http";
import type { Duplex } from "stream";

import type { UniversalErrorCode, UniversalErrorPayload } from "../types.js";
import { UNIVERSAL_WS_SUBPROTOCOL } from "./constants.js";
import { writeError } from "./http.js";

interface BridgeErrorOptions {
  retryable?: boolean;
  details?: Record<string, unknown>;
}

export function writeBridgeError(
  res: ServerResponse,
  statusCode: number,
  code: UniversalErrorCode,
  message: string,
  options?: BridgeErrorOptions,
): void {
  const error: UniversalErrorPayload = {
    code,
    message,
    retryable: options?.retryable ?? false,
    ...(options?.details ? { details: options.details } : {}),
  };

  writeError(res, statusCode, error);
}

export function rejectUpgrade(
  socket: Duplex,
  statusCode: number,
  message: string,
): void {
  const payload = JSON.stringify({
    success: false,
    message,
    error: {
      code: "invalid_request",
      message,
      retryable: false,
      details: {
        wsSubprotocol: UNIVERSAL_WS_SUBPROTOCOL,
      },
    } satisfies UniversalErrorPayload,
  });
  const reason = statusCode === 426 ? "Upgrade Required" : "Bad Request";
  const responseText =
    `HTTP/1.1 ${statusCode} ${reason}\r\n` +
    "Connection: close\r\n" +
    "Content-Type: application/json; charset=utf-8\r\n" +
    `Content-Length: ${Buffer.byteLength(payload)}\r\n` +
    "\r\n" +
    payload;

  try {
    socket.end(responseText);
  } catch {
    socket.destroy();
  }
}
