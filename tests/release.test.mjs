import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { VERSION } from "../lib/version.mjs";

const exec = promisify(execFile);

const npmCli = process.env.npm_execpath;
assert.ok(npmCli, "npm_execpath is unavailable");
const { stdout } = await exec(process.execPath, [npmCli, "pack", "--dry-run", "--json", "--ignore-scripts"], {
  maxBuffer: 8 * 1024 * 1024,
});
const report = JSON.parse(stdout)[0];
const files = new Set(report.files.map((file) => file.path));
for (const required of [
  "bin/kujo-cmd.mjs",
  "bin/kujo-cmd-mcp.mjs",
  ".generated/BUILD.json",
  ".generated/local-runtime.mjs",
  "catalog/abilities.json",
  "catalog/profiles.json",
  "catalog/sources.json",
  "assets/command-code/mods/kujo-command-bridge.ts",
  "assets/command-code/agents/kujo-reviewer.md",
  "assets/command-code/agents/kujo-safety-evidence.md",
  "assets/command-code/agents/kujo-decision-reviewer.md",
  "assets/command-code/agents/kujo-browser-reviewer.md",
  "lib/version.mjs",
  "scripts/check-command-code-host.mjs",
  "README.md",
  "SECURITY.md",
]) assert.ok(files.has(required), `missing ${required}`);
assert.ok(![...files].some((path) => path.includes("node_modules") || path.endsWith(".tgz")));
assert.equal(report.name, "@kujolang/kujo-cmd");
assert.equal(report.version, VERSION);

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
assert.equal(VERSION, packageJson.version);
assert.equal(packageJson.dependencies["@kujolang/kujo-runtime"], "1.8.0");
assert.equal(packageJson.repository.url, "git+https://github.com/kujolang/kujo-cmd.git");
assert.equal(packageJson.homepage, "https://github.com/kujolang/kujo-cmd#readme");
assert.equal(packageJson.bugs.url, "https://github.com/kujolang/kujo-cmd/issues");
const { stdout: versionOutput } = await exec(process.execPath, ["bin/kujo-cmd.mjs", "--version"]);
assert.equal(versionOutput.trim(), `kujo-cmd ${packageJson.version}`);

for (const workflowPath of [".github/workflows/ci.yml", ".github/workflows/release.yml"]) {
  const workflow = await readFile(workflowPath, "utf8");
  assert.ok(!/uses:\s+[^\s]+@(v\d+|main|master)\b/.test(workflow), `${workflowPath} contains a mutable action ref`);
}
const releaseWorkflow = await readFile(".github/workflows/release.yml", "utf8");
assert.ok(!/ubuntu-latest/.test(releaseWorkflow), "release workflow contains a mutable runner");
assert.match(releaseWorkflow, /github\.repository == 'kujolang\/kujo-cmd'/);
assert.match(releaseWorkflow, /npm@11\.19\.0/);
assert.match(releaseWorkflow, /merge-base --is-ancestor/);
assert.match(releaseWorkflow, /Check for an identical existing publication/);
assert.match(releaseWorkflow, /npm diff --diff=/);
assert.match(releaseWorkflow, /if: steps\.registry\.outputs\.published != 'true'/);

assert.deepEqual(packageJson.commandcode.mods, ["./assets/command-code/mods/kujo-command-bridge.ts"]);
for (const entry of packageJson.commandcode.mods) assert.ok(files.has(entry.replace(/^\.\//, "")));
assert.ok(packageJson.keywords.includes("cmd-mod"));
assert.equal(packageJson.scripts.postinstall, undefined);
assert.ok(files.has("docs/mods-directory.md"));
const bridge = await readFile(packageJson.commandcode.mods[0], "utf8");
assert.ok(bridge.includes(`const packageVersion = '${VERSION}'`));

for (const path of ["docs/mods-registry-entry.json", "docs/mods-submission.md"]) assert.ok(files.has(path));
const entry = JSON.parse(await readFile("docs/mods-registry-entry.json", "utf8"));
assert.equal(entry.name, "kujo-cmd");
assert.equal(entry.source, "@kujolang/kujo-cmd");
assert.equal(entry.npm, "@kujolang/kujo-cmd");
assert.deepEqual(entry.kinds, ["command", "hook"]);
assert.ok(entry.description.length <= 240);
