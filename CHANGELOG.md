# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/2.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-07-12

### Changed

- **Breaking:** Renamed the package from `universa-kit` to `universal-bridge`. Update installation commands, dependency declarations, and all import specifiers.
- **Breaking:** Renamed public APIs from the `Universa` prefix to `Universal` (for example, `createUniversalBridge` and `createUniversalVitePlugin`).
- **Breaking:** Changed the default control-plane prefix from `/__universa` to `/__universal`, along with related runtime environment variable and fallback-command defaults.
- Reframed the documentation around Universal Bridge as a protocol for local services, refreshed the README, and replaced the banner with an optimized WebP asset.

## [0.2.1] - 2026-07-07

### Fixed

- Vite plugin middleware registration after dev server restarts (Vite 5.0.4+ compatibility). The framework activation system now tracks which configuration has set up each specific server instance, preventing duplicate middleware registration and ensuring middleware is correctly applied after Vite restarts the dev server with a new server instance.

## [0.2.0] - 2026-03-17

Removed client auto-mount functionality in favor of explicit client bootstrap imports. This is a breaking change for tool packages that relied on automatic injection.

### Added

- Framework-aware client bootstrap injection that detects the active framework (SvelteKit, vinext, or generic) and selects the appropriate injection strategy.
- Support for SvelteKit client entry module transformation via the Vite plugin `transform` hook.
- Support for vinext virtual entry module transformation for client bootstrap injection.
- Shared client bootstrap module source builder (`buildClientBootstrapModuleSource`) with options for HMR acceptance and custom footer lines.
- Shared virtual ID factory (`createClientBootstrapVirtualIds`) that exposes public specifiers to eliminate repeated `/@id/` string construction.
- Transform hook guarding in preset framework activation system.

### Changed

- **BREAKING:** Removed client auto-mount functionality. All examples now use explicit client bootstrap imports instead of automatic injection. Tool packages using `clientModule`/`autoMount` preset options must migrate to direct client imports.
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

[0.3.0]: https://github.com/cpauldev/universal-bridge/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/cpauldev/universal-bridge/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/cpauldev/universal-bridge/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/cpauldev/universal-bridge/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/cpauldev/universal-bridge/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/cpauldev/universal-bridge/releases/tag/v0.1.0
