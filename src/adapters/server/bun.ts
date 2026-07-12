import { UNIVERSAL_WS_SUBPROTOCOL } from "../../bridge/constants.js";
import type { UniversalBridgeOptions } from "../../bridge/options.js";
import {
  type StandaloneBridgeServer,
  startStandaloneUniversalBridgeServer,
} from "../../bridge/standalone.js";
import {
  type UniversalAdapterOptions,
  resolveAdapterOptions,
} from "../shared/adapter-utils.js";

export type BunUniversalOptions = UniversalAdapterOptions;

export interface BunServeLikeServer {
  upgrade: (
    request: Request,
    options?: {
      data?: unknown;
    },
  ) => boolean;
}

export interface BunServeLikeWebSocket<Data = unknown> {
  data: Data;
  send: (data: unknown) => void;
  close: (code?: number, reason?: string) => void;
}

export interface BunServeWebSocketHandlers<Data = unknown> {
  open?: (socket: BunServeLikeWebSocket<Data>) => void;
  message?: (socket: BunServeLikeWebSocket<Data>, message: unknown) => void;
  close?: (
    socket: BunServeLikeWebSocket<Data>,
    code: number,
    reason: string,
  ) => void;
  error?: (socket: BunServeLikeWebSocket<Data>, error: Error) => void;
}

export type BunServeFetchHandler = (
  request: Request,
  server: BunServeLikeServer,
) => Response | Promise<Response | undefined> | undefined;

export type BunServeNextFetchHandler = (
  request: Request,
  server: BunServeLikeServer,
) => Response | Promise<Response>;

interface UniversalBunSocketState {
  upstreamUrl: string;
  upstream: WebSocket | null;
}

interface UniversalBunSocketData {
  __universal?: UniversalBunSocketState;
}

type WebSocketPayload = string | ArrayBuffer | Blob | Uint8Array;

export interface BunBridgeHandle {
  bridge: StandaloneBridgeServer["bridge"];
  baseUrl: string;
  createFetchHandler: (next: BunServeNextFetchHandler) => BunServeFetchHandler;
  createWebSocketHandlers: <
    Data extends UniversalBunSocketData = UniversalBunSocketData,
  >(
    existing?: BunServeWebSocketHandlers<Data>,
  ) => BunServeWebSocketHandlers<Data>;
  close: () => Promise<void>;
}

function toBridgeOptions(options: BunUniversalOptions): UniversalBridgeOptions {
  const {
    adapterName: _adapterName,
    rewriteSource: _rewriteSource,
    nextBridgeGlobalKey: _nextBridgeGlobalKey,
    ...bridgeOptions
  } = options;
  return bridgeOptions;
}

