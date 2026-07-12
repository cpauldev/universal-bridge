import { type ResultPromise, execa } from "execa";
import { createServer } from "net";

import type { UniversalRuntimeStatus } from "../types.js";

const DEFAULT_START_TIMEOUT_MS = 15000;
const DEFAULT_HEALTH_PATH = "/api/version";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_RUNTIME_PORT_ENV_VAR = "UNIVERSAL_RUNTIME_PORT";

export interface RuntimeHelperOptions {
  cwd?: string;
  startTimeoutMs?: number;
  command?: string;
  args?: string[];
  env?: Record<string, string | undefined>;
  host?: string;
  healthPath?: string;
  runtimePortEnvVar?: string;
}

export interface RuntimeControlSupport {
  hasRuntimeControl: boolean;
  reason: "configured" | "missing_command";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findOpenPort(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to allocate a runtime port"));
        return;
      }

      const { port } = address;
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function waitForHealth(
  url: string,
  healthPath: string,
  timeoutMs: number,
): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${url}${healthPath}`);
      if (response.ok) {
        return;
      }
      lastError = new Error(`Health check failed with ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await delay(160);
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error("Timed out waiting for runtime health check");
}

function resolveRuntimeCommand(options: RuntimeHelperOptions): {
  command: string;
  args: string[];
} {
  if (!options.command?.trim()) {
    throw new Error(
      "Runtime command is not configured. Provide `command` (and optional `args`) to RuntimeHelper.",
    );
  }

  return {
    command: options.command,
    args: options.args ?? [],
  };
}

export class RuntimeHelper {
  #options: RuntimeHelperOptions;
  #child: ResultPromise | null = null;
  #status: UniversalRuntimeStatus = {
    phase: "stopped",
    url: null,
    pid: null,
    startedAt: null,
    lastError: null,
  };
  #startPromise: Promise<UniversalRuntimeStatus> | null = null;
  #stopPromise: Promise<UniversalRuntimeStatus> | null = null;
  #listeners = new Set<(status: UniversalRuntimeStatus) => void>();

  constructor(options: RuntimeHelperOptions = {}) {
    this.#options = options;
  }

  onStatusChange(
    listener: (status: UniversalRuntimeStatus) => void,
  ): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  getStatus(): UniversalRuntimeStatus {
    return { ...this.#status };
  }

  getRuntimeUrl(): string | null {
    return this.#status.url;
  }

  getControlSupport(): RuntimeControlSupport {
    if (!this.#options.command?.trim()) {
      return {
        hasRuntimeControl: false,
        reason: "missing_command",
      };
    }

    return {
      hasRuntimeControl: true,
      reason: "configured",
    };
  }

  async ensureStarted(): Promise<UniversalRuntimeStatus> {
    if (this.#status.phase === "running") {
      return this.getStatus();
    }
    return this.start();
  }

  async start(): Promise<UniversalRuntimeStatus> {
    if (this.#status.phase === "running") {
      return this.getStatus();
    }
    if (this.#startPromise) {
      return this.#startPromise;
    }

    this.#startPromise = (async () => {
      this.setStatus({
        ...this.#status,
        phase: "starting",
        lastError: null,
      });

      try {
        const host = this.#options.host ?? DEFAULT_HOST;
        const port = await findOpenPort(host);
        const url = `http://${host}:${port}`;
        const { command, args } = resolveRuntimeCommand(this.#options);
        const cwd = this.#options.cwd || process.cwd();
        const runtimePortEnvVar =
          this.#options.runtimePortEnvVar ?? DEFAULT_RUNTIME_PORT_ENV_VAR;

        const child = execa(command, args, {
          cwd,
          env: {
            ...process.env,
            ...(this.#options.env ?? {}),
            [runtimePortEnvVar]: String(port),
          },
          stdio: ["ignore", "pipe", "pipe"],
        });

        this.#child = child;
        this.setStatus({
          phase: "starting",
          url,
          pid: child.pid ?? null,
          startedAt: Date.now(),
          lastError: null,
        });

        child.on("exit", () => {
          if (this.#status.phase === "stopping") {
            this.setStatus({
              phase: "stopped",
              url: null,
              pid: null,
              startedAt: null,
              lastError: null,
            });
            return;
          }

          this.setStatus({
            phase: "error",
            url: null,
            pid: null,
            startedAt: null,
            lastError: this.#status.lastError || "Runtime exited unexpectedly",
          });
        });

        child.catch((error) => {
          this.setStatus({
            phase: "error",
            url: null,
            pid: null,
            startedAt: null,
            lastError: error instanceof Error ? error.message : String(error),
          });
        });

        try {
          await waitForHealth(
            url,
            this.#options.healthPath ?? DEFAULT_HEALTH_PATH,
            this.#options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS,
          );
        } catch (error) {
          const preStopError = this.#status.lastError;
          await this.stop();
          const message =
            preStopError ||
            this.#status.lastError ||
            (error instanceof Error
              ? error.message
              : "Runtime health check failed");
          this.setStatus({
            phase: "error",
            url: null,
            pid: null,
            startedAt: null,
            lastError: message,
          });
          throw new Error(message, { cause: error });
        }

        this.setStatus({
          phase: "running",
          url,
          pid: child.pid ?? null,
          startedAt: this.#status.startedAt ?? Date.now(),
          lastError: null,
        });

        return this.getStatus();
      } catch (error) {
        if (this.#status.phase !== "error") {
          const message =
            error instanceof Error ? error.message : String(error);
          this.setStatus({
            phase: "error",
            url: null,
            pid: null,
            startedAt: null,
            lastError: message,
          });
        }
        throw error;
      }
    })();

    try {
      return await this.#startPromise;
    } finally {
      this.#startPromise = null;
    }
  }

  async restart(): Promise<UniversalRuntimeStatus> {
    await this.stop();
    return this.start();
  }

  async stop(): Promise<UniversalRuntimeStatus> {
    if (this.#status.phase === "stopped" || !this.#child) {
      this.setStatus({
        phase: "stopped",
        url: null,
        pid: null,
        startedAt: null,
        lastError: null,
      });
      return this.getStatus();
    }
    if (this.#stopPromise) {
      return this.#stopPromise;
    }

    this.#stopPromise = (async () => {
      this.setStatus({
        ...this.#status,
        phase: "stopping",
      });

      const child = this.#child;
      this.#child = null;

      if (!child) {
        this.setStatus({
          phase: "stopped",
          url: null,
          pid: null,
          startedAt: null,
          lastError: null,
        });
        return this.getStatus();
      }

      try {
        child.kill("SIGTERM");
        await child;
      } catch {
        // Ignore runtime exit errors during shutdown.
      }

      this.setStatus({
        phase: "stopped",
        url: null,
        pid: null,
        startedAt: null,
        lastError: null,
      });

      return this.getStatus();
    })();

    try {
      return await this.#stopPromise;
    } finally {
      this.#stopPromise = null;
    }
  }

  private setStatus(next: UniversalRuntimeStatus): void {
    this.#status = { ...next };
    for (const listener of this.#listeners) {
      listener(this.getStatus());
    }
  }
}
