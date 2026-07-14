#!/usr/bin/env bun

import { type ChildProcess, exec, execFileSync, spawn } from "child_process";
import { existsSync, readFileSync, unlinkSync } from "fs";
import { platform } from "os";
import { delimiter, dirname, join } from "path";
import { fileURLToPath } from "url";

import {
  DASHBOARD_FRAMEWORKS,
  type DashboardFrameworkId,
  EXAMPLE_PORT_RANGE_START,
  getFrameworkDefaultPort,
} from "../../example/universal-overlay/src/example-hosts.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, "../..");
const PORT_CLEANUP_SPAN = 20;
const OUTPUT_TAIL_LINES = 25;
const EXAMPLE_LABEL_WIDTH = 14;
const READY_MARKERS = [
  "ready",
  "http://localhost",
  "started",
  "listening",
  "Ready in",
];
const ISSUE_MARKERS = ["ERROR", "error", "warn"];
const ERROR_MARKERS = ["ERROR", "Error", "error", "Unable to acquire lock"];
const NEXT_DEV_LOCK_PATHS = [
  join(".next", "dev", "lock"),
  join(".next", "lock"),
];

interface ExampleDefinition {
  id: DashboardFrameworkId;
  name: string;
  dir: string;
  env?: Record<string, string>;
  devArgs?: string[];
  /** Poll the URL after the ready marker fires to confirm the app is actually serving. */
  confirmUrl?: boolean;
}

interface ExamplePackageManifest {
  scripts?: Record<string, string>;
}

interface RuntimeExample extends ExampleDefinition {
  port: number;
  cwd: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

// Fixed port registry — each framework owns a stable, predictable port.
// Port 4600 remains free for the bridge manager.
const PORT_RANGE_START = EXAMPLE_PORT_RANGE_START;

const STRICT_PORT_ARGS = ["--strictPort"];

const EXAMPLE_OVERRIDES: Partial<
  Record<
    DashboardFrameworkId,
    Pick<ExampleDefinition, "devArgs" | "confirmUrl">
  >
> = {
  react: { devArgs: STRICT_PORT_ARGS },
  "react-router": { devArgs: STRICT_PORT_ARGS, confirmUrl: true },
  vue: { devArgs: STRICT_PORT_ARGS },
  // Nuxt fork mode restarts the worker on unhandled ECONNRESET in dev.
  // Non-fork mode keeps the server stable in multi-example runs.
  nuxt: { devArgs: ["--no-fork"] },
  sveltekit: { devArgs: STRICT_PORT_ARGS },
  solid: { devArgs: STRICT_PORT_ARGS },
  vanilla: { devArgs: STRICT_PORT_ARGS },
  // RSC request handler registers after Vite's socket is ready; poll to confirm.
  vinext: { confirmUrl: true },
};

const EXAMPLES: ExampleDefinition[] = DASHBOARD_FRAMEWORKS.map((framework) => ({
  id: framework.id,
  name: framework.label,
  dir: framework.id,
  ...EXAMPLE_OVERRIDES[framework.id],
}));

const runningProcesses: ChildProcess[] = [];

const COLORS = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  red: "\x1b[31m",
};

const EXAMPLE_COLORS = [
  COLORS.cyan,
  COLORS.green,
  COLORS.yellow,
  COLORS.blue,
  COLORS.magenta,
  COLORS.cyan,
];

function log(message: string, color = COLORS.reset) {
  console.log(`${color}${message}${COLORS.reset}`);
}

function openInBrowser(url: string) {
  const os = platform();
  const command =
    os === "win32"
      ? `start ${url}`
      : os === "darwin"
        ? `open ${url}`
        : `xdg-open ${url}`;

  exec(command, (error) => {
    if (error) console.error(`Failed to open browser: ${error.message}`);
  });
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function clearNextDevLocks(example: RuntimeExample) {
  if (example.id !== "nextjs") {
    return;
  }

  for (const relativePath of NEXT_DEV_LOCK_PATHS) {
    const lockPath = join(example.cwd, relativePath);
    try {
      if (existsSync(lockPath)) {
        unlinkSync(lockPath);
      }
    } catch {
      // Best-effort cleanup.
    }
  }
}

function includesAny(value: string, markers: string[]): boolean {
  return markers.some((marker) => value.includes(marker));
}

async function pollUntilServing(url: string, timeoutMs = 20000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      // "Cannot GET /" is Vite's fallback when no middleware handles the route.
      if (res.status !== 404) return;
      const body = await res.text();
      if (!body.includes("Cannot GET")) return;
    } catch {
      // Server not accepting connections yet — keep waiting.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

function stopProcessTree(pid: number): void {
  if (pid === process.pid) return;

  if (platform() === "win32") {
    execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
    });
    return;
  }

  process.kill(pid, "SIGTERM");
}

