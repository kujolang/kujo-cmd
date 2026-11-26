import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadCatalog } from "../lib/catalog.mjs";
import { installSources } from "../lib/install.mjs";

const exec = promisify(execFile); const cli = resolve("bin/kujo-cmd.mjs");

test("setup, profiles, repair, and uninstall preserve unrelated host config", { timeout: 90_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "kujo-cmd-setup-")); const project = join(root, "project"); const sources = join(root, "sources"); const home = join(root, "home"); const linkedRuntime = join(root, "kujo-runtime"); await mkdir(project); await mkdir(sources); await symlink(process.execPath, linkedRuntime);
  t.after(() => rm(root, { recursive: true, force: true }));
  const catalog = await loadCatalog();
  for (const source of catalog.sources) { await mkdir(join(sources, source.id, "skills"), { recursive: true }); }
  for (const name of ["kujo-scout-workflows", "kujo-patchbrief-workflows", "kujo-shipcheck-workflows", "kujo-changebucket-workflows", "kujo-fence-workflows", "kujo-spec-workflows", "kujo-scent-workflows", "kujo-eval-workflows", "kujo-dispatch-workflows", "kujo-runledger-workflows", "kujo-watchdog-workflows", "kujo-rag-workflows", "kujo-casefile-workflows", "kujo-concord-workflows", "kujo-muzzle-workflows", "kujo-kennel-workflows", "kujo-redact-workflows", "kujo-versionseal-workflows", "kujo-packwrite-workflows", "kujo-tribunal-workflows", "kujo-dossier-workflows", "kujo-howl-workflows", "kujo-lens-workflows"]) { const path = join(sources, "kujo-skills", "skills", name); await mkdir(path, { recursive: true }); await writeFile(join(path, "SKILL.md"), `---\nname: ${name}\ndescription: fixture\n---\n`); }
  await writeFile(join(project, ".mcp.json"), JSON.stringify({ mcpServers: { existing: { command: "existing" } } }));
  await writeFile(join(project, ".gitignore"), "# existing rules\nnode_modules/");
  const env = { ...process.env, KUJO_CMD_HOME: home, KUJO_BIN: linkedRuntime };
  let call = await exec(process.execPath, [cli, "setup", "--project", project, "--source-root", sources, "--json"], { env }); let result = JSON.parse(call.stdout); assert.equal(result.abilities, 5); assert.equal(result.hosted_service_required, false); assert.equal(result.host_assets, 8);
  assert.equal(await readFile(join(project, ".gitignore"), "utf8"), "# existing rules\nnode_modules/\n/.kujo/watchdog-spool/\n");
  assert.match(await readFile(join(project, ".commandcode", "mods", "kujo-command-bridge.ts"), "utf8"), /onStop/);
  assert.match(await readFile(join(project, ".commandcode", "agents", "kujo-reviewer.md"), "utf8"), /mcp__kujo__kujo_concord_scan/);
  assert.match(await readFile(join(project, ".commandcode", "agents", "kujo-safety-evidence.md"), "utf8"), /mcp__kujo__kujo_redact_scan/);
  assert.match(await readFile(join(project, ".commandcode", "agents", "kujo-decision-reviewer.md"), "utf8"), /mcp__kujo__kujo_tribunal_review/);
  assert.match(await readFile(join(project, ".commandcode", "agents", "kujo-browser-reviewer.md"), "utf8"), /mcp__kujo__kujo_lens_check/);
  await assert.rejects(() => exec(process.execPath, [cli, "browser", "status", "--project", project, "--json"], { env }), (error) => { const status = JSON.parse(error.stdout); return status.ready === false && status.browser === "chromium"; });
  call = await exec(process.execPath, [cli, "profile", "kujo.profile.review", "--project", project, "--json"], { env }); result = JSON.parse(call.stdout); assert.equal(result.abilities, 18);
  await exec(process.execPath, [cli, "disable", "kujo.fence.architecture.check", "--project", project, "--json"], { env });
  await exec(process.execPath, [cli, "enable", "kujo.eval.suite.run", "--project", project, "--json"], { env });
  await rm(join(project, ".gitignore"));
  call = await exec(process.execPath, [cli, "update", "--project", project, "--source-root", sources, "--json"], { env }); result = JSON.parse(call.stdout);
  assert.equal(await readFile(join(project, ".gitignore"), "utf8"), "/.kujo/watchdog-spool/\n");
  await writeFile(join(project, ".gitignore"), "# existing rules\nnode_modules/\n/.kujo/watchdog-spool/\n");
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

  // The activated binary can be the update source when npm's runtime is absent.
  await exec(process.execPath, [cli, "update", "--project", project, "--json"], { env: { ...env, KUJO_BIN: installation.kujo_bin } });
  const entry = mcp.mcpServers.kujo;
  const child = spawn(entry.command, entry.args, { env: { ...env, ...entry.env }, stdio: ["pipe", "pipe", "inherit"] });
  try {
    const lines = createInterface({ input:child.stdout })[Symbol.asyncIterator]();
    const next = async () => {
      const result = await lines.next();
      assert.equal(result.done, false, "MCP process closed before its reply");
      return JSON.parse(result.value);
    };
    child.stdin.write("x".repeat(1024 * 1024 + 1));
    assert.equal((await next()).error.code, -32600);
    child.stdin.write("discard the remainder\nnull\n");
    assert.match((await next()).error.message, /invalid JSON-RPC request/);
    child.stdin.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
    assert.deepEqual(await next(), { jsonrpc:"2.0", id:1, result:{} });
    const done = once(child,"exit");
    child.stdin.end();
    assert.deepEqual(await done, [0,null]);
  } finally {
    child.stdin.destroy();
    child.kill("SIGTERM");
  }
  call = await exec(process.execPath, [cli, "setup", "--project", project, "--source-root", sources, "--mod-mode", "package", "--json"], { env });
  result = JSON.parse(call.stdout);
  assert.equal(result.mod_mode, "package"); assert.equal(result.host_assets, 7);
  assert.equal(result.profile, "kujo.profile.review");
  const migrated = JSON.parse(await readFile(join(project, ".kujo", "cmd.json"), "utf8"));
  assert.deepEqual(migrated.disabled, ["kujo.fence.architecture.check"]);
  assert.deepEqual(migrated.enabled, ["kujo.eval.suite.run"]);
  await exec(process.execPath, [cli, "update", "--project", project, "--source-root", sources, "--json"], { env });
  await writeFile(join(project, ".gitignore"), "# existing rules\nnode_modules/");
  await exec(process.execPath, [cli, "repair", "--project", project, "--json"], { env });
  await assert.rejects(() => readFile(join(project, ".commandcode", "mods", "kujo-command-bridge.ts")), { code: "ENOENT" });
  call = await exec(process.execPath, [cli, "setup", "--project", project, "--source-root", sources, "--json"], { env });
  assert.equal(JSON.parse(call.stdout).mod_mode, "package");
  assert.equal(await readFile(join(project, ".gitignore"), "utf8"), "# existing rules\nnode_modules/\n/.kujo/watchdog-spool/\n");
  await exec(process.execPath, [cli, "uninstall", "--project", project, "--json"], { env });
  const after = JSON.parse(await readFile(join(project, ".mcp.json"), "utf8")); assert.ok(after.mcpServers.existing); assert.equal(after.mcpServers.kujo, undefined); assert.ok(await readFile(join(home, "receipts.jsonl"), "utf8"));
  await assert.rejects(() => readFile(join(project, ".commandcode", "mods", "kujo-command-bridge.ts"), "utf8"), { code: "ENOENT" });
});

