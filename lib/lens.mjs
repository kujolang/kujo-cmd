import { join } from "node:path";
import { run } from "./process.mjs";

// Lens installs Playwright's headless shell, not the headed executable returned
// by chromium.executablePath(). Verify the same launch mode Lens actually uses.
const PROBE = `
const fs = require('node:fs');
const {chromium} = require('playwright-core');
(async () => {
  const browser = await chromium.launch({headless: true, timeout: 5000});
  try {
    const executable = chromium.executablePath();
    process.stdout.write(JSON.stringify(fs.existsSync(executable) ? {executable} : {}));
  } finally { await browser.close(); }
})().catch(() => { process.exitCode = 1; });
`;

export async function lensBrowserStatus(lensRoot) {
  const bridge = join(lensRoot, "bridge");
  try {
    const result = await run(process.execPath, ["-e", PROBE], { cwd: bridge, timeoutMs: 10_000, maxBytes: 16 * 1024 });
    return { ready: result.exitCode === 0, bridge, ...(result.exitCode === 0 ? JSON.parse(result.stdout) : {}) };
  } catch (error) {
    return { ready: false, bridge, error: error.message };
  }
}

export async function installLensBrowser(lensRoot, options = {}) {
  const bridge = join(lensRoot, "bridge"); const npm = options.npmCommand || (process.platform === "win32" ? "npm.cmd" : "npm");
  let result = await run(npm, ["ci", "--omit=dev", "--ignore-scripts"], { cwd: bridge, timeoutMs: 300_000, maxBytes: 2 * 1024 * 1024 });
  if (result.exitCode !== 0) throw new Error(`Lens bridge dependency installation failed: ${result.stderr.trim() || result.stdout.trim()}`);
  result = await run(npm, ["run", "install-browser"], { cwd: bridge, timeoutMs: 600_000, maxBytes: 2 * 1024 * 1024 });
  if (result.exitCode !== 0) throw new Error(`Lens browser installation failed: ${result.stderr.trim() || result.stdout.trim()}`);
  const status = await lensBrowserStatus(lensRoot);
  if (!status.ready) throw new Error("Lens browser installation completed without a usable Chromium executable");
  return status;
}
