import { afterEach, describe, expect, it } from "bun:test";

import {
  type UniversalClientRuntimeContext,
  createClientRuntimeContext,
  registerClientRuntimeContext,
  resolveClientAutoMount,
  resolveClientRuntimeContext,
} from "../client/runtime-context.js";

const CLIENT_MODULE = "@tests/client";
const GLOBAL_CONTEXTS_KEY = "__UNIVERSAL_CLIENT_RUNTIME_CONTEXTS__";

type MockWindow = {
  location: { search: string };
  localStorage: {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
  };
};

function createClientContext(): UniversalClientRuntimeContext {
  return createClientRuntimeContext({
    namespaceId: "tests-client",
  });
}

function installMockWindow(search = ""): { storage: Map<string, string> } {
  const storage = new Map<string, string>();
  const mockWindow: MockWindow = {
    location: { search },
    localStorage: {
      getItem(key: string) {
        return storage.has(key) ? (storage.get(key) ?? null) : null;
      },
      setItem(key: string, value: string) {
        storage.set(key, value);
      },
    },
  };

  (globalThis as Record<string, unknown>).window = mockWindow;
  return { storage };
}

afterEach(() => {
  const runtimeGlobal = globalThis as typeof globalThis & {
    [GLOBAL_CONTEXTS_KEY]?: unknown;
    window?: unknown;
  };
  delete runtimeGlobal[GLOBAL_CONTEXTS_KEY];
  delete (runtimeGlobal as Record<string, unknown>).window;
});

describe("client runtime context", () => {
  it("creates normalized runtime context from namespaceId", () => {
    const context = createClientRuntimeContext({
      namespaceId: "@Tests/Client",
    });

    expect(context.namespaceId).toBe("tests-client");
    expect(context.bridgePathPrefix).toBe("/__universal/tests-client");
    expect(context.keyPrefix).toBe("universal:client:tests-client");
    expect(context.rootId).toBe("universal-client-tests-client");
    expect(context.instanceKey).toBe(
      "__UNIVERSAL_CLIENT_INSTANCE__:tests-client",
    );
    expect(context.stateStorageKey).toBe("universal:client:tests-client:state");
    expect(context.enabledStorageKey).toBe(
      "universal:client:tests-client:enabled",
    );
  });

  it("accepts explicit bridge path prefix and keeps universal root", () => {
    const context = createClientRuntimeContext({
      namespaceId: "tests-client",
      bridgePathPrefix: "custom/tests-client",
    });

    expect(context.bridgePathPrefix).toBe("/__universal/custom/tests-client");
  });

  it("registers and resolves client contexts by module specifier", () => {
    const context = createClientContext();
    registerClientRuntimeContext(CLIENT_MODULE, context);

    expect(resolveClientRuntimeContext(CLIENT_MODULE)).toEqual(context);
  });

  it("resolves auto-mount precedence: scoped query > global query > storage > default", () => {
    const context = createClientContext();
    registerClientRuntimeContext(CLIENT_MODULE, context);

    const scopedQueryKey = `universalClient.${context.namespaceId}`;
    installMockWindow(`?${scopedQueryKey}=false&universalClient=true`);
    expect(resolveClientAutoMount(CLIENT_MODULE, true)).toBe(false);

    const { storage } = installMockWindow("?universalClient=false");
    storage.set(context.enabledStorageKey, "true");
    expect(resolveClientAutoMount(CLIENT_MODULE, true)).toBe(false);

    const fromStorage = installMockWindow("");
    fromStorage.storage.set(context.enabledStorageKey, "false");
    expect(resolveClientAutoMount(CLIENT_MODULE, true)).toBe(false);
  });

  it("returns false when client is context-disabled", () => {
    registerClientRuntimeContext(CLIENT_MODULE, {
      ...createClientContext(),
      clientEnabled: false,
      autoMount: true,
    });
    installMockWindow("?universalClient=true");
    expect(resolveClientAutoMount(CLIENT_MODULE, true)).toBe(false);
  });
});
