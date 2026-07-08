![UniversaKit banner](assets/universakit.png)

<p align="center">
  <a href="https://github.com/cpauldev/universa-kit/actions/workflows/ci.yml"><img alt="build" src="https://img.shields.io/github/actions/workflow/status/cpauldev/universa-kit/ci.yml?branch=main&style=for-the-badge&label=build" height="28" style="vertical-align: middle;" /></a>
  <a href="https://github.com/cpauldev/universa-kit/releases"><img alt="release" src="https://img.shields.io/github/v/release/cpauldev/universa-kit?style=for-the-badge&label=release" height="28" style="vertical-align: middle;" /></a>
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge" height="28" style="vertical-align: middle;" /></a>
</p>

<p align="center">
  <img src="https://skillicons.dev/icons?i=nextjs,react,vue,nuxt,svelte,astro,vite,solidjs,angular,remix,nodejs,bun,webpack,cloudflare&theme=light&perline=7" alt="Next.js, React, Vue, Nuxt, SvelteKit, Astro, Vite, Solid, Angular, Remix, Node.js, Bun, Webpack" />
</p>

# UniversaKit

UniversaKit is a framework-agnostic bridge for local developer tools.

Every framework integrates with its dev server differently. Vite has a plugin system. Next.js only exposes a `rewrites` config. Bun has its own server API. Astro, Nuxt, and Angular CLI each have their own setup as well. A dev tool that needs to reach a local companion process through that layer usually needs a separate integration built for each one.

UniversaKit fixes this with one fixed protocol: a small set of HTTP routes plus a websocket event channel. Framework-specific adapters translate it for whatever setup the developer is running.

It mounts a same-origin control plane at `/__universa/*` on the host, covering bridge health/state, runtime start/restart/stop, websocket events, and API proxying.

## Who is this for?

Use UniversaKit directly if you're building a developer tool package (overlay, sidebar, panel, or CLI companion) that needs to work across frameworks.