test("source updates reuse clean pins and preserve installed bytes when acquisition fails", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "kujo-cmd-source-update-"));
  t.after(() => rm(root, { recursive:true, force:true }));
  const source = join(root, "source");
  const home = join(root, "home");
  await mkdir(source);
  await exec("git", ["init", "-q"], { cwd:source });
  await writeFile(join(source,"README.md"), "Pinned fixture\n");
  await exec("git", ["add", "."], { cwd:source });
  await exec("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "-c", "commit.gpgsign=false", "commit", "-qm", "Fixture"], { cwd:source });
  const { stdout } = await exec("git", ["rev-parse", "HEAD"], { cwd:source });
  const env = { KUJO_CMD_HOME:home, GIT_CONFIG_COUNT:"1", GIT_CONFIG_KEY_0:`url.${pathToFileURL(source).href}.insteadOf`, GIT_CONFIG_VALUE_0:"https://github.com/fixtures/catalog.git" };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key,process.env[key]]));
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
  try {
    const catalog = { sources: [{ id:"fixture", repo:"fixtures/catalog", commit:stdout.trim() }] };
    const first = await installSources(catalog);
    await rename(source, join(root,"source-offline"));
    assert.deepEqual(await installSources(catalog), first);
    await assert.rejects(() => installSources(catalog,{force:true}), /failed to acquire/);
    assert.equal(await readFile(join(first.fixture.path,"README.md"),"utf8"), "Pinned fixture\n");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
