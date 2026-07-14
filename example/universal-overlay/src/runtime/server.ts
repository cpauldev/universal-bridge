#!/usr/bin/env bun
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { extname, join, normalize, relative, resolve, sep } from "path";

import {
  OVERLAY_PACKAGE_NAME,
  OVERLAY_RUNTIME_PORT_ENV_VAR,
  OVERLAY_RUNTIME_WS_PATH,
} from "../overlay-config.js";
import {
  RUNTIME_FILES_PATH,
  RUNTIME_HEALTH_PATH,
  RUNTIME_OPEN_FILE_PATH,
} from "./routes.js";

const PORT = Number(
  process.env[
    process.env[OVERLAY_RUNTIME_PORT_ENV_VAR] ?? OVERLAY_RUNTIME_PORT_ENV_VAR
  ] ??
    process.env[OVERLAY_RUNTIME_PORT_ENV_VAR] ??
    0,
);

const EXCLUDE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".astro",
  ".output",
  ".vercel",
  ".netlify",
  "coverage",
]);
const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".vue",
  ".svelte",
  ".astro",
  ".json",
  ".jsonc",
  ".yaml",
  ".yml",
  ".toml",
  ".md",
  ".mdx",
  ".html",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".txt",
  ".sh",
  ".bash",
  ".env",
  ".gitignore",
]);
const PROJECT_ROOT = resolve(process.cwd());

export interface FileTreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileTreeNode[];
}

export interface FileMetadata {
  name: string;
  path: string;
  absolutePath: string;
  size: number;
  extension: string;
  isDirectory: boolean;
  modified: number;
  created: number;
  lines?: number;
}

function buildFileTree(dirPath: string, rootPath: string): FileTreeNode[] {
  const entries = readdirSync(dirPath, { withFileTypes: true });
  const nodes: FileTreeNode[] = [];

  for (const entry of entries) {
    if (EXCLUDE_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith(".") && entry.name !== ".env.example") continue;

    const fullPath = join(dirPath, entry.name);
    const relativePath = relative(rootPath, fullPath).replace(/\\/g, "/");

    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: relativePath,
        type: "directory" as const,
        children: buildFileTree(fullPath, rootPath),
      });
    } else {
      nodes.push({
        name: entry.name,
        path: relativePath,
        type: "file" as const,
      });
    }
  }

  return nodes.sort((a, b) => {
    const aIsDir = a.type === "directory";
    const bIsDir = b.type === "directory";
    if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function resolveSafePath(relPath: string): string | null {
  const normalized = normalize(relPath).replace(/^([/\\])+/, "");
  const absolute = resolve(PROJECT_ROOT, normalized);
  if (!absolute.startsWith(PROJECT_ROOT + sep) && absolute !== PROJECT_ROOT) {
    return null;
  }
  return absolute;
}

function parseLine(line: string | null): number | null {
  if (!line) return 0;
  const parsed = Number.parseInt(line, 10);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1_000_000) {
    return null;
  }
  return parsed;
}

function spawnBestEffort(cmd: string[]): boolean {
  try {
    Bun.spawn({
      cmd,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function openFileInEditor(safePath: string, lineNumber = 0): void {
  const lineArg = lineNumber > 0 ? `${safePath}:${lineNumber}` : safePath;

  if (spawnBestEffort(["code", "--goto", lineArg])) {
    return;
  }

  if (process.platform === "win32") {
    spawnBestEffort(["cmd", "/c", "start", "", safePath]);
    return;
  }

  if (process.platform === "darwin") {
    spawnBestEffort(["open", safePath]);
    return;
  }

  spawnBestEffort(["xdg-open", safePath]);
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(),
    },
  });
}

function countTextFileLines(
  absolutePath: string,
  extension: string,
): number | undefined {
  if (extension && !TEXT_EXTENSIONS.has(extension)) return undefined;

  try {
    const content = readFileSync(absolutePath, "utf-8");
    return content.split("\n").length;
  } catch {
    return undefined;
  }
}

function createFileMetadata(
  filePath: string,
  absolutePath: string,
): FileMetadata {
  const stat = statSync(absolutePath);
  const isDirectory = stat.isDirectory();
  const extension = extname(filePath).toLowerCase();

  return {
    name: filePath.split("/").pop() ?? filePath,
    path: filePath,
    absolutePath,
    size: stat.size,
    extension,
    isDirectory,
    modified: stat.mtimeMs,
    created: stat.birthtimeMs,
    lines: isDirectory
      ? undefined
      : countTextFileLines(absolutePath, extension),
  };
}

function resolveExistingSafePath(filePath: string): string | Response {
  const safePath = resolveSafePath(filePath);
  if (!safePath) return json({ error: "Access denied" }, 403);
  if (!existsSync(safePath)) return json({ error: "Not found" }, 404);
  return safePath;
}

function handleFileMetadata(pathname: string): Response {
  const filePath = decodeURIComponent(
    pathname.slice(`${RUNTIME_FILES_PATH}/`.length),
  );
  const safePath = resolveExistingSafePath(filePath);
  if (safePath instanceof Response) return safePath;
  return json(createFileMetadata(filePath, safePath));
}

function handleOpenFile(url: URL): Response {
  const filePath = url.searchParams.get("path");
  if (!filePath) return json({ error: "Missing path parameter" }, 400);

  const safePath = resolveExistingSafePath(filePath);
  if (safePath instanceof Response) return safePath;

  const lineNumber = parseLine(url.searchParams.get("line"));
  if (lineNumber === null) {
    return json({ error: "Invalid line number" }, 400);
  }

  openFileInEditor(safePath, lineNumber);
  return json({ success: true });
}

const server = Bun.serve({
  port: PORT || 0,
  websocket: {
    open(socket) {
      socket.send(
        JSON.stringify({ type: "ready", service: OVERLAY_PACKAGE_NAME }),
      );
    },
    message(socket, message) {
      try {
        const payload = JSON.parse(String(message)) as {
          type?: unknown;
          seconds?: unknown;
          requestId?: unknown;
        };
        if (payload.type !== "delay") {
          socket.send(message);
          return;
        }

        const seconds = Number(payload.seconds);
        if (!Number.isFinite(seconds) || seconds < 0 || seconds > 10) {
          socket.send(
            JSON.stringify({
              type: "delay-error",
              requestId: payload.requestId,
              message: "Delay must be between 0 and 10 seconds.",
            }),
          );
          return;
        }

        setTimeout(() => {
          socket.send(
            JSON.stringify({
              type: "delay-complete",
              requestId: payload.requestId,
              seconds,
            }),
          );
        }, seconds * 1_000);
      } catch {
        socket.send(message);
      }
    },
  },
  async fetch(req) {
    const url = new URL(req.url);
    const { pathname } = url;

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (pathname === RUNTIME_HEALTH_PATH) {
      return json({ version: "1.0.0", status: "running" });
    }

    if (pathname === OVERLAY_RUNTIME_WS_PATH) {
      if (server.upgrade(req)) return undefined;
      return json({ error: "WebSocket upgrade required" }, 426);
    }

    if (pathname === RUNTIME_FILES_PATH) {
      const tree = buildFileTree(PROJECT_ROOT, PROJECT_ROOT);
      return json(tree);
    }

    if (pathname.startsWith(`${RUNTIME_FILES_PATH}/`)) {
      return handleFileMetadata(pathname);
    }

    if (pathname === RUNTIME_OPEN_FILE_PATH) {
      return handleOpenFile(url);
    }

    return json({ error: "Not found" }, 404);
  },
});

console.warn(`Universal Overlay runtime listening on port ${server.port}`);
