# Universal Architecture

This document explains how UniversalBridge is structured internally and how requests move through the system.

## High-level model

UniversalBridge mounts a same-origin bridge (`/__universal/*`) onto a host dev server.
That bridge provides:

- runtime state and health routes
- runtime control routes
- a websocket events channel
- an optional runtime WebSocket gateway
- proxying to runtime `/api/*` and explicitly configured direct runtime paths

## Subsystems

### 1. Adapters (`src/adapters/*`)

Adapters attach the bridge to framework/dev-server surfaces.

- `src/adapters/framework/*`: Next.js, Nuxt, Astro, Angular CLI proxy helpers
- `src/adapters/server/*`: Bun.serve, Node server, Express, Fastify, Hono-on-Node
- `src/adapters/build/*`: webpack-dev-server, Rsbuild, Rspack integration
- `src/adapters/shared/*`: shared lifecycle/attachment utilities and Vite plugin entrypoints

Responsibility: convert framework-specific hooks into standard bridge HTTP handling and, where the host exposes upgrade ownership, websocket attachment points.

### 2. Bridge runtime (`src/bridge/*`)

Core protocol implementation.

- `bridge.ts`: orchestrator that wires routes, runtime helper, websocket servers, and event bus
- `router.ts`: pathname/query-safe route matching and route keys
- `runtime-control.ts`: `/state`, `/runtime/status`, `/runtime/*` handlers
- `proxy.ts`: `/api/*` passthrough and configured direct-path passthrough to runtime
- `ws.ts`: typed `/events` upgrades plus opaque `/runtime/ws` proxy upgrades
- `events.ts`: monotonic event IDs and state revisions, event fanout, heartbeat lifecycle
- `errors.ts`: bridge error envelopes and websocket upgrade rejection helpers
- `prefix.ts`: normalized bridge prefix and rewrite source helpers

### 3. Runtime helper (`src/runtime/runtime-helper.ts`)

Optional runtime process management:

- command spawn and stop
- health probing (`healthPath` + timeout)
- status transitions (`stopped`, `starting`, `running`, `stopping`, `error`)
- control capability detection (`command` configured or not)

### 4. Preset composition (`src/preset.ts`, `src/preset-registry.ts`)

Preset API for tool authors to expose one integration entrypoint.

- normalizes identity -> namespace (`/__universal/<namespaceId>`)
- computes effective adapter options (bridge prefix, adapter name, next bridge key)
- composes framework adapters through registry mode while keeping imperative adapters local

### 5. Client SDK (`src/client/*`)

Typed helper layer for browser/Node clients.

- `client.ts`: health/state/runtime APIs, websocket subscription, typed errors
- `runtime-store.ts`: shared browser state store with ordered event reconciliation, lifecycle actions, and reconnect/refresh handling
- `runtime-context.ts`: runtime context registration and auto-mount resolution

## Request and event flow

1. Host dev server starts.
2. Adapter attaches bridge middleware and any supported upgrade listeners.
3. Tool UI/CLI calls bridge routes on same origin.
4. Bridge routes request to runtime-control, proxy, or websocket handling.
5. Runtime helper starts/stops/checks runtime when required.
6. Event bus emits complete `bridge-state` snapshots and `bridge-error` events to websocket clients.

## Key design decisions

- **Protocol-first boundary**: all adapter integrations converge on one bridge route/event contract.
- **Same-origin access**: avoids cross-origin complexity for local dev tooling.
- **Capability-aware control**: runtime control endpoints report/behave based on `command` availability.
- **Typed event channel**: `/events` carries bridge-state snapshots and bridge errors only; the optional `/runtime/ws` gateway carries opaque runtime application traffic.
- **Explicit adapter support**: adapters with clean upgrade ownership expose the runtime WebSocket gateway, while HTTP-only adapters report `hasRuntimeWebSocketGateway: false`.
- **Development client entries**: presets derive a runtime context for each registered browser module and inject a one-time bootstrap through the Vite, Next.js, Nuxt, or Astro adapter. The bootstrap registers contexts before dynamically importing the entries; entries own their UI mounting behavior.
- **Scoped namespacing for presets**: multiple tool integrations can coexist in one host project.

## Reliability properties

- Query-safe route matching.
- Deterministic bridge error envelope.
- Binary request + multi-cookie proxy fidelity.
- Websocket subprotocol validation (`universal.v2+json`).
- Opaque runtime WebSocket frame forwarding without bridge event leakage.
- Explicit `stopRuntime()` keeps runtime auto-start disabled until start/restart.
- Next.js standalone singleton keying with optional deterministic override.
