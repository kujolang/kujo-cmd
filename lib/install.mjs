import { cp, lstat, mkdir, rename, rm, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { run } from "./process.mjs";
import { readJson, writeJson } from "./io.mjs";
import { homePaths, packageRoot, projectPaths, safeDirectChild } from "./paths.mjs";
import { profileAbilities, skillForSource } from "./catalog.mjs";

async function exists(path) { try { await lstat(path); return true; } catch { return false; } }

export async function installSources(catalog, { sourceRoot, force = false } = {}) {
  const home = homePaths(); await mkdir(home.sources, { recursive: true });
  const installed = {};
  for (const source of catalog.sources) {
    if (sourceRoot) {
      const local = resolve(sourceRoot, source.id);
      if (!await exists(local)) throw new Error(`local source is missing: ${local}`);
      installed[source.id] = { path: local, commit: source.commit, mode: "local" };
      continue;
    }
    const destination = join(home.sources, source.id);
    if (force) await rm(destination, { recursive: true, force: true });
    if (await exists(destination)) {
      const revision = await run("git", ["rev-parse", "HEAD"], { cwd: destination, timeoutMs: 10_000 });
      if (revision.exitCode !== 0 || revision.stdout.trim() !== source.commit) await rm(destination, { recursive: true, force: true });
    }
    if (!await exists(destination)) {
      const temporary = `${destination}.partial-${process.pid}`;
      await rm(temporary, { recursive: true, force: true });
      let result = await run("git", ["clone", "--filter=blob:none", "--no-checkout", `https://github.com/${source.repo}.git`, temporary], { timeoutMs: 180_000 });
      if (result.exitCode !== 0) throw new Error(`failed to acquire ${source.repo}: ${result.stderr.trim()}`);
      result = await run("git", ["checkout", "--detach", source.commit], { cwd: temporary, timeoutMs: 120_000 });
      if (result.exitCode !== 0) throw new Error(`failed to pin ${source.repo}: ${result.stderr.trim()}`);
      await rename(temporary, destination);
    }
    installed[source.id] = { path: destination, commit: source.commit, mode: "pinned" };
  }
  return installed;
}

export async function installProjection(version, kujoBinary) {
  const destination = join(homePaths().root, "runtime", version);
  if (resolve(destination) === resolve(packageRoot)) return { root: destination, kujo: kujoBinary };
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  for (const name of ["bin", "lib", "catalog", ".generated"]) await cp(join(packageRoot, name), join(destination, name), { recursive: true, force: true });
  for (const name of ["package.json", "README.md", "SECURITY.md", "LICENSE"]) await cp(join(packageRoot, name), join(destination, name), { force: true });
  const nativeDir = join(destination, "native"); await mkdir(nativeDir, { recursive: true });
  const native = join(nativeDir, process.platform === "win32" ? "kujo.exe" : "kujo"); await cp(kujoBinary, native, { force: true });
  return { root: destination, kujo: native };
}

export async function projectSkills(catalog, config, project) {
  const paths = projectPaths(project); const source = config.sources["kujo-skills"]?.path;
  if (!source) throw new Error("canonical Kujo skills source is not installed");
  const active = profileAbilities(catalog, config.profile, config.enabled, config.disabled);
  const names = [...new Set(active.map((ability) => skillForSource[ability.source]).filter(Boolean))].sort();
  await mkdir(paths.skillRoot, { recursive: true });
  const previous = await readJson(paths.projectionManifest, { skills: [] });
  const previousNames = validatedProjectedSkills(previous, catalog, paths.skillRoot);
  for (const name of previousNames) if (!names.includes(name)) await rm(safeDirectChild(paths.skillRoot, name), { recursive: true, force: true });
  for (const name of names) {
    const from = join(source, "skills", name); const to = safeDirectChild(paths.skillRoot, name);
    if (!await exists(from)) throw new Error(`canonical skill is missing: ${name}`);
    await rm(to, { recursive: true, force: true });
    try { await symlink(from, to, process.platform === "win32" ? "junction" : "dir"); }
    catch { await cp(from, to, { recursive: true }); }
  }
  await writeJson(paths.projectionManifest, { schema: "kujo.cmd.skill-projection/v1", source, source_commit: config.sources["kujo-skills"].commit, profile: config.profile, skills: names });
  return names;
}

function validatedProjectedSkills(manifest, catalog, skillRoot) {
  if (!manifest || typeof manifest !== "object" || !Array.isArray(manifest.skills)) throw Object.assign(new Error("invalid Kujo CMD skill projection manifest"), { code: "kujo_skill_manifest_invalid" });
  if (manifest.schema !== undefined && manifest.schema !== "kujo.cmd.skill-projection/v1") throw Object.assign(new Error("unsupported Kujo CMD skill projection manifest"), { code: "kujo_skill_manifest_invalid" });
  const allowed = new Set(catalog.abilities.map((ability) => skillForSource[ability.source]).filter(Boolean));
  for (const name of manifest.skills) {
    safeDirectChild(skillRoot, name);
    if (!allowed.has(name)) throw Object.assign(new Error(`unknown projected Kujo skill '${name}'`), { code: "kujo_skill_manifest_invalid" });
  }
  return [...new Set(manifest.skills)];
}

export async function removeProjectedSkills(catalog, project) {
  const paths = projectPaths(project);
  const manifest = await readJson(paths.projectionManifest, { skills: [] });
  for (const name of validatedProjectedSkills(manifest, catalog, paths.skillRoot)) await rm(safeDirectChild(paths.skillRoot, name), { recursive: true, force: true });
}

export async function configureMcp(config, project) {
  const paths = projectPaths(project); const existing = await readJson(paths.mcp, {});
  const servers = { ...(existing.mcpServers || {}) };
  const projectionRoot = config.projection_root || packageRoot;
  servers["kujo"] = { command: process.execPath, args: [join(projectionRoot, "bin", "kujo-cmd-mcp.mjs")], transport: "stdio", enabled: true, env: { KUJO_CMD_HOME: homePaths().root, KUJO_CMD_PROJECT: paths.root } };
  await writeJson(paths.mcp, { ...existing, mcpServers: servers });
  return paths.mcp;
}

export async function removeMcp(project) {
  const paths = projectPaths(project); const existing = await readJson(paths.mcp, null);
  if (!existing) return;
  const servers = { ...(existing.mcpServers || {}) }; delete servers.kujo;
  await writeJson(paths.mcp, { ...existing, mcpServers: servers });
}