function isBridgePath(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isBridgeEventsPath(pathname: string, prefix: string): boolean {
  return pathname === `${prefix}/events`;
}

function isWebSocketUpgradeRequest(request: Request): boolean {
  const upgrade = request.headers.get("upgrade");
  return typeof upgrade === "string" && upgrade.toLowerCase() === "websocket";
}

function hasRequestBody(method: string): boolean {
  const normalized = method.toUpperCase();
  return normalized !== "GET" && normalized !== "HEAD";
}

function toWebSocketUrl(baseUrl: string, pathWithSearch: string): string {
  const runtimeUrl = new URL(baseUrl);
  runtimeUrl.protocol = runtimeUrl.protocol === "https:" ? "wss:" : "ws:";
  return new URL(pathWithSearch, runtimeUrl).toString();
}

function normalizeWebSocketMessage(message: unknown): WebSocketPayload {
  if (typeof message === "string") return message;
  if (message instanceof ArrayBuffer) return message;
  if (message instanceof Blob) return message;
  if (ArrayBuffer.isView(message)) {
    return new Uint8Array(
      message.buffer,
      message.byteOffset,
      message.byteLength,
    );
  }
  if (message == null) return "";
  return String(message);
}

function closeUpstreamSocket(upstream: WebSocket | null): void {
  if (!upstream) return;
  if (
    upstream.readyState === WebSocket.CLOSING ||
    upstream.readyState === WebSocket.CLOSED
  ) {
    return;
  }
  upstream.close();
}

export async function attachUniversalToBunServe(
  options: BunUniversalOptions = {},
): Promise<BunBridgeHandle> {
  const resolvedOptions = resolveAdapterOptions(options);
  const bridgeServer = await startStandaloneUniversalBridgeServer(
    toBridgeOptions(resolvedOptions),
  );
  const upstreamSockets = new Set<WebSocket>();
  const bridgePathPrefix = resolvedOptions.bridgePathPrefix ?? "/__universal";

  const createFetchHandler = (
    next: BunServeNextFetchHandler,
  ): BunServeFetchHandler => {
    return async (
      request: Request,
      server: BunServeLikeServer,
    ): Promise<Response | undefined> => {
      const url = new URL(request.url);
      if (!isBridgePath(url.pathname, bridgePathPrefix)) {
        return next(request, server);
      }

      if (
        isBridgeEventsPath(url.pathname, bridgePathPrefix) &&
        isWebSocketUpgradeRequest(request)
      ) {
        const pathWithSearch = `${url.pathname}${url.search}`;
        const upgraded = server.upgrade(request, {
          data: {
            __universal: {
              upstreamUrl: toWebSocketUrl(bridgeServer.baseUrl, pathWithSearch),
              upstream: null,
            },
          } satisfies UniversalBunSocketData,
        });
        if (upgraded) {
          return undefined;
        }

        return new Response("Failed to upgrade universal-bridge websocket", {
          status: 400,
        });
      }

      const targetUrl = new URL(
        `${url.pathname}${url.search}`,
        bridgeServer.baseUrl,
      );
      const response = await fetch(targetUrl, {
        method: request.method,
        headers: request.headers,
        body: hasRequestBody(request.method) ? request.body : undefined,
      });
      return response;
    };
  };

  const createWebSocketHandlers = <
    Data extends UniversalBunSocketData = UniversalBunSocketData,
  >(
    existing: BunServeWebSocketHandlers<Data> = {},
  ): BunServeWebSocketHandlers<Data> => {
    return {
      open: (socket) => {
        const universalSocketState = socket.data.__universal;
        if (!universalSocketState) {
          existing.open?.(socket);
          return;
        }

        const upstream = new WebSocket(
          universalSocketState.upstreamUrl,
          UNIVERSAL_WS_SUBPROTOCOL,
        );
        universalSocketState.upstream = upstream;
        upstreamSockets.add(upstream);

        upstream.addEventListener("message", (event) => {
          socket.send(normalizeWebSocketMessage(event.data));
        });
        upstream.addEventListener("error", () => {
          socket.close(1011, "Universal upstream websocket error");
        });
        upstream.addEventListener("close", (event) => {
          upstreamSockets.delete(upstream);
          socket.close(event.code, event.reason);
        });
      },
      message: (socket, message) => {
        const universalSocketState = socket.data.__universal;
        if (!universalSocketState) {
          existing.message?.(socket, message);
          return;
        }

        const upstream = universalSocketState.upstream;
        if (!upstream || upstream.readyState !== WebSocket.OPEN) {
          return;
        }
        upstream.send(normalizeWebSocketMessage(message));
      },
      close: (socket, code, reason) => {
        const universalSocketState = socket.data.__universal;
        if (!universalSocketState) {
          existing.close?.(socket, code, reason);
          return;
        }

        closeUpstreamSocket(universalSocketState.upstream);
        universalSocketState.upstream = null;
      },
      error: (socket, error) => {
        const universalSocketState = socket.data.__universal;
        if (!universalSocketState) {
          existing.error?.(socket, error);
          return;
        }

        closeUpstreamSocket(universalSocketState.upstream);
        universalSocketState.upstream = null;
      },
    };
  };

  return {
    bridge: bridgeServer.bridge,
    baseUrl: bridgeServer.baseUrl,
    createFetchHandler,
    createWebSocketHandlers,
    close: async () => {
      for (const upstream of upstreamSockets) {
        closeUpstreamSocket(upstream);
      }
      upstreamSockets.clear();
      await bridgeServer.close();
    },
  };
}

export function withUniversalBunServeFetch(
  next: BunServeNextFetchHandler,
  handle: BunBridgeHandle,
): BunServeFetchHandler {
  return handle.createFetchHandler(next);
}

export function withUniversalBunServeWebSocketHandlers<
  Data extends UniversalBunSocketData = UniversalBunSocketData,
>(
  handle: BunBridgeHandle,
  existing?: BunServeWebSocketHandlers<Data>,
): BunServeWebSocketHandlers<Data> {
  return handle.createWebSocketHandlers(existing);
}
