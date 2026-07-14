import type { IncomingMessage } from "http";
import type { Duplex } from "stream";
import { WebSocket, WebSocketServer } from "ws";

import type { UniversalBridgeState } from "../types.js";
import { UNIVERSAL_WS_SUBPROTOCOL } from "./constants.js";
import { rejectUpgrade } from "./errors.js";
import type { BridgeEventBus } from "./events.js";
import type { RuntimeWebSocketGatewayOptions } from "./options.js";
import {
  getRequestedSubprotocols,
  isEventsUpgradePath,
  isRuntimeWebSocketUpgradePath,
} from "./router.js";
import { isValidWebSocketCloseCode } from "./websocket.js";

const RUNTIME_WEBSOCKET_HANDSHAKE_TIMEOUT_MS = 5_000;
const RUNTIME_WEBSOCKET_PRE_ACCEPT_MESSAGE_LIMIT = 64;

interface BridgeUpgradeContext {
  bridgePathPrefix: string;
  wss: WebSocketServer;
  runtimeWss: WebSocketServer;
  setRuntimeWebSocketProtocol: (
    request: IncomingMessage,
    protocol: string,
  ) => void;
  clearRuntimeWebSocketProtocol: (request: IncomingMessage) => void;
  eventBus: BridgeEventBus;
  shouldAutoStartRuntime: () => boolean;
  ensureRuntimeStarted: () => Promise<unknown>;
  getState: () => UniversalBridgeState;
  runtimeWebSocketGateway: RuntimeWebSocketGatewayOptions | undefined;
  hasRuntimeWebSocketGateway: () => boolean;
  getRuntimeUrl: () => string | null;
}

interface PendingRuntimeWebSocketState {
  messages: Array<{
    data: WebSocket.RawData;
    isBinary: boolean;
  }>;
  close: { code: number; reason: Buffer } | null;
  error: Error | null;
  overflowed: boolean;
}

export function handleBridgeUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  context: BridgeUpgradeContext,
): void {
  const requestUrl = req.url || "/";
  if (isEventsUpgradePath(requestUrl, context.bridgePathPrefix)) {
    handleEventsUpgrade(req, socket, head, context);
    return;
  }

  if (isRuntimeWebSocketUpgradePath(requestUrl, context.bridgePathPrefix)) {
    void handleRuntimeWebSocketUpgrade(req, socket, head, context);
    return;
  }

  // Prevent unhandled socket errors if no other listener claims this socket.
  socket.once("error", () => {});
}

function handleEventsUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  context: BridgeUpgradeContext,
): void {
  const requestedProtocols = getRequestedSubprotocols(req);
  if (
    requestedProtocols.length > 0 &&
    !requestedProtocols.includes(UNIVERSAL_WS_SUBPROTOCOL)
  ) {
    rejectUpgrade(
      socket,
      426,
      `Unsupported WebSocket subprotocol. Include Sec-WebSocket-Protocol: ${UNIVERSAL_WS_SUBPROTOCOL}.`,
    );
    return;
  }

  context.wss.handleUpgrade(req, socket, head, (ws) => {
    context.wss.emit("connection", ws, req);
    ws.send(
      JSON.stringify(
        context.eventBus.createBridgeStateEvent(context.getState()),
      ),
    );
    ensureRuntimeStartedForEvents(context).catch((error) => {
      context.eventBus.emitBridgeError(
        error instanceof Error ? error.message : String(error),
      );
    });
  });
}

async function ensureRuntimeStartedForEvents(
  context: BridgeUpgradeContext,
): Promise<void> {
  if (context.shouldAutoStartRuntime()) {
    await context.ensureRuntimeStarted();
  }
}

async function handleRuntimeWebSocketUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  context: BridgeUpgradeContext,
): Promise<void> {
  const gateway = context.runtimeWebSocketGateway;
  if (!gateway || !context.hasRuntimeWebSocketGateway()) {
    rejectUpgrade(socket, 404, "Runtime WebSocket gateway is not enabled.", {
      includeWsSubprotocol: false,
    });
    return;
  }

  if (context.shouldAutoStartRuntime()) {
    try {
      await context.ensureRuntimeStarted();
    } catch (error) {
      rejectUpgrade(
        socket,
        503,
        error instanceof Error ? error.message : "Unable to start runtime",
        {
          code: "runtime_start_failed",
          retryable: true,
          includeWsSubprotocol: false,
        },
      );
      return;
    }
  }

  const runtimeUrl = context.getRuntimeUrl();
  if (!runtimeUrl) {
    rejectUpgrade(socket, 503, "Runtime is not running", {
      code: "runtime_unavailable",
      retryable: true,
      includeWsSubprotocol: false,
    });
    return;
  }

  const upstreamUrl = createRuntimeWebSocketUrl(
    runtimeUrl,
    gateway.path,
    req.url || "/",
  );
  const requestedProtocols = getRequestedSubprotocols(req);

  const pending: PendingRuntimeWebSocketState = {
    messages: [],
    close: null,
    error: null,
    overflowed: false,
  };
  const bufferUpstreamMessage = (
    data: WebSocket.RawData,
    isBinary: boolean,
  ) => {
    if (pending.messages.length >= RUNTIME_WEBSOCKET_PRE_ACCEPT_MESSAGE_LIMIT) {
      pending.overflowed = true;
      return;
    }
    pending.messages.push({ data, isBinary });
  };

  let upstream: WebSocket;
  try {
    upstream = await connectRuntimeWebSocket(
      upstreamUrl,
      requestedProtocols,
      bufferUpstreamMessage,
      (code, reason) => {
        pending.close = { code, reason };
      },
      (error) => {
        pending.error = error;
      },
    );
  } catch (error) {
    rejectUpgrade(
      socket,
      502,
      error instanceof Error
        ? `Unable to connect to runtime WebSocket: ${error.message}`
        : "Unable to connect to runtime WebSocket",
      {
        code: "bridge_proxy_failed",
        retryable: true,
        includeWsSubprotocol: false,
      },
    );
    return;
  }

  if (pending.overflowed) {
    upstream.close(1011, "Runtime WebSocket pre-accept buffer exceeded");
    rejectUpgrade(
      socket,
      502,
      "Runtime WebSocket produced too many messages before gateway accept",
      {
        code: "bridge_proxy_failed",
        retryable: true,
        includeWsSubprotocol: false,
      },
    );
    return;
  }
  if (pending.error) {
    closeSocket(upstream, 1011, Buffer.from("Runtime WebSocket error"));
    rejectUpgrade(socket, 502, "Runtime WebSocket error", {
      code: "bridge_proxy_failed",
      retryable: true,
      includeWsSubprotocol: false,
    });
    return;
  }
  if (pending.close || upstream.readyState !== WebSocket.OPEN) {
    rejectUpgrade(
      socket,
      502,
      "Runtime WebSocket closed before gateway accept",
      {
        code: "bridge_proxy_failed",
        retryable: true,
        includeWsSubprotocol: false,
      },
    );
    return;
  }

  if (socket.destroyed) {
    upstream.close();
    return;
  }

  context.setRuntimeWebSocketProtocol(req, upstream.protocol);
  context.runtimeWss.handleUpgrade(req, socket, head, (client) => {
    context.clearRuntimeWebSocketProtocol(req);
    upstream.off("message", bufferUpstreamMessage);
    pipeRuntimeWebSocket(client, upstream, pending);
  });
}

function createRuntimeWebSocketUrl(
  runtimeUrl: string,
  runtimePath: string,
  requestUrl: string,
): string {
  const target = new URL(runtimePath, runtimeUrl);
  const request = new URL(requestUrl, "http://universal-bridge.local");
  target.search = request.search;
  target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
  return target.toString();
}

function connectRuntimeWebSocket(
  url: string,
  protocols: string[],
  onMessage: (data: WebSocket.RawData, isBinary: boolean) => void,
  onClose: (code: number, reason: Buffer) => void,
  onError: (error: Error) => void,
): Promise<WebSocket> {
  const upstream =
    protocols.length > 0
      ? new WebSocket(url, protocols, {
          handshakeTimeout: RUNTIME_WEBSOCKET_HANDSHAKE_TIMEOUT_MS,
        })
      : new WebSocket(url, [], {
          handshakeTimeout: RUNTIME_WEBSOCKET_HANDSHAKE_TIMEOUT_MS,
        });
  upstream.on("message", onMessage);
  upstream.on("close", onClose);

  return new Promise<WebSocket>((resolve, reject) => {
    const onOpen = () => {
      upstream.off("error", onConnectError);
      upstream.on("error", onError);
      resolve(upstream);
    };
    const onConnectError = (error: Error) => {
      upstream.off("open", onOpen);
      reject(error);
    };
    upstream.once("open", onOpen);
    upstream.once("error", onConnectError);
  });
}

function pipeRuntimeWebSocket(
  client: WebSocket,
  upstream: WebSocket,
  pending: PendingRuntimeWebSocketState,
): void {
  let closed = false;
  const closeClient = (code?: number, reason?: Buffer) => {
    if (closed) return;
    closed = true;
    if (client.readyState === WebSocket.OPEN) {
      closeSocket(client, code, reason);
    }
  };
  const closeUpstream = (code?: number, reason?: Buffer) => {
    if (upstream.readyState === WebSocket.OPEN) {
      closeSocket(upstream, code, reason);
    }
  };

  upstream.on("message", (data, isBinary) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data, { binary: isBinary });
    }
  });
  for (const { data, isBinary } of pending.messages) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data, { binary: isBinary });
    }
  }
  if (pending.error) {
    closeUpstream(1011, Buffer.from("Runtime WebSocket error"));
    closeClient(1011, Buffer.from("Runtime WebSocket error"));
    return;
  }
  if (pending.close) {
    closeClient(pending.close.code, pending.close.reason);
    return;
  }
  if (pending.overflowed) {
    closeUpstream(
      1011,
      Buffer.from("Runtime WebSocket pre-accept buffer exceeded"),
    );
    closeClient(
      1011,
      Buffer.from("Runtime WebSocket pre-accept buffer exceeded"),
    );
    return;
  }
  client.on("message", (data, isBinary) => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(data, { binary: isBinary });
    }
  });

  upstream.on("error", () =>
    closeClient(1011, Buffer.from("Runtime WebSocket error")),
  );
  upstream.on("close", (code, reason) => closeClient(code, reason));
  client.on("error", () =>
    closeUpstream(1011, Buffer.from("Gateway client error")),
  );
  client.on("close", (code, reason) => closeUpstream(code, reason));
}

function closeSocket(socket: WebSocket, code?: number, reason?: Buffer): void {
  if (typeof code === "number" && isValidWebSocketCloseCode(code)) {
    socket.close(code, reason?.toString());
    return;
  }
  socket.close();
}
