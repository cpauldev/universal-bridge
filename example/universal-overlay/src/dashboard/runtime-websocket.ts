export type RuntimeWebSocketConnection =
  "connecting" | "live" | "closed" | "error";

export interface RuntimeWebSocketDemoState {
  connection: RuntimeWebSocketConnection;
  connectionLabel: string;
  message: string;
  pending: boolean;
}

export interface RuntimeWebSocketDemoController {
  sendDelay: (seconds: 1 | 2 | 3) => void;
  close: () => void;
}

function formatConnectionLabel(connection: RuntimeWebSocketConnection): string {
  if (connection === "live") return "Live";
  if (connection === "connecting") return "Connecting";
  if (connection === "error") return "Error";
  return "Closed";
}

export function createRuntimeWebSocketDemoController(input: {
  url: string;
  onState: (state: RuntimeWebSocketDemoState) => void;
}): RuntimeWebSocketDemoController {
  let request: { id: string; sentAt: number } | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let disposed = false;
  const socket = new WebSocket(input.url);
  const publish = (connection: RuntimeWebSocketConnection, message: string) => {
    if (disposed) return;
    input.onState({
      connection,
      connectionLabel: formatConnectionLabel(connection),
      message,
      pending: request !== null,
    });
  };
  const stopTimer = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  publish("connecting", "No message sent");
  socket.addEventListener("open", () => publish("live", "No message sent"));
  socket.addEventListener("close", () => publish("closed", "Socket closed"));
  socket.addEventListener("error", () => publish("error", "Socket error"));
  socket.addEventListener("message", (event) => {
    try {
      const payload = JSON.parse(String(event.data)) as {
        type?: string;
        requestId?: string;
        message?: string;
      };
      const activeRequest = request;
      if (!activeRequest || payload.requestId !== activeRequest.id) {
        return;
      }
      if (payload.type === "delay-error") {
        request = null;
        stopTimer();
        publish("live", payload.message ?? "Delay request failed");
        return;
      }
      if (payload.type !== "delay-complete") return;
      const elapsed = Date.now() - activeRequest.sentAt;
      request = null;
      stopTimer();
      publish("live", `Received · ${elapsed} ms total`);
    } catch {
      // Application frames outside the demo protocol are intentionally ignored.
    }
  });

  return {
    sendDelay(seconds) {
      if (socket.readyState !== WebSocket.OPEN || request) return;
      request = { id: crypto.randomUUID(), sentAt: Date.now() };
      publish("live", "Sent · 0 ms elapsed");
      timer = setInterval(() => {
        if (request)
          publish("live", `Sent · ${Date.now() - request.sentAt} ms elapsed`);
      }, 50);
      socket.send(
        JSON.stringify({ type: "delay", seconds, requestId: request.id }),
      );
    },
    close() {
      disposed = true;
      request = null;
      stopTimer();
      socket.close();
    },
  };
}
