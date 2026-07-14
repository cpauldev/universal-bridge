export const BRIDGE_PREFIX_DEFAULT = "/__universal";
export const EVENTS_PATH = "/events";
export const RUNTIME_WEBSOCKET_PATH = "/runtime/ws";
export const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
};
export const DEFAULT_FALLBACK_COMMAND = "universal dev";
export const UNIVERSAL_PROTOCOL_VERSION = "2";
export const UNIVERSAL_WS_SUBPROTOCOL = `universal.v${UNIVERSAL_PROTOCOL_VERSION}+json`;
export const WS_HEARTBEAT_INTERVAL_MS_DEFAULT = 30_000;
