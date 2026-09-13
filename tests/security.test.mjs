import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProjectConfig } from "../lib/app.mjs";
import { loadCatalog } from "../lib/catalog.mjs";
import { removeProjectedSkills } from "../lib/install.mjs";
import { writeInstallation } from "../lib/installation.mjs";
import { assertSafePurgeRoot, homePaths, safeExistingDirectory, safeOutputPath } from "../lib/paths.mjs";

test("workspace path resolution rejects intermediate symbolic-link escapes", async () => {
  const root = await mkdtemp(join(tmpdir(), "kujo-paths-"));
  const project = join(root, "project");
  const outside = join(root, "outside");
  await mkdir(project);
  await mkdir(outside);
  await symlink(outside, join(project, "escape"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(() => safeExistingDirectory(project, "escape"), { code: "ability_path_invalid" });
  await assert.rejects(() => safeOutputPath(project, "escape/result.json"), { code: "ability_path_invalid" });
  assert.equal(await safeExistingDirectory(project, "."), project);
});

test("skill cleanup rejects a forged traversal manifest before deletion", async () => {
  const root = await mkdtemp(join(tmpdir(), "kujo-skills-"));
  const project = join(root, "project");
  const outside = join(project, "outside");
  await mkdir(join(project, ".kujo"), { recursive: true });
  await mkdir(outside);
  await writeFile(join(outside, "keep.txt"), "keep\n");
  await writeFile(join(project, ".kujo", "cmd-skills.json"), JSON.stringify({ schema: "kujo.cmd.skill-projection/v1", skills: ["../../outside"] }));
  const catalog = await loadCatalog();
  await assert.rejects(() => removeProjectedSkills(catalog, project), { code: "kujo_skill_manifest_invalid" });
  assert.equal(await readFile(join(outside, "keep.txt"), "utf8"), "keep\n");
});

test("project configuration cannot override trusted executable or source locations", async () => {
  const root = await mkdtemp(join(tmpdir(), "kujo-config-"));
  const project = join(root, "project");
  const home = join(root, "home");
  const previousHome = process.env.KUJO_CMD_HOME;
  process.env.KUJO_CMD_HOME = home;
  try {
    const catalog = await loadCatalog();
    const projection = join(home, "runtime", "0.1.0");
    const native = join(projection, "native", process.platform === "win32" ? "kujo.exe" : "kujo");
    await mkdir(join(project, ".kujo"), { recursive: true });
    await mkdir(join(projection, "native"), { recursive: true });
    await writeFile(native, "fixture\n");
    const sources = {};
    for (const source of catalog.sources) {
      const path = join(home, "sources", source.id);
      await mkdir(join(path, ".git"), { recursive: true });
      await writeFile(join(path, ".git", "HEAD"), `${source.commit}\n`);
      sources[source.id] = { path, commit: source.commit, mode: "pinned" };
    }
    await writeInstallation({ version: "0.1.0", sources, projection_root: projection, kujo_bin: native, installed_at: new Date().toISOString() });
    await writeFile(join(project, ".kujo", "cmd.json"), JSON.stringify({ schema: "kujo.cmd.config/v1", version: "0.1.0", installation_version: "0.1.0", profile: "kujo.profile.essentials", enabled: [], disabled: [], kujo_bin: "/tmp/attacker" }));
    await assert.rejects(() => loadProjectConfig(project, catalog), { code: "kujo_project_config_invalid" });
  } finally {
    if (previousHome === undefined) delete process.env.KUJO_CMD_HOME;
    else process.env.KUJO_CMD_HOME = previousHome;
  }
});

test("purge guard rejects roots that contain the user home or working directory", () => {
  assert.throws(() => assertSafePurgeRoot("/"), { code: "kujo_purge_forbidden" });
  assert.throws(() => assertSafePurgeRoot(process.cwd()), { code: "kujo_purge_forbidden" });
  assert.doesNotThrow(() => assertSafePurgeRoot(join(tmpdir(), "kujo-cmd-owned-test-home")));
  assert.equal(homePaths().root.length > 0, true);
});
