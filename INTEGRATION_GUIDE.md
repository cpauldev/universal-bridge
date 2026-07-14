# Universal Bridge Integration Guide

This guide shows how to ship a developer-tool package that exposes one stable integration API and works across frameworks through Universal Bridge.

Use the preset flow for most tool packages. Use direct adapters when you are integrating Universal Bridge into an existing server, build tool, or test harness yourself.

## Table of Contents

- [Recommended Preset Flow](#recommended-preset-flow)
  - [1. Build a runtime command](#1-build-a-runtime-command)
  - [2. Export a preset](#2-export-a-preset)
  - [3. User configuration](#3-user-configuration)
  - [4. Bridge routes users get](#4-bridge-routes-users-get)
  - [5. Browser client entries](#5-browser-client-entries)
- [Runtime and Protocol Notes](#runtime-and-protocol-notes)
  - [Shared adapter options](#shared-adapter-options)
  - [Runtime lifecycle](#runtime-lifecycle)
  - [Runtime WebSocket gateway](#runtime-websocket-gateway)
  - [Preset composition](#preset-composition)
- [Adapter Capability Matrix](#adapter-capability-matrix)
- [Public API Coverage](#public-api-coverage)
- [Direct Adapter Cookbook](#direct-adapter-cookbook)
  - [Next.js bridge keying](#nextjs-bridge-keying)
  - [Bun.serve integration](#bunserve-integration)
  - [Node server integration](#node-server-integration)
  - [Express integration](#express-integration)
  - [webpack-dev-server integration](#webpack-dev-server-integration)
  - [Fastify integration](#fastify-integration)
  - [NestJS integration](#nestjs-integration)
  - [Hono on Node integration](#hono-on-node-integration)
  - [Rsbuild and Rspack integration](#rsbuild-and-rspack-integration)
  - [Astro and Nuxt integration](#astro-and-nuxt-integration)
  - [Angular CLI proxy integration](#angular-cli-proxy-integration)
  - [Docker Compose runtime helper](#docker-compose-runtime-helper)
  - [Dev Containers and Codespaces](#dev-containers-and-codespaces)
  - [Standalone bridge](#standalone-bridge-toolingtests)

## Recommended Preset Flow

### 1. Build a runtime command

Your tool runtime should listen on the port provided by `UNIVERSAL_RUNTIME_PORT`, the default environment variable populated by Universal Bridge.

```js
// runtime/dev-server.mjs
import { createServer } from "node:http";

const port = Number(process.env.UNIVERSAL_RUNTIME_PORT ?? 3456);

const server = createServer((req, res) => {
  if (req.url === "/api/version") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ version: "0.1.0" }));
    return;
  }

  if (req.url === "/api/status") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, tool: "acmetool" }));
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[acmetool] runtime listening on http://127.0.0.1:${port}`);
});
```

```js
#!/usr/bin/env node
// bin/acmetool.mjs
const command = process.argv[2];

if (command === "dev") {
  await import("../runtime/dev-server.mjs");
} else if (command === "setup") {
  console.log("acmetool setup: write project config files here.");
} else {
  console.log("Usage: acmetool <setup|dev>");
  process.exit(1);
}
```

### 2. Export a preset

```ts
// src/index.ts
import { createUniversalPreset } from "universal-bridge/preset";

export function acmetool() {
  return createUniversalPreset({
    identity: { packageName: "acmetool" },
    client: {
      entries: [{ module: "acmetool/overlay" }],
    },
    command: "acmetool",
    args: ["dev"],
    fallbackCommand: "acmetool dev",
    runtimeWebSocketGateway: { path: "/ws" },
  });
}
```

Why presets are recommended:

- users import from one place (`acmetool`)
- namespace, bridge prefix, adapter name, and instance metadata are derived automatically
- framework and build-tool adapters can compose safely when multiple presets are present
- direct server adapters remain available from the same preset object

### 3. User configuration

### Next.js

```ts
// next.config.ts
import { acmetool } from "acmetool";

export default acmetool().next({});
```

### Vite

```ts
// vite.config.ts
import { acmetool } from "acmetool";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [acmetool().vite()],
});
```

Then users run their normal app dev command.

### 4. Bridge routes users get

Preset integrations are namespaced:

- `GET /__universal/acmetool/health`
- `GET /__universal/acmetool/state`
- `WS /__universal/acmetool/events`
- `WS /__universal/acmetool/runtime/ws` (when configured)
- `ANY /__universal/acmetool/api/*`

### 5. Browser client entries

Client entries are self-initializing browser modules. In development, preset
adapters for Vite (including SvelteKit and Vinext), Next.js, Nuxt, and Astro
load them automatically. Use them for overlays, panels, inspectors, and other
developer-facing browser features.

```ts
client: {
  entries: [{ module: "acmetool/overlay" }],
}
```

The entry can read its derived namespace and bridge path, then mount its UI:

```ts
// acmetool/overlay
import { resolveClientRuntimeContext } from "universal-bridge/client-runtime";

const context = resolveClientRuntimeContext("acmetool/overlay");
if (context?.clientEnabled) {
  mountOverlay({ bridgePathPrefix: context.bridgePathPrefix });
}
```

The entry owns its UI and mounting behavior.

Each client module is initialized once per page, so a module may only be registered for one preset namespace. Use distinct module specifiers when multiple preset instances need separate browser clients.

### Manual client access

```ts
import { createUniversalClient } from "universal-bridge/client";

const client = createUniversalClient({ namespaceId: "acmetool" });
const state = await client.getState();
console.log(state.runtime.phase);

const runtimeSocket = new WebSocket(
  client.getRuntimeWebSocketUrl({ query: { session: "local" } }),
  ["acmetool.v1"],
);

const unsubscribe = client.subscribeEvents((event) => {
  if (event.type === "bridge-state") {
    console.log(event.state.runtime.phase);
  } else {
    console.error(event.error);
  }
});

window.addEventListener("beforeunload", () => unsubscribe());
```

For a UI that needs shared state, reconnection, ordered events, and runtime
actions, use `createBridgeRuntimeStore`:

```ts
import { createBridgeRuntimeStore } from "universal-bridge/client";

const runtimeStore = createBridgeRuntimeStore({ namespaceId: "acmetool" });
const unsubscribe = runtimeStore.subscribe(() => {
  const { bridgeState, connection, error } = runtimeStore.getSnapshot();
  console.log(connection, bridgeState?.runtime.phase, error);
});

await runtimeStore.restart();
unsubscribe();
runtimeStore.destroy();
```

## Runtime and Protocol Notes

### Shared adapter options

Most preset and direct adapter calls accept the same bridge/runtime options.

| Option                          | Purpose                                                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `command` / `args`              | Runtime command and arguments. Required for managed `start` and `restart`.                                                                                   |
| `cwd` / `env`                   | Runtime process working directory and extra environment variables.                                                                                           |
| `host`                          | Runtime bind host used with the generated runtime port. Defaults to `127.0.0.1`.                                                                             |
| `healthPath` / `startTimeoutMs` | Runtime health probe path and startup timeout.                                                                                                               |
| `runtimePortEnvVar`             | Environment variable that receives the generated runtime port. Defaults to `UNIVERSAL_RUNTIME_PORT`.                                                         |
| `autoStart`                     | Whether state/proxy/event/gateway traffic may start the runtime. Defaults to `true`.                                                                         |
| `fallbackCommand`               | Command shown in some error payloads when users need to start the runtime manually.                                                                          |
| `bridgePathPrefix`              | Bridge route prefix. Custom values are normalized under `/__universal`.                                                                                      |
| `runtimeWebSocketGateway`       | Optional `{ path }` for same-origin WebSocket proxying to one runtime path.                                                                                  |
| `additionalRewriteSources`      | Extra path prefixes routed to the bridge and proxied directly to the runtime by adapters that convert rewrite sources into direct runtime passthrough paths. |
| `instance`                      | Optional bridge instance metadata returned in health/state payloads.                                                                                         |

Direct adapters are not identical transports. Node/Hono/build-tool integrations can attach HTTP middleware and upgrade listeners when an `httpServer` is available; Express and Fastify are HTTP middleware integrations; Bun uses a standalone bridge plus Bun fetch/WebSocket handlers. Check the adapter notes before relying on WebSocket upgrades or direct-path passthrough.

### Runtime lifecycle

- If `command` is omitted, `start` and `restart` runtime controls are unavailable by design.
- `stop` is idempotent and disables auto-start until `start` or `restart` is called.
- `GET /state`, `/api/*` proxy requests, direct proxy paths, `/events`, and `/runtime/ws` may auto-start the runtime when `autoStart` is enabled and runtime control is available.
- `bridgePathPrefix` is normalized under `/__universal`.
- Keep your public tool API stable (`acmetool().vite()`, `acmetool().next(...)`, etc.) even if you change your internal Universal Bridge wiring.

### Runtime WebSocket gateway

- `runtimeWebSocketGateway` proxies one fixed runtime WebSocket path; it does not expose arbitrary internal network destinations.
- `client.getRuntimeWebSocketUrl({ query })` appends stringified query values and omits `undefined` values.
- `/events` is bridge-only. Runtime/app text and binary frames should use `client.getRuntimeWebSocketUrl()`.
- The bridge forwards runtime WebSocket frames opaquely and does not reconnect, replay, or parse application messages.
- Express and Fastify currently support bridge HTTP routes only, so their runtime WebSocket gateway capability is always `false`.

### Preset composition

- `createUniversalPreset` defaults to `composition: "registry"`.
- In `"registry"` mode, framework/build adapters compose all registered presets (`vite`, `next`, `nuxt`, `astro`, `webpack`, `rsbuild`, `rspack`).
- In `"local"` mode, a preset only applies its own framework/build wiring.
- Imperative adapters remain local to each preset instance (`bun`, `node`, `express`, `fastify`, `hono`, `angularCli`).

## Adapter Capability Matrix

| Surface                | Preset method                                                | Client entries                    | Runtime WebSocket gateway                          |
| ---------------------- | ------------------------------------------------------------ | --------------------------------- | -------------------------------------------------- |
| Vite-based dev servers | `preset.vite()`                                              | Yes                               | Yes, when the dev server exposes an HTTP server    |
| Next.js                | `preset.next(config)`                                        | Yes                               | Yes, through the standalone rewrite target         |
| Nuxt                   | `preset.nuxt()`                                              | Yes                               | Yes, when Nuxt exposes an upgrade-capable listener |
| Astro                  | `preset.astro()`                                             | Yes                               | Yes, when the dev server exposes an HTTP server    |
| Angular CLI proxy      | `preset.angularCli.*`                                        | No automatic client entry loading | Yes, through the standalone proxy target           |
| Bun.serve              | `preset.bun.attach()`                                        | No automatic client entry loading | Yes                                                |
| Node HTTP server       | `preset.node.attach(server)`                                 | No automatic client entry loading | Yes, when `httpServer` is provided                 |
| Express                | `preset.express.attach(app)` / `preset.express.middleware()` | No automatic client entry loading | No                                                 |
| Fastify                | `preset.fastify.attach(instance)`                            | No automatic client entry loading | No                                                 |
| Hono on Node           | `preset.hono.attach(server)`                                 | No automatic client entry loading | Yes, when `httpServer` is provided                 |
| webpack-dev-server     | `preset.webpack.withDevServer(config)`                       | No automatic client entry loading | Yes, when the dev server exposes an HTTP server    |
| Rsbuild                | `preset.rsbuild.withDevServer(config)`                       | No automatic client entry loading | Yes, when the dev server exposes an HTTP server    |
| Rspack                 | `preset.rspack.withDevServer(config)`                        | No automatic client entry loading | Yes, when the dev server exposes an HTTP server    |

## Public API Coverage

### Core bridge and preset APIs

| API                                         | Import path               | Purpose                                        |
| ------------------------------------------- | ------------------------- | ---------------------------------------------- |
| `createUniversalPreset`                     | `universal-bridge/preset` | Unified integration surface for tool packages. |
| `createUniversalBridge` / `UniversalBridge` | `universal-bridge`        | Direct bridge instance control and attachment. |
| `startStandaloneUniversalBridgeServer`      | `universal-bridge`        | Standalone bridge server for tooling/tests.    |

### Client SDK and runtime-context helpers

| API                                                              | Import path                       | Purpose                                                                    |
| ---------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------- |
| `createUniversalClient` / `UniversalClientError`                 | `universal-bridge/client`         | Typed health/state/runtime/event client.                                   |
| `createBridgeRuntimeStore`                                       | `universal-bridge/client`         | Shared browser runtime state, lifecycle actions, and event reconciliation. |
| `createClientRuntimeContext`                                     | `universal-bridge/client-runtime` | Create normalized namespace runtime context.                               |
| `registerClientRuntimeContext` / `registerClientRuntimeContexts` | `universal-bridge/client-runtime` | Register module-to-context mappings.                                       |
| `getClientRuntimeContexts` / `resolveClientRuntimeContext`       | `universal-bridge/client-runtime` | Read/resolve runtime contexts.                                             |
| `resolveClientAutoMount`                                         | `universal-bridge/client-runtime` | Evaluate effective auto-mount from query/storage/defaults.                 |

### Framework adapters

| API                                    | Import path                    |
| -------------------------------------- | ------------------------------ |
| `createUniversalVitePlugin`            | `universal-bridge/vite`        |
| `withUniversalNext`                    | `universal-bridge/next`        |
| `createUniversalAstroIntegration`      | `universal-bridge/astro`       |
| `createUniversalNuxtModule`            | `universal-bridge/nuxt`        |
| `startUniversalAngularCliBridge`       | `universal-bridge/angular/cli` |
| `createUniversalAngularCliProxyConfig` | `universal-bridge/angular/cli` |
| `withUniversalAngularCliProxyConfig`   | `universal-bridge/angular/cli` |

### Server adapters

| API                                      | Import path                |
| ---------------------------------------- | -------------------------- |
| `attachUniversalToBunServe`              | `universal-bridge/bun`     |
| `withUniversalBunServeFetch`             | `universal-bridge/bun`     |
| `withUniversalBunServeWebSocketHandlers` | `universal-bridge/bun`     |
| `attachUniversalToNodeServer`            | `universal-bridge/node`    |
| `attachUniversalToExpress`               | `universal-bridge/express` |
| `createUniversalExpressMiddleware`       | `universal-bridge/express` |
| `attachUniversalToFastify`               | `universal-bridge/fastify` |
| `attachUniversalToHonoNodeServer`        | `universal-bridge/hono`    |

Preset instances also expose `preset.express.attach(app, options)` and `preset.express.middleware(options)` for namespaced Express integrations.

### Build adapters and lifecycle helpers

| API                             | Import path                |
| ------------------------------- | -------------------------- |
| `withUniversalWebpackDevServer` | `universal-bridge/webpack` |
| `withUniversalRsbuild`          | `universal-bridge/rsbuild` |
| `withUniversalRspack`           | `universal-bridge/rspack`  |
| `createWebpackBridgeLifecycle`  | `universal-bridge/webpack` |
| `createRsbuildBridgeLifecycle`  | `universal-bridge/rsbuild` |
| `createRspackBridgeLifecycle`   | `universal-bridge/rspack`  |
| `createNodeBridgeLifecycle`     | `universal-bridge/node`    |
| `createHonoBridgeLifecycle`     | `universal-bridge/hono`    |

### Runtime helper and protocol constants

| API                          | Import path               |
| ---------------------------- | ------------------------- |
| `createDockerComposeRuntime` | `universal-bridge/docker` |
| `RuntimeHelper`              | `universal-bridge`        |
| `UNIVERSAL_PROTOCOL_VERSION` | `universal-bridge`        |
| `UNIVERSAL_WS_SUBPROTOCOL`   | `universal-bridge`        |

For the full public export list in the repository, use `package.json` exports plus the corresponding source entrypoints such as `src/index.ts` and `src/preset.ts`; in the published package, use the generated declaration files and package export map.

## Direct Adapter Cookbook

Use these direct adapters when a preset is not your integration surface, or when you are wiring Universal Bridge into an existing host server/tooling setup yourself.

### Next.js bridge keying

`withUniversalNext` creates isolated bridge keys by default. You can set `nextBridgeGlobalKey` for deterministic keying.

```ts
import { withUniversalNext } from "universal-bridge/next";

export default withUniversalNext(
  {},
  {
    nextBridgeGlobalKey: "__UNIVERSAL_NEXT_BRIDGE__:workspace-a",
  },
);
```

### Bun.serve integration

```ts
import {
  attachUniversalToBunServe,
  withUniversalBunServeFetch,
  withUniversalBunServeWebSocketHandlers,
} from "universal-bridge/bun";

const universal = await attachUniversalToBunServe({
  command: "acmetool",
  args: ["dev"],
  runtimeWebSocketGateway: { path: "/ws" },
});

const server = Bun.serve({
  fetch: withUniversalBunServeFetch((request) => new Response("ok"), universal),
  websocket: withUniversalBunServeWebSocketHandlers(universal),
});

// cleanup
await universal.close();
server.stop();
```

### Node server integration

```ts
import express from "express";
import http from "node:http";
import { attachUniversalToNodeServer } from "universal-bridge/node";

const app = express();
const server = http.createServer(app);

await attachUniversalToNodeServer(
  {
    middlewares: { use: app.use.bind(app) },
    httpServer: server,
  },
  {
    command: "acmetool",
    args: ["dev"],
  },
);
```

### Express integration

Use the Express adapter when you only need bridge HTTP routes in an Express middleware chain. If your tool needs the runtime WebSocket gateway, attach the Node adapter to the underlying HTTP server instead.

```ts
import express from "express";
import { attachUniversalToExpress } from "universal-bridge/express";

const app = express();

const universal = await attachUniversalToExpress(app, {
  command: "acmetool",
  args: ["dev"],
});

// cleanup
await universal.close();
```

### webpack-dev-server integration

```ts
import { withUniversalWebpackDevServer } from "universal-bridge/webpack";

export default {
  devServer: withUniversalWebpackDevServer({
    setupMiddlewares: (middlewares) => middlewares,
  }),
};
```

### Fastify integration

```ts
import Fastify from "fastify";
import { attachUniversalToFastify } from "universal-bridge/fastify";

const fastify = Fastify();

await attachUniversalToFastify(fastify, {
  command: "acmetool",
  args: ["dev"],
});
```

### NestJS integration

Nest does not need its own adapter unless a future lifecycle-specific behavior requires one. Reuse the underlying HTTP adapter.

```ts
import { NestFactory } from "@nestjs/core";
import { attachUniversalToExpress } from "universal-bridge/express";

import { AppModule } from "./app.module";

const app = await NestFactory.create(AppModule);
await attachUniversalToExpress(app.getHttpAdapter().getInstance(), {
  command: "acmetool",
  args: ["dev"],
});
```

```ts
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { attachUniversalToFastify } from "universal-bridge/fastify";

import { AppModule } from "./app.module";

const app = await NestFactory.create<NestFastifyApplication>(
  AppModule,
  new FastifyAdapter(),
);
await attachUniversalToFastify(app.getHttpAdapter().getInstance(), {
  command: "acmetool",
  args: ["dev"],
});
```

### Hono on Node integration

`attachUniversalToHonoNodeServer` uses the same Node-style server surface as `attachUniversalToNodeServer`.

```ts
import { attachUniversalToHonoNodeServer } from "universal-bridge/hono";

await attachUniversalToHonoNodeServer(
  {
    middlewares: {
      use: (handler) => {
        // register the handler on your Node HTTP middleware chain
      },
    },
    httpServer,
  },
  {
    command: "acmetool",
    args: ["dev"],
  },
);
```

### Rsbuild and Rspack integration

```ts
import { withUniversalRsbuild } from "universal-bridge/rsbuild";
import { withUniversalRspack } from "universal-bridge/rspack";

export const rsbuildConfig = withUniversalRsbuild({});
export const rspackConfig = withUniversalRspack({});
```

### Astro and Nuxt integration

```ts
import { defineConfig as defineAstroConfig } from "astro/config";
import { createUniversalAstroIntegration } from "universal-bridge/astro";

export default defineAstroConfig({
  integrations: [createUniversalAstroIntegration()],
});
```

```ts
import { defineNuxtConfig } from "nuxt/config";
import { createUniversalNuxtModule } from "universal-bridge/nuxt";

export default defineNuxtConfig({
  modules: [createUniversalNuxtModule()],
});
```

### Angular CLI proxy integration

```ts
import { createUniversalAngularCliProxyConfig } from "universal-bridge/angular/cli";

const proxyConfig = await createUniversalAngularCliProxyConfig({
  command: "acmetool",
  args: ["dev"],
});
```

### Docker Compose runtime helper

`createDockerComposeRuntime` only composes runtime command options; it does not check for Docker or attach to a host framework.
Pair it with a host adapter such as Vite, Next.js, Node, Express, or Fastify.

```ts
import { createDockerComposeRuntime } from "universal-bridge/docker";

const runtime = createDockerComposeRuntime({
  service: "acmetool",
  composeFile: "docker-compose.dev.yml",
  projectName: "acme",
  upArgs: ["--wait"],
  env: { DEBUG: "1" },
});

export default acmetool().vite(runtime);
```

The default test suite validates the helper without invoking Docker. To run the
real Docker Compose integration test, start Docker Desktop and opt in:

```bash
UNIVERSAL_BRIDGE_TEST_DOCKER=1 bun test src/tests/docker-runtime.test.ts
```

### Dev Containers and Codespaces

Run the bridge in the app host and the companion runtime wherever your project expects it: inside the same container, in another Compose service, or on the host. In containerized development, set the runtime `host` to the address reachable from the bridge process and forward the app dev-server port so browser requests still hit the same origin.

For a runtime service in Docker Compose, pair the helper with an adapter:

```ts
import { createDockerComposeRuntime } from "universal-bridge/docker";

const runtime = createDockerComposeRuntime({ service: "acmetool" });

export default acmetool().vite({
  ...runtime,
  host: "0.0.0.0",
});
```

Forward the dev-server port in Dev Containers or Codespaces. The browser should call `/__universal/*` on the app origin, while Universal Bridge manages or proxies the containerized runtime behind that origin.

### Standalone bridge (tooling/tests)

```ts
import { startStandaloneUniversalBridgeServer } from "universal-bridge";

const standalone = await startStandaloneUniversalBridgeServer({
  command: "acmetool",
  args: ["dev"],
});

console.log(standalone.baseUrl);
await standalone.close();
```
