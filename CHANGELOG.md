# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/2.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - 2026-07-14

### Added

- Optional same-origin runtime WebSocket gateway at `/runtime/ws`, with binary frame, query-string, and runtime subprotocol forwarding.
- `getRuntimeWebSocketUrl()` client helper, including query-string construction, and `hasRuntimeWebSocketGateway` capability reporting for gateway feature detection.
- Express middleware and attachment APIs via `universal-bridge/express`, plus `preset.express.attach()` and `preset.express.middleware()`.
- `createDockerComposeRuntime()` via `universal-bridge/docker` for composing Docker Compose-backed runtime command options.
- React Router example host, shared example host metadata, and updated example runner/verification scripts.
- Updated examples, fixtures, and smoke scripts to exercise the runtime WebSocket gateway in Vite and Next.js hosts.
- Exported `RuntimeWebSocketGatewayOptions` for typed gateway configuration.

### Changed

- Kept `/events` bridge-protocol-only; runtime/app WebSocket traffic now belongs on the opt-in `/runtime/ws` gateway.
- Split the example overlay into focused runtime and files panes, with dashboard section tests covering the shared section model.

### Fixed

- Hardened runtime WebSocket gateway lifecycle handling for paired socket closure, runtime restart, explicit stop/auto-start behavior, and Bun adapter payload typing.

## [0.4.1] - 2026-07-12

### Changed

- Reconciled the changelog and GitHub release notes for published releases.

## [0.4.0] - 2026-07-12

### Added

- `createBridgeRuntimeStore` for shared browser runtime state, lifecycle actions, event ordering, and refresh.
- Preset `client.entries` support for auto-loaded development browser modules, with derived runtime context and cross-namespace duplicate protection.
- Development client-entry injection for Vite (including SvelteKit and Vinext), Next.js/Turbopack, Nuxt, and Astro.
- Browser-specific package exports, including the root-package browser condition, to keep server-only dependencies out of browser bundles.
- `onOpen` and `onClose` lifecycle callbacks for client event subscriptions.
- A consolidated example dashboard with Runtime, Files, and Settings views backed by a shared dashboard controller.

### Changed

- **Breaking:** Renamed the package from `universa-kit` to `universal-bridge`. Update installation commands, dependency declarations, and import specifiers.
- **Breaking:** Renamed public APIs from the `Universa` prefix to `Universal` (for example, `createUniversalBridge` and `createUniversalVitePlugin`).
- **Breaking:** Changed the default bridge prefix from `/__universa` to `/__universal`, including related runtime environment variable and fallback-command defaults.
- **Breaking:** Upgraded the bridge protocol from v1 to v2. WebSocket clients that send `Sec-WebSocket-Protocol` must offer `universal.v2+json`; v1 is rejected.
- **Breaking:** Replaced `runtime-status` and `runtime-error` events with `bridge-state` (a complete `UniversalBridgeState` snapshot) and `bridge-error`. `UniversalBridgeState` now includes a required monotonic `revision` field.
- Reorganized framework hosts and the reference overlay under `example/`; the overlay now registers and auto-mounts itself through `universalOverlay()` configuration.
- Refreshed example dashboard, file explorer, settings, and bridge-status presentation across framework examples.
- Reframed the documentation around Universal Bridge as a protocol for local processes and refreshed the README and banner.

### Removed

- Runtime WebSocket proxying through `/events`, including the `proxyRuntimeWebSocket` option. Connect runtime WebSocket clients directly to their runtime channel.

### Fixed

- Fixed Vite middleware registration after dev-server restarts.
- Kept the selected file-tree row visually stable on hover and aligned bridge status badges across the examples.
- Prevented duplicate Next browser-warning forwarding to the development terminal.
- Prevented intentional runtime stops from being reported as runtime failures, and preserved binary Bun WebSocket payloads safely.

## [0.2.0] - 2026-03-17

### Added

