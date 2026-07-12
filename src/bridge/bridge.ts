import type { IncomingMessage, ServerResponse } from "http";
import type { Duplex } from "stream";
import { WebSocketServer } from "ws";

import { RuntimeHelper } from "../runtime/runtime-helper.js";
import type {
  UniversalBridgeCapabilities,
  UniversalBridgeInstance,
  UniversalBridgeState,
} from "../types.js";
import {
  UNIVERSAL_PROTOCOL_VERSION,
  UNIVERSAL_WS_SUBPROTOCOL,
} from "./constants.js";
import {
  createRuntimeControlContext,
  createRuntimeProxyContext,
} from "./contexts.js";
import { writeBridgeError } from "./errors.js";
import { BridgeEventBus } from "./events.js";
import { writeJson } from "./http.js";
import {
  type ResolvedBridgeOptions,
  type UniversalBridgeOptions,
  resolveBridgeOptions,
} from "./options.js";
import { proxyToRuntime, proxyToRuntimeRaw } from "./proxy.js";
import { createRouteKey, matchBridgeRoute } from "./router.js";
import {
  handleRuntimeControlRoute,
  handleRuntimeStatusRoute,
  handleStateRoute,
} from "./runtime-control.js";
import type { BridgeMiddlewareServer } from "./server-types.js";
import { createCapabilities, toTransportState } from "./state.js";
import { handleBridgeUpgrade } from "./ws.js";

function normalizeBridgeInstance(
  instance: UniversalBridgeOptions["instance"],
): UniversalBridgeInstance | undefined {
  if (!instance) return undefined;

  const id = instance.id.trim();
  if (!id) return undefined;

  const label = instance.label?.trim();
  return {
    id,
    ...(label ? { label } : {}),
  };
}

