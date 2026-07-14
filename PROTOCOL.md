# Universal Bridge Protocol (v2)

This document is the normative contract for the Universal bridge protocol implemented in `src/bridge/*`.

## Versioning

- Protocol version: `2`
- Bridge state field: `protocolVersion: "2"`
- Supported websocket subprotocol: `universal.v2+json`

Backward-incompatible protocol changes must increment the protocol version.
Adapter API naming changes alone do not require a protocol version bump unless route/event/error semantics change.

## Migrating from v1

Version 2 is not wire-compatible with version 1. Update WebSocket clients to offer `universal.v2+json` and replace the old runtime event payloads with the typed bridge event union:

| v1                   | v2                                                |
| -------------------- | ------------------------------------------------- |
| `runtime-status`     | `bridge-state` with `state: UniversalBridgeState` |
| `runtime-error`      | `bridge-error` with `error: string`               |
| no snapshot revision | `state.revision` for ordering snapshots           |

The `/events` endpoint carries bridge events only. An optional runtime WebSocket gateway is available separately at `/runtime/ws` when configured.

## Route prefix

Default bridge prefix: `/__universal`

Prefix behavior:

- Custom prefixes are normalized to stay rooted under `/__universal`.
- Preset integrations typically use `/__universal/<namespaceId>`.

All routes below are relative to the effective bridge prefix.

## Routes

- `GET /health`
- `GET /state`
- `GET /runtime/status`
- `POST /runtime/start`
- `POST /runtime/restart`
- `POST /runtime/stop`
- `WS /events`
- `WS /runtime/ws` (when `runtimeWebSocketGateway` is configured)
- `ANY /api/*` (proxied to runtime `/api/*`)

### Query handling

Route matching is pathname-based and query-safe.

Example: `GET /__universal/state?source=ui` is handled as `GET /state`.

## Health and state contracts

### `GET /health`

Returns:

```ts
{
  ok: true;
  bridge: true;
  protocolVersion: "2";
  transportState:
    | "disconnected"
    | "bridge_detecting"
    | "runtime_starting"
    | "connected"
    | "degraded";
  runtime: UniversalRuntimeStatus;
  capabilities: UniversalBridgeCapabilities;
  instance?: { id: string; label?: string };
  error?: string;
}
```

### `GET /state`

Returns `UniversalBridgeState`:

```ts
interface UniversalBridgeState {
  protocolVersion: "2";
  revision: number;
  transportState:
    | "disconnected"
    | "bridge_detecting"
    | "runtime_starting"
    | "connected"
    | "degraded";
  runtime: UniversalRuntimeStatus;
  capabilities: UniversalBridgeCapabilities;
  instance?: { id: string; label?: string };
  error?: string;
}
```

`capabilities` are configuration-aware:

- `hasRuntimeControl` and `can*Runtime` are `false` when runtime `command` is not configured.
- `hasRuntimeWebSocketGateway` is `true` only when the gateway is configured and the active adapter supports WebSocket upgrades.
- `commandHost` can be:
  - `"host"` when runtime command control is unavailable
  - `"helper"` when helper runtime control is available and no fallback command is configured
  - `"hybrid"` when helper runtime control is available with a fallback command present

`revision` is monotonic for emitted state changes. Clients should retain the snapshot with the greatest revision when reconciling `/state` responses and `bridge-state` events.

## Runtime lifecycle semantics

- `autoStart` defaults to `true`.
- `GET /state`, `WS /events`, `WS /runtime/ws`, and runtime proxy requests may auto-start runtime when `autoStart` is enabled.
- `POST /runtime/stop` disables auto-start until `start` or `restart` is called.
- A stopped runtime is not restarted by a gateway connection until `start` or `restart` re-enables auto-start.
- `POST /runtime/stop` is idempotent and safe even when runtime command control is unavailable.

Required missing-command behavior for `start`/`restart`:

- HTTP status: `503`
- `error.code = "runtime_start_failed"`
- `error.details.reason = "missing_command"`

## Websocket events (`WS /events`)

Subprotocol behavior:

- If `Sec-WebSocket-Protocol` is supplied, offered values must include `universal.v2+json`.
- Unsupported offered protocol list is rejected with `426`.
- If the header is supplied and accepted, the negotiated protocol is `universal.v2+json`.
- If the header is omitted, the connection may still be accepted without negotiated subprotocol.

Event union:

- `bridge-state` (complete `UniversalBridgeState` snapshot)
- `bridge-error` (transient bridge/proxy failure)

All bridge events include:

- `protocolVersion`
- `eventId` (monotonic per bridge instance)
- `timestamp` (epoch milliseconds)

Connection behavior:

- Clients receive an immediate `bridge-state` event after websocket upgrade completes.
- The events socket carries typed bridge events only; runtime websocket traffic must use a separate channel.

## Runtime WebSocket gateway (`WS /runtime/ws`)

Enable it with `runtimeWebSocketGateway: { path: "/ws" }`. The bridge resolves
the current managed runtime URL and proxies this fixed upstream path. Browser
query parameters are forwarded to the upstream path; text, binary frames, and
runtime-specific WebSocket subprotocol negotiation are passed through.

Clients can construct the same-origin gateway URL with:

```ts
const socket = new WebSocket(
  client.getRuntimeWebSocketUrl({ query: { session: "local" } }),
);
```

The gateway does not accept browser-provided upstream hosts or paths, attach
custom upstream headers, reconnect, replay application traffic, or interpret
runtime messages. Runtime socket closure or failure closes only the paired
gateway socket and does not close `/events` subscriptions or emit runtime frames
on `/events`.

Adapters that cannot cleanly own WebSocket upgrade handling must report
`hasRuntimeWebSocketGateway: false` and reject or fall through predictably.

## Error envelope

Bridge-generated non-2xx responses use:

```ts
{
  success: false;
  message: string;
  error: {
    code:
      | "invalid_request"
      | "route_not_found"
      | "runtime_start_failed"
      | "runtime_control_failed"
      | "runtime_unavailable"
      | "bridge_proxy_failed"
      | "internal_error";
    message: string;
    retryable: boolean;
    details?: Record<string, unknown>;
  };
}
```

Proxy passthrough responses are not envelope-wrapped by default.

## Proxy fidelity (`ANY /api/*`)

Guarantees:

- Binary request body forwarding (no forced UTF-8 conversion)
- Multi-value `Set-Cookie` forwarding
- Upstream 5xx emits a `bridge-error` event
- Upstream status/headers/body pass through unchanged (including non-2xx)

Required unavailable-runtime behavior:

- HTTP status: `503`
- `error.code = "runtime_unavailable"`
