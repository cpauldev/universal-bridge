import {
  RUNTIME_FILES_PATH,
  RUNTIME_OPEN_FILE_PATH,
  runtimeFileMetadataPath,
} from "../runtime/routes.js";
import { bridgeRoute } from "./bridge-routes.js";
import type {
  FileMetadata,
  FileTreeNode,
  OverlayActionResult,
} from "./types.js";

export interface OverlayApi {
  openFile: (path: string, line?: number) => Promise<OverlayActionResult>;
  getFileTree: () => Promise<FileTreeNode[]>;
  getFileMetadata: (path: string) => Promise<FileMetadata>;
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

export function resolveDevServerBaseUrl(baseUrl?: string): string {
  return normalizeBaseUrl(baseUrl);
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

export function createOverlayApi(baseUrl?: string): OverlayApi {
  const normalizedBaseUrl = resolveDevServerBaseUrl(baseUrl);

  return {
    async openFile(path: string, line?: number) {
      const params = new URLSearchParams();
      params.set("path", path);
      if (typeof line === "number" && Number.isFinite(line)) {
        params.set("line", String(line));
      }
      const data = await request<Record<string, unknown>>(
        normalizedBaseUrl,
        bridgeRoute(`${RUNTIME_OPEN_FILE_PATH}?${params.toString()}`),
      );
      return asActionResult(data);
    },
    async getFileTree() {
      return request<FileTreeNode[]>(
        normalizedBaseUrl,
        bridgeRoute(RUNTIME_FILES_PATH),
      );
    },
    async getFileMetadata(path: string) {
      return request<FileMetadata>(
        normalizedBaseUrl,
        bridgeRoute(runtimeFileMetadataPath(path)),
      );
    },
  };
}
