import {
  createElement as createReactElement,
  useSyncExternalStore,
} from "react";
import { type Root as ReactRoot, createRoot } from "react-dom/client";
import { Toaster } from "sileo";
import type { UniversalBridgeEvent } from "universal-bridge";

import {
  OverlayPanel,
  type OverlayPanelProps,
  normalizeTheme,
} from "./OverlayPanel.js";
import {
  type ExampleApi,
  type WebSocketBinding,
  createExampleApi,
  createWebSocketBinding,
  getDevServerBaseUrlCandidates,
  resolveDevServerBaseUrl,
} from "./api.js";
import {
  OVERLAY_HOST_ID,
  OVERLAY_MOUNT_ROOT_ATTRIBUTE,
  STATE_POLL_INTERVAL_MS,
  WS_RECONNECT_DELAY_MS,
} from "./constants.js";
import {
  PanelStore,
  ShadowStyleSheet,
  useToast,
  useToastController,
} from "./shared/shadow.js";
import {
  createInitialOverlayState,
  loadOverlaySettings,
  overlayReducer,
  persistOverlaySettings,
} from "./state.js";
import type {
  OverlayAction,
  OverlayMountOptions,
  OverlaySettings,
  OverlayState,
} from "./types.js";
import { setOverlayPortalContainer } from "./ui/utils.js";

// ── Transport helpers ─────────────────────────────────────────────────────────

type TransportState = OverlayState["transportState"];
const FAILURE_THRESHOLD = 2;
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

function resolveBridgeTransportState(
  current: TransportState,
  bridgeState: import("universal-bridge").UniversalBridgeState,
): TransportState {
  if (
    current === "runtime_starting" &&
    bridgeState.runtime.phase !== "running" &&
    bridgeState.runtime.phase !== "error"
  ) {
    return "runtime_starting";
  }
  return bridgeState.transportState;
}

function resolveFailureTransportState(
  current: TransportState,
  failures: number,
): TransportState {
  if (failures >= FAILURE_THRESHOLD) return "degraded";
  return current === "runtime_starting"
    ? "runtime_starting"
    : "bridge_detecting";
}

function resolveRuntimeEventTransportState(
  current: TransportState,
  phase: string,
): TransportState {
  if (
    current === "runtime_starting" &&
    phase !== "running" &&
    phase !== "error"
  ) {
    return "runtime_starting";
  }
  return "connected";
}

function shouldRetainConnectedStateOnFailure(
  connected: boolean,
  failures: number,
): boolean {
  return connected && failures < FAILURE_THRESHOLD;
}

// ─────────────────────────────────────────────────────────────────────────────

const OVERLAY_TOAST_ID = "example-overlay";
const __OVERLAY_CSS_INLINE__ = "__EXAMPLE_OVERLAY_CSS_INLINE__";
const overlayStyles = new ShadowStyleSheet();

function OverlayPanelDescription({
  store,
}: {
  store: PanelStore<OverlayPanelProps>;
}) {
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  return createReactElement(OverlayPanel, snapshot);
}

function OverlayRoot({
  autoExpand,
  store,
  theme,
  shadowRoot,
}: {
  autoExpand: boolean;
  store: PanelStore<OverlayPanelProps>;
  theme: "light" | "dark";
  shadowRoot: ShadowRoot;
}) {
  useToast({
    toastId: OVERLAY_TOAST_ID,
    title: "Example",
    theme,
    description: createReactElement(OverlayPanelDescription, {
      store,
    }),
  });
  useToastController({ shadowRoot, autoExpand });

  return createReactElement(Toaster, {
    position: "bottom-right",
    theme,
  });
}

export class ExampleOverlay {
  #api: ExampleApi;
  #baseUrl: string;
  #baseUrlCandidates: string[] = [];
  #baseUrlCandidateIndex = 0;
  #host: HTMLElement | null = null;
  #shadowRoot: ShadowRoot | null = null;
  #mountRoot: HTMLElement | null = null;
  #hostObserver: MutationObserver | null = null;
  #deferredMountCleanup: (() => void) | null = null;
  #mounted = false;
  #state: OverlayState;
  #wsBinding: WebSocketBinding | null = null;
  #wsConnectionVersion = 0;
  #wsConsecutiveFailures = 0;
  #wsConnected = false;
  #wsFallbackMode = false;
  #wsOpenedAt: number | null = null;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #statePollTimer: ReturnType<typeof setInterval> | null = null;
  #allowWebSocket = true;
  #forceMount = false;
  #reactRoot: ReactRoot | null = null;
  #panelStore: PanelStore<OverlayPanelProps>;
  #renderScheduled = false;
  #runtimeRefreshFailures = 0;
  #stylesReady = false;

