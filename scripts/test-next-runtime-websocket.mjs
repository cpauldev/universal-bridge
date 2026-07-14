import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = resolve(
  projectRoot,
  "example/nextjs/test-fixtures/runtime-websocket",
);
const nextWorkspaceDir = resolve(projectRoot, "example/nextjs");
const nextRequire = createRequire(resolve(nextWorkspaceDir, "package.json"));
const nextCli = nextRequire.resolve("next/dist/bin/next");

function getFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to allocate a test port"));
        return;
      }
      server.close((error) =>
        error ? reject(error) : resolvePort(address.port),
      );
    });
  });
}

async function waitForServer(url, processOutput) {
  const deadline = Date.now() + 30_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(
    `Next did not start: ${String(lastError)}\n${processOutput.join("")}`,
  );
}

async function main() {
  const port = await getFreePort();
  const processOutput = [];
  const nextProcess = spawn(
    process.execPath,
    [nextCli, "dev", "--port", String(port)],
    {
      cwd: fixtureDir,
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: "1",
        NODE_ENV: "development",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  nextProcess.stdout.on("data", (chunk) => processOutput.push(String(chunk)));
  nextProcess.stderr.on("data", (chunk) => processOutput.push(String(chunk)));

  try {
    await waitForServer(`http://127.0.0.1:${port}/`, processOutput);
    const socket = new WebSocket(
      `ws://127.0.0.1:${port}/__universal/runtime/ws?via=next-rewrite`,
      ["runtime.v1"],
    );
    await once(socket, "open");
    if (socket.protocol !== "runtime.v1") {
      throw new Error(
        `Expected runtime.v1, received ${socket.protocol || "none"}`,
      );
    }
    const [message] = await once(socket, "message");
    if (!Buffer.from(message).toString().includes("via=next-rewrite")) {
      throw new Error("The runtime did not receive the browser query string");
    }
    socket.close();
    console.log("Next runtime WebSocket rewrite verified");
  } finally {
    if (nextProcess.exitCode === null) {
      const exited = once(nextProcess, "exit");
      nextProcess.kill();
      await exited;
    }
  }
}

await main();
