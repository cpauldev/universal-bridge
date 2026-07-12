import {
  type StandaloneBridgeServer,
  UniversalBridge,
  type UniversalBridgeOptions,
  startStandaloneUniversalBridgeServer,
} from "universal-bridge";
import { createUniversalPreset } from "universal-bridge/preset";

import {
  type ExampleConfigOptions,
  resolveExampleBridgeOptions,
  resolveExampleConfigOptions,
} from "./defaults.js";

export type ExampleBridgeOptions = UniversalBridgeOptions;
export type { StandaloneBridgeServer };

export class ExampleBridge extends UniversalBridge {
  constructor(options: ExampleBridgeOptions = {}) {
    super(resolveExampleBridgeOptions(options));
  }
}

export function createExampleBridge(
  options: ExampleBridgeOptions = {},
): ExampleBridge {
  return new ExampleBridge(options);
}

export async function startStandaloneExampleBridgeServer(
  options: ExampleBridgeOptions = {},
): Promise<StandaloneBridgeServer> {
  return startStandaloneUniversalBridgeServer(
    resolveExampleBridgeOptions(options),
  );
}

export function example(options: ExampleConfigOptions = {}) {
  return createUniversalPreset(resolveExampleConfigOptions(options));
}
