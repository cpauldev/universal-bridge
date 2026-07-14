import type { IncomingMessage } from "http";
import { URL } from "url";

import { EVENTS_PATH, RUNTIME_WEBSOCKET_PATH } from "./constants.js";

export interface BridgeRouteMatch {
  method: string;
  routePath: string;
  routeWithSearch: string;
}

export function createRouteKey(method: string, routePath: string): string {
  return `${method} ${routePath}`;
}

function isBridgePath(pathname: string, bridgePathPrefix: string): boolean {
  return (
    pathname === bridgePathPrefix || pathname.startsWith(`${bridgePathPrefix}/`)
  );
}

export function matchBridgeRoute(
  req: IncomingMessage,
  bridgePathPrefix: string,
): BridgeRouteMatch | null {
  const parsedRequestUrl = new URL(
    req.url || "/",
    "http://universal-bridge.local",
  );
  if (!isBridgePath(parsedRequestUrl.pathname, bridgePathPrefix)) {
    return null;
  }

  const routePath =
    parsedRequestUrl.pathname === bridgePathPrefix
      ? "/"
      : parsedRequestUrl.pathname.slice(bridgePathPrefix.length);

  return {
    method: req.method || "GET",
    routePath,
    routeWithSearch: `${routePath}${parsedRequestUrl.search}`,
  };
}

export function isEventsUpgradePath(
  requestUrl: string,
  bridgePathPrefix: string,
): boolean {
  const eventsPath = `${bridgePathPrefix}${EVENTS_PATH}`;
  const parsed = new URL(requestUrl, "http://universal-bridge.local");
  return parsed.pathname === eventsPath;
}

export function isRuntimeWebSocketUpgradePath(
  requestUrl: string,
  bridgePathPrefix: string,
): boolean {
  const gatewayPath = `${bridgePathPrefix}${RUNTIME_WEBSOCKET_PATH}`;
  const parsed = new URL(requestUrl, "http://universal-bridge.local");
  return parsed.pathname === gatewayPath;
}

export function isBridgeWebSocketUpgradePath(
  requestUrl: string,
  bridgePathPrefix: string,
): boolean {
  return (
    isEventsUpgradePath(requestUrl, bridgePathPrefix) ||
    isRuntimeWebSocketUpgradePath(requestUrl, bridgePathPrefix)
  );
}

export function getRequestedSubprotocols(req: IncomingMessage): string[] {
  const protocolHeader = req.headers["sec-websocket-protocol"];
  const raw = Array.isArray(protocolHeader)
    ? protocolHeader.join(",")
    : (protocolHeader ?? "");

  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}
