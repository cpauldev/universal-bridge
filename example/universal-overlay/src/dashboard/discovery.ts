import { DASHBOARD_FRAMEWORKS } from "../example-hosts.js";
import { BRIDGE_BASE_PATH } from "../overlay/constants.js";
import type {
  DashboardDiscoveredInstance,
  DashboardDiscoveryConfig,
  DashboardDiscoveryState,
  DashboardFrameworkDefinition,
  DashboardFrameworkId,
  DashboardFrameworkNavItem,
  DashboardHealthPayload,
} from "./types.js";

const DEFAULT_CONFIG: DashboardDiscoveryConfig = {
  frameworks: [...DASHBOARD_FRAMEWORKS],
  hostnames: ["127.0.0.1", "localhost"],
  scanWindowSize: 10,
  probeTimeoutMs: 800,
  knownPollIntervalMs: 4000,
  fullScanIntervalMs: 30000,
  offlineFailureThreshold: 2,
};

function isFrameworkId(
  value: string,
  frameworks: DashboardFrameworkDefinition[],
): value is DashboardFrameworkId {
  return frameworks.some((framework) => framework.id === value);
}

function getFrameworkByPort(
  port: number,
  frameworks: DashboardFrameworkDefinition[],
): DashboardFrameworkDefinition | null {
  return frameworks.find((framework) => framework.defaultPort === port) ?? null;
}

function normalizeOrigin(origin: string): string {
  try {
    const parsed = new URL(origin);
    parsed.pathname = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return origin.replace(/\/$/, "");
  }
}

function resolveOriginPort(origin: string): number {
  try {
    const parsed = new URL(origin);
    if (parsed.port) return Number.parseInt(parsed.port, 10);
    return parsed.protocol === "https:" ? 443 : 80;
  } catch {
    return 0;
  }
}

function createFrameworkItems(
  frameworks: DashboardFrameworkDefinition[],
): DashboardFrameworkNavItem[] {
  return frameworks.map((framework) => ({
    id: framework.id,
    label: framework.label,
    online: false,
    href: null,
    port: null,
    duplicateCount: 0,
    instances: [],
  }));
}

function compareDiscoveredInstances(
  a: DashboardDiscoveredInstance,
  b: DashboardDiscoveredInstance,
): number {
  if (a.online !== b.online) {
    return a.online ? -1 : 1;
  }

  const healthyA = a.lastHealthyAt ?? 0;
  const healthyB = b.lastHealthyAt ?? 0;
  if (healthyA !== healthyB) {
    return healthyB - healthyA;
  }

  return a.port - b.port;
}

export function createInitialDiscoveryState(
  frameworks: DashboardFrameworkDefinition[] = DASHBOARD_FRAMEWORKS,
): DashboardDiscoveryState {
  return {
    instancesByOrigin: {},
    frameworkItems: createFrameworkItems(frameworks),
    lastScanAt: null,
  };
}

export function resolveDiscoveryConfig(
  partial: Partial<DashboardDiscoveryConfig> = {},
): DashboardDiscoveryConfig {
  const hostnames = new Set<string>([
    ...DEFAULT_CONFIG.hostnames,
    ...(partial.hostnames ?? []),
  ]);

  if (typeof window !== "undefined") {
    const hostname = window.location.hostname?.trim();
    if (hostname && hostname !== "0.0.0.0") {
      hostnames.add(hostname);
    }
  }

  return {
    ...DEFAULT_CONFIG,
    ...partial,
    frameworks: partial.frameworks ?? DEFAULT_CONFIG.frameworks,
    hostnames: [...hostnames],
  };
}

function buildBoundedScanOrigins(
  config: DashboardDiscoveryConfig,
  knownOrigins: Set<string>,
): string[] {
  const origins = new Set<string>();

  for (const knownOrigin of knownOrigins) {
    origins.add(normalizeOrigin(knownOrigin));
  }

  const defaultPorts = config.frameworks.map(
    (framework) => framework.defaultPort,
  );
  if (defaultPorts.length === 0) {
    return [...origins];
  }

  const firstPort = Math.min(...defaultPorts);
  const lastPort = Math.max(...defaultPorts) + config.scanWindowSize;

  for (let port = firstPort; port <= lastPort; port += 1) {
    for (const hostname of config.hostnames) {
      origins.add(`http://${hostname}:${port}`);
    }
  }

  return [...origins];
}

