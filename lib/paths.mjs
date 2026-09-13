import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const catalogDir = join(packageRoot, "catalog");
export const runtimeModule = join(packageRoot, ".generated", "local-runtime.mjs");

export function homePaths() {
  const root = resolve(process.env.KUJO_CMD_HOME || join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "kujo", "cmd"));
  return {
    root,
    sources: join(root, "sources"),
    state: join(root, "state.json"),
    receipts: join(root, "receipts.jsonl"),
    services: join(root, "services.json"),
  };
}

export function projectPaths(project = process.cwd()) {
  const root = resolve(project);
  return {
    root,
    config: join(root, ".kujo", "cmd.json"),
    mcp: join(root, ".mcp.json"),
    skillRoot: join(root, ".agents", "skills"),
    projectionManifest: join(root, ".kujo", "cmd-skills.json"),
  };
}
