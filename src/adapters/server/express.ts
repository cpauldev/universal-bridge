import type { IncomingMessage, ServerResponse } from "http";

import {
  type UniversalBridge,
  createUniversalBridge,
} from "../../bridge/bridge.js";
import {
  type UniversalAdapterOptions,
  resolveBridgeOptionsFromAdapterOptions,
} from "../shared/adapter-utils.js";

export type ExpressUniversalOptions = UniversalAdapterOptions;

export type ExpressNextFunction = (error?: unknown) => void;

export type ExpressUniversalMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: ExpressNextFunction,
) => void;

export interface ExpressLikeApp {
  use(middleware: ExpressUniversalMiddleware): void;
}

export interface ExpressBridgeHandle {
  bridge: UniversalBridge;
  close: () => Promise<void>;
}

function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  return new Error(String(value));
}

function createMiddlewareForBridge(
  bridge: UniversalBridge,
): ExpressUniversalMiddleware {
  return (req, res, next) => {
    void bridge
      .handleHttpRequest(req, res, next)
      .catch((error) => next(toError(error)));
  };
}

export function createUniversalExpressMiddleware(
  options: ExpressUniversalOptions = {},
): ExpressUniversalMiddleware {
  let bridgePromise: Promise<UniversalBridge> | null = null;

  return (req, res, next) => {
    bridgePromise ??= createUniversalBridge(
      resolveBridgeOptionsFromAdapterOptions({
        ...options,
        runtimeWebSocketGatewaySupported: false,
      }),
    );

    void bridgePromise
      .then((bridge) => bridge.handleHttpRequest(req, res, next))
      .catch((error) => next(toError(error)));
  };
}

export async function attachUniversalToExpress(
  app: ExpressLikeApp,
  options: ExpressUniversalOptions = {},
): Promise<ExpressBridgeHandle> {
  const bridge = await createUniversalBridge(
    resolveBridgeOptionsFromAdapterOptions({
      ...options,
      runtimeWebSocketGatewaySupported: false,
    }),
  );
  app.use(createMiddlewareForBridge(bridge));

  return {
    bridge,
    close: async () => {
      await bridge.close();
    },
  };
}
