import { describe, expect, it } from "bun:test";
import { Readable } from "stream";

import {
  type ExpressLikeApp,
  type ExpressUniversalMiddleware,
  attachUniversalToExpress,
  createUniversalExpressMiddleware,
} from "../adapters/server/express.js";

function createExpressFixture(): {
  app: ExpressLikeApp;
  middlewares: ExpressUniversalMiddleware[];
} {
  const middlewares: ExpressUniversalMiddleware[] = [];
  return {
    app: {
      use: (middleware) => {
        middlewares.push(middleware);
      },
    },
    middlewares,
  };
}

function createRequest(path: string) {
  return Object.assign(Readable.from([]), {
    method: "GET",
    url: path,
    headers: {},
  });
}

function createResponse() {
  const headers = new Map<string, string | number | readonly string[]>();
  let body = "";
  return {
    res: {
      statusCode: 200,
      writableEnded: false,
      setHeader(name: string, value: string | number | readonly string[]) {
        headers.set(name.toLowerCase(), value);
      },
      getHeader(name: string) {
        return headers.get(name.toLowerCase());
      },
      writeHead(
        statusCode: number,
        values: Record<string, string | number | readonly string[]>,
      ) {
        this.statusCode = statusCode;
        for (const [name, value] of Object.entries(values)) {
          headers.set(name.toLowerCase(), value);
        }
      },
      write(chunk: unknown) {
        body += String(chunk);
      },
      end(chunk?: unknown) {
        if (chunk !== undefined) body += String(chunk);
        this.writableEnded = true;
      },
    },
    getBody: () => body,
  };
}

async function runMiddleware(
  middleware: ExpressUniversalMiddleware,
  path: string,
): Promise<{ nextCalled: boolean; statusCode: number; body: string }> {
  const req = createRequest(path);
  const { res, getBody } = createResponse();
  let nextCalled = false;

  middleware(req as never, res as never, () => {
    nextCalled = true;
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  return {
    nextCalled,
    statusCode: res.statusCode,
    body: getBody(),
  };
}

async function runMiddlewareStack(
  middlewares: ExpressUniversalMiddleware[],
  path: string,
): Promise<string[]> {
  const order: string[] = [];
  const req = createRequest(path);
  const { res } = createResponse();
  let index = 0;

  const next = () => {
    const middleware = middlewares[index++];
    if (!middleware) {
      order.push("final");
      return;
    }

    middleware(req as never, res as never, next);
  };

  next();
  await new Promise((resolve) => setTimeout(resolve, 0));

  return order;
}

describe("express adapter", () => {
  it("registers middleware and closes the bridge", async () => {
    const fixture = createExpressFixture();
    const handle = await attachUniversalToExpress(fixture.app, {
      autoStart: false,
    });

    expect(fixture.middlewares).toHaveLength(1);
    expect(handle.bridge).toBeDefined();

    await handle.close();
    expect(handle.bridge.isClosed()).toBe(true);
  });

  it("serves health and state through express middleware", async () => {
    const fixture = createExpressFixture();
    const handle = await attachUniversalToExpress(fixture.app, {
      autoStart: false,
    });
    const middleware = fixture.middlewares[0];
    if (!middleware) throw new Error("Expected express middleware");

    const health = await runMiddleware(middleware, "/__universal/health");
    expect(health.nextCalled).toBe(false);
    expect(health.statusCode).toBe(200);
    expect(JSON.parse(health.body)).toMatchObject({
      ok: true,
      bridge: true,
    });

    const state = await runMiddleware(middleware, "/__universal/state");
    expect(state.nextCalled).toBe(false);
    expect(state.statusCode).toBe(200);
    expect(JSON.parse(state.body)).toMatchObject({
      transportState: "bridge_detecting",
      capabilities: {
        hasRuntimeWebSocketGateway: false,
      },
    });

    await handle.close();
  });

  it("falls through for non-bridge requests", async () => {
    const middleware = createUniversalExpressMiddleware({ autoStart: false });

    const result = await runMiddleware(middleware, "/not-universal");
    expect(result.nextCalled).toBe(true);
    expect(result.body).toBe("");
  });

  it("preserves express middleware ordering", async () => {
    const bridge = createUniversalExpressMiddleware({ autoStart: false });
    const before: ExpressUniversalMiddleware = (_req, _res, next) => {
      observedOrder.push("before");
      next();
    };
    const after: ExpressUniversalMiddleware = (_req, _res, next) => {
      observedOrder.push("after");
      next();
    };
    const observedOrder: string[] = [];

    const finalOrder = await runMiddlewareStack(
      [before, bridge, after],
      "/not-universal",
    );

    expect(observedOrder).toEqual(["before", "after"]);
    expect(finalOrder).toEqual(["final"]);
  });
});
