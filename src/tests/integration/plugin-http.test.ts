import { afterEach, describe, expect, it } from "bun:test";
import { type IncomingMessage, type ServerResponse, createServer } from "http";

import { createUniversalVitePlugin } from "../../adapters/shared/plugin.js";

type MiddlewareHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (error?: unknown) => void,
) => void;

interface ViteLikeHarness {
  baseUrl: string;
  close: () => Promise<void>;
  server: {
    middlewares: {
      use: (fn: MiddlewareHandler) => void;
    };
    httpServer: ReturnType<typeof createServer>;
  };
}

async function createViteLikeHarness(): Promise<ViteLikeHarness> {
  let middleware: MiddlewareHandler | null = null;
  const httpServer = createServer((req, res) => {
    if (!middleware) {
      res.statusCode = 404;
      res.end("No middleware");
      return;
    }

    middleware(req, res, () => {
      if (!res.writableEnded) {
        res.statusCode = 404;
        res.end("Not found");
      }
    });
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(0, "127.0.0.1", () => resolve());
  });

  const address = httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve harness port");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
    server: {
      middlewares: {
        use: (fn) => {
          middleware = fn;
        },
      },
      httpServer,
    },
  };
}

const harnesses = new Set<ViteLikeHarness>();

afterEach(async () => {
  await Promise.all(
    [...harnesses].map(async (harness) => {
      await harness.close();
    }),
  );
  harnesses.clear();
});

describe("plugin integration", () => {
  it("serves bridge health route after plugin setup", async () => {
    const harness = await createViteLikeHarness();
    harnesses.add(harness);

    const plugin = createUniversalVitePlugin({ autoStart: false });
    const pluginObject = Array.isArray(plugin) ? plugin[0] : plugin;
    await pluginObject?.configureServer?.(harness.server as never);

    const response = await fetch(`${harness.baseUrl}/__universal/health`);
    expect(response.ok).toBe(true);
    const payload = (await response.json()) as {
      ok: boolean;
      bridge: boolean;
      protocolVersion: string;
      capabilities: {
        wsSubprotocol: string;
      };
    };
    expect(payload.ok).toBe(true);
    expect(payload.bridge).toBe(true);
    expect(payload.protocolVersion).toBe("1");
    expect(payload.capabilities.wsSubprotocol).toBe("universal.v1+json");
  });
});
