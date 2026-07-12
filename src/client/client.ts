import {
  BRIDGE_PREFIX_DEFAULT,
  UNIVERSAL_WS_SUBPROTOCOL,
} from "../bridge/constants.js";
import { normalizeBridgePathPrefix } from "../bridge/prefix.js";
import type {
  UniversalBridgeEvent,
  UniversalBridgeInstance,
  UniversalBridgeState,
  UniversalErrorResponse,
  UniversalRuntimeStatus,
} from "../types.js";

export interface UniversalClientOptions {
  baseUrl?: string;
  bridgePathPrefix?: string;
  namespaceId?: string;
  fetchImpl?: typeof fetch;
  webSocketFactory?: (
    url: string,
    protocols: string[],
  ) => UniversalWebSocketLike;
}

export interface UniversalBridgeHealth extends UniversalBridgeState {
  ok: true;
  bridge: true;
  instance?: UniversalBridgeInstance;
}

export interface UniversalEventsSubscriptionOptions {
  onError?: (error: unknown) => void;
}

export interface UniversalWebSocketLike {
  close: () => void;
  addEventListener?: (
    event: string,
    listener: (...args: unknown[]) => void,
  ) => void;
  removeEventListener?: (
    event: string,
    listener: (...args: unknown[]) => void,
  ) => void;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  off?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (
    event: string,
    listener: (...args: unknown[]) => void,
  ) => void;
}

export class UniversalClientError extends Error {
  statusCode: number;
  response: UniversalErrorResponse | null;

  constructor(statusCode: number, response: UniversalErrorResponse | null) {
    super(
      response?.error.message ?? `Request failed with status ${statusCode}`,
    );
    this.name = "UniversalClientError";
    this.statusCode = statusCode;
    this.response = response;
  }
}

export interface UniversalClient {
  getHealth: () => Promise<UniversalBridgeHealth>;
  getState: () => Promise<UniversalBridgeState>;
  getRuntimeStatus: () => Promise<UniversalRuntimeStatus>;
  startRuntime: () => Promise<UniversalRuntimeStatus>;
  restartRuntime: () => Promise<UniversalRuntimeStatus>;
  stopRuntime: () => Promise<UniversalRuntimeStatus>;
  subscribeEvents: (
    listener: (event: UniversalBridgeEvent) => void,
    options?: UniversalEventsSubscriptionOptions,
  ) => () => void;
}

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

function joinPath(basePath: string, suffix: string): string {
  return `${basePath.replace(/\/$/, "")}${normalizePath(suffix)}`;
}

function resolveHttpUrl(baseUrl: string | undefined, path: string): string {
  if (!baseUrl) {
    return path;
  }

  return new URL(path, baseUrl).toString();
}

function resolveWebSocketUrl(
  baseUrl: string | undefined,
  path: string,
): string {
  if (baseUrl) {
    const url = new URL(path, baseUrl);
    if (url.protocol === "http:") {
      url.protocol = "ws:";
    } else if (url.protocol === "https:") {
      url.protocol = "wss:";
    }
    return url.toString();
  }

  if (typeof window !== "undefined") {
    const url = new URL(path, window.location.origin);
    url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return url.toString();
  }

  throw new Error(
    "Universal client requires `baseUrl` in non-browser environments for WebSocket subscriptions.",
  );
}

function addSocketListener(
  socket: UniversalWebSocketLike,
  event: string,
  listener: (...args: unknown[]) => void,
): void {
  if (typeof socket.addEventListener === "function") {
    socket.addEventListener(event, listener);
    return;
  }
  if (typeof socket.on === "function") {
    socket.on(event, listener);
    return;
  }
  throw new Error("WebSocket implementation does not support event listeners.");
}

function removeSocketListener(
  socket: UniversalWebSocketLike,
  event: string,
  listener: (...args: unknown[]) => void,
): void {
  if (typeof socket.removeEventListener === "function") {
    socket.removeEventListener(event, listener);
    return;
  }
  if (typeof socket.off === "function") {
    socket.off(event, listener);
    return;
  }
  if (typeof socket.removeListener === "function") {
    socket.removeListener(event, listener);
  }
}

