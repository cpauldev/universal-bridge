import type { UniversalBridgeEvent } from "universal-bridge";

import {
  type ExampleApi,
  type WebSocketBinding,
  createExampleApi,
  createWebSocketBinding,
  getDevServerBaseUrlCandidates,
  resolveDevServerBaseUrl,
} from "../overlay/api.js";
import {
  createDashboardDiscoveryController,
  createInitialDiscoveryState,
} from "./discovery.js";
import {
  areDashboardLiveStatesEqual,
  createInitialDashboardLiveState,
  resolveDashboardLiveStateOnFailure,
  resolveDashboardLiveStateOnSuccess,
} from "./sections.js";
import type {
  DashboardActionId,
  DashboardController,
  DashboardControllerOptions,
  DashboardControllerState,
  DashboardLiveState,
} from "./types.js";

const DEFAULT_LIVE_POLL_INTERVAL_MS = 2000;
const WS_RECONNECT_DELAY_MS = 1500;
let overlayBootstrapPromise: Promise<void> | null = null;

type RuntimeStatusEvent = Extract<
  UniversalBridgeEvent,
  { type: "runtime-status" }
>;
type RuntimeErrorEvent = Extract<
  UniversalBridgeEvent,
  { type: "runtime-error" }
>;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isRuntimeStatusEvent(message: unknown): message is RuntimeStatusEvent {
  if (!isObject(message)) return false;
  if (message.type !== "runtime-status") return false;
  if (typeof message.timestamp !== "number") return false;
  if (!isObject(message.status)) return false;
  return typeof message.status.phase === "string";
}

function isRuntimeErrorEvent(message: unknown): message is RuntimeErrorEvent {
  if (!isObject(message)) return false;
  if (message.type !== "runtime-error") return false;
  return (
    typeof message.timestamp === "number" && typeof message.error === "string"
  );
}

function resolveRuntimeEventTransportState(
  currentState: DashboardLiveState["transportState"],
  phase: string,
): DashboardLiveState["transportState"] {
  if (
    currentState === "runtime_starting" &&
    phase !== "running" &&
    phase !== "error"
  ) {
    return "runtime_starting";
  }
  return "connected";
}

function ensureOverlayMounted(): void {
  if (typeof window === "undefined") return;
  if (overlayBootstrapPromise) return;

  overlayBootstrapPromise = import("../overlay/index.js")
    .then((module) => {
      module.mountOverlay();
    })
    .catch(() => {
      overlayBootstrapPromise = null;
      // Ignore overlay bootstrap failures to keep dashboard runtime resilient.
    });
}

function createInitialState(): DashboardControllerState {
  return {
    live: createInitialDashboardLiveState(),
    actionLoading: null,
    fileTree: [],
    treeLoading: false,
    fileFilter: "",
    selectedFilePath: null,
    fileMetadata: null,
    fileMetadataLoading: false,
    websocket: {
      status: "closed",
      openedAt: null,
      mode: "polling",
      failures: 0,
    },
    discovery: createInitialDiscoveryState(),
  };
}

function setLiveState(
  prev: DashboardControllerState,
  next: DashboardLiveState,
): DashboardControllerState {
  return {
    ...prev,
    live: next,
  };
}

function areWebSocketSnapshotsEqual(
  a: DashboardControllerState["websocket"],
  b: DashboardControllerState["websocket"],
): boolean {
  return (
    a.status === b.status &&
    a.openedAt === b.openedAt &&
    a.mode === b.mode &&
    a.failures === b.failures
  );
}

function areControllerStatesEqual(
  a: DashboardControllerState,
  b: DashboardControllerState,
): boolean {
  return (
    areDashboardLiveStatesEqual(a.live, b.live) &&
    a.actionLoading === b.actionLoading &&
    a.fileTree === b.fileTree &&
    a.treeLoading === b.treeLoading &&
    a.fileFilter === b.fileFilter &&
    a.selectedFilePath === b.selectedFilePath &&
    a.fileMetadata === b.fileMetadata &&
    a.fileMetadataLoading === b.fileMetadataLoading &&
    areWebSocketSnapshotsEqual(a.websocket, b.websocket) &&
    a.discovery === b.discovery
  );
}

