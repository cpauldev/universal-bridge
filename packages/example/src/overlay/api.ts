import type {
  UniversalBridgeState,
  UniversalRuntimeStatus,
} from "universal-bridge";

import { BRIDGE_BASE_PATH } from "./constants.js";
import type {
  FileMetadata,
  FileTreeNode,
  OverlayActionResult,
} from "./types.js";

const UNIVERSAL_WS_SUBPROTOCOL = "universal.v1+json";

export interface ExampleApi {
  getBridgeState: () => Promise<UniversalBridgeState>;
  getRuntimeStatus: () => Promise<UniversalRuntimeStatus>;
  startRuntime: () => Promise<OverlayActionResult>;
  restartRuntime: () => Promise<OverlayActionResult>;
  stopRuntime: () => Promise<OverlayActionResult>;
  openFile: (path: string, line?: number) => Promise<OverlayActionResult>;
  getFileTree: () => Promise<FileTreeNode[]>;
  getFileMetadata: (path: string) => Promise<FileMetadata>;
}

export interface WebSocketBinding {
  close: () => void;
}

export interface WebSocketHandlers {
  onMessage: (message: unknown) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: () => void;
}

function normalizeBaseUrl(baseUrl?: string): string {
  if (baseUrl?.trim()) {
    const value = baseUrl.trim();
    return value.endsWith("/") ? value.slice(0, -1) : value;
  }

  if (typeof window !== "undefined" && window.location?.origin) {
    const origin = window.location.origin;
    if (origin && origin !== "null" && !origin.startsWith("about:")) {
      return origin;
    }
  }

  return "http://127.0.0.1";
}

function appendUniqueCandidate(candidates: string[], value?: string): void {
  if (!value) return;
  const normalized = normalizeBaseUrl(value);
  if (!candidates.includes(normalized)) {
    candidates.push(normalized);
  }
}

export function getDevServerBaseUrlCandidates(baseUrl?: string): string[] {
  const candidates: string[] = [];
  appendUniqueCandidate(candidates, baseUrl);

  if (typeof window !== "undefined") {
    const origin = window.location?.origin;
    if (origin && origin !== "null" && !origin.startsWith("about:")) {
      appendUniqueCandidate(candidates, origin);
    }
  }

  if (candidates.length === 0) {
    appendUniqueCandidate(candidates, normalizeBaseUrl(baseUrl));
  }

  return candidates;
}

export function resolveDevServerBaseUrl(baseUrl?: string): string {
  return getDevServerBaseUrlCandidates(baseUrl)[0] || normalizeBaseUrl(baseUrl);
}

function toWebSocketUrl(baseUrl: string, path: string): string {
  const normalized = normalizeBaseUrl(baseUrl);
  const withPath = `${normalized}${path}`;
  if (withPath.startsWith("https://")) {
    return `wss://${withPath.slice("https://".length)}`;
  }
  if (withPath.startsWith("http://")) {
    return `ws://${withPath.slice("http://".length)}`;
  }
  return `ws://${withPath}`;
}

async function parseResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") || "";

  if (!response.ok) {
    let errorMessage = `Request failed (${response.status})`;
    if (contentType.includes("application/json")) {
      try {
        const payload = (await response.json()) as Record<string, unknown>;
        const message =
          (payload.message as string | undefined) ||
          (payload.error as string | undefined);
        if (message) errorMessage = message;
      } catch {
        // Ignore parse failures.
      }
    }
    throw new Error(errorMessage);
  }

  if (contentType.includes("application/json")) {
    return (await response.json()) as T;
  }

  throw new Error("Expected JSON response from bridge");
}

async function request<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  return parseResponse<T>(response);
}

function asActionResult(payload: Record<string, unknown>): OverlayActionResult {
  return {
    success: (payload.success as boolean | undefined) ?? true,
    message:
      (payload.message as string | undefined) ||
      (payload.error as string | undefined),
  };
}

function toBridgeRoute(path: string): string {
  return `${BRIDGE_BASE_PATH}${path}`;
}

function toRuntimeApiRoute(path: string): string {
  return `${BRIDGE_BASE_PATH}/api${path}`;
}

export function createExampleApi(baseUrl?: string): ExampleApi {
  const normalizedBaseUrl = resolveDevServerBaseUrl(baseUrl);

  return {
    async getBridgeState() {
      return request<UniversalBridgeState>(
        normalizedBaseUrl,
        toBridgeRoute("/state"),
      );
    },
    async getRuntimeStatus() {
      return request<UniversalRuntimeStatus>(
        normalizedBaseUrl,
        toBridgeRoute("/runtime/status"),
      );
    },
    async startRuntime() {
      const data = await request<Record<string, unknown>>(
        normalizedBaseUrl,
        toBridgeRoute("/runtime/start"),
        { method: "POST", body: JSON.stringify({}) },
      );
      return asActionResult(data);
    },
    async restartRuntime() {
      const data = await request<Record<string, unknown>>(
        normalizedBaseUrl,
        toBridgeRoute("/runtime/restart"),
        { method: "POST", body: JSON.stringify({}) },
      );
      return asActionResult(data);
    },
    async stopRuntime() {
      const data = await request<Record<string, unknown>>(
        normalizedBaseUrl,
        toBridgeRoute("/runtime/stop"),
        { method: "POST", body: JSON.stringify({}) },
      );
      return asActionResult(data);
    },
    async openFile(path: string, line?: number) {
      const params = new URLSearchParams();
      params.set("path", path);
      if (typeof line === "number" && Number.isFinite(line)) {
        params.set("line", String(line));
      }
      const data = await request<Record<string, unknown>>(
        normalizedBaseUrl,
        toRuntimeApiRoute(`/open-file?${params.toString()}`),
      );
      return asActionResult(data);
    },
    async getFileTree() {
      return request<FileTreeNode[]>(
        normalizedBaseUrl,
        toRuntimeApiRoute("/files"),
      );
    },
    async getFileMetadata(path: string) {
      const encoded = encodeURIComponent(path);
      return request<FileMetadata>(
        normalizedBaseUrl,
        toRuntimeApiRoute(`/files/${encoded}`),
      );
    },
  };
}

export function createWebSocketBinding(
  baseUrl: string,
  handlers: WebSocketHandlers,
): WebSocketBinding {
  const wsUrl = toWebSocketUrl(
    resolveDevServerBaseUrl(baseUrl),
    `${BRIDGE_BASE_PATH}/events`,
  );
  const ws = new WebSocket(wsUrl, [UNIVERSAL_WS_SUBPROTOCOL]);

  ws.addEventListener("open", () => handlers.onOpen?.());
  ws.addEventListener("close", () => handlers.onClose?.());
  ws.addEventListener("error", () => handlers.onError?.());

  ws.addEventListener("message", (event) => {
    try {
      const payload = JSON.parse(event.data as string);
      handlers.onMessage(payload);
    } catch {
      // Ignore malformed payloads.
    }
  });

  return {
    close() {
      if (
        ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING
      ) {
        ws.close();
      }
    },
  };
}
