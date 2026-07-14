import { UNIVERSAL_WS_SUBPROTOCOL } from "../../bridge/constants.js";
import type { UniversalBridgeOptions } from "../../bridge/options.js";
import { isBridgeWebSocketUpgradePath } from "../../bridge/router.js";
import {
  type StandaloneBridgeServer,
  startStandaloneUniversalBridgeServer,
} from "../../bridge/standalone.js";
import { isValidWebSocketCloseCode } from "../../bridge/websocket.js";
import {
  type UniversalAdapterOptions,
  resolveAdapterOptions,
} from "../shared/adapter-utils.js";

export type BunUniversalOptions = UniversalAdapterOptions;
type WebSocketPayload = string | ArrayBuffer | Uint8Array<ArrayBuffer>;
const BRIDGE_WEBSOCKET_HANDSHAKE_TIMEOUT_MS = 5_000;
const BRIDGE_WEBSOCKET_PRE_OPEN_MESSAGE_LIMIT = 64;

export interface BunServeLikeServer {
  upgrade: (
    request: Request,
    options: {
      headers?: HeadersInit;
      data: UniversalBunSocketData;
    },
  ) => boolean;
}

export interface BunServeLikeWebSocket<Data = unknown> {
  data: Data;
  send: (data: WebSocketPayload) => unknown;
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
  upstream: WebSocket;
  downstream: BunServeLikeWebSocket | null;
  pendingMessages: WebSocketPayload[];
  upstreamClose: { code: number; reason: string } | null;
  upstreamErrored: boolean;
  upstreamOverflowed: boolean;
}

export interface UniversalBunSocketData {
  __universal?: UniversalBunSocketState;
}

