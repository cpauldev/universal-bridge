import type { MiddlewareAdapterServer } from "../shared/adapter-utils.js";
import {
  type NodeBridgeHandle,
  type NodeUniversalOptions,
  attachUniversalToNodeServer,
  createNodeBridgeLifecycle,
} from "./node.js";

export type HonoNodeServer = MiddlewareAdapterServer;
export type HonoUniversalOptions = NodeUniversalOptions;
export type HonoBridgeHandle = NodeBridgeHandle;

export const createHonoBridgeLifecycle = createNodeBridgeLifecycle;

export function attachUniversalToHonoNodeServer(
  server: HonoNodeServer,
  options: HonoUniversalOptions = {},
): Promise<HonoBridgeHandle> {
  return attachUniversalToNodeServer(server, options);
}
