import {
  type MiddlewareAdapterServer,
  type UniversalAdapterOptions,
  createBridgeLifecycle,
  resolveAdapterOptions,
} from "../shared/adapter-utils.js";

export type AstroUniversalOptions = UniversalAdapterOptions;
export type UniversalAstroIntegration = {
  name: string;
  hooks: Record<string, (options: unknown) => void | Promise<void>>;
};

export function createUniversalAstroIntegration(
  options: AstroUniversalOptions = {},
): UniversalAstroIntegration {
  const resolvedOptions = resolveAdapterOptions(options);
  const lifecycle = createBridgeLifecycle(resolvedOptions);

  return {
    name: resolvedOptions.adapterName,
    hooks: {
      "astro:server:setup": async (options: unknown) => {
        const server = (options as { server?: MiddlewareAdapterServer })
          ?.server;
        if (!server) return;
        await lifecycle.setup(server);
      },
      "astro:server:done": async () => {
        await lifecycle.teardown();
      },
    },
  };
}
