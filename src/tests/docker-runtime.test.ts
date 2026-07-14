import { describe, expect, it } from "bun:test";
import { execa } from "execa";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { createDockerComposeRuntime } from "../runtime/docker.js";

const dockerIntegrationTest =
  process.env.UNIVERSAL_BRIDGE_TEST_DOCKER === "1" ? it : it.skip;

describe("docker compose runtime helper", () => {
  it("builds default docker compose args", () => {
    expect(createDockerComposeRuntime({ service: "runtime" })).toEqual({
      command: "docker",
      args: ["compose", "up", "runtime"],
    });
  });

  it("supports compose file, project name, up args, and env", () => {
    expect(
      createDockerComposeRuntime({
        service: "runtime",
        composeFile: "docker-compose.dev.yml",
        projectName: "acme",
        upArgs: ["--wait"],
        env: { DEBUG: "1" },
      }),
    ).toEqual({
      command: "docker",
      args: [
        "compose",
        "-f",
        "docker-compose.dev.yml",
        "-p",
        "acme",
        "up",
        "runtime",
        "--wait",
      ],
      env: { DEBUG: "1" },
    });
  });

  it("rejects blank service names", () => {
    expect(() => createDockerComposeRuntime({ service: " " })).toThrow(
      "service must be a non-empty string.",
    );
  });

  dockerIntegrationTest("runs a real Docker Compose service", async () => {
    const root = mkdtempSync(join(tmpdir(), "universal-docker-runtime-"));
    const composeFile = join(root, "compose.yml");
    const projectName = `universal_bridge_test_${process.pid}`;

    mkdirSync(root, { recursive: true });
    writeFileSync(
      composeFile,
      [
        "services:",
        "  runtime:",
        "    image: busybox:latest",
        "    command: ['sh', '-c', 'echo universal-bridge-docker-test']",
        "",
      ].join("\n"),
    );

    const runtime = createDockerComposeRuntime({
      service: "runtime",
      composeFile,
      projectName,
    });

    try {
      const result = await execa(runtime.command, runtime.args, {
        cwd: root,
        env: runtime.env,
        reject: false,
        timeout: 120_000,
      });

      expect(
        result.exitCode,
        [result.command, result.stdout, result.stderr]
          .filter(Boolean)
          .join("\n"),
      ).toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain(
        "universal-bridge-docker-test",
      );
    } finally {
      await execa(
        "docker",
        ["compose", "-f", composeFile, "-p", projectName, "down", "--volumes"],
        {
          cwd: root,
          reject: false,
          timeout: 60_000,
        },
      );
      rmSync(root, { recursive: true, force: true });
    }
  });
});
