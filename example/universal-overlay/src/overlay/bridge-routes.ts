import { BRIDGE_BASE_PATH } from "./constants.js";

export function bridgeRoute(path: string): string {
  return `${BRIDGE_BASE_PATH}${path}`;
}
