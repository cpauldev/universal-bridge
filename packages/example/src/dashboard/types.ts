import type { UniversalBridgeState } from "universal-bridge";

import type { ExampleApi } from "../overlay/api.js";
import type { FileMetadata, FileTreeNode } from "../overlay/types.js";

export type DashboardTransportState =
  | "disconnected"
  | "bridge_detecting"
  | "runtime_starting"
  | "connected"
  | "degraded";

export type DashboardActionId = "start" | "restart" | "stop";

export interface DashboardLiveState {
  hasBootstrapped: boolean;
  connected: boolean;
  transportState: DashboardTransportState;
  bridgeState: UniversalBridgeState | null;
  errorMessage: string | null;
  lastUpdatedAt: number | null;
  consecutiveFailures: number;
  fallbackCommand: string;
  protocolVersion: string | null;
}

export interface DashboardWebSocketSnapshot {
  status: "open" | "closed";
  openedAt: number | null;
  mode: "websocket" | "polling";
  failures: number;
}

export interface DashboardActionState {
  id: DashboardActionId;
  label: string;
  loadingLabel: string;
  icon: "play" | "rotate-ccw" | "square";
  disabled: boolean;
  loading: boolean;
}

export type DashboardBadgeVariant =
  | "default"
  | "success"
  | "warning"
  | "error"
  | "info"
  | "secondary";

export type DashboardTableCell =
  | {
      kind: "text";
      text: string;
      tone?: "default" | "muted" | "code";
    }
  | {
      kind: "link";
      text: string;
      href: string;
      tone?: "default" | "muted" | "code";
    }
  | {
      kind: "badge";
      text: string;
      variant: DashboardBadgeVariant;
    };

export interface DashboardTableRow {
  key: string;
  label: string;
  value: DashboardTableCell;
}

export interface DashboardControlsSection {
  id: "controls";
  title: string;
  actions: DashboardActionState[];
  message?: string;
}

export interface DashboardTableSection {
  id:
    | "bridge"
    | "websocket"
    | "runtime"
    | "capabilities"
    | "settings"
    | "metadata";
  title: string;
  rows: DashboardTableRow[];
}

export type DashboardRuntimeSection =
  | DashboardControlsSection
  | DashboardTableSection;

export type DashboardFrameworkId =
  | "react"
  | "vue"
  | "sveltekit"
  | "astro"
  | "solid"
  | "nextjs"
  | "nuxt"
  | "vanilla"
  | "vinext";

export interface DashboardFrameworkDefinition {
  id: DashboardFrameworkId;
  label: string;
  defaultPort: number;
}

export interface DashboardHealthInstance {
  id: string;
  label?: string;
}

export interface DashboardHealthPayload {
  ok: true;
  bridge: true;
  instance?: DashboardHealthInstance;
}

export interface DashboardDiscoveredInstance {
  origin: string;
  port: number;
  online: boolean;
  frameworkId: DashboardFrameworkId | null;
  instanceId: string | null;
  instanceLabel: string | null;
  lastSeenAt: number | null;
  lastHealthyAt: number | null;
  failures: number;
}

export interface DashboardFrameworkNavItem {
  id: DashboardFrameworkId;
  label: string;
  online: boolean;
  href: string | null;
  port: number | null;
  duplicateCount: number;
  instances: DashboardDiscoveredInstance[];
}

export interface DashboardDiscoveryState {
  instancesByOrigin: Record<string, DashboardDiscoveredInstance>;
  frameworkItems: DashboardFrameworkNavItem[];
  lastScanAt: number | null;
}

export interface DashboardControllerState {
  live: DashboardLiveState;
  actionLoading: DashboardActionId | null;
  fileTree: FileTreeNode[];
  treeLoading: boolean;
  fileFilter: string;
  selectedFilePath: string | null;
  fileMetadata: FileMetadata | null;
  fileMetadataLoading: boolean;
  websocket: DashboardWebSocketSnapshot;
  discovery: DashboardDiscoveryState;
}

export interface DashboardDiscoveryConfig {
  frameworks: DashboardFrameworkDefinition[];
  hostnames: string[];
  scanWindowSize: number;
  probeTimeoutMs: number;
  knownPollIntervalMs: number;
  fullScanIntervalMs: number;
  offlineFailureThreshold: number;
}

export interface DashboardControllerOptions {
  api?: ExampleApi;
  baseUrl?: string;
  livePollIntervalMs?: number;
  loadFilesOnStart?: boolean;
  enableDiscovery?: boolean;
  discovery?: Partial<DashboardDiscoveryConfig>;
}

export interface DashboardController {
  getState: () => DashboardControllerState;
  subscribe: (
    listener: (state: DashboardControllerState) => void,
  ) => () => void;
  start: () => void;
  stop: () => void;
  refresh: () => Promise<void>;
  runAction: (action: DashboardActionId) => Promise<void>;
  setFileFilter: (value: string) => void;
  selectFilePath: (path: string | null) => Promise<void>;
  loadFileTree: () => Promise<void>;
}