function stopProcessTreeIfAlive(pid: number, label?: string): void {
  if (
    !Number.isFinite(pid) ||
    pid <= 0 ||
    pid === process.pid ||
    !isProcessAlive(pid)
  ) {
    return;
  }

  try {
    if (label)
      log(`Stopping existing ${label} process (pid ${pid})...`, COLORS.yellow);
    stopProcessTree(pid);
  } catch {
    // The process may have exited between the liveness check and termination.
  }
}

function parseWindowsPortOwners(output: string, port: number): number[] {
  const owners = new Set<number>();
  const portPattern = new RegExp(`[:.]${port}$`);

  for (const line of output.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (
      parts.length < 5 ||
      parts[3] !== "LISTENING" ||
      !portPattern.test(parts[1])
    )
      continue;
    const pid = Number.parseInt(parts[4] ?? "", 10);
    if (Number.isFinite(pid) && pid > 0) owners.add(pid);
  }

  return [...owners];
}

function getPortOwners(port: number): number[] {
  try {
    if (platform() === "win32") {
      return parseWindowsPortOwners(
        execFileSync("netstat", ["-ano"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }),
        port,
      );
    }

    return execFileSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split(/\r?\n/)
      .map((line) => Number.parseInt(line.trim(), 10))
      .filter((pid) => Number.isFinite(pid) && pid > 0);
  } catch {
    return [];
  }
}

function stopExistingPortOwners(hosts: ExampleDefinition[]): void {
  const ownersByPid = new Map<number, string[]>();
  const namesByPort = new Map(
    hosts.map((example) => [
      getFrameworkDefaultPort(example.id),
      `${example.name} port ${getFrameworkDefaultPort(example.id)}`,
    ]),
  );

  for (
    let port = PORT_RANGE_START;
    port < PORT_RANGE_START + PORT_CLEANUP_SPAN;
    port += 1
  ) {
    for (const pid of getPortOwners(port)) {
      const labels = ownersByPid.get(pid) ?? [];
      labels.push(namesByPort.get(port) ?? `stale host port ${port}`);
      ownersByPid.set(pid, labels);
    }
  }

  for (const [pid, labels] of ownersByPid)
    stopProcessTreeIfAlive(pid, labels.join(", "));
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function waitForPortsAvailable(
  hosts: ExampleDefinition[],
  timeoutMs = 10000,
): void {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (
      hosts.every(
        (example) =>
          getPortOwners(getFrameworkDefaultPort(example.id)).length === 0,
      )
    )
      return;
    sleep(250);
  }

  const busy = hosts
    .map((example) => ({
      example,
      owners: getPortOwners(getFrameworkDefaultPort(example.id)),
    }))
    .filter(({ owners }) => owners.length > 0)
    .map(
      ({ example, owners }) =>
        `${example.name} port ${getFrameworkDefaultPort(example.id)} (pid ${owners.join(", ")})`,
    );
  if (busy.length > 0)
    throw new Error(`Could not free host ports: ${busy.join("; ")}.`);
}

function resolvePathKey(env: NodeJS.ProcessEnv): string {
  return Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
}

function buildExamplePathEnv(exampleDir: string): Record<string, string> {
  const pathKey = resolvePathKey(process.env);
  const currentPath = process.env[pathKey] ?? process.env.PATH ?? "";
  return {
    [pathKey]: [
      join(exampleDir, "node_modules", ".bin"),
      join(ROOT_DIR, "node_modules", ".bin"),
      currentPath,
    ]
      .filter(Boolean)
      .join(delimiter),
  };
}

