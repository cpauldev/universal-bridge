import { createRequire } from "module";
import { join } from "path";

import type { UniversalClientRuntimeContext } from "../client/runtime-context.js";

export interface UniversalClientEntry {
  /** Browser module that initializes its own developer-facing client feature. */
  module: string;
}

export interface ResolvedUniversalClientEntry extends UniversalClientEntry {
  context: UniversalClientRuntimeContext;
}

export type ViteClientEntryPlugin = {
  name: string;
  enforce: "post";
  apply: "serve";
  configResolved: (config: { root: string }) => void;
  resolveId: (id: string) => string | null | undefined;
  load: (id: string) => string | null;
  transformIndexHtml: () => {
    tags: Array<{
      tag: "script";
      attrs: { type: "module"; src: string };
      injectTo: "head";
    }>;
  };
  transform: (
    code: string,
    id: string,
    options?: { ssr?: boolean },
  ) => string | null;
};

const VIRTUAL_CLIENT_ENTRY = "\0universal-bridge:client-entry";
const PUBLIC_VIRTUAL_CLIENT_ENTRY = "virtual:universal-bridge:client-entry";
const VIRTUAL_CLIENT_ENTRY_URL = "/@id/__x00__universal-bridge:client-entry";
const SVELTEKIT_CLIENT_ENTRY =
  /[\\/]\.svelte-kit[\\/]generated[\\/]client[\\/]app\.js$/;
const VINEXT_CLIENT_ENTRY = "virtual:vite-rsc/entry-browser";
const REACT_ROUTER_DEFAULT_CLIENT_ENTRY =
  /[\\/]@react-router[\\/]dev[\\/]dist[\\/]config[\\/]defaults[\\/]entry\.client\.tsx$/;
const REACT_ROUTER_APP_CLIENT_ENTRY = /[\\/]app[\\/]entry\.client\.[jt]sx?$/;
const ASTRO_PAGE_SCRIPT_QUERY = "?astro&type=script";
const CLIENT_ENTRY_MARKER_PREFIX = "__UNIVERSAL_CLIENT_ENTRIES__:";

function stableEntryKey(
  entries: readonly ResolvedUniversalClientEntry[],
): string {
  return entries
    .map((entry) => entry.module)
    .sort()
    .join("|");
}

function createBootstrap(
  entries: readonly ResolvedUniversalClientEntry[],
): string {
  const contexts = Object.fromEntries(
    entries.map((entry) => [entry.module, entry.context]),
  );
  const marker = `${CLIENT_ENTRY_MARKER_PREFIX}${stableEntryKey(entries)}`;
  const contextsJson = JSON.stringify(contexts);
  const imports = entries
    .map((entry) => `import(${JSON.stringify(entry.module)})`)
    .join(", ");

  return [
    `const __universalClientEntryMarker = Symbol.for(${JSON.stringify(marker)});`,
    "if (!globalThis[__universalClientEntryMarker]) {",
    "  globalThis[__universalClientEntryMarker] = true;",
    '  const __universalClientRuntimeContexts = globalThis["__UNIVERSAL_CLIENT_RUNTIME_CONTEXTS__"] ??= {};',
    `  Object.assign(__universalClientRuntimeContexts, ${contextsJson});`,
    `  void Promise.all([${imports}]);`,
    "}",
  ].join("\n");
}

function isClientEntryTarget(id: string): boolean {
  return (
    SVELTEKIT_CLIENT_ENTRY.test(id) ||
    id.includes(VINEXT_CLIENT_ENTRY) ||
    REACT_ROUTER_DEFAULT_CLIENT_ENTRY.test(id) ||
    REACT_ROUTER_APP_CLIENT_ENTRY.test(id) ||
    id.includes(ASTRO_PAGE_SCRIPT_QUERY)
  );
}

export function createUniversalClientEntryVitePlugin(
  entries: readonly ResolvedUniversalClientEntry[],
): ViteClientEntryPlugin | null {
  if (entries.length === 0) return null;

  const bootstrap = createBootstrap(entries);
  const entryModules = new Set(entries.map((entry) => entry.module));
  let viteRoot = process.cwd();

  function resolveClientEntryModule(id: string): string | undefined {
    if (!entryModules.has(id)) return undefined;

    try {
      return createRequire(join(viteRoot, "package.json")).resolve(id);
    } catch {
      return undefined;
    }
  }

  return {
    name: "universal-bridge:client-entry",
    enforce: "post",
    apply: "serve",
    configResolved(config) {
      viteRoot = config.root;
    },
    resolveId(id) {
      if (id === PUBLIC_VIRTUAL_CLIENT_ENTRY || id === VIRTUAL_CLIENT_ENTRY) {
        return VIRTUAL_CLIENT_ENTRY;
      }
      return resolveClientEntryModule(id);
    },
    load(id) {
      return id === VIRTUAL_CLIENT_ENTRY ? bootstrap : null;
    },
    transformIndexHtml: () => ({
      tags: [
        {
          tag: "script",
          attrs: { type: "module", src: VIRTUAL_CLIENT_ENTRY_URL },
          injectTo: "head",
        },
      ],
    }),
    transform(code, id, options) {
      if (options?.ssr || !isClientEntryTarget(id)) return null;
      if (id.includes(VINEXT_CLIENT_ENTRY)) {
        return `${code}\nqueueMicrotask(() => {\n${bootstrap}\n});`;
      }
      return `${bootstrap}\n${code}`;
    },
  };
}

export function createUniversalClientEntryBootstrap(
  entries: readonly ResolvedUniversalClientEntry[],
): string | null {
  return entries.length === 0 ? null : createBootstrap(entries);
}
