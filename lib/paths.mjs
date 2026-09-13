import { homedir } from "node:os";
import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const catalogDir = join(packageRoot, "catalog");
export const runtimeModule = join(packageRoot, ".generated", "local-runtime.mjs");

export function homePaths() {
  const root = resolve(process.env.KUJO_CMD_HOME || join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "kujo", "cmd"));
  return {
    root,
    installation: join(root, "installation.json"),
    sources: join(root, "sources"),
    state: join(root, "state.json"),
    receipts: join(root, "receipts.jsonl"),
    services: join(root, "services.json"),
  };
}

function pathError(message, code = "ability_path_forbidden") {
  return Object.assign(new Error(message), { code });
}

export function assertLexicallyContained(root, target, message = "path must stay within the configured project") {
  const rel = relative(resolve(root), resolve(target));
  if (rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))) return resolve(target);
  throw pathError(message);
}

async function assertNoSymlinkComponents(root, target, { allowMissing = false } = {}) {
  const rootPath = resolve(root);
  const rootStat = await lstat(rootPath);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw pathError("configured project must be a real directory", "ability_path_invalid");
  const rootReal = await realpath(rootPath);
  const targetPath = assertLexicallyContained(rootPath, target);
  const rel = relative(rootPath, targetPath);
  let current = rootPath;
  for (const segment of rel.split(sep).filter(Boolean)) {
    current = join(current, segment);
    let stat;
    try { stat = await lstat(current); }
    catch (error) {
      if (allowMissing && error.code === "ENOENT") break;
      throw error;
    }
    if (stat.isSymbolicLink()) throw pathError("symbolic links are not allowed in Kujo Ability paths", "ability_path_invalid");
  }
  const existing = allowMissing ? await nearestExisting(targetPath) : targetPath;
  const existingReal = await realpath(existing);
  assertLexicallyContained(rootReal, existingReal);
  return targetPath;
}

async function nearestExisting(target) {
  let current = resolve(target);
  while (true) {
    try { await lstat(current); return current; }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

export async function safeExistingDirectory(root, requested = ".") {
  const target = await assertNoSymlinkComponents(root, resolve(root, requested));
  if (!(await lstat(target)).isDirectory()) throw pathError("path must be a real directory", "ability_path_invalid");
  return target;
}

export async function safeExistingFile(root, requested) {
  const target = await assertNoSymlinkComponents(root, resolve(root, requested));
  if (!(await lstat(target)).isFile()) throw pathError("path must be a real file", "ability_path_invalid");
  return target;
}

export async function safeOutputPath(root, requested) {
  return assertNoSymlinkComponents(root, resolve(root, requested), { allowMissing: true });
}

export function safeDirectChild(root, name) {
  if (typeof name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)) throw pathError("invalid projected skill name", "kujo_skill_manifest_invalid");
  const target = resolve(root, name);
  if (dirname(target) !== resolve(root)) throw pathError("projected skill path must be a direct child", "kujo_skill_manifest_invalid");
  return target;
}

export function assertSafePurgeRoot(root) {
  const value = resolve(root);
  const userHome = resolve(homedir());
  const workingDirectory = resolve(process.cwd());
  const contains = (parent, child) => {
    const rel = relative(parent, child);
    return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
  };
  if (value === parse(value).root || contains(value, userHome) || contains(value, workingDirectory)) {
    throw pathError("refusing to purge an unsafe Kujo CMD home", "kujo_purge_forbidden");
  }
  return value;
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
