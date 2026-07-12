import type { IncomingMessage } from "http";
import type { Duplex } from "stream";
import { WebSocket, WebSocketServer } from "ws";

import type { UniversalRuntimeStatus } from "../types.js";
import { UNIVERSAL_WS_SUBPROTOCOL } from "./constants.js";
import { rejectUpgrade } from "./errors.js";
import type { BridgeEventBus } from "./events.js";
import { getRequestedSubprotocols, isEventsUpgradePath } from "./router.js";
import { toRuntimeWebSocketUrl } from "./state.js";

interface BridgeUpgradeContext {
  bridgePathPrefix: string;
  wss: WebSocketServer;
  eventBus: BridgeEventBus;
  shouldAutoStartRuntime: () => boolean;
  shouldProxyRuntimeWebSocket: () => boolean;
  ensureRuntimeStarted: () => Promise<unknown>;
  getRuntimeUrl: () => string | null;
  getRuntimeStatus: () => UniversalRuntimeStatus;
}

export function handleBridgeUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  context: BridgeUpgradeContext,
): void {
  if (!isEventsUpgradePath(req.url || "/", context.bridgePathPrefix)) {
    // Prevent unhandled socket errors if no other listener claims this socket
    socket.once("error", () => {});
    return;
  }

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
        context.eventBus.createRuntimeStatusEvent(context.getRuntimeStatus()),
      ),
    );
    pipeRuntimeEvents(ws, context).catch((error) => {
      context.eventBus.emitRuntimeError(
        error instanceof Error ? error.message : String(error),
      );
    });
  });
}

async function pipeRuntimeEvents(
  client: WebSocket,
  context: BridgeUpgradeContext,
): Promise<void> {
  if (context.shouldAutoStartRuntime()) {
    try {
      await context.ensureRuntimeStarted();
    } catch (error) {
      context.eventBus.emitRuntimeError(
        error instanceof Error ? error.message : String(error),
      );
      return;
    }
  }

  if (!context.shouldProxyRuntimeWebSocket()) {
    return;
  }

  const runtimeUrl = context.getRuntimeUrl();
  if (!runtimeUrl || client.readyState !== WebSocket.OPEN) {
    return;
  }

  const upstream = new WebSocket(toRuntimeWebSocketUrl(runtimeUrl));
  upstream.on("message", (data, isBinary) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data, { binary: isBinary });
    }
  });
  upstream.on("error", (error) => {
    context.eventBus.emitRuntimeError(error.message);
  });
  // Keep the bridge events socket open even if the runtime websocket closes.
  // The /events channel is used for bridge runtime status updates and should
  // remain available independently of runtime websocket proxy health.
  upstream.on("close", () => {
    context.eventBus.emitRuntimeError("Runtime websocket closed");
  });

  client.on("message", (data, isBinary) => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(data, { binary: isBinary });
    }
  });
  client.on("close", () => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.close();
    }
  });
}
