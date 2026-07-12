# Universal Bridge Integration Guide

This guide shows how to ship a tool package that exposes one integration API and works across frameworks via UniversalBridge.

## 1) Build a runtime command

Your tool runtime should listen on the port provided by `UNIVERSAL_RUNTIME_PORT` (default env var used by UniversalBridge).

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

## 2) Export a preset (recommended)

```ts
// src/index.ts
import { createUniversalPreset } from "universal-bridge/preset";

export function acmetool() {
  return createUniversalPreset({
    identity: { packageName: "acmetool" },
    command: "acmetool",
    args: ["dev"],
    fallbackCommand: "acmetool dev",
  });
}
```

Why presets are recommended:

- users import from one place (`acmetool`)
- namespace + bridge prefix are derived automatically
- framework adapters can compose safely when multiple presets are present

## 3) User integration examples

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

## 4) Bridge routes users get

Preset integrations are namespaced:

- `GET /__universal/acmetool/health`
- `GET /__universal/acmetool/state`
- `WS /__universal/acmetool/events`
- `ANY /__universal/acmetool/api/*`

## 5) Optional browser overlay client

```ts
import { createUniversalClient } from "universal-bridge/client";

const client = createUniversalClient({ namespaceId: "acmetool" });
const state = await client.getState();
console.log(state.runtime.phase);

const unsubscribe = client.subscribeEvents((event) => {
  if (event.type === "runtime-status") {
    console.log(event.status.phase);
  }
});

window.addEventListener("beforeunload", () => unsubscribe());
```

## 6) Important notes

- If `command` is omitted, `start`/`restart` runtime controls are unavailable by design.
- `stop` remains idempotent.
- `bridgePathPrefix` is normalized under `/__universal`.
- Keep your public API stable (`acmetool().vite()`, `acmetool().next(...)`, etc.).

## 7) Preset composition

- `createUniversalPreset` defaults to `composition: "registry"`.
- In `"registry"` mode, framework/build adapters compose all registered presets (`vite`, `next`, `nuxt`, `astro`, `webpack`, `rsbuild`, `rspack`).
- In `"local"` mode, a preset only applies its own framework/build wiring.
- Imperative adapters remain local to each preset instance (`bun`, `node`, `fastify`, `hono`, `angularCli`).

## 8) Public API coverage

### Core bridge and preset APIs

| API                                         | Import path               | Purpose                                        |
| ------------------------------------------- | ------------------------- | ---------------------------------------------- |
| `createUniversalPreset`                     | `universal-bridge/preset` | Unified integration surface for tool packages. |
| `createUniversalBridge` / `UniversalBridge` | `universal-bridge`        | Direct bridge instance control and attachment. |
| `startStandaloneUniversalBridgeServer`      | `universal-bridge`        | Standalone bridge server for tooling/tests.    |

### Client SDK and runtime-context helpers

| API                                                              | Import path                       | Purpose                                                    |
| ---------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------- |
| `createUniversalClient` / `UniversalClientError`                 | `universal-bridge/client`         | Typed health/state/runtime/event client.                   |
| `createClientRuntimeContext`                                     | `universal-bridge/client-runtime` | Create normalized namespace runtime context.               |
| `registerClientRuntimeContext` / `registerClientRuntimeContexts` | `universal-bridge/client-runtime` | Register module-to-context mappings.                       |
| `getClientRuntimeContexts` / `resolveClientRuntimeContext`       | `universal-bridge/client-runtime` | Read/resolve runtime contexts.                             |
| `resolveClientAutoMount`                                         | `universal-bridge/client-runtime` | Evaluate effective auto-mount from query/storage/defaults. |

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
| `attachUniversalToFastify`               | `universal-bridge/fastify` |
| `attachUniversalToHonoNodeServer`        | `universal-bridge/hono`    |

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

| API                          | Import path        |
| ---------------------------- | ------------------ |
| `RuntimeHelper`              | `universal-bridge` |
| `UNIVERSAL_PROTOCOL_VERSION` | `universal-bridge` |
| `UNIVERSAL_WS_SUBPROTOCOL`   | `universal-bridge` |

For the full public export list (including types), use `src/index.ts` as the source of truth.

## 9) Adapter-specific notes (when presets are not your integration surface)

If you expose framework-specific APIs instead of a preset, keep these behaviors documented for users.

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

### Hono (Node server) integration

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
