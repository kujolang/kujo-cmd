import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadCatalog } from "../lib/catalog.mjs";

const exec = promisify(execFile); const cli = resolve("bin/kujo-cmd.mjs");

test("setup, profiles, repair, and uninstall preserve unrelated host config", async () => {
  const root = await mkdtemp(join(tmpdir(), "kujo-cmd-setup-")); const project = join(root, "project"); const sources = join(root, "sources"); const home = join(root, "home"); const linkedRuntime = join(root, "kujo-runtime"); await mkdir(project); await mkdir(sources); await symlink(process.execPath, linkedRuntime);
  const catalog = await loadCatalog();
  for (const source of catalog.sources) { await mkdir(join(sources, source.id, "skills"), { recursive: true }); }
  for (const name of ["kujo-scout-workflows", "kujo-patchbrief-workflows", "kujo-shipcheck-workflows", "kujo-changebucket-workflows", "kujo-fence-workflows", "kujo-spec-workflows", "kujo-scent-workflows", "kujo-eval-workflows", "kujo-dispatch-workflows", "kujo-runledger-workflows", "kujo-watchdog-workflows", "kujo-rag-workflows", "kujo-casefile-workflows", "kujo-concord-workflows", "kujo-muzzle-workflows", "kujo-kennel-workflows", "kujo-redact-workflows", "kujo-versionseal-workflows", "kujo-packwrite-workflows", "kujo-tribunal-workflows", "kujo-dossier-workflows", "kujo-howl-workflows"]) { const path = join(sources, "kujo-skills", "skills", name); await mkdir(path, { recursive: true }); await writeFile(join(path, "SKILL.md"), `---\nname: ${name}\ndescription: fixture\n---\n`); }
  await writeFile(join(project, ".mcp.json"), JSON.stringify({ mcpServers: { existing: { command: "existing" } } }));
  const env = { ...process.env, KUJO_CMD_HOME: home, KUJO_BIN: linkedRuntime };
  let call = await exec(process.execPath, [cli, "setup", "--project", project, "--source-root", sources, "--json"], { env }); let result = JSON.parse(call.stdout); assert.equal(result.abilities, 5); assert.equal(result.hosted_service_required, false); assert.equal(result.host_assets, 7);
  assert.match(await readFile(join(project, ".commandcode", "mods", "kujo-command-bridge.ts"), "utf8"), /onStop/);
  assert.match(await readFile(join(project, ".commandcode", "agents", "kujo-reviewer.md"), "utf8"), /mcp__kujo__kujo_concord_scan/);
  assert.match(await readFile(join(project, ".commandcode", "agents", "kujo-safety-evidence.md"), "utf8"), /mcp__kujo__kujo_redact_scan/);
  assert.match(await readFile(join(project, ".commandcode", "agents", "kujo-decision-reviewer.md"), "utf8"), /mcp__kujo__kujo_tribunal_review/);
  call = await exec(process.execPath, [cli, "profile", "kujo.profile.review", "--project", project, "--json"], { env }); result = JSON.parse(call.stdout); assert.equal(result.abilities, 17);
  await exec(process.execPath, [cli, "disable", "kujo.fence.architecture.check", "--project", project, "--json"], { env });
  await exec(process.execPath, [cli, "enable", "kujo.eval.suite.run", "--project", project, "--json"], { env });
  call = await exec(process.execPath, [cli, "update", "--project", project, "--source-root", sources, "--json"], { env }); result = JSON.parse(call.stdout);
  assert.equal(result.profile, "kujo.profile.review");
  assert.deepEqual(result.disabled, ["kujo.fence.architecture.check"]);
  assert.deepEqual(result.enabled, ["kujo.eval.suite.run"]);
  const updated = JSON.parse(await readFile(join(project, ".kujo", "cmd.json"), "utf8"));
  assert.equal(updated.profile, "kujo.profile.review");
  assert.deepEqual(updated.disabled, ["kujo.fence.architecture.check"]);
  assert.deepEqual(updated.enabled, ["kujo.eval.suite.run"]);
  assert.equal(updated.sources, undefined);
  assert.equal(updated.kujo_bin, undefined);
  const installation = JSON.parse(await readFile(join(home, "installation.json"), "utf8"));
  assert.equal(installation.schema, "kujo.cmd.installation/v1");
  assert.equal(Object.keys(installation.sources).length, catalog.sources.length);
  assert.equal((await lstat(installation.kujo_bin)).isSymbolicLink(), false);
  const mcp = JSON.parse(await readFile(join(project, ".mcp.json"), "utf8")); assert.ok(mcp.mcpServers.existing); assert.equal(mcp.mcpServers.kujo.transport, "stdio");
  await exec(process.execPath, [cli, "repair", "--project", project, "--json"], { env });
  await exec(process.execPath, [cli, "uninstall", "--project", project, "--json"], { env });
  const after = JSON.parse(await readFile(join(project, ".mcp.json"), "utf8")); assert.ok(after.mcpServers.existing); assert.equal(after.mcpServers.kujo, undefined); assert.ok(await readFile(join(home, "receipts.jsonl"), "utf8"));
  await assert.rejects(() => readFile(join(project, ".commandcode", "mods", "kujo-command-bridge.ts"), "utf8"), { code: "ENOENT" });
});
