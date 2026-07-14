import {
  type UniversalClientRuntimeContext,
  createClientRuntimeContext,
  resolveClientRuntimeContext,
} from "universal-bridge/client-runtime";

import {
  OVERLAY_MODULE_SPECIFIER,
  OVERLAY_PACKAGE_NAME,
} from "../overlay-config.js";
import type {
  OverlayPosition,
  OverlaySettings,
  TabDefinition,
} from "./types.js";

function createFallbackRuntimeContext(): UniversalClientRuntimeContext {
  return createClientRuntimeContext({
    namespaceId: OVERLAY_PACKAGE_NAME,
  });
}

export const OVERLAY_RUNTIME_CONTEXT: UniversalClientRuntimeContext =
  resolveClientRuntimeContext(OVERLAY_MODULE_SPECIFIER) ??
  createFallbackRuntimeContext();

export const OVERLAY_HOST_ID = OVERLAY_RUNTIME_CONTEXT.rootId;
export const OVERLAY_MOUNT_ROOT_ATTRIBUTE = "data-overlay-root";
export const OVERLAY_MOUNT_ROOT_SELECTOR = `#${OVERLAY_HOST_ID} [${OVERLAY_MOUNT_ROOT_ATTRIBUTE}="true"]`;
export const OVERLAY_STORAGE_KEY = OVERLAY_RUNTIME_CONTEXT.stateStorageKey;
export const OVERLAY_ENABLED_KEY = OVERLAY_RUNTIME_CONTEXT.enabledStorageKey;
export const OVERLAY_INSTANCE_GLOBAL_KEY = OVERLAY_RUNTIME_CONTEXT.instanceKey;
export const BRIDGE_BASE_PATH = OVERLAY_RUNTIME_CONTEXT.bridgePathPrefix;

export const WS_RECONNECT_DELAY_MS = 1500;
export const STATE_POLL_INTERVAL_MS = 12000;

export const DEFAULT_SETTINGS: OverlaySettings = {
  theme: "light",
  position: "bottom-center",
  enabled: true,
};

export const OVERLAY_POSITIONS: OverlayPosition[] = [
  "top-left",
  "top-center",
  "top-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];

export const DEFAULT_TAB = "runtime" as const;

export const TABS: TabDefinition[] = [
  {
    id: "runtime",
    label: "Runtime",
    description: "Runtime status and controls",
    icon: "cpu",
  },
  {
    id: "files",
    label: "Files",
    description: "Browse project files and view metadata",
    icon: "folder-open",
  },
  {
    id: "settings",
    label: "Settings",
    description: "Overlay appearance and behavior",
    icon: "sliders-horizontal",
  },
];
