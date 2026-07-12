import {
  type UniversalAdapterOptions,
  type ViteAdapterServer,
  createBridgeLifecycle,
  resolveAdapterOptions,
} from "./adapter-utils.js";

export type UniversalVitePluginOptions = UniversalAdapterOptions;
export function createUniversalVitePlugin(
  options: UniversalVitePluginOptions = {},
) {
  const resolvedOptions = resolveAdapterOptions(options);
  const lifecycle = createBridgeLifecycle(resolvedOptions);

  return {
    name: resolvedOptions.adapterName,
    enforce: "pre" as const,
    apply: "serve" as const,

    async configureServer(server: ViteAdapterServer) {
      await lifecycle.setup(server);
    },
  };
}