function shellEscape(value: string): string {
  if (/^[\w./:=+-]+$/.test(value)) return value;
  return platform() === "win32"
    ? `"${value.replace(/"/g, '""')}"`
    : `'${value.replace(/'/g, `'\\''`)}'`;
}

function resolveShellInvocation(commandLine: string): {
  command: string;
  args: string[];
} {
  return platform() === "win32"
    ? {
        command: process.env.ComSpec || "cmd.exe",
        args: ["/d", "/s", "/c", commandLine],
      }
    : { command: process.env.SHELL || "sh", args: ["-lc", commandLine] };
}

function resolveExampleDevScript(
  exampleDir: string,
  exampleName: string,
): string {
  const manifest = JSON.parse(
    readFileSync(join(exampleDir, "package.json"), "utf8"),
  ) as ExamplePackageManifest;
  const script = manifest.scripts?.dev?.trim();
  if (!script)
    throw new Error(`Missing "dev" script for ${exampleName} (${exampleDir})`);
  return script;
}

function toRuntimeExample(definition: ExampleDefinition): RuntimeExample {
  const cwd = join(ROOT_DIR, "example", definition.dir);
  const port = getFrameworkDefaultPort(definition.id);
  const launchCommand = [
    resolveExampleDevScript(cwd, definition.name),
    ...["--port", String(port), ...(definition.devArgs ?? [])].map(shellEscape),
  ].join(" ");
  const shellInvocation = resolveShellInvocation(launchCommand);
  return {
    ...definition,
    port,
    cwd,
    command: shellInvocation.command,
    args: shellInvocation.args,
    env: {
      PORT: String(port),
      ...buildExamplePathEnv(cwd),
      ...(definition.env ?? {}),
    },
  };
}

function resolveRuntimeExamples(
  definitions: ExampleDefinition[],
): RuntimeExample[] {
  return definitions.map(toRuntimeExample);
}

function pushOutputTail(outputTail: string[], chunk: string) {
  const lines = chunk
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return;

  outputTail.push(...lines);
  if (outputTail.length > OUTPUT_TAIL_LINES) {
    outputTail.splice(0, outputTail.length - OUTPUT_TAIL_LINES);
  }
}

function printUsageAndExit() {
  log(
    `${COLORS.red}Error: No valid framework hosts specified.${COLORS.reset}`,
    COLORS.red,
  );
  log(
    `\nAvailable framework hosts: ${EXAMPLES.map((example) => example.id).join(", ")}\n`,
    COLORS.yellow,
  );
  log("Usage:", COLORS.bright);
  log("  bun run example                     # Run all framework hosts");
  log("  bun run example react react-router  # Run specific framework hosts");
  log(
    "  bun run example --no-open           # Run without opening browser tabs",
  );
  log(
    "  bun run example --verify            # Verify bridge health after startup",
  );
  process.exit(1);
}

function parseArguments(argv: string[]): {
  openBrowser: boolean;
  verifyAfterStart: boolean;
  selectedExamples: ExampleDefinition[];
} {
  const args = [...argv];
  let openBrowser = true;
  let verifyAfterStart = false;

  const noOpenIndex = args.indexOf("--no-open");
  if (noOpenIndex !== -1) {
    openBrowser = false;
    args.splice(noOpenIndex, 1);
  }

  const verifyIndex = args.indexOf("--verify");
  if (verifyIndex !== -1) {
    verifyAfterStart = true;
    args.splice(verifyIndex, 1);
  }

  if (args.length === 0) {
    return { openBrowser, verifyAfterStart, selectedExamples: EXAMPLES };
  }

  const requestedIds = args.map((arg) => arg.toLowerCase());
  const selectedExamples = EXAMPLES.filter((example) =>
    requestedIds.includes(example.id),
  );

  if (selectedExamples.length === 0) {
    printUsageAndExit();
  }

  return { openBrowser, verifyAfterStart, selectedExamples };
}

function cleanupAndExit(code = 0) {
  log("\n\nShutting down all servers...", COLORS.yellow);
  for (const processHandle of runningProcesses) {
    if (processHandle.pid) stopProcessTreeIfAlive(processHandle.pid);
    else processHandle.kill();
  }
  process.exit(code);
}

function startExample(
  example: RuntimeExample,
  index: number,
  openBrowser = true,
): Promise<void> {
  const color = EXAMPLE_COLORS[index % EXAMPLE_COLORS.length];
  const url = `http://localhost:${example.port}`;
  const outputTail: string[] = [];
  clearNextDevLocks(example);
  let hasShownReady = false;
  let resolveReady: () => void;
  let rejectReady: (error: Error) => void;
  const readyPromise = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const childProcess = spawn(example.command, example.args, {
    cwd: example.cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...example.env,
      FORCE_COLOR: "1",
    },
  });

  runningProcesses.push(childProcess);

  childProcess.stdout?.on("data", async (data) => {
    const output = data.toString();
    pushOutputTail(outputTail, output);

    if (!hasShownReady && includesAny(output, READY_MARKERS)) {
      hasShownReady = true;
      if (example.confirmUrl) {
        await pollUntilServing(url);
      }
      log(
        `${COLORS.green}✓${COLORS.reset} ${example.name.padEnd(EXAMPLE_LABEL_WIDTH)} ${url}`,
      );
      if (openBrowser) openInBrowser(url);
      resolveReady();
    }

    if (includesAny(output, ISSUE_MARKERS)) {
      console.log(`${color}[${example.name}]${COLORS.reset} ${output.trim()}`);
    }
  });

  childProcess.stderr?.on("data", (data) => {
    const output = data.toString();
    pushOutputTail(outputTail, output);
    if (includesAny(output, ERROR_MARKERS)) {
      console.error(
        `${COLORS.red}[${example.name}]${COLORS.reset} ${output.trim()}`,
      );
    }
  });

  childProcess.on("error", (error) => {
    log(
      `${COLORS.red}✗${COLORS.reset} ${example.name} failed: ${error.message}`,
      COLORS.red,
    );
    rejectReady(error);
  });

  childProcess.on("close", (code) => {
    if (code !== 0 && code !== null) {
      log(
        `${COLORS.red}✗${COLORS.reset} ${example.name} exited with code ${code}`,
        COLORS.red,
      );

      if (outputTail.length > 0) {
        console.error(
          `${COLORS.red}[${example.name}]${COLORS.reset} Last output:\n${outputTail.join("\n")}`,
        );
      }
    }
    if (!hasShownReady) {
      rejectReady(
        new Error(`${example.name} exited before reporting readiness`),
      );
    }
  });

  return readyPromise;
}

