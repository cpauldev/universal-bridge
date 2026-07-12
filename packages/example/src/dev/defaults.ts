import { existsSync } from "fs";
import { basename, dirname, join } from "path";
import type {
  RuntimeHelperOptions,
  UniversalBridgeOptions,
} from "universal-bridge";
import type {
  UniversalPresetIdentity,
  UniversalPresetOptions,
} from "universal-bridge/preset";
import { fileURLToPath } from "url";

export const EXAMPLE_BRIDGE_PATH_PREFIX = "/__universal/example";
export const EXAMPLE_RUNTIME_HEALTH_PATH = "/api/version";
export const EXAMPLE_RUNTIME_PORT_ENV_VAR = "EXAMPLE_RUNTIME_PORT";
export const EXAMPLE_RUNTIME_FALLBACK_COMMAND = "example dev";
export const EXAMPLE_INSTANCE_ID_FALLBACK = "example";
export const EXAMPLE_CONFIG_PACKAGE_NAME = "example";

type ExampleInstanceOptions = {
  id?: string;
  label?: string;
};

type ExampleBridgeOptions = UniversalBridgeOptions & {
  instance?: ExampleInstanceOptions;
  proxyRuntimeWebSocket?: boolean;
};

function resolveExampleRuntimeScript(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  // Support both preserved-module output (dist/dev/defaults.js) and bundled output (dist/index.js).
  const bundledOutputPath = join(currentDir, "runtime", "server.js");
  if (existsSync(bundledOutputPath)) {
    return bundledOutputPath;
  }

  return join(currentDir, "..", "runtime", "server.js");
}

function resolveCommand(
  command?: string,
  args?: string[],
): { command: string; args: string[] } {
  if (command) {
    return { command, args: args ?? [] };
  }

  const defaultCommand =
    typeof process !== "undefined" && process.versions?.bun && process.execPath
      ? process.execPath
      : "bun";

  return {
    command: defaultCommand,
    args: args ?? [resolveExampleRuntimeScript()],
  };
}

function sanitizeInstanceId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || EXAMPLE_INSTANCE_ID_FALLBACK;
}

function deriveDefaultInstanceId(cwd?: string): string {
  return sanitizeInstanceId(basename((cwd || process.cwd()).trim()));
}

function resolveExampleInstance(
  options: ExampleBridgeOptions,
): ExampleInstanceOptions {
  const providedId = options.instance?.id?.trim();
  const id = providedId
    ? sanitizeInstanceId(providedId)
    : deriveDefaultInstanceId(options.cwd);
  const label = options.instance?.label?.trim();
  return {
    id,
    ...(label ? { label } : {}),
  };
}

export function resolveExampleRuntimeOptions(
  options: RuntimeHelperOptions = {},
): RuntimeHelperOptions {
  const resolvedCommand = resolveCommand(options.command, options.args);

  return {
    ...options,
    command: resolvedCommand.command,
    args: resolvedCommand.args,
    healthPath: options.healthPath ?? EXAMPLE_RUNTIME_HEALTH_PATH,
    runtimePortEnvVar:
      options.runtimePortEnvVar ?? EXAMPLE_RUNTIME_PORT_ENV_VAR,
  };
}

export function resolveExampleBridgeOptions(
  options: UniversalBridgeOptions = {},
): UniversalBridgeOptions {
  const bridgeOptions = options as ExampleBridgeOptions;
  const instance = resolveExampleInstance(bridgeOptions);

  return {
    ...resolveExampleRuntimeOptions(options),
    bridgePathPrefix: EXAMPLE_BRIDGE_PATH_PREFIX,
    fallbackCommand:
      options.fallbackCommand ?? EXAMPLE_RUNTIME_FALLBACK_COMMAND,
    proxyRuntimeWebSocket: bridgeOptions.proxyRuntimeWebSocket ?? false,
    instance,
  } as UniversalBridgeOptions;
}

export type ExampleConfigOptions = Omit<UniversalPresetOptions, "identity"> & {
  identity?: Omit<UniversalPresetIdentity, "packageName"> & {
    packageName?: string;
  };
};

export function resolveExampleConfigOptions(
  options: ExampleConfigOptions = {},
): UniversalPresetOptions {
  const {
    identity,
    unsafeOverrides,
    composition,
    instanceId,
    ...runtimeOptions
  } = options;

  const resolvedRuntime = resolveExampleRuntimeOptions(runtimeOptions);
  return {
    ...resolvedRuntime,
    fallbackCommand:
      runtimeOptions.fallbackCommand ?? EXAMPLE_RUNTIME_FALLBACK_COMMAND,
    proxyRuntimeWebSocket: runtimeOptions.proxyRuntimeWebSocket ?? false,
    identity: {
      packageName: identity?.packageName ?? EXAMPLE_CONFIG_PACKAGE_NAME,
      ...(identity?.variant ? { variant: identity.variant } : {}),
    },
    ...(unsafeOverrides ? { unsafeOverrides } : {}),
    ...(composition ? { composition } : {}),
    ...(instanceId ? { instanceId } : {}),
  };
}
