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

import {
  OVERLAY_BRIDGE_PATH_PREFIX,
  OVERLAY_PACKAGE_NAME,
  OVERLAY_RUNTIME_FALLBACK_COMMAND,
  OVERLAY_RUNTIME_PORT_ENV_VAR,
  OVERLAY_RUNTIME_WS_PATH,
} from "../overlay-config.js";
import { RUNTIME_HEALTH_PATH } from "../runtime/routes.js";

type OverlayInstanceOptions = {
  id?: string;
  label?: string;
};

type OverlayBridgeOptions = UniversalBridgeOptions & {
  instance?: OverlayInstanceOptions;
};

function resolveOverlayRuntimeScript(): string {
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
    args: args ?? [resolveOverlayRuntimeScript()],
  };
}

function sanitizeInstanceId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || OVERLAY_PACKAGE_NAME;
}

function deriveDefaultInstanceId(cwd?: string): string {
  return sanitizeInstanceId(basename((cwd || process.cwd()).trim()));
}

function resolveOverlayInstance(
  options: OverlayBridgeOptions,
): OverlayInstanceOptions {
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

function resolveOverlayRuntimeOptions(
  options: RuntimeHelperOptions = {},
): RuntimeHelperOptions {
  const resolvedCommand = resolveCommand(options.command, options.args);

  return {
    ...options,
    command: resolvedCommand.command,
    args: resolvedCommand.args,
    healthPath: options.healthPath ?? RUNTIME_HEALTH_PATH,
    runtimePortEnvVar:
      options.runtimePortEnvVar ?? OVERLAY_RUNTIME_PORT_ENV_VAR,
  };
}

export function resolveOverlayBridgeOptions(
  options: UniversalBridgeOptions = {},
): UniversalBridgeOptions {
  const bridgeOptions = options as OverlayBridgeOptions;
  const instance = resolveOverlayInstance(bridgeOptions);

  return {
    ...resolveOverlayRuntimeOptions(options),
    bridgePathPrefix: OVERLAY_BRIDGE_PATH_PREFIX,
    runtimeWebSocketGateway: { path: OVERLAY_RUNTIME_WS_PATH },
    fallbackCommand:
      options.fallbackCommand ?? OVERLAY_RUNTIME_FALLBACK_COMMAND,
    instance,
  } as UniversalBridgeOptions;
}

export type UniversalOverlayOptions = Omit<
  UniversalPresetOptions,
  "identity"
> & {
  identity?: Omit<UniversalPresetIdentity, "packageName"> & {
    packageName?: string;
  };
};

export function resolveUniversalOverlayOptions(
  options: UniversalOverlayOptions = {},
): UniversalPresetOptions {
  const {
    identity,
    unsafeOverrides,
    composition,
    instanceId,
    ...runtimeOptions
  } = options;

  const resolvedRuntime = resolveOverlayRuntimeOptions(runtimeOptions);
  return {
    ...resolvedRuntime,
    runtimeWebSocketGateway: { path: OVERLAY_RUNTIME_WS_PATH },
    fallbackCommand:
      runtimeOptions.fallbackCommand ?? OVERLAY_RUNTIME_FALLBACK_COMMAND,
    identity: {
      packageName: identity?.packageName ?? OVERLAY_PACKAGE_NAME,
      ...(identity?.variant ? { variant: identity.variant } : {}),
    },
    ...(unsafeOverrides ? { unsafeOverrides } : {}),
    ...(composition ? { composition } : {}),
    ...(instanceId ? { instanceId } : {}),
  };
}