async function runExampleVerification(
  selectedExamples: ExampleDefinition[],
): Promise<void> {
  log("");
  const childProcess = spawn(
    "bun",
    [
      "scripts/example/verify.ts",
      ...selectedExamples.map((example) => example.id),
    ],
    {
      cwd: ROOT_DIR,
      stdio: "inherit",
      env: process.env,
    },
  );
  const exitCode = await new Promise<number>((resolve) => {
    childProcess.on("close", (code) => resolve(code ?? 1));
    childProcess.on("error", () => resolve(1));
  });
  if (exitCode !== 0) {
    throw new Error(`Bridge verification failed with exit code ${exitCode}`);
  }
}

async function main() {
  const { openBrowser, verifyAfterStart, selectedExamples } = parseArguments(
    process.argv.slice(2),
  );
  process.on("SIGINT", () => cleanupAndExit(0));
  process.on("SIGTERM", () => cleanupAndExit(0));

  log(
    `Starting ${selectedExamples.length} example${selectedExamples.length > 1 ? "s" : ""}...`,
    COLORS.cyan,
  );
  log(`Press Ctrl+C to stop all servers\n`, COLORS.yellow);

  stopExistingPortOwners(selectedExamples);
  waitForPortsAvailable(selectedExamples);

  const runtimeExamples = resolveRuntimeExamples(selectedExamples);
  const readyPromises = runtimeExamples.map((example, index) =>
    startExample(example, index, openBrowser),
  );

  if (verifyAfterStart) {
    await Promise.all(readyPromises);
    await runExampleVerification(selectedExamples);
  }
}

try {
  await main();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  log(
    `${COLORS.red}Failed to start framework hosts: ${message}${COLORS.reset}`,
    COLORS.red,
  );
  cleanupAndExit(1);
}
