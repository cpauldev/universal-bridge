import type { RuntimeHelperOptions } from "./runtime-helper.js";

export interface DockerComposeRuntimeOptions {
  service: string;
  composeFile?: string;
  projectName?: string;
  upArgs?: string[];
  env?: Record<string, string | undefined>;
}

export type DockerComposeRuntimeConfig = Pick<
  RuntimeHelperOptions,
  "command" | "args" | "env"
>;

function requireNonEmpty(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return trimmed;
}

export function createDockerComposeRuntime(
  options: DockerComposeRuntimeOptions,
): DockerComposeRuntimeConfig {
  const service = requireNonEmpty(options.service, "service");
  const args = ["compose"];

  if (options.composeFile?.trim()) {
    args.push("-f", options.composeFile.trim());
  }

  if (options.projectName?.trim()) {
    args.push("-p", options.projectName.trim());
  }

  args.push("up", service, ...(options.upArgs ?? []));

  return {
    command: "docker",
    args,
    ...(options.env ? { env: options.env } : {}),
  };
}
