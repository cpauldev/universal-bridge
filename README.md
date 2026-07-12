![Universal Bridge banner](banner.webp)

# Universal Bridge: A Protocol for Local Services

![Protocol](https://img.shields.io/badge/Protocol-Universal_Bridge-7C3AED?style=flat-square) ![Frameworks + Runtimes](https://img.shields.io/badge/Frameworks_%2B_Runtimes-4F46E5?style=flat-square) ![MIT License](https://img.shields.io/badge/-MIT_License-blue?style=flat-square)

Universal Bridge is a framework- and runtime-agnostic protocol for mounting a same-origin control plane for local companion processes.

Frameworks and runtimes expose different dev-server integration points—plugins, rewrites, middleware, and server APIs. Without a shared layer, each tool needs a separate integration for every host.

Universal Bridge mounts that shared layer at `/__universal/*`, providing HTTP health/state/control routes, WebSocket events, and API proxying. Framework-specific adapters translate it for each host environment.

## Who is this for?

Use Universal Bridge when you're building a developer tool—such as an overlay, panel, CLI companion, or local service—that needs to work across frameworks and server runtimes.

If you're using a tool that already includes Universal Bridge integration, configure that tool instead; you usually do not need to install Universal Bridge directly.

## Table of Contents

- [Installation](#installation)
- [What it provides](#what-it-provides)
- [Use cases](#use-cases)
- [Quick start (Vite)](#quick-start-vite)
- [Core concepts](#core-concepts)
- [Integration surfaces](#integration-surfaces)
- [Public API reference](#public-api-reference)
- [Configuration](#configuration)
- [Protocol summary](#protocol-summary)
- [Usage examples](#usage-examples)
- [Architecture overview](#architecture-overview)
- [Design caveats](#design-caveats)
- [Compatibility](#compatibility)
- [Additional docs](#additional-docs)

## Installation

```bash
npm i universal-bridge
```

```bash
pnpm add universal-bridge
```

```bash
yarn add universal-bridge
```

```bash
bun add universal-bridge
```

## What it provides

- same-origin bridge endpoints under `/__universal/*`
- runtime lifecycle control (`start`/`restart` require `command`; `stop` is idempotent)
- runtime status and capability reporting for UIs/automation
- websocket event stream with protocol versioning
- `/api/*` passthrough proxy from host origin to runtime origin
- framework/server/build-tool adapter surfaces plus a preset API for tool packages

Non-goals:

- no first-party UI or hosted service
- no requirement that end users import UniversalBridge directly when a tool already wraps it

## Use cases

- devtool overlays/sidebars/panels that should run across frameworks
- local CLIs/scripts that need runtime status and control via the same bridge
- internal developer platforms that expose same-origin local control APIs

## Quick start (Vite)

```ts
// vite.config.ts
import { createUniversalVitePlugin } from "universal-bridge/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    createUniversalVitePlugin({
      command: "node",
      args: ["./scripts/dev-runtime.js"],
    }),
  ],
});
```

## Core concepts

- **Bridge path prefix**: defaults to `/__universal`.
- **Runtime helper**: optional process manager for your tool runtime command.
- **Protocol version**: current bridge protocol is `1`.
- **Preset API**: recommended integration API for tool authors so users configure one entry point (`mytool().vite()`, `mytool().next(...)`, etc.).

## Integration surfaces

| Host setup                                                                                 | Import path                    |
| ------------------------------------------------------------------------------------------ | ------------------------------ |
| Vite-based dev servers (React, Vue, Solid, SvelteKit, Remix, TanStack Start, Vinext, etc.) | `universal-bridge/vite`        |
| Next.js                                                                                    | `universal-bridge/next`        |
| Nuxt                                                                                       | `universal-bridge/nuxt`        |
| Astro                                                                                      | `universal-bridge/astro`       |
| Angular CLI proxy flow                                                                     | `universal-bridge/angular/cli` |
| `Bun.serve`                                                                                | `universal-bridge/bun`         |
| Node middleware + HTTP server                                                              | `universal-bridge/node`        |
| Fastify                                                                                    | `universal-bridge/fastify`     |
| Hono on Node server                                                                        | `universal-bridge/hono`        |
| webpack-dev-server                                                                         | `universal-bridge/webpack`     |
| Rsbuild dev server                                                                         | `universal-bridge/rsbuild`     |
| Rspack dev server                                                                          | `universal-bridge/rspack`      |

## Public API reference

### Primary exports

| API                                         | Import                            |
| ------------------------------------------- | --------------------------------- |
| `createUniversalPreset`                     | `universal-bridge/preset`         |
| `createUniversalClient`                     | `universal-bridge/client`         |
| `createClientRuntimeContext`                | `universal-bridge/client-runtime` |
| `startStandaloneUniversalBridgeServer`      | `universal-bridge`                |
| `createUniversalBridge` / `UniversalBridge` | `universal-bridge`                |

### Adapter naming conventions

- `createUniversal*`: build a plugin/module/integration instance.
- `withUniversal*`: wrap and return config.
- `attachUniversalTo*`: attach to an existing server.
- `startUniversal*`: start helper/standalone utilities.

For expanded API coverage (including lifecycle helpers, runtime-context utilities, and adapter-specific helper exports), see `INTEGRATION_GUIDE.md`.

## Configuration

Most adapter APIs accept shared bridge/runtime options.

| Option                     | Type                                  | Default                    | Notes                                                                                             |
| -------------------------- | ------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------- |
| `bridgePathPrefix`         | `string`                              | `"/__universal"`           | Normalized to stay rooted under `/__universal`.                                                   |
| `autoStart`                | `boolean`                             | `true`                     | Auto-start runtime on state/proxy/events paths.                                                   |
| `command`                  | `string`                              | none                       | Required for managed runtime start/restart.                                                       |
| `args`                     | `string[]`                            | `[]`                       | Runtime command args.                                                                             |
| `cwd`                      | `string`                              | `process.cwd()`            | Runtime working directory.                                                                        |
| `env`                      | `Record<string, string \| undefined>` | none                       | Extra runtime environment variables.                                                              |
| `host`                     | `string`                              | `"127.0.0.1"`              | Runtime host binding.                                                                             |
| `healthPath`               | `string`                              | `"/api/version"`           | Runtime health probe endpoint.                                                                    |
| `startTimeoutMs`           | `number`                              | `15000`                    | Runtime startup timeout.                                                                          |
| `runtimePortEnvVar`        | `string`                              | `"UNIVERSAL_RUNTIME_PORT"` | Env var populated with selected runtime port.                                                     |
| `fallbackCommand`          | `string`                              | `"universal dev"`          | Returned in some runtime-control error payloads.                                                  |
| `eventHeartbeatIntervalMs` | `number`                              | `30000`                    | WS heartbeat for stale client cleanup.                                                            |
| `proxyRuntimeWebSocket`    | `boolean`                             | `true`                     | Enables runtime websocket proxying through bridge events socket.                                  |
| `instance`                 | `{ id: string; label?: string }`      | none                       | Optional instance metadata in bridge state/health.                                                |
| `additionalRewriteSources` | `string[]`                            | `[]`                       | Extra path prefixes proxied directly to the runtime (e.g. `["/dashboard/:path*"]`). Next.js only. |

### Preset-specific options (`createUniversalPreset`)

- `identity` (**required**): `{ packageName: string; variant?: string }`
- `composition`: `"registry" | "local"`
- `instanceId`: stable suffix for multiple preset instances
- `unsafeOverrides`: advanced adapter identity overrides

## Protocol summary

With prefix `/__universal` (or `/__universal/<namespaceId>` for presets):

- `GET /health`
- `GET /state`
- `GET /runtime/status`
- `POST /runtime/start`
- `POST /runtime/restart`
- `POST /runtime/stop`
- `WS /events`
- `ANY /api/*` proxied to runtime `/api/*`

Behavior highlights:

- Route matching is query-safe.
- `GET /state` may auto-start runtime when `autoStart` is enabled.
- `POST /runtime/stop` is idempotent and disables auto-start until start/restart.
- Bridge-generated errors use `{ success: false, message, error }` envelope.
- Proxied `/api/*` responses pass through status/headers/body (including non-2xx).

For normative protocol details, see `PROTOCOL.md`.

For adapter-specific snippets (Next keying, Bun/Node/Fastify/Hono servers, webpack/Rsbuild/Rspack, Astro/Nuxt, Angular CLI, and standalone bridge usage), see `INTEGRATION_GUIDE.md`.

## Usage examples

### Preset export for your tool package

```ts
import { createUniversalPreset } from "universal-bridge/preset";

export function myTool() {
  return createUniversalPreset({
    identity: { packageName: "mytool" },
    command: "mytool",
    args: ["dev"],
    fallbackCommand: "mytool dev",
  });
}
```

### Next.js

```ts
// next.config.ts
import { myTool } from "mytool";

export default myTool().next({ reactStrictMode: true });
```

### Vite (including Vinext)

```ts
// vite.config.ts
import { myTool } from "mytool";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [myTool().vite()],
});
```

### Client SDK

```ts
import { createUniversalClient } from "universal-bridge/client";

const client = createUniversalClient({ namespaceId: "mytool" });
const state = await client.getState();

const unsubscribe = client.subscribeEvents((event) => {
  console.log(event.type, event.eventId);
});

unsubscribe();
```

## Architecture overview

High-level internals:

- `src/bridge/*`: HTTP/WS routing, runtime control routes, proxying, event fanout.
- `src/runtime/runtime-helper.ts`: command lifecycle and health probing.
- `src/adapters/*`: framework/server/build-tool integration points.
- `src/client/*`: typed browser/Node client helpers.
- `src/preset.ts` + `src/preset-registry.ts`: preset composition and registry behavior.

For implementation details, see `ARCHITECTURE.md`.

## Design caveats

- UniversalBridge does **not** ship a first-party UI.
- Runtime start/restart are unavailable when `command` is not configured.
- `bridgePathPrefix` is normalized under `/__universal`.
- Package is ESM-only (`"type": "module"`).

## Compatibility

- Runtime targets: Node.js and Bun.
- Package format: ESM-only (`"type": "module"`).

## Additional docs

- [`INTEGRATION_GUIDE.md`](INTEGRATION_GUIDE.md): end-to-end guide for tool authors, adapter cookbook, and expanded API coverage.
- [`PROTOCOL.md`](PROTOCOL.md): normative bridge contract.
- [`ARCHITECTURE.md`](ARCHITECTURE.md): internal architecture.
- [`EXAMPLES.md`](EXAMPLES.md): workspace example setup and verification.

Docs checks:

```bash
bun run docs:lint
bun run docs:check
```
