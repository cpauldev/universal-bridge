import { describe, expect, it } from "bun:test";

import {
  type FastifyLikeInstance,
  attachUniversalToFastify,
} from "../adapters/server/fastify.js";

type HookHandler = (...args: unknown[]) => void;

function createFastifyFixture(): {
  fastify: FastifyLikeInstance;
  getHook: (name: "onRequest" | "onClose") => HookHandler | undefined;
} {
  const hooks: Record<"onRequest" | "onClose", HookHandler | undefined> = {
    onRequest: undefined,
    onClose: undefined,
  };

  return {
    fastify: {
      addHook: (name: string, hook: HookHandler) => {
        hooks[name as "onRequest" | "onClose"] = hook;
      },
    } as FastifyLikeInstance,
    getHook: (name) => hooks[name],
  };
}

describe("fastify adapter", () => {
  it("registers request/close hooks and forwards non-bridge routes", async () => {
    const fixture = createFastifyFixture();
    const handle = await attachUniversalToFastify(fixture.fastify, {
      autoStart: false,
      runtimeWebSocketGateway: { path: "/ws" },
    });
    expect(
      handle.bridge.getState().capabilities.hasRuntimeWebSocketGateway,
    ).toBe(false);

    const onRequest = fixture.getHook("onRequest");
    const onClose = fixture.getHook("onClose");
    expect(typeof onRequest).toBe("function");
    expect(typeof onClose).toBe("function");

    let doneCalled = false;
    onRequest?.(
      {
        raw: {
          url: "/not-universal-bridge",
          method: "GET",
        },
      },
      {
        raw: {
          writableEnded: false,
        },
      },
      () => {
        doneCalled = true;
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(doneCalled).toBe(true);

    await new Promise<void>((resolve, reject) => {
      onClose?.({}, (error?: Error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    await handle.close();
  });
});