If you're using a tool that already ships UniversaKit integration, use that tool's setup docs instead.

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
npm i universa-kit
```

```bash
pnpm add universa-kit
```

```bash
yarn add universa-kit
```

```bash
bun add universa-kit
```

## What it provides

- same-origin bridge endpoints under `/__universa/*`
- runtime lifecycle control (`start`/`restart` require `command`; `stop` is idempotent)
- runtime status and capability reporting for UIs/automation
- websocket event stream with protocol versioning
- `/api/*` passthrough proxy from host origin to runtime origin
- framework/server/build-tool adapter surfaces plus a preset API for tool packages

Non-goals:

- no first-party UI or hosted service
- no requirement that end users import UniversaKit directly when a tool already wraps it

## Use cases

- devtool overlays/sidebars/panels that should run across frameworks
- local CLIs/scripts that need runtime status and control via the same bridge
- internal developer platforms that expose same-origin local control APIs

## Quick start (Vite)

```ts
// vite.config.ts
import { createUniversaVitePlugin } from "universa-kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    createUniversaVitePlugin({
      command: "node",
      args: ["./scripts/dev-runtime.js"],
    }),
  ],
});
```

## Core concepts

- **Bridge path prefix**: defaults to `/__universa`.
- **Runtime helper**: optional process manager for your tool runtime command.
- **Protocol version**: current bridge protocol is `1`.
- **Preset API**: recommended integration API for tool authors so users configure one entry point (`mytool().vite()`, `mytool().next(...)`, etc.).

## Integration surfaces

| Host setup                                                                                 | Import path                |
| ------------------------------------------------------------------------------------------ | -------------------------- |
| Vite-based dev servers (React, Vue, Solid, SvelteKit, Remix, TanStack Start, Vinext, etc.) | `universa-kit/vite`        |
| Next.js                                                                                    | `universa-kit/next`        |
| Nuxt                                                                                       | `universa-kit/nuxt`        |
| Astro                                                                                      | `universa-kit/astro`       |
| Angular CLI proxy flow                                                                     | `universa-kit/angular/cli` |
| `Bun.serve`                                                                                | `universa-kit/bun`         |
| Node middleware + HTTP server                                                              | `universa-kit/node`        |
| Fastify                                                                                    | `universa-kit/fastify`     |
| Hono on Node server                                                                        | `universa-kit/hono`        |
| webpack-dev-server                                                                         | `universa-kit/webpack`     |
| Rsbuild dev server                                                                         | `universa-kit/rsbuild`     |
| Rspack dev server                                                                          | `universa-kit/rspack`      |

## Public API reference

### Primary exports

| API                                       | Import                        |
| ----------------------------------------- | ----------------------------- |
| `createUniversaPreset`                    | `universa-kit/preset`         |
| `createUniversaClient`                    | `universa-kit/client`         |
| `createClientRuntimeContext`              | `universa-kit/client-runtime` |
| `startStandaloneUniversaBridgeServer`     | `universa-kit`                |
| `createUniversaBridge` / `UniversaBridge` | `universa-kit`                |

### Adapter naming conventions

- `createUniversa*`: build a plugin/module/integration instance.
- `withUniversa*`: wrap and return config.
- `attachUniversaTo*`: attach to an existing server.
- `startUniversa*`: start helper/standalone utilities.

For expanded API coverage (including lifecycle helpers, runtime-context utilities, and adapter-specific helper exports), see `INTEGRATION_GUIDE.md`.

## Configuration

Most adapter APIs accept shared bridge/runtime options.

| Option                     | Type                                  | Default                   | Notes                                                                                             |
| -------------------------- | ------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------- |
| `bridgePathPrefix`         | `string`                              | `"/__universa"`           | Normalized to stay rooted under `/__universa`.                                                    |
| `autoStart`                | `boolean`                             | `true`                    | Auto-start runtime on state/proxy/events paths.                                                   |
| `command`                  | `string`                              | none                      | Required for managed runtime start/restart.                                                       |
| `args`                     | `string[]`                            | `[]`                      | Runtime command args.                                                                             |
| `cwd`                      | `string`                              | `process.cwd()`           | Runtime working directory.                                                                        |
| `env`                      | `Record<string, string \| undefined>` | none                      | Extra runtime environment variables.                                                              |
| `host`                     | `string`                              | `"127.0.0.1"`             | Runtime host binding.                                                                             |
| `healthPath`               | `string`                              | `"/api/version"`          | Runtime health probe endpoint.                                                                    |
| `startTimeoutMs`           | `number`                              | `15000`                   | Runtime startup timeout.                                                                          |
| `runtimePortEnvVar`        | `string`                              | `"UNIVERSA_RUNTIME_PORT"` | Env var populated with selected runtime port.                                                     |
| `fallbackCommand`          | `string`                              | `"universa dev"`          | Returned in some runtime-control error payloads.                                                  |
| `eventHeartbeatIntervalMs` | `number`                              | `30000`                   | WS heartbeat for stale client cleanup.                                                            |
| `proxyRuntimeWebSocket`    | `boolean`                             | `true`                    | Enables runtime websocket proxying through bridge events socket.                                  |
| `instance`                 | `{ id: string; label?: string }`      | none                      | Optional instance metadata in bridge state/health.                                                |
| `additionalRewriteSources` | `string[]`                            | `[]`                      | Extra path prefixes proxied directly to the runtime (e.g. `["/dashboard/:path*"]`). Next.js only. |

### Preset-specific options (`createUniversaPreset`)

- `identity` (**required**): `{ packageName: string; variant?: string }`
- `composition`: `"registry" | "local"`
- `instanceId`: stable suffix for multiple preset instances
- `unsafeOverrides`: advanced adapter identity overrides

## Protocol summary

With prefix `/__universa` (or `/__universa/<namespaceId>` for presets):

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
import { createUniversaPreset } from "universa-kit/preset";

export function myTool() {
  return createUniversaPreset({
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
import { createUniversaClient } from "universa-kit/client";

const client = createUniversaClient({ namespaceId: "mytool" });
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

- UniversaKit does **not** ship a first-party UI.
- Runtime start/restart are unavailable when `command` is not configured.
- `bridgePathPrefix` is normalized under `/__universa`.
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
