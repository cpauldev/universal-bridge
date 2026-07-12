import type { IncomingMessage, ServerResponse } from "http";

import {
  type UniversalBridge,
  createUniversalBridge,
} from "../../bridge/bridge.js";
import {
  type UniversalAdapterOptions,
  resolveAdapterOptions,
} from "../shared/adapter-utils.js";

type FastifyDone = (error?: Error) => void;

export interface FastifyLikeRequest {
  raw: IncomingMessage;
}

export interface FastifyLikeReply {
  raw: ServerResponse;
}

export interface FastifyLikeInstance {
  addHook(
    name: "onRequest",
    hook: (
      request: FastifyLikeRequest,
      reply: FastifyLikeReply,
      done: FastifyDone,
    ) => void,
  ): void;
  addHook(
    name: "onClose",
    hook: (instance: unknown, done: FastifyDone) => void,
  ): void;
}

export interface FastifyBridgeHandle {
  bridge: UniversalBridge;
  close: () => Promise<void>;
}

export type FastifyUniversalOptions = UniversalAdapterOptions;

function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  return new Error(String(value));
}

export async function attachUniversalToFastify(
  fastify: FastifyLikeInstance,
  options: FastifyUniversalOptions = {},
): Promise<FastifyBridgeHandle> {
  const bridge = await createUniversalBridge(resolveAdapterOptions(options));

  fastify.addHook(
    "onRequest",
    (
      request: FastifyLikeRequest,
      reply: FastifyLikeReply,
      done: FastifyDone,
    ) => {
      void bridge
        .handleHttpRequest(request.raw, reply.raw, (error) =>
          done(error ? toError(error) : undefined),
        )
        .catch((error) => {
          if (!reply.raw.writableEnded) {
            done(toError(error));
          }
        });
    },
  );

  fastify.addHook("onClose", (_instance: unknown, done: FastifyDone) => {
    void bridge
      .close()
      .then(() => done())
      .catch((error) => done(toError(error)));
  });

  return {
    bridge,
    close: async () => {
      await bridge.close();
    },
  };
}