  constructor(options: OverlayMountOptions = {}) {
    const settings = loadOverlaySettings();
    this.#state = createInitialOverlayState(settings);
    this.#baseUrlCandidates = getDevServerBaseUrlCandidates(options.baseUrl);
    this.#baseUrl =
      this.#baseUrlCandidates[0] || resolveDevServerBaseUrl(options.baseUrl);
    this.#api = createExampleApi(this.#baseUrl);
    this.#forceMount = Boolean(options.force);
    this.#allowWebSocket =
      typeof window === "undefined" || typeof window.WebSocket === "function";
    this.#panelStore = new PanelStore(this.buildPanelProps());

    if (this.#forceMount && !settings.enabled) {
      this.applySettings({ ...settings, enabled: true });
    }
  }

  mount(): void {
    if (this.#mounted) return;
    if (!this.#state.settings.enabled && !this.#forceMount) return;
    if (!document.body) {
      this.deferMountUntilBodyReady();
      return;
    }

    this.clearDeferredMount();

    document
      .querySelectorAll<HTMLElement>(`#${OVERLAY_HOST_ID}`)
      .forEach((node) => node.remove());

    this.#host = document.createElement("div");
    this.#host.id = OVERLAY_HOST_ID;
    document.body.appendChild(this.#host);
    this.#shadowRoot = this.#host.attachShadow({ mode: "open" });
    this.startHostObserver();

    const mountRoot = document.createElement("div");
    mountRoot.setAttribute(OVERLAY_MOUNT_ROOT_ATTRIBUTE, "true");
    this.#shadowRoot.appendChild(mountRoot);
    this.#mountRoot = mountRoot;
    setOverlayPortalContainer(mountRoot);
    this.#reactRoot = createRoot(mountRoot);

    this.#mounted = true;
    this.dispatch({ type: "setLoadingAction", loadingAction: "Connecting" });
    void this.finishMount();
  }

  destroy(): void {
    this.clearDeferredMount();
    this.clearReconnectTimer();

    this.stopStatePolling();
    this.closeWebSocket();
    this.stopHostObserver();

    this.#reactRoot?.unmount();
    this.#reactRoot = null;
    setOverlayPortalContainer(null);

    if (this.#host) {
      this.#host.remove();
      this.#host = null;
    }
    this.#mountRoot = null;

    if (this.#stylesReady && this.#shadowRoot) {
      overlayStyles.release(this.#shadowRoot);
      this.#stylesReady = false;
    }
    this.#shadowRoot = null;

    this.#mounted = false;
  }

  private deferMountUntilBodyReady(): void {
    if (this.#deferredMountCleanup) return;

    const retryMount = () => {
      if (!document.body) return;
      this.clearDeferredMount();
      this.mount();
    };

    const onDOMContentLoaded = () => retryMount();
    const onLoad = () => retryMount();

    document.addEventListener("DOMContentLoaded", onDOMContentLoaded, {
      once: true,
    });
    window.addEventListener("load", onLoad, { once: true });

    this.#deferredMountCleanup = () => {
      document.removeEventListener("DOMContentLoaded", onDOMContentLoaded);
      window.removeEventListener("load", onLoad);
    };

    // If DOMContentLoaded already fired (readyState is not 'loading'), the
    // event listeners above will never trigger. Kick off a rAF-based retry so
    // the mount still happens on the next animation frame.
    if (document.readyState !== "loading") {
      requestAnimationFrame(() => retryMount());
    }
  }

  private clearDeferredMount(): void {
    this.#deferredMountCleanup?.();
    this.#deferredMountCleanup = null;
  }

  private async finishMount(): Promise<void> {
    if (this.#shadowRoot) {
      overlayStyles.retain(this.#shadowRoot, __OVERLAY_CSS_INLINE__);
    }
    if (!this.#mounted) {
      if (this.#shadowRoot) {
        overlayStyles.release(this.#shadowRoot);
      }
      return;
    }

    this.#stylesReady = true;
    this.render();
    await this.bootstrap();
  }

  private async bootstrap(): Promise<void> {
    await this.refreshState();
    if (this.#allowWebSocket) {
      this.connectWebSocket();
    } else {
      this.#wsConnected = false;
      this.#wsFallbackMode = true;
    }
    this.startStatePolling();
    this.dispatch({ type: "bootstrapComplete" });
    if (this.#state.activeTab === "files") {
      void this.ensureFileTreeLoaded();
    }
  }

  private dispatch(action: OverlayAction): void {
    const prevState = this.#state;
    this.#state = overlayReducer(this.#state, action);

    if (action.type === "setSettings") {
      persistOverlaySettings(action.settings);
    }

    if (this.#mounted) {
      this.applyUpdate(action, prevState);
    }
  }

  private applySettings(settings: OverlaySettings): void {
    this.dispatch({ type: "setSettings", settings });
  }

  private applyUpdate(action: OverlayAction, prevState: OverlayState): void {
    switch (action.type) {
      case "setSettings": {
        // Position changes: update CSS attribute only — no Sileo re-render needed
        // because the Sileo viewport position is always fixed at "bottom-right".
        if (
          action.settings.position !== prevState.settings.position &&
          this.#mountRoot
        ) {
          this.#mountRoot.dataset.overlayPosition = action.settings.position;
        }
        // Theme changes need a full render so mount-root data-theme is refreshed.
        if (action.settings.theme !== prevState.settings.theme) {
          this.scheduleRender();
        } else {
          this.scheduleBodyUpdate();
        }
        break;
      }
      default:
        this.scheduleBodyUpdate();
        break;
    }
  }

  private scheduleRender(): void {
    if (this.#renderScheduled) return;
    this.#renderScheduled = true;
    queueMicrotask(() => {
      this.#renderScheduled = false;
      if (this.#mounted) this.render();
    });
  }

  private scheduleBodyUpdate(): void {
    if (this.#renderScheduled) return;
    queueMicrotask(() => {
      if (this.#mounted && !this.#renderScheduled) this.updatePanel();
    });
  }

  /** Re-render OverlayPanel into the existing sileo toast (no dismiss/re-show). */
  private updatePanel(): void {
    this.#panelStore.setSnapshot(this.buildPanelProps());
  }

  private buildPanelProps(): OverlayPanelProps {
    return {
      state: this.#state,
      wsConnected: this.#wsConnected,
      wsOpenedAt: this.#wsOpenedAt,
      wsFallbackMode: this.#wsFallbackMode,
      wsConsecutiveFailures: this.#wsConsecutiveFailures,
      onDispatch: this.dispatch.bind(this),
      onStart: () => void this.handleStart(),
      onStop: () => void this.handleStop(),
      onRestart: () => void this.handleRestart(),
      onLoadFileMetadata: (path) => void this.loadFileMetadata(path),
      onOpenFile: (path) => void this.openFile(path),
      onEnsureFileTreeLoaded: () => void this.ensureFileTreeLoaded(),
    };
  }

  // ── Runtime actions ────────────────────────────────────────────────────────

  private async runRuntimeAction(
    loadingLabel: string,
    fn: () => Promise<unknown>,
    fallbackMessage: string,
  ): Promise<void> {
    this.dispatch({ type: "setLoadingAction", loadingAction: loadingLabel });
    try {
      await fn();
      this.dispatch({ type: "markSuccess" });
      await this.refreshState();
    } catch (err) {
      const message = err instanceof Error ? err.message : fallbackMessage;
      this.dispatch({ type: "setError", errorMessage: message });
    }
  }

  private handleStart(): Promise<void> {
    return this.runRuntimeAction(
      "Starting",
      () => this.#api.startRuntime(),
      "Start failed",
    );
  }

  private handleRestart(): Promise<void> {
    return this.runRuntimeAction(
      "Restarting",
      () => this.#api.restartRuntime(),
      "Restart failed",
    );
  }

  private handleStop(): Promise<void> {
    return this.runRuntimeAction(
      "Stopping",
      () => this.#api.stopRuntime(),
      "Stop failed",
    );
  }

  // ── File tree ──────────────────────────────────────────────────────────────

  private async ensureFileTreeLoaded(): Promise<void> {
    if (this.#state.fileTree.length > 0) return;
    this.dispatch({ type: "setTreeLoading", treeLoading: true });
    try {
      const tree = await this.#api.getFileTree();
      this.dispatch({ type: "setFileTree", fileTree: tree });
    } catch {
      this.dispatch({ type: "setTreeLoading", treeLoading: false });
    }
  }

  private async loadFileMetadata(path: string): Promise<void> {
    this.dispatch({ type: "setFileMetadataLoading", loading: true });
    try {
      const meta = await this.#api.getFileMetadata(path);
      if (this.#state.selectedFilePath === path) {
        this.dispatch({ type: "setFileMetadata", metadata: meta });
      }
    } catch {
      this.dispatch({ type: "setFileMetadata", metadata: null });
    }
  }

  private async openFile(path: string): Promise<void> {
    try {
      await this.#api.openFile(path);
    } catch {
      // Best-effort: opening files in editor is non-critical.
    }
  }

  // ── State refresh ──────────────────────────────────────────────────────────

  private async refreshState(): Promise<void> {
    try {
      const bridgeState = await this.runWithBaseUrlFallback(
        () => this.#api.getBridgeState(),
        true,
      );

      const nextTransport = resolveBridgeTransportState(
        this.#state.transportState,
        bridgeState,
      );

      this.dispatch({ type: "setBridgeState", bridgeState });
      this.dispatch({
        type: "setTransportState",
        transportState: nextTransport,
      });
      this.dispatch({ type: "markSuccess" });

      const nextConnected = nextTransport === "connected";
      if (this.#state.connected !== nextConnected) {
        this.dispatch({ type: "setConnected", connected: nextConnected });
      }
      if (this.#state.loadingAction === "Connecting") {
        this.dispatch({ type: "setLoadingAction", loadingAction: null });
      }
      this.#runtimeRefreshFailures = 0;
    } catch {
      this.#runtimeRefreshFailures += 1;
      const nextTransport = resolveFailureTransportState(
        this.#state.transportState,
        this.#runtimeRefreshFailures,
      );
      const retainConnected = shouldRetainConnectedStateOnFailure(
        this.#state.connected,
        this.#runtimeRefreshFailures,
      );
      this.dispatch({
        type: "setTransportState",
        transportState: nextTransport,
      });
      if (!retainConnected && this.#state.connected) {
        this.dispatch({ type: "setConnected", connected: false });
      }
    }
  }

  private applyRuntimeStatusEvent(event: RuntimeStatusEvent): void {
    if (!this.#state.bridgeState) {
      void this.refreshState();
      return;
    }

    const nextTransport = resolveRuntimeEventTransportState(
      this.#state.transportState,
      event.status.phase,
    );
    const nextBridgeState = {
      ...this.#state.bridgeState,
      transportState: nextTransport,
      runtime: event.status,
    };

    this.dispatch({ type: "setBridgeState", bridgeState: nextBridgeState });
    this.dispatch({ type: "setTransportState", transportState: nextTransport });
    if (!this.#state.connected) {
      this.dispatch({ type: "setConnected", connected: true });
    }
    this.dispatch({ type: "markSuccess", at: event.timestamp });
    if (this.#state.loadingAction === "Connecting") {
      this.dispatch({ type: "setLoadingAction", loadingAction: null });
    }
    this.#runtimeRefreshFailures = 0;
  }

  private applyRuntimeErrorEvent(event: RuntimeErrorEvent): void {
    const nextTransport =
      this.#state.transportState === "runtime_starting"
        ? "runtime_starting"
        : "connected";
    if (this.#state.bridgeState) {
      this.dispatch({
        type: "setBridgeState",
        bridgeState: {
          ...this.#state.bridgeState,
          transportState: nextTransport,
        },
      });
    }
    this.dispatch({ type: "setTransportState", transportState: nextTransport });
    if (!this.#state.connected) {
      this.dispatch({ type: "setConnected", connected: true });
    }
    this.dispatch({ type: "markSuccess", at: event.timestamp });
    this.dispatch({ type: "setError", errorMessage: event.error });
    this.#runtimeRefreshFailures = 0;
  }

  private handleWebSocketMessage(message: unknown): void {
    this.#wsConsecutiveFailures = 0;

    if (isRuntimeStatusEvent(message)) {
      this.applyRuntimeStatusEvent(message);
      return;
    }
    if (isRuntimeErrorEvent(message)) {
      this.applyRuntimeErrorEvent(message);
    }
  }

  // ── WebSocket ──────────────────────────────────────────────────────────────

  private connectWebSocket(): void {
    if (!this.#allowWebSocket) return;
    const connectionVersion = ++this.#wsConnectionVersion;
    this.#wsBinding?.close();
    this.#wsBinding = null;
    this.clearReconnectTimer();

    try {
      this.#wsBinding = createWebSocketBinding(this.#baseUrl, {
        onOpen: () => {
          if (connectionVersion !== this.#wsConnectionVersion) return;
          this.#wsConsecutiveFailures = 0;
          this.#wsConnected = true;
          this.#wsFallbackMode = false;
          this.#wsOpenedAt = Date.now();
          this.scheduleBodyUpdate();
          void this.refreshState();
        },
        onClose: () => {
          if (connectionVersion !== this.#wsConnectionVersion) return;
          this.#wsConnected = false;
          this.#wsConsecutiveFailures += 1;
          this.#wsFallbackMode = true;
          this.scheduleBodyUpdate();
          this.scheduleReconnect();
        },
        onError: () => {
          if (connectionVersion !== this.#wsConnectionVersion) return;
          this.#wsConnected = false;
          this.#wsConsecutiveFailures += 1;
          this.#wsFallbackMode = true;
          this.scheduleBodyUpdate();
          this.scheduleReconnect();
        },
        onMessage: (message) => {
          if (connectionVersion !== this.#wsConnectionVersion) return;
          this.handleWebSocketMessage(message);
        },
      });
    } catch {
      this.scheduleReconnect();
    }
  }

  private closeWebSocket(): void {
    this.#wsConnectionVersion += 1;
    this.#wsBinding?.close();
    this.#wsBinding = null;
    this.#wsConnected = false;
    this.#wsFallbackMode = true;
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      if (this.#mounted) this.connectWebSocket();
    }, WS_RECONNECT_DELAY_MS);
  }

  private clearReconnectTimer(): void {
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
  }

  // ── State polling ──────────────────────────────────────────────────────────

  private startStatePolling(): void {
    this.stopStatePolling();
    this.#statePollTimer = setInterval(() => {
      if (this.#allowWebSocket && this.#wsConnected) {
        return;
      }
      void this.refreshState();
    }, STATE_POLL_INTERVAL_MS);
  }

  private stopStatePolling(): void {
    if (this.#statePollTimer) {
      clearInterval(this.#statePollTimer);
      this.#statePollTimer = null;
    }
  }

  // ── Host observer (HMR cleanup) ────────────────────────────────────────────

  private startHostObserver(): void {
    if (!this.#host) return;
    this.stopHostObserver();
    this.#hostObserver = new MutationObserver(() => {
      if (this.#host && !document.body.contains(this.#host)) {
        this.destroy();
      }
    });
    this.#hostObserver.observe(document.body, {
      childList: true,
      subtree: false,
    });
  }

  private stopHostObserver(): void {
    if (this.#hostObserver) {
      this.#hostObserver.disconnect();
      this.#hostObserver = null;
    }
  }

  // ── Base URL fallback ──────────────────────────────────────────────────────

  private setActiveBaseUrl(baseUrl: string): void {
    if (this.#baseUrl === baseUrl) return;
    this.#baseUrl = baseUrl;
    this.#api = createExampleApi(this.#baseUrl);
  }

  private rotateBaseUrlCandidate(): void {
    if (this.#baseUrlCandidates.length < 2) return;
    this.#baseUrlCandidateIndex =
      (this.#baseUrlCandidateIndex + 1) % this.#baseUrlCandidates.length;
    const nextBaseUrl = this.#baseUrlCandidates[this.#baseUrlCandidateIndex];
    if (!nextBaseUrl) return;
    this.setActiveBaseUrl(nextBaseUrl);
  }

  private async runWithBaseUrlFallback<T>(
    task: () => Promise<T>,
    rotateBeforeRetry: boolean,
  ): Promise<T> {
    const totalCandidates = this.#baseUrlCandidates.length;
    if (totalCandidates <= 1) return task();

    try {
      return await task();
    } catch (firstErr) {
      for (let i = 1; i < totalCandidates; i += 1) {
        if (rotateBeforeRetry) this.rotateBaseUrlCandidate();
        try {
          return await task();
        } catch {
          // try next candidate
        }
      }
      throw firstErr;
    }
  }

  // ── Main render ────────────────────────────────────────────────────────────

  private render(): void {
    if (!this.#mounted || !this.#shadowRoot) return;

    const theme = normalizeTheme(this.#state.settings.theme);
    const autoExpand = this.#state.settings.autoExpand;
    if (this.#mountRoot) {
      this.#mountRoot.dataset.theme = theme;
      this.#mountRoot.dataset.overlayPosition = this.#state.settings.position;
    }
    this.#panelStore.setSnapshot(this.buildPanelProps());

    this.#reactRoot?.render(
      createReactElement(OverlayRoot, {
        autoExpand,
        store: this.#panelStore,
        theme,
        shadowRoot: this.#shadowRoot,
      }),
    );
  }
}
