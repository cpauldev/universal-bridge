import {
  type BridgeRuntimeSnapshot,
  type BridgeRuntimeStore,
  createBridgeRuntimeStore,
} from "universal-bridge";

import { createOverlayApi, resolveDevServerBaseUrl } from "../overlay/api.js";
import { BRIDGE_BASE_PATH } from "../overlay/constants.js";
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
  DashboardDiscoveryState,
} from "./types.js";

function createInitialRuntimeSnapshot(): BridgeRuntimeSnapshot {
  return {
    bridgeState: null,
    connection: "idle",
    action: null,
    error: null,
    eventId: 0,
    revision: 0,
    updatedAt: null,
  };
}

function createInitialDashboardState(): DashboardControllerState {
  return {
    live: createInitialDashboardLiveState(),
    actionLoading: null,
    fileTree: [],
    treeLoading: false,
    fileFilter: "",
    selectedFilePath: null,
    fileMetadata: null,
    fileMetadataLoading: false,
    runtimeSnapshot: createInitialRuntimeSnapshot(),
    discovery: createInitialDiscoveryState(),
  };
}

function resolveLiveStateFromSnapshot(
  state: DashboardControllerState,
  snapshot: BridgeRuntimeSnapshot,
) {
  if (snapshot.bridgeState && snapshot.connection === "open") {
    return resolveDashboardLiveStateOnSuccess(state.live, snapshot.bridgeState);
  }

  return resolveDashboardLiveStateOnFailure(
    state.live,
    new Error(snapshot.error ?? `Bridge connection is ${snapshot.connection}`),
  );
}

async function runBridgeAction(
  bridgeStore: BridgeRuntimeStore,
  action: DashboardActionId,
): Promise<void> {
  if (action === "start") {
    await bridgeStore.start();
    return;
  }

  if (action === "restart") {
    await bridgeStore.restart();
    return;
  }

  await bridgeStore.stop();
}

export function createDashboardController(
  options: DashboardControllerOptions = {},
): DashboardController {
  const baseUrl = resolveDevServerBaseUrl(options.baseUrl);
  const api = createOverlayApi(baseUrl);
  const bridgeStore = createBridgeRuntimeStore({
    baseUrl,
    bridgePathPrefix: BRIDGE_BASE_PATH,
  });
  const discovery = options.enableDiscovery
    ? createDashboardDiscoveryController(options.discovery ?? {})
    : null;
  const listeners = new Set<(state: DashboardControllerState) => void>();

  let state = createInitialDashboardState();
  let started = false;
  let storeUnsubscribe: (() => void) | null = null;
  let discoveryUnsubscribe: (() => void) | null = null;

  function setState(
    updater:
      | DashboardControllerState
      | ((current: DashboardControllerState) => DashboardControllerState),
  ): void {
    const next = typeof updater === "function" ? updater(state) : updater;
    if (next === state) return;
    state = next;
    listeners.forEach((listener) => listener(state));
  }

  function setDiscoveryState(discoveryState: DashboardDiscoveryState): void {
    setState((current) => ({ ...current, discovery: discoveryState }));
  }

  function applyStoreSnapshot(): void {
    const snapshot = bridgeStore.getSnapshot();
    const live = resolveLiveStateFromSnapshot(state, snapshot);
    if (
      areDashboardLiveStatesEqual(live, state.live) &&
      snapshot === state.runtimeSnapshot
    ) {
      return;
    }
    setState((current) => ({ ...current, live, runtimeSnapshot: snapshot }));
  }

  async function runAction(action: DashboardActionId): Promise<void> {
    setState((current) => ({ ...current, actionLoading: action }));
    try {
      await runBridgeAction(bridgeStore, action);
    } finally {
      setState((current) => ({ ...current, actionLoading: null }));
    }
  }

  async function loadFileTree(): Promise<void> {
    if (state.treeLoading || state.fileTree.length > 0) return;

    setState((current) => ({ ...current, treeLoading: true }));
    try {
      const fileTree = await api.getFileTree();
      setState((current) => ({ ...current, fileTree, treeLoading: false }));
    } catch {
      setState((current) => ({ ...current, treeLoading: false }));
    }
  }

  async function selectFilePath(path: string | null): Promise<void> {
    setState((current) => ({
      ...current,
      selectedFilePath: path,
      fileMetadata: path ? current.fileMetadata : null,
      fileMetadataLoading: Boolean(path),
    }));

    if (!path) return;

    try {
      const fileMetadata = await api.getFileMetadata(path);
      setState((current) =>
        current.selectedFilePath === path
          ? { ...current, fileMetadata, fileMetadataLoading: false }
          : current,
      );
    } catch {
      setState((current) =>
        current.selectedFilePath === path
          ? { ...current, fileMetadata: null, fileMetadataLoading: false }
          : current,
      );
    }
  }

  function start(): void {
    if (started) return;
    started = true;

    storeUnsubscribe = bridgeStore.subscribe(applyStoreSnapshot);
    applyStoreSnapshot();

    if (discovery) {
      discoveryUnsubscribe = discovery.subscribe(setDiscoveryState);
      discovery.start();
    }

    if (options.loadFilesOnStart) {
      void loadFileTree();
    }
  }

  function stop(): void {
    if (!started) return;
    started = false;

    storeUnsubscribe?.();
    storeUnsubscribe = null;

    discovery?.stop();
    discoveryUnsubscribe?.();
    discoveryUnsubscribe = null;
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => {
        listeners.delete(listener);
      };
    },
    start,
    stop,
    runAction,
    setFileFilter(value) {
      if (value === state.fileFilter) return;
      setState((current) => ({ ...current, fileFilter: value }));
    },
    selectFilePath,
    loadFileTree,
  };
}
