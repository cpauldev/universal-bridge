# Universal Bridge Protocol (v1)

This document is the normative contract for the Universal bridge protocol implemented in `src/bridge/*`.

## Versioning

- Protocol version: `1`
- Bridge state field: `protocolVersion: "1"`
- Supported websocket subprotocol: `universal.v1+json`

Backward-incompatible protocol changes must increment the protocol version.
Adapter API naming changes alone do not require a protocol version bump unless route/event/error semantics change.

## Route prefix

Default bridge prefix: `/__universal`

Prefix behavior:

- Custom prefixes are normalized to stay rooted under `/__universal`.
- Preset integrations typically use `/__universal/<namespaceId>`.

All routes below are relative to the effective bridge prefix.

## HTTP routes

- `GET /health`
- `GET /state`
- `GET /runtime/status`
- `POST /runtime/start`
- `POST /runtime/restart`
- `POST /runtime/stop`
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
  protocolVersion: "1";
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
  protocolVersion: "1";
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
- `commandHost` can be:
  - `"host"` when runtime command control is unavailable
  - `"helper"` when helper runtime control is available and no fallback command is configured
  - `"hybrid"` when helper runtime control is available with a fallback command present

## Runtime lifecycle semantics

- `autoStart` defaults to `true`.
- `GET /state` may auto-start runtime when `autoStart` is enabled.
- `POST /runtime/stop` disables auto-start until `start` or `restart` is called.
- `POST /runtime/stop` is idempotent and safe even when runtime command control is unavailable.

Required missing-command behavior for `start`/`restart`:

- HTTP status: `503`
- `error.code = "runtime_start_failed"`
- `error.details.reason = "missing_command"`

## Websocket events (`WS /events`)

Subprotocol behavior:

- If `Sec-WebSocket-Protocol` is supplied, offered values must include `universal.v1+json`.
- Unsupported offered protocol list is rejected with `426`.
- If the header is supplied and accepted, the negotiated protocol is `universal.v1+json`.
- If the header is omitted, the connection may still be accepted without negotiated subprotocol.

Event union:

- `runtime-status`
- `runtime-error`

All bridge events include:

- `protocolVersion`
- `eventId` (monotonic per bridge instance)
- `timestamp` (epoch milliseconds)

Connection behavior:

- Clients receive an immediate `runtime-status` event after websocket upgrade completes.
- Runtime websocket proxying (when enabled) reuses this same socket and keeps bridge event delivery alive even if upstream runtime websocket closes.

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
- Upstream 5xx emits a `runtime-error` event
- Upstream status/headers/body pass through unchanged (including non-2xx)

Required unavailable-runtime behavior:

- HTTP status: `503`
- `error.code = "runtime_unavailable"`
