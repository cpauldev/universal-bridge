export const RUNTIME_HEALTH_PATH = "/api/version";
export const RUNTIME_FILES_PATH = "/api/files";
export const RUNTIME_OPEN_FILE_PATH = "/api/open-file";

export function runtimeFileMetadataPath(filePath: string): string {
  return `${RUNTIME_FILES_PATH}/${encodeURIComponent(filePath)}`;
}
