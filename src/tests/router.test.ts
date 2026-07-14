import { describe, expect, it } from "bun:test";

import {
  createRouteKey,
  isBridgeWebSocketUpgradePath,
  matchBridgeRoute,
} from "../bridge/router.js";

function createRequest(
  method: string,
  url: string,
): import("http").IncomingMessage {
  return {
    method,
    url,
  } as import("http").IncomingMessage;
}

describe("bridge router", () => {
  it("matches bridge endpoints with and without query strings", () => {
    const prefix = "/__universal";
    const cases = [
      { method: "GET", url: "/__universal/health", key: "GET /health" },
      {
        method: "GET",
        url: "/__universal/health?source=ui",
        key: "GET /health",
      },
      { method: "GET", url: "/__universal/state", key: "GET /state" },
      {
        method: "GET",
        url: "/__universal/state?source=ui",
        key: "GET /state",
      },
      {
        method: "GET",
        url: "/__universal/runtime/status?check=1",
        key: "GET /runtime/status",
      },
      {
        method: "POST",
        url: "/__universal/runtime/start?manual=true",
        key: "POST /runtime/start",
      },
      {
        method: "POST",
        url: "/__universal/runtime/restart?manual=true",
        key: "POST /runtime/restart",
      },
      {
        method: "POST",
        url: "/__universal/runtime/stop?manual=true",
        key: "POST /runtime/stop",
      },
      {
        method: "GET",
        url: "/__universal/api/version?debug=true",
        key: "GET /api/version",
      },
    ];

    for (const testCase of cases) {
      const match = matchBridgeRoute(
        createRequest(testCase.method, testCase.url),
        prefix,
      );
      expect(match).not.toBeNull();
      if (!match) {
        continue;
      }
      expect(createRouteKey(match.method, match.routePath)).toBe(testCase.key);
    }
  });

  it("returns null for non-bridge paths", () => {
    const match = matchBridgeRoute(
      createRequest("GET", "/api/version"),
      "/__universal",
    );
    expect(match).toBeNull();
  });

  it("recognizes both bridge WebSocket upgrade routes", () => {
    expect(
      isBridgeWebSocketUpgradePath(
        "/__universal/events?source=ui",
        "/__universal",
      ),
    ).toBe(true);
    expect(
      isBridgeWebSocketUpgradePath(
        "/__universal/runtime/ws?session=ui",
        "/__universal",
      ),
    ).toBe(true);
    expect(
      isBridgeWebSocketUpgradePath(
        "/__universal/runtime/other",
        "/__universal",
      ),
    ).toBe(false);
  });
});
