#!/usr/bin/env bun

/**
 * Verifies that all running examples have the bridge attached and healthy.
 * Run after `bun examples --no-open` with examples started.
 *
 * Usage: bun scripts/examples/verify.ts [name ...]
 *   e.g. bun scripts/examples/verify.ts react nuxt
 */

const PORT_RANGE_START = 4600;
const EXAMPLE_BRIDGE_NAMESPACE = "example";
const EXAMPLE_BRIDGE_PREFIX = `/__universal/${EXAMPLE_BRIDGE_NAMESPACE}`;

const EXAMPLE_IDS = [
  "react",
  "vue",
  "sveltekit",
  "solid",
  "astro",
  "nextjs",
  "nuxt",
  "vanilla",
  "vinext",
] as const;

const EXAMPLES: { name: string; defaultUrl: string }[] = EXAMPLE_IDS.map(
  (name, index) => ({
    name,
    defaultUrl: `http://localhost:${PORT_RANGE_START + index}`,
  }),
);

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
    `${baseUrl}${EXAMPLE_BRIDGE_PREFIX}/health`,
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
  const state = await checkEndpoint(`${baseUrl}${EXAMPLE_BRIDGE_PREFIX}/state`);
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
  const argv = process.argv.slice(2).map((a) => a.toLowerCase());
  const selected =
    argv.length > 0 ? EXAMPLES.filter((e) => argv.includes(e.name)) : EXAMPLES;

  if (selected.length === 0) {
    console.error(
      `${COLORS.red}No matching examples. Available: ${EXAMPLES.map((e) => e.name).join(", ")}${COLORS.reset}`,
    );
    process.exit(1);
  }

  log(`${COLORS.bright}${COLORS.cyan}Verifying ${selected.length} example bridge${selected.length > 1 ? "s" : ""}...${COLORS.reset}
`);

  const results = await Promise.all(
    selected.map((e) => verifyExample(e.name, e.defaultUrl)),
  );

  let allPass = true;
  for (const result of results) {
    const icon = result.pass
      ? `${COLORS.green}✓${COLORS.reset}`
      : `${COLORS.red}✗${COLORS.reset}`;
    log(`${icon} ${result.name.padEnd(12)} ${result.url}`);
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
      `${COLORS.green}${COLORS.bright}All ${passCount} bridge${passCount > 1 ? "s" : ""} healthy.${COLORS.reset}`,
    );
  } else {
    log(
      `${COLORS.red}${COLORS.bright}${failCount} of ${results.length} failed.${COLORS.reset}`,
    );
    process.exit(1);
  }
}

await main();
