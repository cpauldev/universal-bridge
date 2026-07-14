#!/usr/bin/env bun

/**
 * Verifies that all running framework hosts have the bridge attached and healthy.
 * Run after `bun run example --no-open` with hosts started.
 *
 * Usage: bun scripts/example/verify.ts [name ...]
 *   e.g. bun scripts/example/verify.ts react nuxt
 */
import { DASHBOARD_FRAMEWORKS } from "../../example/universal-overlay/src/example-hosts.js";
import { OVERLAY_BRIDGE_PATH_PREFIX } from "../../example/universal-overlay/src/overlay-config.js";

const EXAMPLES = DASHBOARD_FRAMEWORKS.map((framework) => ({
  id: framework.id,
  name: framework.label,
  defaultUrl: `http://localhost:${framework.defaultPort}`,
}));
const EXAMPLE_LABEL_WIDTH = 14;

const COLORS = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  bright: "\x1b[1m",
  cyan: "\x1b[36m",
};

function log(msg: string) {
  console.log(msg);
}

async function checkEndpoint(
  url: string,
  timeout = 5000,
): Promise<{ ok: boolean; status?: number; body?: unknown; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

interface VerifyResult {
  name: string;
  url: string;
  pass: boolean;
  details: string[];
}

async function verifyExample(
  name: string,
  baseUrl: string,
): Promise<VerifyResult> {
  const details: string[] = [];
  let pass = true;

  // Check 1: /__universal/<namespace>/health
  const health = await checkEndpoint(
    `${baseUrl}${OVERLAY_BRIDGE_PATH_PREFIX}/health`,
  );
  if (!health.ok) {
    pass = false;
    details.push(`FAIL health: ${health.error ?? `HTTP ${health.status}`}`);
  } else {
    const body = health.body as Record<string, unknown> | null;
    if (body?.ok !== true || body?.bridge !== true) {
      pass = false;
      details.push(`FAIL health: unexpected body ${JSON.stringify(body)}`);
    } else {
      details.push("PASS health: { ok: true, bridge: true }");
    }
  }

  // Check 2: /__universal/<namespace>/state
  const state = await checkEndpoint(
    `${baseUrl}${OVERLAY_BRIDGE_PATH_PREFIX}/state`,
  );
  if (!state.ok) {
    pass = false;
    details.push(`FAIL state: ${state.error ?? `HTTP ${state.status}`}`);
  } else {
    const body = state.body as Record<string, unknown> | null;
    if (typeof body?.transportState !== "string") {
      pass = false;
      details.push(
        `FAIL state: missing transportState in ${JSON.stringify(body)}`,
      );
    } else {
      details.push(`PASS state: transportState = "${body.transportState}"`);
    }
  }

  return { name, url: baseUrl, pass, details };
}

async function main() {
  const argv = process.argv.slice(2).map((arg) => arg.toLowerCase());
  const selected =
    argv.length > 0
      ? EXAMPLES.filter((example) => argv.includes(example.id))
      : EXAMPLES;

  if (selected.length === 0) {
    console.error(
      `${COLORS.red}No matching framework hosts. Available: ${EXAMPLES.map((example) => example.id).join(", ")}${COLORS.reset}`,
    );
    process.exit(1);
  }

  log(
    `${COLORS.cyan}Verifying ${selected.length} example bridge${selected.length > 1 ? "s" : ""}...${COLORS.reset}\n`,
  );

  const results = await Promise.all(
    selected.map((example) => verifyExample(example.name, example.defaultUrl)),
  );

  let allPass = true;
  for (const result of results) {
    const icon = result.pass
      ? `${COLORS.green}✓${COLORS.reset}`
      : `${COLORS.red}✗${COLORS.reset}`;
    log(`${icon} ${result.name.padEnd(EXAMPLE_LABEL_WIDTH)} ${result.url}`);
    if (!result.pass) {
      allPass = false;
      for (const detail of result.details) {
        if (detail.startsWith("FAIL")) {
          log(`    ${COLORS.red}${detail}${COLORS.reset}`);
        }
      }
    } else if (process.env.VERBOSE) {
      for (const detail of result.details) {
        log(`    ${COLORS.green}${detail}${COLORS.reset}`);
      }
    }
  }

  const passCount = results.filter((r) => r.pass).length;
  const failCount = results.length - passCount;

  log("");
  if (allPass) {
    log(
      `${COLORS.green}All ${passCount} bridge${passCount > 1 ? "s" : ""} healthy.${COLORS.reset}`,
    );
  } else {
    log(
      `${COLORS.red}${failCount} of ${results.length} failed.${COLORS.reset}`,
    );
    process.exit(1);
  }
}

await main();
