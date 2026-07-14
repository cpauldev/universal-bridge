export { universalOverlay } from "./dev/bridge.js";
export {
  DASHBOARD_FRAMEWORKS,
  EXAMPLE_FRAMEWORK_IDS,
  EXAMPLE_PORT_RANGE_START,
  getFrameworkDefaultPort,
} from "./example-hosts.js";
export {
  OVERLAY_BRIDGE_PATH_PREFIX,
  OVERLAY_MODULE_SPECIFIER,
  OVERLAY_PACKAGE_NAME,
  OVERLAY_RUNTIME_FALLBACK_COMMAND,
  OVERLAY_RUNTIME_PORT_ENV_VAR,
  OVERLAY_RUNTIME_WS_PATH,
} from "./overlay-config.js";
export { OverlayBridge } from "./dev/bridge.js";
export type { OverlayBridgeOptions } from "./dev/bridge.js";
export type { UniversalOverlayOptions } from "./dev/defaults.js";
export * as dashboard from "./dashboard/index.js";
