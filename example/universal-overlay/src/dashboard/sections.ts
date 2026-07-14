import type {
  BridgeRuntimeSnapshot,
  UniversalBridgeState,
} from "universal-bridge";

import { OVERLAY_RUNTIME_FALLBACK_COMMAND } from "../overlay-config.js";
import { bridgeRoute } from "../overlay/bridge-routes.js";
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
} from "./types.js";

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
    a.capabilities.hasRuntimeWebSocketGateway ===
      b.capabilities.hasRuntimeWebSocketGateway &&
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

function formatStoreConnection(
  connection: BridgeRuntimeSnapshot["connection"],
): string {
  return connection.charAt(0).toUpperCase() + connection.slice(1);
}

function resolveStoreConnectionBadgeVariant(
  connection: BridgeRuntimeSnapshot["connection"],
): DashboardBadgeVariant {
  if (connection === "open") return "success";
  if (connection === "connecting" || connection === "reconnecting")
    return "warning";
  if (connection === "idle") return "secondary";
  return "error";
}

function asLinkCell(
  text: string,
  href: string,
  tone: "default" | "muted" | "code" = "default",
): DashboardTableCell {
  return { kind: "link", text, href, tone };
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

function resolveBridgeTransportDisplay(live: DashboardLiveState): {
  text: string;
  variant: DashboardBadgeVariant;
} {
  if (live.bridgeState?.runtime.phase === "stopped") {
    return { text: "Runtime stopped", variant: "secondary" };
  }

  return {
    text: formatTransportState(live.transportState),
    variant: resolveTransportBadgeVariant(live.transportState),
  };
}

function resolveRuntimePhaseBadgeVariant(phase: string): DashboardBadgeVariant {
  if (phase === "running") return "success";
  if (phase === "starting" || phase === "stopping") return "warning";
  if (phase === "error") return "error";
  if (phase === "stopped") return "secondary";
  return "default";
}

function resolveAvailabilityBadgeVariant(
  available: boolean,
): DashboardBadgeVariant {
  return available ? "success" : "secondary";
}

function formatActionName(action: string): string {
  return `${action.charAt(0).toUpperCase()}${action.slice(1)}`;
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
    fallbackCommand: OVERLAY_RUNTIME_FALLBACK_COMMAND,
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

  if (state.bridgeState?.runtime.phase === "stopped") {
    return { text: "Stopped", variant: "secondary" };
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

  if (state.bridgeState?.runtime.phase === "stopped") {
    return "Runtime is stopped. Start it to enable runtime-backed features.";
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
  runtimeSnapshot: BridgeRuntimeSnapshot;
  actionLoading: DashboardActionId | null;
  now?: number;
}): {
  summary: string;
  sections: DashboardRuntimeSection[];
} {
  const { live, runtimeSnapshot, actionLoading } = input;
  const now = input.now ?? Date.now();
  const bridgeState = live.bridgeState;
  const runtime = bridgeState?.runtime;
  const capabilities = bridgeState?.capabilities;
  const phase = runtime?.phase ?? null;

  const controls: DashboardControlsSection = {
    id: "controls",
    title: "Runtime Control",
    actions: resolveActionStates(
      phase,
      actionLoading,
      capabilities?.hasRuntimeControl ?? false,
    ),
    ...(live.errorMessage ? { message: live.errorMessage } : {}),
  };

  const bridgeStateRows: DashboardTableRow[] = [];
  const bridgeTransport = resolveBridgeTransportDisplay(live);
  pushRow(
    bridgeStateRows,
    "health-route",
    "Health route",
    asLinkCell("GET /health", bridgeRoute("/health"), "code"),
  );
  pushRow(
    bridgeStateRows,
    "state-route",
    "State route",
    asLinkCell("GET /state", bridgeRoute("/state"), "code"),
  );
  pushRow(
    bridgeStateRows,
    "transport",
    "Transport",
    asBadgeCell(bridgeTransport.text, bridgeTransport.variant),
  );
  if (bridgeState?.protocolVersion) {
    pushRow(
      bridgeStateRows,
      "protocol",
      "Protocol",
      asTextCell(`v${bridgeState.protocolVersion}`, "code"),
    );
  }
  if (bridgeState?.instance) {
    pushRow(
      bridgeStateRows,
      "instance",
      "Instance",
      asTextCell(
        bridgeState.instance.label
          ? `${bridgeState.instance.label} (${bridgeState.instance.id})`
          : bridgeState.instance.id,
        "code",
      ),
    );
  }
  if (live.lastUpdatedAt) {
    pushRow(
      bridgeStateRows,
      "last-update",
      "Last state update",
      asTextCell(formatLastUpdated(live.lastUpdatedAt, now), "muted"),
    );
  }
  if (Number.isFinite(bridgeState?.revision)) {
    pushRow(
      bridgeStateRows,
      "revision",
      "Revision",
      asTextCell(String(bridgeState?.revision), "code"),
    );
  }
  if (bridgeState?.error) {
    pushRow(
      bridgeStateRows,
      "error",
      "Bridge error",
      asTextCell(bridgeState.error),
    );
  }

  const bridgeEventRows: DashboardTableRow[] = [];
  pushRow(
    bridgeEventRows,
    "events-route",
    "Events route",
    asTextCell(`${bridgeRoute("/events")}`, "code"),
  );
  pushRow(
    bridgeEventRows,
    "connection",
    "Event connection",
    asBadgeCell(
      formatStoreConnection(runtimeSnapshot.connection),
      resolveStoreConnectionBadgeVariant(runtimeSnapshot.connection),
    ),
  );
  pushRow(
    bridgeEventRows,
    "event-id",
    "Latest event ID",
    asTextCell(String(runtimeSnapshot.eventId), "code"),
  );
  if (runtimeSnapshot.updatedAt) {
    pushRow(
      bridgeEventRows,
      "snapshot-time",
      "Last state sync",
      asTextCell(formatDate(runtimeSnapshot.updatedAt), "muted"),
    );
  }
  pushRow(
    bridgeEventRows,
    "action",
    "Active action",
    runtimeSnapshot.action
      ? asBadgeCell(formatActionName(runtimeSnapshot.action), "warning")
      : asTextCell("None", "muted"),
  );
  if (runtimeSnapshot.error) {
    pushRow(
      bridgeEventRows,
      "event-error",
      "Event stream error",
      asTextCell(runtimeSnapshot.error),
    );
  }
  if (capabilities?.wsSubprotocol) {
    pushRow(
      bridgeEventRows,
      "required-subprotocol",
      "Required subprotocol",
      asTextCell(capabilities.wsSubprotocol, "code"),
    );
  }

  const runtimeControlRows: DashboardTableRow[] = [];
  pushRow(
    runtimeControlRows,
    "status-route",
    "Status route",
    asLinkCell("GET /runtime/status", bridgeRoute("/runtime/status"), "code"),
  );
  pushRow(
    runtimeControlRows,
    "start-route",
    "Start route",
    asTextCell("POST /runtime/start", "code"),
  );
  pushRow(
    runtimeControlRows,
    "restart-route",
    "Restart route",
    asTextCell("POST /runtime/restart", "code"),
  );
  pushRow(
    runtimeControlRows,
    "stop-route",
    "Stop route",
    asTextCell("POST /runtime/stop", "code"),
  );
  pushRow(
    runtimeControlRows,
    "phase",
    "Phase",
    phase
      ? asBadgeCell(formatPhase(phase), resolveRuntimePhaseBadgeVariant(phase))
      : asTextCell("Unavailable", "muted"),
  );
  if (runtime?.url) {
    pushRow(
      runtimeControlRows,
      "url",
      "Runtime base URL",
      asLinkCell(runtime.url, runtime.url, "code"),
    );
  }
  if (runtime?.pid) {
    pushRow(
      runtimeControlRows,
      "pid",
      "PID",
      asTextCell(String(runtime.pid), "code"),
    );
  }
  if (runtime?.startedAt) {
    pushRow(
      runtimeControlRows,
      "started",
      "Started",
      asTextCell(formatDate(runtime.startedAt), "muted"),
    );
    pushRow(
      runtimeControlRows,
      "uptime",
      "Uptime",
      asTextCell(formatUptime(runtime.startedAt, now), "muted"),
    );
  }
  if (runtime?.lastError) {
    pushRow(
      runtimeControlRows,
      "last-error",
      "Last error",
      asTextCell(runtime.lastError),
    );
  }
  if (capabilities) {
    const actions = [
      capabilities.canStartRuntime ? "start" : null,
      capabilities.canRestartRuntime ? "restart" : null,
      capabilities.canStopRuntime ? "stop" : null,
    ].filter(Boolean) as string[];
    const actionText = actions.map(formatActionName).join(", ") || "None";
    pushRow(
      runtimeControlRows,
      "runtime-control",
      "Runtime control",
      asBadgeCell(
        capabilities.hasRuntimeControl ? "Available" : "Unavailable",
        resolveAvailabilityBadgeVariant(capabilities.hasRuntimeControl),
      ),
    );
    pushRow(
      runtimeControlRows,
      "actions",
      "Supported actions",
      asTextCell(actionText),
    );
    pushRow(
      runtimeControlRows,
      "command-host",
      "Command host",
      asTextCell(capabilities.commandHost, "code"),
    );
    if (actions.length === 0 && capabilities.fallbackCommand) {
      pushRow(
        runtimeControlRows,
        "fallback-command",
        "Fallback cmd",
        asTextCell(capabilities.fallbackCommand, "code"),
      );
    }
  }

  const runtimeWebSocketRows: DashboardTableRow[] = [];
  pushRow(
    runtimeWebSocketRows,
    "gateway-route",
    "Gateway route",
    asTextCell(`${bridgeRoute("/runtime/ws")}`, "code"),
  );
  pushRow(
    runtimeWebSocketRows,
    "capability",
    "Capability",
    asBadgeCell(
      capabilities?.hasRuntimeWebSocketGateway ? "Available" : "Unavailable",
      resolveAvailabilityBadgeVariant(
        capabilities?.hasRuntimeWebSocketGateway ?? false,
      ),
    ),
  );
  pushRow(
    runtimeWebSocketRows,
    "client-helper",
    "Client helper",
    asTextCell("getRuntimeWebSocketUrl()", "code"),
  );
  pushRow(
    runtimeWebSocketRows,
    "query-forwarding",
    "Query forwarding",
    asTextCell("Preserved"),
  );
  pushRow(
    runtimeWebSocketRows,
    "frame-forwarding",
    "Frame forwarding",
    asTextCell("Opaque text/binary"),
  );
  pushRow(
    runtimeWebSocketRows,
    "subprotocol-forwarding",
    "Subprotocols",
    asTextCell("Forwarded"),
  );
  pushRow(
    runtimeWebSocketRows,
    "runtime-parsing",
    "Payload parsing",
    asTextCell("None"),
  );
  pushRow(
    runtimeWebSocketRows,
    "reconnect-replay",
    "Reconnect/replay",
    asTextCell("None"),
  );

  const sections: DashboardRuntimeSection[] = [
    controls,
    {
      id: "runtime-control",
      title: "Runtime Control",
      description:
        "Shows whether the runtime is running and can be controlled.",
      rows: runtimeControlRows,
    } satisfies DashboardTableSection,
    {
      id: "bridge-state",
      title: "Bridge State",
      description:
        "Shows whether the bridge is alive and which instance is active.",
      rows: bridgeStateRows,
    } satisfies DashboardTableSection,
    {
      id: "bridge-events",
      title: "Bridge Events",
      description:
        "Shows the dashboard's bridge event subscription and latest event.",
      rows: bridgeEventRows,
    } satisfies DashboardTableSection,
    {
      id: "runtime-websocket",
      title: "Runtime WebSocket Gateway",
      description: "Shows whether browser WebSockets can proxy to the runtime.",
      rows: runtimeWebSocketRows,
    } satisfies DashboardTableSection,
  ];
  return {
    summary: resolveDashboardStatusSummary(live),
    sections,
  };
}

export function buildSettingsRows(settings: {
  theme: string;
  position: string;
}): DashboardTableRow[] {
  return [
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
