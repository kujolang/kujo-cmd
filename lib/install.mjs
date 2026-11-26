import { constants } from "node:fs";
import { appendFile, copyFile, cp, lstat, mkdir, mkdtemp, readFile, readlink, realpath, rename, rm, symlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { run } from "./process.mjs";
import { readJson, writeJson } from "./io.mjs";
import { homePaths, packageRoot, projectPaths, safeDirectChild, safeOutputPath } from "./paths.mjs";
import { profileAbilities, skillForSource } from "./catalog.mjs";

async function exists(path) {
  try { await lstat(path); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

async function publishDirectory(staged, destination) {
  const previous = `${staged}.previous`;
  let hadPrevious = false;
  try { await rename(destination, previous); hadPrevious = true; }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  try {
    await rename(staged, destination);
  } catch (error) {
    if (hadPrevious) {
      try { await rename(previous, destination); }
      catch (restoreError) {
        throw new Error(`installation replacement failed; previous copy remains at ${previous}`, { cause: restoreError });
      }
    }
    throw error;
  }
  if (hadPrevious) await rm(previous, { recursive: true, force: true });
}


// Append a narrow, root-anchored rule without replacing user ignore patterns.
export async function configureWatchdogIgnore(project) {
  const path = await safeOutputPath(project, ".gitignore");
  let content = "";
  try {
    const stat = await lstat(path);
    if (!stat.isFile()) throw new Error("Refusing to modify a non-regular .gitignore");
    content = await readFile(path, "utf8");
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const rule = "/.kujo/watchdog-spool/";
  if (content.split(/\r?\n/).includes(rule)) return;
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  await appendFile(path, `${content && !content.endsWith("\n") ? newline : ""}${rule}${newline}`);
}

const HOST_ASSETS = [
  ".commandcode/mods/kujo-command-bridge.ts",
  ".commandcode/agents/kujo-context-builder.md",
  ".commandcode/agents/kujo-reviewer.md",
  ".commandcode/agents/kujo-workflow-operator.md",
  ".commandcode/agents/kujo-release-verifier.md",
  ".commandcode/agents/kujo-safety-evidence.md",
  ".commandcode/agents/kujo-decision-reviewer.md",
  ".commandcode/agents/kujo-browser-reviewer.md",
];

export async function installSources(catalog, { sourceRoot, force = false } = {}) {
  const home = homePaths();
  await mkdir(home.root, { recursive: true, mode: 0o700 });
  await safeOutputPath(home.root, home.sources);
  await mkdir(home.sources, { recursive: true, mode: 0o700 });
  const installed = {};
  for (const source of catalog.sources) {
    if (sourceRoot) {
      const local = resolve(sourceRoot, source.id);
      if (!await exists(local)) throw new Error(`local source is missing: ${local}`);
      installed[source.id] = { path: local, commit: source.commit, mode: "local" };
      continue;
    }
    const destination = join(home.sources, source.id);
    let current = false;
    if (!force && await exists(destination)) {
      await safeOutputPath(home.root, destination);
      const revision = await run("git", ["rev-parse", "HEAD"], { cwd: destination, timeoutMs: 10_000 });
      if (revision.exitCode === 0 && revision.stdout.trim() === source.commit) {
        const status = await run("git", ["status", "--porcelain", "--untracked-files=normal"], { cwd: destination, timeoutMs: 10_000 });
        current = status.exitCode === 0 && !status.stdout.trim();
      }
    }
    if (!current) {
      const temporary = await mkdtemp(`${destination}.partial-`);
      try {
        let result = await run("git", ["clone", "--filter=blob:none", "--no-checkout", `https://github.com/${source.repo}.git`, temporary], { timeoutMs: 180_000 });
        if (result.exitCode !== 0) throw new Error(`failed to acquire ${source.repo}: ${result.stderr.trim()}`);
        result = await run("git", ["checkout", "--detach", source.commit], { cwd: temporary, timeoutMs: 120_000 });
        if (result.exitCode !== 0) throw new Error(`failed to pin ${source.repo}: ${result.stderr.trim()}`);
        await publishDirectory(temporary, destination);
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
    }
    installed[source.id] = { path: destination, commit: source.commit, mode: "pinned" };
  }
  return installed;
}

export async function installProjection(version, kujoBinary) {
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) throw new Error("invalid Kujo CMD projection version");
  const home = homePaths();
  const runtimeRoot = join(home.root, "runtime");
  const destination = join(runtimeRoot, version);
  if (resolve(destination) === resolve(packageRoot)) return { root: destination, kujo: kujoBinary };
  const resolvedBinary = await realpath(kujoBinary);
  await mkdir(home.root, { recursive: true, mode: 0o700 });
  await safeOutputPath(home.root, destination);
  await mkdir(runtimeRoot, { recursive: true, mode: 0o700 });
  const temporary = await mkdtemp(`${destination}.partial-`);
  const executable = process.platform === "win32" ? "kujo.exe" : "kujo";
  try {
    for (const name of ["bin", "lib", "catalog", "assets", ".generated"]) await cp(join(packageRoot, name), join(temporary, name), { recursive: true });
    for (const name of ["package.json", "README.md", "SECURITY.md", "LICENSE"]) await cp(join(packageRoot, name), join(temporary, name));
    const nativeDir = join(temporary, "native");
    await mkdir(nativeDir);
    await copyFile(resolvedBinary, join(nativeDir, executable), constants.COPYFILE_FICLONE);
    await publishDirectory(temporary, destination);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  return { root: destination, kujo: join(destination, "native", executable) };
}

export async function projectSkills(catalog, config, project) {
  const paths = projectPaths(project); const source = config.sources["kujo-skills"]?.path;
  await safeOutputPath(paths.root, paths.skillRoot);
  await safeOutputPath(paths.root, paths.projectionManifest);
  if (!source) throw new Error("canonical Kujo skills source is not installed");
  const active = profileAbilities(catalog, config.profile, config.enabled, config.disabled);
  const names = [...new Set(active.map((ability) => skillForSource[ability.source]).filter(Boolean))].sort();
  await mkdir(paths.skillRoot, { recursive: true });
  const previous = await readJson(paths.projectionManifest, { skills: [] });
  const previousNames = validatedProjectedSkills(previous, catalog, paths.skillRoot);
  const projections = [];
  for (const name of names) {
    const from = join(source, "skills", name);
    const to = safeDirectChild(paths.skillRoot, name);
    if (!await exists(from)) throw new Error(`canonical skill is missing: ${name}`);
    if (!previousNames.includes(name) && await exists(to)) {
      const info = await lstat(to);
      const matches = info.isSymbolicLink() && resolve(dirname(to), await readlink(to)) === resolve(from);
      if (!matches) throw Object.assign(new Error(`refusing to replace unowned Kujo skill: ${name}`), { code: "kujo_skill_conflict" });
    }
    projections.push({ from, to });
  }
  for (const name of previousNames) if (!names.includes(name)) await rm(safeDirectChild(paths.skillRoot, name), { recursive: true, force: true });
  for (const { from, to } of projections) {
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
  await safeOutputPath(paths.root, paths.skillRoot);
  await safeOutputPath(paths.root, paths.projectionManifest);
  const manifest = await readJson(paths.projectionManifest, { skills: [] });
  for (const name of validatedProjectedSkills(manifest, catalog, paths.skillRoot)) await rm(safeDirectChild(paths.skillRoot, name), { recursive: true, force: true });
}

export async function checkCommandCodeAssets(project, modMode = "projected") {
  if (!["projected", "package"].includes(modMode)) throw new Error("mod mode must be projected or package");
  const paths = projectPaths(project);
  await safeOutputPath(paths.root, paths.hostManifest);
  const previous = await readJson(paths.hostManifest, { files: [] });
  const owned = validatedHostFiles(previous);
  const assets = modMode === "package" ? HOST_ASSETS.filter((file) => !file.startsWith(".commandcode/mods/")) : HOST_ASSETS;
  for (const file of new Set([...owned, ...assets, HOST_ASSETS[0]])) await safeOutputPath(paths.root, file);
  const bridge = HOST_ASSETS[0];
  if (modMode === "package" && await exists(join(paths.root, bridge)) && !owned.includes(bridge)) {
    throw Object.assign(new Error(`remove or move the unowned bridge before choosing package mode: ${bridge}`), { code: "kujo_host_asset_conflict" });
  }
  for (const relativePath of assets) {
    const from = join(packageRoot, "assets", "command-code", relativePath.replace(/^\.commandcode\//, ""));
    const to = join(paths.root, relativePath);
    if (await exists(to) && !owned.includes(relativePath)) {
      const [current, packaged] = await Promise.all([readFile(to), readFile(from)]);
      if (!current.equals(packaged)) throw Object.assign(new Error(`refusing to replace unowned Command Code asset: ${relativePath}`), { code: "kujo_host_asset_conflict" });
    }
  }
  return { paths, owned, assets };
}

export async function projectCommandCodeAssets(project, modMode = "projected") {
  const { paths, owned, assets } = await checkCommandCodeAssets(project, modMode);
  for (const relativePath of assets) {
    const from = join(packageRoot, "assets", "command-code", relativePath.replace(/^\.commandcode\//, ""));
    const to = join(paths.root, relativePath);
    await mkdir(dirname(to), { recursive: true });
    await cp(from, to, { force: true });
  }
  for (const relativePath of owned) if (!assets.includes(relativePath)) await rm(join(paths.root, relativePath), { force: true });
  await writeJson(paths.hostManifest, { schema: "kujo.cmd.command-code-projection/v1", files: assets });
  return [...assets];
}

function validatedHostFiles(manifest) {
  if (!manifest || typeof manifest !== "object" || !Array.isArray(manifest.files)) throw Object.assign(new Error("invalid Command Code projection manifest"), { code: "kujo_host_manifest_invalid" });
  if (manifest.schema !== undefined && manifest.schema !== "kujo.cmd.command-code-projection/v1") throw Object.assign(new Error("unsupported Command Code projection manifest"), { code: "kujo_host_manifest_invalid" });
  for (const file of manifest.files) if (!HOST_ASSETS.includes(file)) throw Object.assign(new Error(`unknown projected Command Code asset '${file}'`), { code: "kujo_host_manifest_invalid" });
  return [...new Set(manifest.files)];
}

export async function removeCommandCodeAssets(project) {
  const paths = projectPaths(project);
  await safeOutputPath(paths.root, paths.hostManifest);
  const manifest = await readJson(paths.hostManifest, { files: [] });
  const owned = validatedHostFiles(manifest);
  for (const file of owned) await safeOutputPath(paths.root, file);
  for (const file of owned) await rm(join(paths.root, file), { force: true });
  await rm(paths.hostManifest, { force: true });
}

export async function configureMcp(config, project) {
  const paths = projectPaths(project);
  await safeOutputPath(paths.root, paths.mcp);
  const existing = await readJson(paths.mcp, {});
  const servers = { ...(existing.mcpServers || {}) };
  const projectionRoot = config.projection_root || packageRoot;
  servers["kujo"] = { command: process.execPath, args: [join(projectionRoot, "bin", "kujo-cmd-mcp.mjs")], transport: "stdio", enabled: true, env: { KUJO_CMD_HOME: homePaths().root, KUJO_CMD_PROJECT: paths.root } };
  await writeJson(paths.mcp, { ...existing, mcpServers: servers });
  return paths.mcp;
}

export async function removeMcp(project) {
  const paths = projectPaths(project);
  await safeOutputPath(paths.root, paths.mcp);
  const existing = await readJson(paths.mcp, null);
  if (!existing) return;
  const servers = { ...(existing.mcpServers || {}) }; delete servers.kujo;
  await writeJson(paths.mcp, { ...existing, mcpServers: servers });
}