- `additionalRewriteSources` for proxying extra path prefixes directly to the runtime in Next.js.
- `createDirectRewriteRoute` from `universa-kit/internal` for creating direct runtime rewrite rules.
- Framework-aware client bootstrap injection that detects the active framework (SvelteKit, vinext, or generic) and selects the appropriate injection strategy.
- Support for SvelteKit client entry module transformation via the Vite plugin `transform` hook.
- Support for vinext virtual entry module transformation for client bootstrap injection.
- Shared client bootstrap module source builder (`buildClientBootstrapModuleSource`) with options for HMR acceptance and custom footer lines.
- Shared virtual ID factory (`createClientBootstrapVirtualIds`) that exposes public specifiers to eliminate repeated `/@id/` string construction.
- Transform hook guarding in preset framework activation system.

### Changed

- **Breaking:** Removed client auto-mount functionality. All examples now use explicit client bootstrap imports instead of automatic injection. Tool packages using `clientModule`/`autoMount` preset options must migrate to direct client imports.
- Refactored Vite plugin to use framework detection via `package.json` dependencies to determine the correct client injection strategy.
- Updated Astro, Nuxt, and Vite adapters to use shared bootstrap assembly helpers for consistency.
- Improved client bootstrap handling to avoid HTML injection for frameworks with their own client entry systems (SvelteKit, vinext).
- Simplified preset and adapter APIs by removing auto-mount plumbing from bridge, proxy, plugin, and adapter-utils modules.

### Fixed

- Client bootstrap injection for SvelteKit and vinext, which bypass the HTML injection path with their own client entry module systems.

### Removed

- `client-inject.cjs` and `instrumentation-client.ts` (Turbopack approach superseded by explicit imports).
- Client runtime context auto-mount metadata and related resolution logic.

## [0.1.2] - 2026-03-08

### Fixed

- Shadow DOM CSS issues in overlay component. Stripped `@supports` wrapper inside `@layer properties` during build step so Tailwind v4 `--tw-*` initial values always apply in `adoptedStyleSheets`. Chrome 130+ evaluates the fallback condition as false, and `@property` rules in constructed stylesheets don't register globally, both causing issues in shadow DOM context.
- Manual `--tw-*` reset block from `overlay.css` as build post-processing now handles this automatically.

### Changed

- Updated README with framework icon grid (Next.js, React, Vue, Nuxt, SvelteKit, Astro, Vite, Solid, Angular, Remix, Node.js, Bun, Webpack, Cloudflare).
- Replaced banner asset with `universakit.png`.

## [0.1.1] - 2026-03-04

### Changed

- Improved release workflow with tag-based manual dispatch and deterministic behavior.
- npm token fallback support in CI/CD pipeline.
- Validated the automated release pipeline for subsequent releases.

## [0.1.0] - 2026-03-04

Initial release of `universa-kit`, a universal bridge for in-browser development tools with cross-framework adapters, same-origin APIs, and runtime control.

### Added

- Same-origin bridge runtime mounted at `/__universa/*` with routes, websocket events channel, and runtime control capabilities.
- Typed client SDK (`universa-kit/client`) with bridge health/state/runtime APIs, websocket subscription, and typed errors.
- Runtime helper for optional runtime process management with command spawn/stop, health probing, and status transitions.
- Framework adapters for Vite, Next.js, Nuxt, Astro, and Angular CLI.
- Server adapters for Bun.serve, Node HTTP server, Fastify, and Hono.
- Build tool adapters for webpack-dev-server, Rsbuild, and Rspack.
- Preset composition API (`createUniversaPreset`) for tool packages with namespace isolation and multi-integration support.
- Client runtime context utilities and derived key/path handling for composed presets.
- Protocol documentation (PROTOCOL.md), architecture documentation (ARCHITECTURE.md), and integration guide.
- Automated tests, TypeScript declarations, and CI workflows with doc-sync validation.
- Eight framework examples (Next.js, Nuxt, Astro, SvelteKit, React, Vue, Solid, Vanilla) with shared UI components and example runner scripts.
- Development overlay with React UI, Tailwind CSS, dashboard panels, file explorer, and metadata display.

[0.5.0]: https://github.com/cpauldev/universal-bridge/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/cpauldev/universal-bridge/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/cpauldev/universal-bridge/compare/v0.2.0...v0.4.0
[0.2.0]: https://github.com/cpauldev/universal-bridge/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/cpauldev/universal-bridge/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/cpauldev/universal-bridge/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/cpauldev/universal-bridge/releases/tag/v0.1.0
