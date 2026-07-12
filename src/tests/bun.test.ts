import { describe, expect, it } from "bun:test";

import { attachUniversalToBunServe } from "../adapters/server/bun.js";

describe("bun adapter", () => {
  it("proxies bridge routes and falls through for non-bridge routes", async () => {
    const handle = await attachUniversalToBunServe({ autoStart: false });
    const server = {
      upgrade: () => false,
    };
    const fetchHandler = handle.createFetchHandler(async () => {
      return new Response("app");
    });

    const appResponse = await fetchHandler(
      new Request("http://localhost:3000/app"),
      server,
    );
    expect(appResponse).toBeDefined();
    expect(await appResponse?.text()).toBe("app");

    const healthResponse = await fetchHandler(
      new Request("http://localhost:3000/__universal/health"),
      server,
    );
    expect(healthResponse).toBeDefined();
    expect(healthResponse?.status).toBe(200);
    const healthJson = await healthResponse?.json();
    expect(healthJson.ok).toBe(true);
    expect(healthJson.bridge).toBe(true);

    await handle.close();
  });

  it("upgrades websocket requests for bridge events route", async () => {
    const handle = await attachUniversalToBunServe({ autoStart: false });
    const upgrades: unknown[] = [];
    const server = {
      upgrade: (_request: Request, options?: { data?: unknown }) => {
        upgrades.push(options?.data);
        return true;
      },
    };
    const fetchHandler = handle.createFetchHandler(async () => {
      return new Response("app");
    });

    const upgradeResponse = await fetchHandler(
      new Request("http://localhost:3000/__universal/events?source=ui", {
        headers: {
          upgrade: "websocket",
        },
      }),
      server,
    );

    expect(upgradeResponse).toBeUndefined();
    expect(upgrades.length).toBe(1);
    const upgradeData = upgrades[0] as {
      __universal: { upstreamUrl: string };
    };
    expect(upgradeData.__universal.upstreamUrl).toBe(
      `${handle.baseUrl.replace("http://", "ws://")}/__universal/events?source=ui`,
    );

    await handle.close();
  });

  it("delegates websocket handlers for non-universal-bridge sockets", async () => {
    const handle = await attachUniversalToBunServe({ autoStart: false });
    const calls = {
      open: 0,
      message: 0,
      close: 0,
      error: 0,
    };
    const handlers = handle.createWebSocketHandlers({
      open: () => {
        calls.open += 1;
      },
      message: () => {
        calls.message += 1;
      },
      close: () => {
        calls.close += 1;
      },
      error: () => {
        calls.error += 1;
      },
    });

    const socket = {
      data: {},
      send: () => {},
      close: () => {},
    };

    handlers.open?.(socket);
    handlers.message?.(socket, "ping");
    handlers.close?.(socket, 1000, "done");
    handlers.error?.(socket, new Error("oops"));

    expect(calls).toEqual({
      open: 1,
      message: 1,
      close: 1,
      error: 1,
    });

    await handle.close();
  });
});
