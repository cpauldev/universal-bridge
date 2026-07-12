import type { UniversalBridge } from "../../bridge/bridge.js";
import {
  type BridgeLifecycle,
  type MiddlewareAdapterServer,
  type UniversalAdapterOptions,
  createBridgeLifecycle,
} from "../shared/adapter-utils.js";

export type NodeUniversalOptions = UniversalAdapterOptions;

export interface NodeBridgeHandle {
  bridge: UniversalBridge;
  close: () => Promise<void>;
}

export function createNodeBridgeLifecycle(
  options: NodeUniversalOptions = {},
): BridgeLifecycle {
  return createBridgeLifecycle(options);
}

export async function attachUniversalToNodeServer(
  server: MiddlewareAdapterServer,
  options: NodeUniversalOptions = {},
): Promise<NodeBridgeHandle> {
  const lifecycle = createNodeBridgeLifecycle(options);
  const bridge = await lifecycle.setup(server);
  return {
    bridge,
    close: async () => {
      await lifecycle.teardown();
    },
  };
}
