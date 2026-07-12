import type {
  UniversalBridgeState,
  UniversalRuntimeStatus,
} from "universal-bridge";

export type OverlaySeverity =
  | "success"
  | "loading"
  | "error"
  | "warning"
  | "info"
  | "action";

export type OverlayTheme = "system" | "light" | "dark";
export type OverlayPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export type OverlayTab = "runtime" | "files" | "settings";

export interface OverlaySettings {
  autoExpand: boolean;
  theme: OverlayTheme;
  position: OverlayPosition;
  enabled: boolean;
}

export interface FileTreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileTreeNode[];
}

export interface FileMetadata {
  name: string;
  path: string;
  absolutePath?: string;
  size: number;
  extension: string;
  isDirectory: boolean;
  modified: number;
  created: number;
  lines?: number;
}

export interface OverlayState {
  connected: boolean;
  hasBootstrapped: boolean;
  transportState:
    | "disconnected"
    | "bridge_detecting"
    | "runtime_starting"
    | "connected"
    | "degraded";
  activeTab: OverlayTab;
  expanded: boolean;
  loadingAction: string | null;
  errorMessage: string | null;
  lastSuccessAt: number | null;
  bridgeState: UniversalBridgeState | null;
  settings: OverlaySettings;
  fileTree: FileTreeNode[];
  fileFilter: string;
  selectedFilePath: string | null;
  fileMetadata: FileMetadata | null;
  fileMetadataLoading: boolean;
  treeLoading: boolean;
}

export type OverlayAction =
  | { type: "bootstrapComplete" }
  | { type: "setConnected"; connected: boolean }
  | {
      type: "setTransportState";
      transportState: OverlayState["transportState"];
    }
  | { type: "setBridgeState"; bridgeState: UniversalBridgeState | null }
  | { type: "setTab"; tab: OverlayTab }
  | { type: "setExpanded"; expanded: boolean }
  | { type: "setLoadingAction"; loadingAction: string | null }
  | { type: "setError"; errorMessage: string | null }
  | { type: "markSuccess"; at?: number }
  | { type: "setSettings"; settings: OverlaySettings }
  | { type: "setFileTree"; fileTree: FileTreeNode[] }
  | { type: "setTreeLoading"; treeLoading: boolean }
  | { type: "setFileFilter"; fileFilter: string }
  | { type: "setSelectedFilePath"; path: string | null }
  | { type: "setFileMetadata"; metadata: FileMetadata | null }
  | { type: "setFileMetadataLoading"; loading: boolean };

export interface TabDefinition {
  id: OverlayTab;
  label: string;
  description: string;
  icon: string;
}

export interface OverlayMountOptions {
  baseUrl?: string;
  force?: boolean;
}

export interface OverlayActionResult {
  success?: boolean;
  message?: string;
}

export type { UniversalBridgeState, UniversalRuntimeStatus };
