import { describe, expect, it } from "bun:test";
import type {
  BridgeRuntimeSnapshot,
  UniversalBridgeState,
} from "universal-bridge";

import { OVERLAY_RUNTIME_FALLBACK_COMMAND } from "../overlay-config.js";
import { buildRuntimeSections } from "./sections.js";
import type {
  DashboardLiveState,
  DashboardTableCell,
  DashboardTableSection,
} from "./types.js";

function createBridgeState(
  hasRuntimeWebSocketGateway = true,
): UniversalBridgeState {
  return {
    protocolVersion: "2",
    revision: 7,
    transportState: "connected",
    runtime: {
      phase: "running",
      url: "http://localhost:4100",
      pid: 1234,
      startedAt: 1_700_000_000_000,
      lastError: null,
    },
    capabilities: {
      commandHost: "host",
      hasRuntimeControl: true,
      canStartRuntime: true,
      canRestartRuntime: true,
      canStopRuntime: true,
      hasRuntimeWebSocketGateway,
      fallbackCommand: OVERLAY_RUNTIME_FALLBACK_COMMAND,
      wsSubprotocol: "universal.v2+json",
      supportedProtocolVersions: ["2"],
    },
    instance: {
      id: "overlay",
      label: "Universal Overlay",
    },
  };
}

function createLiveState(
  hasRuntimeWebSocketGateway = true,
): DashboardLiveState {
  return {
    hasBootstrapped: true,
    connected: true,
    transportState: "connected",
    bridgeState: createBridgeState(hasRuntimeWebSocketGateway),
    errorMessage: null,
    lastUpdatedAt: 1_700_000_001_000,
    consecutiveFailures: 0,
    fallbackCommand: OVERLAY_RUNTIME_FALLBACK_COMMAND,
    protocolVersion: "2",
  };
}

function createStoppedLiveState(): DashboardLiveState {
  const bridgeState = createBridgeState();
  bridgeState.transportState = "bridge_detecting";
  bridgeState.runtime = {
    phase: "stopped",
    url: null,
    pid: null,
    startedAt: null,
    lastError: null,
  };

  return {
    ...createLiveState(),
    connected: false,
    transportState: "bridge_detecting",
    bridgeState,
  };
}

function createRuntimeSnapshot(): BridgeRuntimeSnapshot {
  return {
    bridgeState: createBridgeState(),
    connection: "open",
    action: null,
    error: null,
    eventId: 42,
    revision: 7,
    updatedAt: 1_700_000_002_000,
  };
}

function tableSections(live = createLiveState()): DashboardTableSection[] {
  return buildRuntimeSections({
    live,
    runtimeSnapshot: createRuntimeSnapshot(),
    actionLoading: null,
    now: 1_700_000_003_000,
  }).sections.filter(
    (section): section is DashboardTableSection => section.id !== "controls",
  );
}

function cellText(cell: DashboardTableCell): string {
  return cell.kind === "badge" ? cell.text : cell.text;
}

describe("buildRuntimeSections", () => {
  it("groups bridge details by developer-facing feature", () => {
    const sections = tableSections();

    expect(sections.map((section) => section.title)).toEqual([
      "Runtime Control",
      "Bridge State",
      "Bridge Events",
      "Runtime WebSocket Gateway",
    ]);
    expect(sections.map((section) => section.id)).toEqual([
      "runtime-control",
      "bridge-state",
      "bridge-events",
      "runtime-websocket",
    ]);
    expect(
      sections.every(
        (section) =>
          section.description !== undefined && section.description.length <= 80,
      ),
    ).toBe(true);
  });

  it("keeps event and runtime websocket routes in their owning sections", () => {
    const sections = tableSections();
    const bridgeEvents = sections.find(
      (section) => section.id === "bridge-events",
    );
    const runtimeWebSocket = sections.find(
      (section) => section.id === "runtime-websocket",
    );

    expect(bridgeEvents?.rows.map((row) => row.key)).toContain("events-route");
    expect(runtimeWebSocket?.rows.map((row) => row.key)).toContain(
      "gateway-route",
    );
    expect(sections.map((section) => section.id)).not.toContain("capabilities");
  });

  it("shows runtime websocket gateway unavailable without dropping the section", () => {
    const sections = tableSections(createLiveState(false));
    const runtimeWebSocket = sections.find(
      (section) => section.id === "runtime-websocket",
    );
    const capability = runtimeWebSocket?.rows.find(
      (row) => row.key === "capability",
    );

    expect(runtimeWebSocket).toBeDefined();
    expect(capability ? cellText(capability.value) : null).toBe("Unavailable");
  });

  it("labels stopped runtime as stopped instead of bridge detection", () => {
    const runtimeData = buildRuntimeSections({
      live: createStoppedLiveState(),
      runtimeSnapshot: createRuntimeSnapshot(),
      actionLoading: null,
      now: 1_700_000_003_000,
    });
    const bridgeState = runtimeData.sections.find(
      (section) => section.id === "bridge-state",
    );
    const transport =
      bridgeState && "rows" in bridgeState
        ? bridgeState.rows.find((row) => row.key === "transport")
        : null;

    expect(runtimeData.summary).toBe(
      "Runtime is stopped. Start it to enable runtime-backed features.",
    );
    expect(transport ? cellText(transport.value) : null).toBe(
      "Runtime stopped",
    );
  });
});
