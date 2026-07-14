import { resolveClientAutoMount } from "universal-bridge/client-runtime";

import { OVERLAY_MODULE_SPECIFIER } from "../overlay-config.js";
import { OVERLAY_INSTANCE_GLOBAL_KEY } from "./constants.js";
import { UniversalOverlay } from "./overlay.js";
import type { OverlayMountOptions } from "./types.js";

// ── Mount policy ─────────────────────────────────────────────────────────────

function isBrowserRuntime(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function isLikelyLocalHost(hostname: string): boolean {
  if (!hostname) return false;
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1"
  )
    return true;
  if (hostname.endsWith(".local") || hostname.endsWith(".localhost"))
    return true;

  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;

  const [a, b] = ipv4.slice(1).map(Number);
  return (
    a === 10 ||
    a === 127 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31)
  );
}

function isDevLikeEnvironment(): boolean {
  if (!isBrowserRuntime()) return false;

  const env =
    typeof process !== "undefined" ? process.env?.NODE_ENV : undefined;
  if (env === "development" || env === "test") return true;
  if (env && env !== "development" && env !== "test") return false;

  if (isLikelyLocalHost(window.location.hostname)) return true;
  return false;
}

// ── Instance management ───────────────────────────────────────────────────────

interface OverlayInstanceLike {
  mount(): void;
  destroy(): void;
}

interface OverlayRuntimeWindow extends Window {
  [key: string]: unknown;
}

let overlayInstance: UniversalOverlay | null = null;

function getOverlayWindow(): OverlayRuntimeWindow {
  return window as unknown as OverlayRuntimeWindow;
}

function getOverlayFlagKey(suffix: "disabled" | "enabled"): string {
  return `${OVERLAY_INSTANCE_GLOBAL_KEY}:${suffix}`;
}

function getGlobalOverlayInstance(): OverlayInstanceLike | null {
  if (!isBrowserRuntime()) return overlayInstance;
  const globalInstance = getOverlayWindow()[OVERLAY_INSTANCE_GLOBAL_KEY] as
    OverlayInstanceLike | null | undefined;
  if (globalInstance && !overlayInstance)
    overlayInstance = globalInstance as UniversalOverlay;
  return globalInstance ?? null;
}

function setGlobalOverlayInstance(instance: OverlayInstanceLike | null): void {
  if (isBrowserRuntime())
    getOverlayWindow()[OVERLAY_INSTANCE_GLOBAL_KEY] = instance;
  overlayInstance = instance as UniversalOverlay | null;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function shouldMountOverlay(force = false): boolean {
  if (!isBrowserRuntime()) return false;
  if (force) return true;
  const runtimeWindow = getOverlayWindow();
  if (runtimeWindow[getOverlayFlagKey("disabled")] === true) return false;
  if (runtimeWindow[getOverlayFlagKey("enabled")] === true) return true;

  return resolveClientAutoMount(
    OVERLAY_MODULE_SPECIFIER,
    isDevLikeEnvironment(),
  );
}

export function mountOverlay(
  options: OverlayMountOptions = {},
): UniversalOverlay | null {
  if (!shouldMountOverlay(options.force)) return null;

  const existing = getGlobalOverlayInstance();
  if (existing) {
    existing.mount();
    return existing as UniversalOverlay;
  }

  const instance = new UniversalOverlay({
    baseUrl: options.baseUrl,
    force: options.force,
  });
  instance.mount();
  setGlobalOverlayInstance(instance);
  return instance;
}

export function unmountOverlay(): void {
  getGlobalOverlayInstance()?.destroy();
  setGlobalOverlayInstance(null);
}

export { UniversalOverlay };
export { createOverlayApi } from "./api.js";
export type { OverlayApi } from "./api.js";
export type { OverlayMountOptions };
export type { UniversalBridgeState, UniversalRuntimeStatus } from "./types.js";

// Auto-mount when imported as the adapter-injected overlay entry.
if (isBrowserRuntime() && shouldMountOverlay()) {
  try {
    mountOverlay();
  } catch {
    // Ignore overlay bootstrap failures.
  }
}