function extractMessagePayload(message: unknown): string {
  const textDecoder = new TextDecoder();

  if (typeof message === "string") {
    return message;
  }

  if (
    typeof message === "object" &&
    message !== null &&
    "data" in message &&
    typeof (message as { data?: unknown }).data !== "undefined"
  ) {
    return extractMessagePayload((message as { data: unknown }).data);
  }

  if (message instanceof ArrayBuffer) {
    return textDecoder.decode(new Uint8Array(message));
  }
  if (ArrayBuffer.isView(message)) {
    return textDecoder.decode(
      new Uint8Array(message.buffer, message.byteOffset, message.byteLength),
    );
  }

  return String(message);
}

export function createUniversalClient(
  options: UniversalClientOptions = {},
): UniversalClient {
  const bridgePathPrefix = normalizeBridgePathPrefix(
    options.bridgePathPrefix ??
      (options.namespaceId?.trim()
        ? options.namespaceId.trim()
        : BRIDGE_PREFIX_DEFAULT),
  );
  const fetchImpl = options.fetchImpl ?? fetch;

  const requestJson = async <T>(
    routeSuffix: string,
    init?: RequestInit,
  ): Promise<T> => {
    const routePath = joinPath(bridgePathPrefix, routeSuffix);
    const url = resolveHttpUrl(options.baseUrl, routePath);
    const response = await fetchImpl(url, init);

    if (!response.ok) {
      let payload: UniversalErrorResponse | null;
      try {
        payload = (await response.json()) as UniversalErrorResponse;
      } catch {
        payload = null;
      }
      throw new UniversalClientError(response.status, payload);
    }

    return (await response.json()) as T;
  };

  const requestRuntimeControl = async (
    routeSuffix: "/runtime/start" | "/runtime/restart" | "/runtime/stop",
  ): Promise<UniversalRuntimeStatus> => {
    const payload = await requestJson<{
      success: boolean;
      runtime: UniversalRuntimeStatus;
    }>(routeSuffix, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: "{}",
    });

    return payload.runtime;
  };

  return {
    getHealth: () => requestJson<UniversalBridgeHealth>("/health"),
    getState: () => requestJson<UniversalBridgeState>("/state"),
    getRuntimeStatus: () =>
      requestJson<UniversalRuntimeStatus>("/runtime/status"),
    startRuntime: () => requestRuntimeControl("/runtime/start"),
    restartRuntime: () => requestRuntimeControl("/runtime/restart"),
    stopRuntime: () => requestRuntimeControl("/runtime/stop"),
    subscribeEvents: (
      listener: (event: UniversalBridgeEvent) => void,
      subscriptionOptions?: UniversalEventsSubscriptionOptions,
    ) => {
      const eventsPath = joinPath(bridgePathPrefix, "/events");
      const webSocketUrl = resolveWebSocketUrl(options.baseUrl, eventsPath);
      const socket =
        options.webSocketFactory?.(webSocketUrl, [UNIVERSAL_WS_SUBPROTOCOL]) ??
        (new WebSocket(webSocketUrl, [
          UNIVERSAL_WS_SUBPROTOCOL,
        ]) as UniversalWebSocketLike);

      const onMessage = (message: unknown) => {
        try {
          const payload = JSON.parse(
            extractMessagePayload(message),
          ) as UniversalBridgeEvent;
          listener(payload);
        } catch (error) {
          subscriptionOptions?.onError?.(error);
        }
      };

      const onError = (...args: unknown[]) => {
        subscriptionOptions?.onError?.(args.length > 1 ? args : args[0]);
      };

      addSocketListener(socket, "message", onMessage);
      addSocketListener(socket, "error", onError);

      return () => {
        removeSocketListener(socket, "message", onMessage);
        removeSocketListener(socket, "error", onError);
        socket.close();
      };
    },
  };
}
