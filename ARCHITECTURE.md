# Universal Architecture

This document explains how UniversalBridge is structured internally and how requests move through the system.

## High-level model

UniversalBridge mounts a same-origin bridge (`/__universal/*`) onto a host dev server.
That bridge provides:

- runtime state and health routes
- runtime control routes
- a websocket events channel
- proxying to runtime `/api/*`

## Subsystems

### 1. Adapters (`src/adapters/*`)

Adapters attach the bridge to framework/dev-server surfaces.

- `src/adapters/framework/*`: Next.js, Nuxt, Astro, Angular CLI proxy helpers
- `src/adapters/server/*`: Bun.serve, Node server, Fastify, Hono-on-Node
- `src/adapters/build/*`: webpack-dev-server, Rsbuild, Rspack integration
- `src/adapters/shared/*`: shared lifecycle/attachment utilities and Vite plugin entrypoints

Responsibility: convert framework-specific hooks into standard bridge HTTP + websocket attachment points.

### 2. Bridge runtime (`src/bridge/*`)

Core protocol implementation.

- `bridge.ts`: orchestrator that wires routes, runtime helper, websocket server, and event bus
- `router.ts`: pathname/query-safe route matching and route keys
- `runtime-control.ts`: `/state`, `/runtime/status`, `/runtime/*` handlers
- `proxy.ts`: `/api/*` passthrough to runtime
- `ws.ts`: `/events` websocket upgrade and optional runtime websocket piping
- `events.ts`: monotonic event IDs, event fanout, heartbeat lifecycle
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
- `runtime-context.ts`: runtime context registration and auto-mount resolution

## Request and event flow

1. Host dev server starts.
2. Adapter attaches bridge middleware and upgrade listeners.
3. Tool UI/CLI calls bridge routes on same origin.
4. Bridge routes request to runtime-control, proxy, or websocket handling.
5. Runtime helper starts/stops/checks runtime when required.
6. Event bus emits runtime updates to websocket clients.

## Key design decisions

- **Protocol-first boundary**: all adapter integrations converge on one bridge route/event contract.
- **Same-origin access**: avoids cross-origin complexity for local dev tooling.
- **Capability-aware control**: runtime control endpoints report/behave based on `command` availability.
- **Graceful websocket behavior**: bridge event socket stays useful even if runtime websocket proxy path closes.
- **Scoped namespacing for presets**: multiple tool integrations can coexist in one host project.

## Reliability properties

- Query-safe route matching.
- Deterministic bridge error envelope.
- Binary request + multi-cookie proxy fidelity.
- Websocket subprotocol validation (`universal.v1+json`).
- Next.js standalone singleton keying with optional deterministic override.