async function probeOrigin(
  origin: string,
  timeoutMs: number,
): Promise<{ ok: boolean; payload: DashboardHealthPayload | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${origin}${BRIDGE_BASE_PATH}/health`, {
      method: "GET",
      cache: "no-store",
      mode: "cors",
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, payload: null };
    }

    const payload = (await response.json()) as DashboardHealthPayload;
    if (payload?.ok === true && payload?.bridge === true) {
      return { ok: true, payload };
    }

    return { ok: false, payload: null };
  } catch {
    return { ok: false, payload: null };
  } finally {
    clearTimeout(timeout);
  }
}

function resolveFrameworkIdForInstance(input: {
  payload: DashboardHealthPayload | null;
  port: number;
  frameworks: DashboardFrameworkDefinition[];
}): DashboardFrameworkId | null {
  const instanceId = input.payload?.instance?.id?.trim();
  if (instanceId && isFrameworkId(instanceId, input.frameworks)) {
    return instanceId;
  }

  if (!instanceId) {
    return getFrameworkByPort(input.port, input.frameworks)?.id ?? null;
  }

  return null;
}

function resolveFrameworkItems(input: {
  frameworks: DashboardFrameworkDefinition[];
  instancesByOrigin: Record<string, DashboardDiscoveredInstance>;
  currentOrigin: string | null;
}): DashboardFrameworkNavItem[] {
  const values = Object.values(input.instancesByOrigin);

  return input.frameworks.map((framework) => {
    const instances = values
      .filter((instance) => instance.frameworkId === framework.id)
      .sort(compareDiscoveredInstances);

    const onlineInstances = instances.filter((instance) => instance.online);
    const preferredCurrent = input.currentOrigin
      ? (onlineInstances.find(
          (instance) =>
            normalizeOrigin(instance.origin) === input.currentOrigin,
        ) ?? null)
      : null;

    const preferred = preferredCurrent ?? onlineInstances[0] ?? null;

    return {
      id: framework.id,
      label: framework.label,
      online: Boolean(preferred),
      href: preferred?.origin ?? null,
      port: preferred?.port ?? null,
      duplicateCount: Math.max(onlineInstances.length - 1, 0),
      instances,
    };
  });
}

function updateDiscoveryState(input: {
  state: DashboardDiscoveryState;
  config: DashboardDiscoveryConfig;
  results: Array<{
    origin: string;
    ok: boolean;
    payload: DashboardHealthPayload | null;
  }>;
  now: number;
  currentOrigin: string | null;
}): DashboardDiscoveryState {
  const instancesByOrigin: Record<string, DashboardDiscoveredInstance> = {
    ...input.state.instancesByOrigin,
  };

  for (const result of input.results) {
    const origin = normalizeOrigin(result.origin);
    const port = resolveOriginPort(origin);
    const previous = instancesByOrigin[origin];

    if (result.ok) {
      const frameworkId = resolveFrameworkIdForInstance({
        payload: result.payload,
        port,
        frameworks: input.config.frameworks,
      });

      instancesByOrigin[origin] = {
        origin,
        port,
        online: true,
        frameworkId,
        instanceId: result.payload?.instance?.id ?? null,
        instanceLabel: result.payload?.instance?.label ?? null,
        lastSeenAt: input.now,
        lastHealthyAt: input.now,
        failures: 0,
      };
      continue;
    }

    const nextFailures = (previous?.failures ?? 0) + 1;
    instancesByOrigin[origin] = {
      origin,
      port,
      online:
        nextFailures < input.config.offlineFailureThreshold
          ? (previous?.online ?? false)
          : false,
      frameworkId: previous?.frameworkId ?? null,
      instanceId: previous?.instanceId ?? null,
      instanceLabel: previous?.instanceLabel ?? null,
      lastSeenAt: input.now,
      lastHealthyAt: previous?.lastHealthyAt ?? null,
      failures: nextFailures,
    };
  }

  return {
    instancesByOrigin,
    frameworkItems: resolveFrameworkItems({
      frameworks: input.config.frameworks,
      instancesByOrigin,
      currentOrigin: input.currentOrigin,
    }),
    lastScanAt: input.now,
  };
}

function resolveCurrentOrigin(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return normalizeOrigin(window.location.origin);
  } catch {
    return null;
  }
}

export interface DashboardDiscoveryController {
  getState: () => DashboardDiscoveryState;
  subscribe: (listener: (state: DashboardDiscoveryState) => void) => () => void;
  start: () => void;
  stop: () => void;
  scanNow: () => Promise<void>;
}

export function createDashboardDiscoveryController(
  partialConfig: Partial<DashboardDiscoveryConfig> = {},
): DashboardDiscoveryController {
  const config = resolveDiscoveryConfig(partialConfig);
  const knownOrigins = new Set<string>();
  const listeners = new Set<(state: DashboardDiscoveryState) => void>();
  const currentOrigin = resolveCurrentOrigin();

  let state = createInitialDiscoveryState(config.frameworks);
  let knownPollTimer: ReturnType<typeof setInterval> | null = null;
  let fullScanTimer: ReturnType<typeof setInterval> | null = null;
  let scanSequence = Promise.resolve();

  if (currentOrigin) {
    knownOrigins.add(currentOrigin);
  }

  const notify = () => {
    for (const listener of listeners) {
      listener(state);
    }
  };

  const runScan = async (origins: string[]): Promise<void> => {
    if (origins.length === 0) return;

    const uniqueOrigins = [
      ...new Set(origins.map((origin) => normalizeOrigin(origin))),
    ];
    const results = await Promise.all(
      uniqueOrigins.map(async (origin) => {
        const probe = await probeOrigin(origin, config.probeTimeoutMs);
        if (probe.ok) {
          knownOrigins.add(origin);
        }
        return {
          origin,
          ok: probe.ok,
          payload: probe.payload,
        };
      }),
    );

    state = updateDiscoveryState({
      state,
      config,
      results,
      now: Date.now(),
      currentOrigin,
    });
    notify();
  };

  const queueScan = (origins: string[]): Promise<void> => {
    scanSequence = scanSequence
      .then(() => runScan(origins))
      .catch(() => {
        // Ignore scan errors to keep polling resilient.
      });
    return scanSequence;
  };

  const runKnownPoll = (): Promise<void> => {
    const origins = [...knownOrigins];
    return queueScan(origins);
  };

  const runFullScan = (): Promise<void> => {
    const origins = buildBoundedScanOrigins(config, knownOrigins);
    return queueScan(origins);
  };

  return {
    getState() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      if (knownPollTimer || fullScanTimer) return;

      void runFullScan();
      knownPollTimer = setInterval(() => {
        void runKnownPoll();
      }, config.knownPollIntervalMs);
      fullScanTimer = setInterval(() => {
        void runFullScan();
      }, config.fullScanIntervalMs);
    },
    stop() {
      if (knownPollTimer) {
        clearInterval(knownPollTimer);
        knownPollTimer = null;
      }
      if (fullScanTimer) {
        clearInterval(fullScanTimer);
        fullScanTimer = null;
      }
    },
    scanNow() {
      return runFullScan();
    },
  };
}
