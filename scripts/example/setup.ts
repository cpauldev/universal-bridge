#!/usr/bin/env bun

import { exec } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, "../..");

const C = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
};

function formatLine(line: string): string {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("$ "))
    return `  ${C.cyan}$${C.reset} ${trimmed.slice(2)}`;
  return `  ${trimmed}`;
}

async function run(command: string, cwd = ROOT_DIR): Promise<void> {
  console.log(`  ${C.cyan}$${C.reset} ${command}`);
  const { stdout, stderr } = await execAsync(command, { cwd });
  const format = (s: string) =>
    s
      .split("\n")
      .filter((l) => l.trim())
      .map(formatLine)
      .join("\n");
  if (stdout.trim()) console.log(format(stdout));
  if (stderr.trim()) console.log(format(stderr));
}

async function step(label: string, fn: () => Promise<void>): Promise<void> {
  console.log(`${C.yellow}→${C.reset} ${label}`);
  try {
    await fn();
    console.log(`${C.green}✓ done${C.reset}\n`);
  } catch (error) {
    console.log(`${C.red}✗ failed${C.reset}\n`);
    throw error;
  }
}

async function main(): Promise<void> {
  const force = process.argv.includes("--force");

  console.log(
    `\n${C.bright}${C.cyan}Setting up Universal Overlay hosts...${C.reset}\n`,
  );

  await step("Installing workspace dependencies", () => run("bun install"));
  await step("Building universal-bridge", () => run("bun run build"));
  if (force) {
    await step("Re-linking workspace packages (--force)", () =>
      run("bun install --force"),
    );
  }
  await step("Building example tool", () =>
    run("bun run build", join(ROOT_DIR, "example", "universal-overlay")),
  );

  console.log(`${C.bright}${C.green}✓ Setup complete!${C.reset}`);
  console.log(`\nTo start all framework hosts:`);
  console.log(`  ${C.cyan}bun run example${C.reset}`);
  console.log(`\nTo start specific framework hosts:`);
  console.log(
    `  ${C.cyan}bun run example react react-router nextjs vue${C.reset}\n`,
  );
}

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n${C.red}Setup failed: ${message}${C.reset}`);
  process.exit(1);
});