export interface BunBridgeHandle {
  bridge: StandaloneBridgeServer["bridge"];
  baseUrl: string;
  createFetchHandler: (next: BunServeNextFetchHandler) => BunServeFetchHandler;
  createWebSocketHandlers: <
    Data extends UniversalBunSocketData = UniversalBunSocketData,
  >(
    existing?: BunServeWebSocketHandlers<Data>,
  ) => Required<BunServeWebSocketHandlers<Data>>;
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

function isWebSocketUpgradeRequest(request: Request): boolean {
  const upgrade = request.headers.get("upgrade");
  return typeof upgrade === "string" && upgrade.toLowerCase() === "websocket";
}

function getRequestedProtocols(request: Request): string[] {
  return (request.headers.get("sec-websocket-protocol") ?? "")
    .split(",")
    .map((protocol) => protocol.trim())
    .filter(Boolean);
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
  if (ArrayBuffer.isView(message)) {
    const copy = new Uint8Array(message.byteLength);
    copy.set(
      new Uint8Array(message.buffer, message.byteOffset, message.byteLength),
    );
    return copy;
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

function closeDownstreamSocket(
  socket: BunServeLikeWebSocket,
  code: number,
  reason: string,
): void {
  if (isValidWebSocketCloseCode(code)) {
    socket.close(code, reason);
    return;
  }
  socket.close();
}

function connectUpstreamWebSocket(
  upstreamUrl: string,
  protocols: string[],
): Promise<WebSocket> {
  const upstream =
    protocols.length > 0
      ? new WebSocket(upstreamUrl, protocols)
      : new WebSocket(upstreamUrl);

  return new Promise<WebSocket>((resolve, reject) => {
    const timeout = setTimeout(() => {
      upstream.removeEventListener("open", onOpen);
      upstream.removeEventListener("error", onError);
      closeUpstreamSocket(upstream);
      reject(new Error("Timed out connecting universal-bridge websocket"));
    }, BRIDGE_WEBSOCKET_HANDSHAKE_TIMEOUT_MS);
    const onOpen = () => {
      clearTimeout(timeout);
      upstream.removeEventListener("error", onError);
      resolve(upstream);
    };
    const onError = () => {
      clearTimeout(timeout);
      upstream.removeEventListener("open", onOpen);
      reject(new Error("Failed to connect universal-bridge websocket"));
    };
    upstream.addEventListener("open", onOpen, { once: true });
    upstream.addEventListener("error", onError, { once: true });
  });
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
        isBridgeWebSocketUpgradePath(url.pathname, bridgePathPrefix) &&
        isWebSocketUpgradeRequest(request)
      ) {
        const pathWithSearch = `${url.pathname}${url.search}`;
        const requestedProtocols = getRequestedProtocols(request);
        const isEventsPath = url.pathname === `${bridgePathPrefix}/events`;
        if (
          isEventsPath &&
          requestedProtocols.length > 0 &&
          !requestedProtocols.includes(UNIVERSAL_WS_SUBPROTOCOL)
        ) {
          return new Response(
            `Unsupported WebSocket subprotocol. Include Sec-WebSocket-Protocol: ${UNIVERSAL_WS_SUBPROTOCOL}.`,
            { status: 426 },
          );
        }
        const upstreamProtocols = isEventsPath
          ? [UNIVERSAL_WS_SUBPROTOCOL]
          : requestedProtocols;
        const upstreamUrl = toWebSocketUrl(
          bridgeServer.baseUrl,
          pathWithSearch,
        );
        let upstream: WebSocket;
        try {
          upstream = await connectUpstreamWebSocket(
            upstreamUrl,
            upstreamProtocols,
          );
        } catch {
          return new Response("Failed to connect universal-bridge websocket", {
            status: 502,
          });
        }

        const universalSocketState: UniversalBunSocketState = {
          upstream,
          downstream: null,
          pendingMessages: [],
          upstreamClose: null,
          upstreamErrored: false,
          upstreamOverflowed: false,
        };
        upstreamSockets.add(upstream);
        upstream.addEventListener("message", (event) => {
          const message = normalizeWebSocketMessage(event.data);
          if (universalSocketState.downstream) {
            universalSocketState.downstream.send(message);
            return;
          }
          if (
            universalSocketState.pendingMessages.length >=
            BRIDGE_WEBSOCKET_PRE_OPEN_MESSAGE_LIMIT
          ) {
            universalSocketState.upstreamOverflowed = true;
            closeUpstreamSocket(upstream);
            return;
          }
          universalSocketState.pendingMessages.push(message);
        });
        upstream.addEventListener("error", () => {
          universalSocketState.upstreamErrored = true;
          if (universalSocketState.downstream) {
            universalSocketState.downstream.close(
              1011,
              "Universal upstream websocket error",
            );
          }
        });
        upstream.addEventListener("close", (event) => {
          upstreamSockets.delete(upstream);
          universalSocketState.upstreamClose = {
            code: event.code,
            reason: event.reason,
          };
          if (universalSocketState.downstream) {
            closeDownstreamSocket(
              universalSocketState.downstream,
              event.code,
              event.reason,
            );
          }
        });
        const selectedProtocol = requestedProtocols.includes(upstream.protocol)
          ? upstream.protocol
          : "";
        const upgraded = server.upgrade(request, {
          ...(selectedProtocol
            ? { headers: { "Sec-WebSocket-Protocol": upstream.protocol } }
            : {}),
          data: {
            __universal: universalSocketState,
          } satisfies UniversalBunSocketData,
        });
        if (upgraded) {
          return undefined;
        }

        upstreamSockets.delete(upstream);
        closeUpstreamSocket(upstream);
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
  ): Required<BunServeWebSocketHandlers<Data>> => {
    return {
      open: (socket) => {
        const universalSocketState = socket.data.__universal;
        if (!universalSocketState) {
          existing.open?.(socket);
          return;
        }

        universalSocketState.downstream = socket;
        for (const message of universalSocketState.pendingMessages) {
          socket.send(message);
        }
        universalSocketState.pendingMessages.length = 0;
        if (universalSocketState.upstreamErrored) {
          closeUpstreamSocket(universalSocketState.upstream);
          socket.close(1011, "Universal upstream websocket error");
          return;
        }
        if (universalSocketState.upstreamOverflowed) {
          closeUpstreamSocket(universalSocketState.upstream);
          socket.close(1011, "Universal upstream websocket buffer exceeded");
          return;
        }
        if (universalSocketState.upstreamClose) {
          closeDownstreamSocket(
            socket,
            universalSocketState.upstreamClose.code,
            universalSocketState.upstreamClose.reason,
          );
        }
      },
      message: (socket, message) => {
        const universalSocketState = socket.data.__universal;
        if (!universalSocketState) {
          existing.message?.(socket, message);
          return;
        }

        const upstream = universalSocketState.upstream;
        if (upstream.readyState !== WebSocket.OPEN) {
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
        universalSocketState.downstream = null;
      },
      error: (socket, error) => {
        const universalSocketState = socket.data.__universal;
        if (!universalSocketState) {
          existing.error?.(socket, error);
          return;
        }

        closeUpstreamSocket(universalSocketState.upstream);
        universalSocketState.downstream = null;
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
): Required<BunServeWebSocketHandlers<Data>> {
  return handle.createWebSocketHandlers(existing);
}
