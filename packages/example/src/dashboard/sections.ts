import type { UniversalBridgeState } from "universal-bridge";

import { BRIDGE_BASE_PATH } from "../overlay/constants.js";
import {
  formatBytes,
  formatDate,
  formatLastUpdated,
  formatPhase,
  formatTransportState,
  formatUptime,
} from "../overlay/format.js";
import type { FileMetadata } from "../overlay/types.js";
import type {
  DashboardActionId,
  DashboardActionState,
  DashboardBadgeVariant,
  DashboardControlsSection,
  DashboardLiveState,
  DashboardRuntimeSection,
  DashboardTableCell,
  DashboardTableRow,
  DashboardTableSection,
  DashboardTransportState,
  DashboardWebSocketSnapshot,
} from "./types.js";

const DEFAULT_FALLBACK_COMMAND = "example dev";
const DEFAULT_FAILURE_THRESHOLD = 1;
const NO_ERROR_MESSAGE = "Failed to reach bridge state";

function normalizeNullableString(
  value: string | null | undefined,
): string | null {
  return value ?? null;
}

function areStringArraysEqual(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
): boolean {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function areBridgeStatesEqual(
  a: UniversalBridgeState | null,
  b: UniversalBridgeState | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;

  return (
    a.protocolVersion === b.protocolVersion &&
    a.transportState === b.transportState &&
    a.runtime.phase === b.runtime.phase &&
    normalizeNullableString(a.runtime.url) ===
      normalizeNullableString(b.runtime.url) &&
    a.runtime.pid === b.runtime.pid &&
    a.runtime.startedAt === b.runtime.startedAt &&
    normalizeNullableString(a.runtime.lastError) ===
      normalizeNullableString(b.runtime.lastError) &&
    a.capabilities.commandHost === b.capabilities.commandHost &&
    a.capabilities.hasRuntimeControl === b.capabilities.hasRuntimeControl &&
    a.capabilities.canStartRuntime === b.capabilities.canStartRuntime &&
    a.capabilities.canRestartRuntime === b.capabilities.canRestartRuntime &&
    a.capabilities.canStopRuntime === b.capabilities.canStopRuntime &&
    normalizeNullableString(a.capabilities.fallbackCommand) ===
      normalizeNullableString(b.capabilities.fallbackCommand) &&
    a.capabilities.wsSubprotocol === b.capabilities.wsSubprotocol &&
    areStringArraysEqual(
      a.capabilities.supportedProtocolVersions,
      b.capabilities.supportedProtocolVersions,
    ) &&
    normalizeNullableString(a.instance?.id) ===
      normalizeNullableString(b.instance?.id) &&
    normalizeNullableString(a.instance?.label) ===
      normalizeNullableString(b.instance?.label) &&
    normalizeNullableString(a.error) === normalizeNullableString(b.error)
  );
}

export function areDashboardLiveStatesEqual(
  a: DashboardLiveState,
  b: DashboardLiveState,
): boolean {
  return (
    a.hasBootstrapped === b.hasBootstrapped &&
    a.connected === b.connected &&
    a.transportState === b.transportState &&
    normalizeNullableString(a.errorMessage) ===
      normalizeNullableString(b.errorMessage) &&
    a.lastUpdatedAt === b.lastUpdatedAt &&
    a.consecutiveFailures === b.consecutiveFailures &&
    a.fallbackCommand === b.fallbackCommand &&
    normalizeNullableString(a.protocolVersion) ===
      normalizeNullableString(b.protocolVersion) &&
    areBridgeStatesEqual(a.bridgeState, b.bridgeState)
  );
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return NO_ERROR_MESSAGE;
}

function resolveBridgeTransportState(
  currentState: DashboardTransportState,
  bridgeState: UniversalBridgeState,
): DashboardTransportState {
  if (
    currentState === "runtime_starting" &&
    bridgeState.runtime.phase !== "running" &&
    bridgeState.runtime.phase !== "error"
  ) {
    return "runtime_starting";
  }

  return bridgeState.transportState;
}

function resolveFailureTransportState(
  currentState: DashboardTransportState,
  consecutiveFailures: number,
  failureThreshold = DEFAULT_FAILURE_THRESHOLD,
): DashboardTransportState {
  if (consecutiveFailures >= failureThreshold) {
    return "degraded";
  }

  if (currentState === "runtime_starting") {
    return "runtime_starting";
  }

  return "bridge_detecting";
}

function asTextCell(
  text: string,
  tone: "default" | "muted" | "code" = "default",
): DashboardTableCell {
  return { kind: "text", text, tone };
}

function asBadgeCell(
  text: string,
  variant: DashboardBadgeVariant,
): DashboardTableCell {
  return { kind: "badge", text, variant };
}

function asLinkCell(
  text: string,
  href: string,
  tone: "default" | "muted" | "code" = "default",
): DashboardTableCell {
  return { kind: "link", text, href, tone };
}

function toBridgeEndpoint(path: string): string {
  return `${BRIDGE_BASE_PATH}${path}`;
}

function resolveTransportBadgeVariant(
  transportState: DashboardTransportState,
): DashboardBadgeVariant {
  if (transportState === "connected") return "success";
  if (
    transportState === "runtime_starting" ||
    transportState === "bridge_detecting"
  ) {
    return "warning";
  }
  if (transportState === "degraded" || transportState === "disconnected") {
    return "error";
  }
  return "default";
}

function resolveRuntimePhaseBadgeVariant(phase: string): DashboardBadgeVariant {
  if (phase === "running") return "success";
  if (phase === "starting" || phase === "stopping") return "warning";
  if (phase === "error") return "error";
  if (phase === "stopped") return "secondary";
  return "default";
}

function pushRow(
  rows: DashboardTableRow[],
  key: string,
  label: string,
  value: DashboardTableCell,
): void {
  rows.push({ key, label, value });
}

export function createInitialDashboardLiveState(): DashboardLiveState {
  return {
    hasBootstrapped: false,
    connected: false,
    transportState: "disconnected",
    bridgeState: null,
    errorMessage: null,
    lastUpdatedAt: null,
    consecutiveFailures: 0,
    fallbackCommand: DEFAULT_FALLBACK_COMMAND,
    protocolVersion: null,
  };
}

export function resolveDashboardLiveStateOnSuccess(
  prev: DashboardLiveState,
  bridgeState: UniversalBridgeState,
): DashboardLiveState {
  const now = Date.now();
  const nextTransportState = resolveBridgeTransportState(
    prev.transportState,
    bridgeState,
  );
  const nextConnected = nextTransportState === "connected";

  return {
    hasBootstrapped: true,
    connected: nextConnected,
    transportState: nextTransportState,
    bridgeState,
    errorMessage: null,
    // Last contact tracks the most recent successful bridge sync.
    lastUpdatedAt: now,
    consecutiveFailures: 0,
    fallbackCommand:
      bridgeState.capabilities?.fallbackCommand ?? prev.fallbackCommand,
    protocolVersion: bridgeState.protocolVersion ?? prev.protocolVersion,
  };
}

export function resolveDashboardLiveStateOnFailure(
  prev: DashboardLiveState,
  error: unknown,
  failureThreshold = DEFAULT_FAILURE_THRESHOLD,
): DashboardLiveState {
  const consecutiveFailures = Math.min(
    prev.consecutiveFailures + 1,
    failureThreshold,
  );
  const errorMessage = normalizeErrorMessage(error);
  return {
    ...prev,
    hasBootstrapped: true,
    connected: false,
    transportState: resolveFailureTransportState(
      prev.transportState,
      consecutiveFailures,
      failureThreshold,
    ),
    bridgeState: null,
    errorMessage,
    consecutiveFailures,
  };
}

export function resolveDashboardStatusBadge(state: DashboardLiveState): {
  text: string;
  variant: DashboardBadgeVariant;
} {
  if (!state.hasBootstrapped) {
    return { text: "Connecting", variant: "warning" };
  }

  if (
    state.transportState === "degraded" ||
    state.transportState === "disconnected"
  ) {
    return { text: "Disconnected", variant: "error" };
  }

  if (state.transportState === "bridge_detecting") {
    return { text: "Detecting", variant: "warning" };
  }

  if (state.transportState === "runtime_starting") {
    return { text: "Starting", variant: "warning" };
  }

  if (state.bridgeState?.runtime.phase === "error") {
    return { text: "Error", variant: "error" };
  }

  return { text: "Connected", variant: "success" };
}

export function resolveDashboardStatusSummary(
  state: DashboardLiveState,
): string {
  if (!state.hasBootstrapped) {
    return "Waiting for bridge state.";
  }

  if (
    state.transportState === "degraded" ||
    state.transportState === "disconnected"
  ) {
    return state.errorMessage ?? "Runtime unavailable. Bridge appears closed.";
  }

  if (state.transportState === "bridge_detecting") {
    return "Checking bridge availability.";
  }

  if (state.transportState === "runtime_starting") {
    return "Runtime is starting.";
  }

  if (state.bridgeState?.runtime.phase === "error") {
    return state.bridgeState.runtime.lastError ?? "Runtime reported an error.";
  }

  return "Live bridge connection established.";
}

function resolveActionStates(
  phase: string | null,
  actionLoading: DashboardActionId | null,
  hasRuntimeControl: boolean,
): DashboardActionState[] {
  const isTransitioning =
    actionLoading !== null || phase === "starting" || phase === "stopping";
  const isRunning = phase === "running";
  const controlsDisabled = !hasRuntimeControl;

  return [
    {
      id: "start",
      label: "Start",
      loadingLabel: "Starting...",
      icon: "play",
      disabled: controlsDisabled || isRunning || isTransitioning,
      loading: actionLoading === "start",
    },
    {
      id: "restart",
      label: "Restart",
      loadingLabel: "Restarting...",
      icon: "rotate-ccw",
      disabled: controlsDisabled || !isRunning || isTransitioning,
      loading: actionLoading === "restart",
    },
    {
      id: "stop",
      label: "Stop",
      loadingLabel: "Stopping...",
      icon: "square",
      disabled: controlsDisabled || !isRunning || isTransitioning,
      loading: actionLoading === "stop",
    },
  ];
}

export function buildRuntimeSections(input: {
  live: DashboardLiveState;
  websocket: DashboardWebSocketSnapshot;
  actionLoading: DashboardActionId | null;
  now?: number;
}): {
  summary: string;
  sections: DashboardRuntimeSection[];
} {
  const { live, websocket, actionLoading } = input;
  const now = input.now ?? Date.now();
  const bridgeState = live.bridgeState;
  const runtime = bridgeState?.runtime;
  const capabilities = bridgeState?.capabilities;
  const phase = runtime?.phase ?? null;

  const controls: DashboardControlsSection = {
    id: "controls",
    title: "Controls",
    actions: resolveActionStates(
      phase,
      actionLoading,
      capabilities?.hasRuntimeControl ?? false,
    ),
    ...(live.errorMessage ? { message: live.errorMessage } : {}),
  };

  const bridgeRows: DashboardTableRow[] = [];
  pushRow(
    bridgeRows,
    "transport",
    "Transport",
    asBadgeCell(
      formatTransportState(live.transportState),
      resolveTransportBadgeVariant(live.transportState),
    ),
  );
  if (bridgeState?.protocolVersion) {
    pushRow(
      bridgeRows,
      "protocol",
      "Protocol",
      asTextCell(`v${bridgeState.protocolVersion}`, "code"),
    );
  }
  if (bridgeState?.capabilities?.supportedProtocolVersions?.length) {
    pushRow(
      bridgeRows,
      "supported",
      "Supported",
      asTextCell(
        bridgeState.capabilities.supportedProtocolVersions
          .map((version) => `v${version}`)
          .join(", "),
        "code",
      ),
    );
  }
  if (live.lastUpdatedAt) {
    pushRow(
      bridgeRows,
      "last-contact",
      "Last contact",
      asTextCell(formatLastUpdated(live.lastUpdatedAt, now), "muted"),
    );
  }
  pushRow(
    bridgeRows,
    "endpoint-health",
    "Health API",
    asLinkCell("health", toBridgeEndpoint("/health"), "code"),
  );
  pushRow(
    bridgeRows,
    "endpoint-state",
    "State API",
    asLinkCell("state", toBridgeEndpoint("/state"), "code"),
  );
  pushRow(
    bridgeRows,
    "endpoint-runtime",
    "Runtime API",
    asLinkCell("runtime/status", toBridgeEndpoint("/runtime/status"), "code"),
  );
  pushRow(
    bridgeRows,
    "endpoint-events",
    "Events stream",
    asTextCell(`${toBridgeEndpoint("/events")}`, "code"),
  );
  if (bridgeState?.error) {
    pushRow(bridgeRows, "error", "Error", asTextCell(bridgeState.error));
  }

  const websocketRows: DashboardTableRow[] = [];
  pushRow(
    websocketRows,
    "status",
    "Status",
    asBadgeCell(
      websocket.status === "open" ? "Open" : "Closed",
      websocket.status === "open" ? "success" : "error",
    ),
  );
  if (websocket.openedAt) {
    pushRow(
      websocketRows,
      "opened",
      "Opened",
      asTextCell(formatDate(websocket.openedAt), "muted"),
    );
  }
  pushRow(
    websocketRows,
    "fallback",
    "Fallback",
    asBadgeCell(
      websocket.mode === "polling" ? "Enabled" : "Disabled",
      websocket.mode === "polling" ? "warning" : "secondary",
    ),
  );
  if (websocket.failures > 0) {
    pushRow(
      websocketRows,
      "failures",
      "Failures",
      asTextCell(String(websocket.failures)),
    );
  }

  const runtimeRows: DashboardTableRow[] = [];
  pushRow(
    runtimeRows,
    "phase",
    "Phase",
    phase
      ? asBadgeCell(formatPhase(phase), resolveRuntimePhaseBadgeVariant(phase))
      : asTextCell("Unavailable", "muted"),
  );
  if (runtime?.pid) {
    pushRow(runtimeRows, "pid", "PID", asTextCell(String(runtime.pid), "code"));
  }
  if (runtime?.url) {
    pushRow(runtimeRows, "url", "URL", asTextCell(runtime.url, "code"));
  }
  if (runtime?.startedAt) {
    pushRow(
      runtimeRows,
      "started",
      "Started",
      asTextCell(formatDate(runtime.startedAt), "muted"),
    );
    pushRow(
      runtimeRows,
      "uptime",
      "Uptime",
      asTextCell(formatUptime(runtime.startedAt, now), "muted"),
    );
  }
  if (runtime?.lastError) {
    pushRow(
      runtimeRows,
      "last-error",
      "Last error",
      asTextCell(runtime.lastError),
    );
  }

  const capabilityRows: DashboardTableRow[] = [];
  if (capabilities) {
    pushRow(
      capabilityRows,
      "command-host",
      "Command host",
      asTextCell(capabilities.commandHost),
    );
    pushRow(
      capabilityRows,
      "ws-subprotocol",
      "WS subprotocol",
      asTextCell(capabilities.wsSubprotocol, "code"),
    );

    const actions = [
      capabilities.canStartRuntime ? "start" : null,
      capabilities.canRestartRuntime ? "restart" : null,
      capabilities.canStopRuntime ? "stop" : null,
    ].filter(Boolean) as string[];

    const actionText = actions.join(", ") || "none";
    pushRow(
      capabilityRows,
      "actions",
      "Actions",
      asTextCell(actionText, "code"),
    );

    if (actionText === "none") {
      pushRow(
        capabilityRows,
        "runtime-control",
        "Runtime control",
        asTextCell(capabilities.hasRuntimeControl ? "Yes" : "No"),
      );
    }

    if (capabilities.fallbackCommand) {
      pushRow(
        capabilityRows,
        "fallback-command",
        "Fallback cmd",
        asTextCell(capabilities.fallbackCommand, "code"),
      );
    }
  }

  const sections: DashboardRuntimeSection[] = [
    controls,
    {
      id: "runtime",
      title: "Runtime",
      rows: runtimeRows,
    } satisfies DashboardTableSection,
    {
      id: "bridge",
      title: "Bridge",
      rows: bridgeRows,
    } satisfies DashboardTableSection,
    {
      id: "websocket",
      title: "WebSocket",
      rows: websocketRows,
    } satisfies DashboardTableSection,
  ];

  if (capabilityRows.length > 0) {
    sections.push({
      id: "capabilities",
      title: "Capabilities",
      rows: capabilityRows,
    });
  }

  return {
    summary: resolveDashboardStatusSummary(live),
    sections,
  };
}

export function buildSettingsRows(settings: {
  autoExpand: boolean;
  theme: string;
  position: string;
}): DashboardTableRow[] {
  return [
    {
      key: "auto-expand",
      label: "Auto-expand",
      value: asTextCell(settings.autoExpand ? "Enabled" : "Disabled"),
    },
    {
      key: "theme",
      label: "Theme",
      value: asTextCell(settings.theme),
    },
    {
      key: "position",
      label: "Position",
      value: asTextCell(settings.position),
    },
  ];
}

export function buildFileMetadataRows(
  metadata: FileMetadata,
): DashboardTableRow[] {
  const rows: DashboardTableRow[] = [];
  pushRow(rows, "name", "Name", asTextCell(metadata.name));
  pushRow(rows, "path", "Path", asTextCell(metadata.path, "code"));
  if (metadata.absolutePath) {
    pushRow(
      rows,
      "absolute-path",
      "Full path",
      asTextCell(metadata.absolutePath, "code"),
    );
  }
  pushRow(
    rows,
    "type",
    "Type",
    asTextCell(
      metadata.isDirectory ? "Directory" : metadata.extension || "File",
    ),
  );
  pushRow(rows, "size", "Size", asTextCell(formatBytes(metadata.size)));
  if (metadata.lines !== undefined) {
    pushRow(
      rows,
      "lines",
      "Lines",
      asTextCell(metadata.lines.toLocaleString()),
    );
  }
  pushRow(
    rows,
    "modified",
    "Modified",
    asTextCell(formatDate(metadata.modified), "muted"),
  );
  pushRow(
    rows,
    "created",
    "Created",
    asTextCell(formatDate(metadata.created), "muted"),
  );
  return rows;
}