export function createDashboardController(
  options: DashboardControllerOptions = {},
): DashboardController {
  const usingExternalApi = Boolean(options.api);
  const baseUrlCandidates = usingExternalApi
    ? []
    : getDevServerBaseUrlCandidates(options.baseUrl);
  let baseUrlCandidateIndex = 0;
  let activeBaseUrl = usingExternalApi
    ? ""
    : baseUrlCandidates[0] || resolveDevServerBaseUrl(options.baseUrl);
  let api: ExampleApi = options.api ?? createExampleApi(activeBaseUrl);
  const listeners = new Set<(state: DashboardControllerState) => void>();
  const livePollIntervalMs =
    options.livePollIntervalMs ?? DEFAULT_LIVE_POLL_INTERVAL_MS;
  const loadFilesOnStart = options.loadFilesOnStart ?? false;
  const enableDiscovery = options.enableDiscovery ?? false;

  const discovery = enableDiscovery
    ? createDashboardDiscoveryController(options.discovery ?? {})
    : null;
  const shouldUseWebSocket =
    typeof window === "undefined" || typeof window.WebSocket === "function";

  let state = createInitialState();
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  let wsBinding: WebSocketBinding | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let wsConnectionVersion = 0;
  let discoveryUnsubscribe: (() => void) | null = null;
  let refreshInFlight: Promise<void> | null = null;
  let started = false;

  const notify = () => {
    for (const listener of listeners) {
      listener(state);
    }
  };

  const setState = (
    updater: (prev: DashboardControllerState) => DashboardControllerState,
  ) => {
    const nextState = updater(state);
    if (nextState === state || areControllerStatesEqual(state, nextState))
      return;
    state = nextState;
    notify();
  };

  const setWebSocketState = (
    updater: (
      prev: DashboardControllerState["websocket"],
    ) => DashboardControllerState["websocket"],
  ) => {
    setState((prev) => {
      const nextWebSocket = updater(prev.websocket);
      if (areWebSocketSnapshotsEqual(prev.websocket, nextWebSocket))
        return prev;
      return { ...prev, websocket: nextWebSocket };
    });
  };

  const incrementWebSocketFailures = (
    prev: DashboardControllerState["websocket"],
  ) => prev.failures + 1;

  const clearReconnectTimer = () => {
    if (!reconnectTimer) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  };

  const setActiveBaseUrl = (baseUrl: string) => {
    if (usingExternalApi || !baseUrl || baseUrl === activeBaseUrl) return;
    activeBaseUrl = baseUrl;
    api = createExampleApi(activeBaseUrl);
    if (started) {
      connectWebSocket();
    }
  };

  const rotateBaseUrlCandidate = () => {
    if (usingExternalApi || baseUrlCandidates.length < 2) return;
    baseUrlCandidateIndex =
      (baseUrlCandidateIndex + 1) % baseUrlCandidates.length;
    setActiveBaseUrl(baseUrlCandidates[baseUrlCandidateIndex]);
  };

  const runWithBaseUrlFallback = async <T>(
    fn: () => Promise<T>,
    allowFallback = true,
  ): Promise<T> => {
    const totalCandidates = baseUrlCandidates.length;
    const attempts =
      !usingExternalApi && allowFallback && totalCandidates > 1
        ? totalCandidates
        : 1;
    let lastError: unknown = null;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (attempt < attempts - 1) {
          rotateBaseUrlCandidate();
          continue;
        }
      }
    }

    throw lastError ?? new Error("Request failed");
  };

  const scheduleReconnect = () => {
    if (!started) return;
    clearReconnectTimer();
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (started) {
        connectWebSocket();
      }
    }, WS_RECONNECT_DELAY_MS);
  };

  const applyRuntimeStatusEvent = (event: RuntimeStatusEvent): void => {
    setState((prev) => {
      if (!prev.live.bridgeState) {
        return prev;
      }

      const nextTransportState = resolveRuntimeEventTransportState(
        prev.live.transportState,
        event.status.phase,
      );

      const nextLive: DashboardLiveState = {
        ...prev.live,
        hasBootstrapped: true,
        connected: true,
        transportState: nextTransportState,
        bridgeState: {
          ...prev.live.bridgeState,
          transportState: nextTransportState,
          runtime: event.status,
        },
        errorMessage: null,
        lastUpdatedAt: event.timestamp,
        consecutiveFailures: 0,
      };
      if (areDashboardLiveStatesEqual(prev.live, nextLive)) {
        return prev;
      }
      return setLiveState(prev, nextLive);
    });
  };

  const applyRuntimeErrorEvent = (event: RuntimeErrorEvent): void => {
    setState((prev) => {
      const nextTransportState =
        prev.live.transportState === "runtime_starting"
          ? "runtime_starting"
          : "connected";
      const nextLive: DashboardLiveState = {
        ...prev.live,
        hasBootstrapped: true,
        connected: true,
        transportState: nextTransportState,
        bridgeState: prev.live.bridgeState
          ? { ...prev.live.bridgeState, transportState: nextTransportState }
          : null,
        errorMessage: event.error,
        lastUpdatedAt: event.timestamp,
        consecutiveFailures: 0,
      };
      if (areDashboardLiveStatesEqual(prev.live, nextLive)) {
        return prev;
      }
      return setLiveState(prev, nextLive);
    });
  };

  const handleWebSocketMessage = (message: unknown): void => {
    if (isRuntimeStatusEvent(message)) {
      if (!state.live.bridgeState) {
        void refresh();
        return;
      }
      applyRuntimeStatusEvent(message);
      return;
    }

    if (isRuntimeErrorEvent(message)) {
      applyRuntimeErrorEvent(message);
      return;
    }
  };

  const connectWebSocket = () => {
    const connectionVersion = ++wsConnectionVersion;
    clearReconnectTimer();
    wsBinding?.close();

    if (typeof window === "undefined") {
      return;
    }

    try {
      wsBinding = createWebSocketBinding(
        activeBaseUrl || window.location.origin,
        {
          onOpen: () => {
            if (connectionVersion !== wsConnectionVersion) return;
            setWebSocketState(() => ({
              status: "open",
              openedAt: Date.now(),
              mode: "websocket",
              failures: 0,
            }));
            void refresh();
          },
          onClose: () => {
            if (connectionVersion !== wsConnectionVersion) return;
            setWebSocketState((prev) => ({
              status: "closed",
              openedAt: prev.openedAt,
              mode: "polling",
              failures: incrementWebSocketFailures(prev),
            }));
            scheduleReconnect();
          },
          onError: () => {
            if (connectionVersion !== wsConnectionVersion) return;
            setWebSocketState((prev) => ({
              status: "closed",
              openedAt: prev.openedAt,
              mode: "polling",
              failures: incrementWebSocketFailures(prev),
            }));
            scheduleReconnect();
          },
          onMessage: (message) => {
            if (connectionVersion !== wsConnectionVersion) return;
            handleWebSocketMessage(message);
          },
        },
      );
    } catch {
      setWebSocketState((prev) => ({
        ...prev,
        status: "closed",
        mode: "polling",
        failures: incrementWebSocketFailures(prev),
      }));
      scheduleReconnect();
    }
  };

  const refresh = (): Promise<void> => {
    if (refreshInFlight) {
      return refreshInFlight;
    }

    refreshInFlight = (async () => {
      try {
        const bridgeState = await runWithBaseUrlFallback(
          () => api.getBridgeState(),
          true,
        );
        setState((prev) => {
          const nextLive = resolveDashboardLiveStateOnSuccess(
            prev.live,
            bridgeState,
          );
          if (areDashboardLiveStatesEqual(prev.live, nextLive)) {
            return prev;
          }
          return setLiveState(prev, nextLive);
        });
      } catch (error) {
        setState((prev) => {
          const nextLive = resolveDashboardLiveStateOnFailure(prev.live, error);
          if (areDashboardLiveStatesEqual(prev.live, nextLive)) {
            return prev;
          }
          return setLiveState(prev, nextLive);
        });
      } finally {
        refreshInFlight = null;
      }
    })();

    return refreshInFlight;
  };

  const runAction = async (action: DashboardActionId): Promise<void> => {
    setState((prev) => {
      if (prev.actionLoading === action) return prev;
      return { ...prev, actionLoading: action };
    });
    try {
      if (action === "start") {
        await api.startRuntime();
      } else if (action === "restart") {
        await api.restartRuntime();
      } else {
        await api.stopRuntime();
      }

      await refresh();
    } catch (error) {
      setState((prev) => {
        const nextLive = resolveDashboardLiveStateOnFailure(prev.live, error);
        if (areDashboardLiveStatesEqual(prev.live, nextLive)) {
          return prev;
        }
        return setLiveState(prev, nextLive);
      });
    } finally {
      setState((prev) => {
        if (prev.actionLoading === null) return prev;
        return { ...prev, actionLoading: null };
      });
    }
  };

  const loadFileTree = async (): Promise<void> => {
    if (state.treeLoading || state.fileTree.length > 0) {
      return;
    }

    setState((prev) => {
      if (prev.treeLoading) return prev;
      return { ...prev, treeLoading: true };
    });

    try {
      const fileTree = await api.getFileTree();
      setState((prev) => ({
        ...prev,
        fileTree,
        treeLoading: false,
      }));
    } catch {
      setState((prev) => {
        if (!prev.treeLoading) return prev;
        return { ...prev, treeLoading: false };
      });
    }
  };

  const selectFilePath = async (path: string | null): Promise<void> => {
    setState((prev) => {
      const nextMetadataLoading = Boolean(path);
      const nextMetadata = path ? prev.fileMetadata : null;
      if (
        prev.selectedFilePath === path &&
        prev.fileMetadata === nextMetadata &&
        prev.fileMetadataLoading === nextMetadataLoading
      ) {
        return prev;
      }
      return {
        ...prev,
        selectedFilePath: path,
        fileMetadata: nextMetadata,
        fileMetadataLoading: nextMetadataLoading,
      };
    });

    if (!path) return;

    try {
      const metadata = await api.getFileMetadata(path);
      setState((prev) => {
        if (prev.selectedFilePath !== path) {
          return prev;
        }
        if (
          prev.fileMetadata === metadata &&
          prev.fileMetadataLoading === false
        ) {
          return prev;
        }

        return {
          ...prev,
          fileMetadata: metadata,
          fileMetadataLoading: false,
        };
      });
    } catch {
      setState((prev) => {
        if (prev.selectedFilePath !== path) {
          return prev;
        }
        if (prev.fileMetadata === null && prev.fileMetadataLoading === false) {
          return prev;
        }

        return {
          ...prev,
          fileMetadata: null,
          fileMetadataLoading: false,
        };
      });
    }
  };

  return {
    getState() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      if (started) return;
      started = true;
      ensureOverlayMounted();

      if (discovery) {
        discoveryUnsubscribe = discovery.subscribe((discoveryState) => {
          setState((prev) => ({
            ...prev,
            discovery: discoveryState,
          }));
        });
        discovery.start();
      }
      if (shouldUseWebSocket) {
        connectWebSocket();
      } else {
        setWebSocketState((prev) => ({
          ...prev,
          status: "closed",
          mode: "polling",
        }));
      }

      void refresh();
      if (loadFilesOnStart) {
        void loadFileTree();
      }

      refreshTimer = setInterval(() => {
        if (shouldUseWebSocket && state.websocket.status === "open") {
          return;
        }
        void refresh();
      }, livePollIntervalMs);
    },
    stop() {
      if (!started) return;
      started = false;

      if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
      }
      clearReconnectTimer();

      wsBinding?.close();
      wsBinding = null;

      discovery?.stop();
      discoveryUnsubscribe?.();
      discoveryUnsubscribe = null;
    },
    refresh,
    runAction,
    setFileFilter(value) {
      setState((prev) => {
        if (prev.fileFilter === value) return prev;
        return {
          ...prev,
          fileFilter: value,
        };
      });
    },
    selectFilePath,
    loadFileTree,
  };
}