export class UniversalBridge {
  #options: ResolvedBridgeOptions;
  #helper: RuntimeHelper;
  #capabilities: UniversalBridgeCapabilities;
  #instance: UniversalBridgeInstance | undefined;
  #wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    handleProtocols: (protocols) => {
      return protocols.has(UNIVERSAL_WS_SUBPROTOCOL)
        ? UNIVERSAL_WS_SUBPROTOCOL
        : false;
    },
  });
  #eventBus: BridgeEventBus;
  #closed = false;
  #autoStartEnabled = true;

  constructor(options: UniversalBridgeOptions = {}) {
    this.#options = resolveBridgeOptions(options);
    this.#helper = new RuntimeHelper(this.#options);
    this.#instance = normalizeBridgeInstance(this.#options.instance);
    const support = this.#helper.getControlSupport();
    this.#capabilities = createCapabilities(
      this.#options.fallbackCommand,
      support.hasRuntimeControl,
      support.hasRuntimeControl
        ? this.#options.fallbackCommand.trim()
          ? "hybrid"
          : "helper"
        : "host",
    );
    this.#autoStartEnabled = this.#options.autoStart;
    this.#eventBus = new BridgeEventBus(this.#options.eventHeartbeatIntervalMs);
    this.#eventBus.attachToWebSocketServer(this.#wss);
    this.#helper.onStatusChange((status) =>
      this.#eventBus.emitRuntimeStatus(status),
    );
  }

  getBridgePathPrefix(): string {
    return this.#options.bridgePathPrefix;
  }

  getState(): UniversalBridgeState {
    const runtime = this.#helper.getStatus();
    return {
      protocolVersion: UNIVERSAL_PROTOCOL_VERSION,
      transportState: toTransportState(runtime),
      runtime,
      capabilities: this.#capabilities,
      ...(this.#instance ? { instance: this.#instance } : {}),
      ...(runtime.lastError ? { error: runtime.lastError } : {}),
    };
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#helper.stop();
    this.#eventBus.close();
    this.#wss.close();
  }

  isClosed(): boolean {
    return this.#closed;
  }

  async attach(server: BridgeMiddlewareServer): Promise<void> {
    server.middlewares.use((req, res, next) => {
      void this.handleHttpRequest(req, res, next).catch((error) => {
        next?.(error);
      });
    });

    server.httpServer?.on("upgrade", (...args: unknown[]) => {
      const [req, socket, head] = args as [IncomingMessage, unknown, Buffer];
      this.handleUpgrade(req, socket as Duplex, head);
    });

    server.httpServer?.on("close", () => {
      this.close().catch(() => {});
    });
  }
  async attachVite(server: BridgeMiddlewareServer): Promise<void> {
    await this.attach(server);
  }

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    handleBridgeUpgrade(req, socket, head, {
      bridgePathPrefix: this.#options.bridgePathPrefix,
      wss: this.#wss,
      eventBus: this.#eventBus,
      shouldAutoStartRuntime: () => this.shouldAutoStartRuntime(),
      shouldProxyRuntimeWebSocket: () => this.#options.proxyRuntimeWebSocket,
      ensureRuntimeStarted: () => this.#helper.ensureStarted(),
      getRuntimeUrl: () => this.#helper.getRuntimeUrl(),
      getRuntimeStatus: () => this.#helper.getStatus(),
    });
  }

  async handleHttpRequest(
    req: IncomingMessage,
    res: ServerResponse,
    next?: (error?: unknown) => void,
  ): Promise<void> {
    const url = req.url ?? "/";
    const urlPath = url.split("?")[0];
    for (const prefix of this.#options.additionalProxyPaths ?? []) {
      if (urlPath === prefix || urlPath.startsWith(prefix + "/")) {
        await proxyToRuntimeRaw(req, res, url, this.getProxyContext());
        return;
      }
    }

    const match = matchBridgeRoute(req, this.#options.bridgePathPrefix);
    if (!match) {
      next?.();
      return;
    }

    const routeKey = createRouteKey(match.method, match.routePath);
    if (routeKey === "GET /health") {
      writeJson(
        res,
        200,
        { ok: true, bridge: true, ...this.getState() },
        {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      );
      return;
    }

    if (routeKey === "GET /state") {
      await handleStateRoute(res, this.getRuntimeControlContext());
      return;
    }

    if (routeKey === "GET /runtime/status") {
      handleRuntimeStatusRoute(res, this.getRuntimeControlContext());
      return;
    }

    if (match.routePath.startsWith("/api")) {
      await proxyToRuntime(
        req,
        res,
        match.routeWithSearch.slice("/api".length),
        this.getProxyContext(),
      );
      return;
    }

    if (
      await handleRuntimeControlRoute(
        match.method,
        match.routePath,
        res,
        this.getRuntimeControlContext(),
      )
    ) {
      return;
    }

    writeBridgeError(
      res,
      404,
      "route_not_found",
      `Unknown universal-bridge bridge route: ${match.routeWithSearch}`,
      {
        details: {
          route: match.routeWithSearch,
          method: match.method,
        },
      },
    );
  }

  private shouldAutoStartRuntime(): boolean {
    return (
      this.#options.autoStart &&
      this.#autoStartEnabled &&
      this.#capabilities.canStartRuntime
    );
  }

  private getBridgeContextOptions() {
    return {
      shouldAutoStartRuntime: () => this.shouldAutoStartRuntime(),
      hasRuntimeControl: () => this.#capabilities.hasRuntimeControl,
      fallbackCommand: this.#options.fallbackCommand,
      getState: () => this.getState(),
      getRuntimeStatus: () => this.#helper.getStatus(),
      startRuntime: () => this.#helper.start(),
      restartRuntime: () => this.#helper.restart(),
      stopRuntime: () => this.#helper.stop(),
      ensureRuntimeStarted: () => this.#helper.ensureStarted(),
      getRuntimeUrl: () => this.#helper.getRuntimeUrl(),
      enableAutoStartRuntime: () => {
        this.#autoStartEnabled = true;
      },
      disableAutoStartRuntime: () => {
        this.#autoStartEnabled = false;
      },
      emitRuntimeError: (error: string) =>
        this.#eventBus.emitRuntimeError(error),
      writeBridgeError,
    };
  }
  private getRuntimeControlContext() {
    return createRuntimeControlContext(this.getBridgeContextOptions());
  }
  private getProxyContext() {
    return createRuntimeProxyContext(this.getBridgeContextOptions());
  }
}
export async function createUniversalBridge(
  options: UniversalBridgeOptions = {},
): Promise<UniversalBridge> {
  return new UniversalBridge(options);
}
export type { UniversalBridgeOptions } from "./options.js";
