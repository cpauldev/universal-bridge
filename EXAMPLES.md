# Universal Examples

This document explains the workspace examples under `examples/` and how to run/verify them.

## What examples are included?

Each example mounts the `example` package (from `packages/example`) into a framework dev server and exposes bridge routes under `/__universal/example/*`.

| ID          | Framework  | Starting port |
| ----------- | ---------- | ------------- |
| `react`     | React      | 4600          |
| `vue`       | Vue        | 4601          |
| `sveltekit` | SvelteKit  | 4602          |
| `solid`     | Solid      | 4603          |
| `astro`     | Astro      | 4604          |
| `nextjs`    | Next.js    | 4605          |
| `nuxt`      | Nuxt       | 4606          |
| `vanilla`   | Vanilla JS | 4607          |
| `vinext`    | Vinext     | 4608          |

The runner starts searching at `4600` and automatically advances when a port is already in use.

## Prerequisites

- [Bun](https://bun.sh) (workspace package manager + script runner)
- Node.js 20 or 22 (required by some framework dev servers)

## Setup (first run)

```bash
bun run examples:setup
```

This script:

1. installs workspace dependencies (`bun install`)
2. builds `universal-bridge`
3. builds `packages/example`

Optional force re-link:

```bash
bun run examples:setup --force
```

Use this if workspace linking becomes stale after branch switches or lockfile changes.

## Run examples

### Start all

```bash
bun run examples
```

### Start selected examples

```bash
bun run examples react nextjs
bun run examples vinext
```

### Disable browser auto-open

```bash
bun run examples --no-open
bun run examples react nextjs --no-open
```

The examples runner assigns and passes `--port` automatically. Example app configs should not hard-code ports.

## Verify bridge wiring

```bash
bun run verify:examples
```

Verification checks each running example for:

- `GET /__universal/example/health`
- `GET /__universal/example/state`

You can target specific examples:

```bash
bun run verify:examples react nuxt
```

## Rebuild guidance after changes

Rebuild when you change:

- `src/` (core package)
- `packages/example/src/` (example overlay/runtime)

Commands:

```bash
bun run build
bun run build --filter=example
```

Or run setup again:

```bash
bun run examples:setup
```

## Example structure

Each `examples/<id>/` project is a standard framework app that imports the `example` preset and applies the framework adapter (`example().vite()`, `example().next(...)`, `example().astro()`, `example().nuxt()`, etc.).

Shared dashboard UI primitives live in `examples/shared/ui` (`example-ui` workspace package).

## Framework-specific notes

- **Vinext + Solid**: both use Vite adapter integration.
- **Vinext**: includes `resolve.dedupe` and `optimizeDeps.include` tweaks to avoid Bun workspace resolution issues.
- **Nuxt**: examples runner uses `--no-fork` for stability during multi-example runs.

## Troubleshooting

- If examples fail to resolve workspace packages, run `bun run examples:setup --force`.
- If a runner says another examples process is active, stop that process (the runner uses a lock file).
- Stop all running examples with `Ctrl+C`.
