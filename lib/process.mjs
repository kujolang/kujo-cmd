import { spawn } from "node:child_process";

export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env || process.env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const stdout = []; const stderr = []; let bytes = 0; const limit = options.maxBytes || 8 * 1024 * 1024;
    const collect = (bucket) => (chunk) => { bytes += chunk.length; if (bytes > limit) { child.kill("SIGKILL"); return; } bucket.push(chunk); };
    child.stdout.on("data", collect(stdout)); child.stderr.on("data", collect(stderr));
    const abort = () => child.kill("SIGTERM");
    options.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => child.kill("SIGKILL"), options.timeoutMs || 120_000);
    child.on("error", reject);
    child.on("close", (code, signal) => {
      clearTimeout(timer); options.signal?.removeEventListener("abort", abort);
      if (options.signal?.aborted) return reject(Object.assign(new Error("operation cancelled"), { name: "AbortError" }));
      if (bytes > limit) return reject(Object.assign(new Error("command output exceeded safety limit"), { code: "ability_output_limit" }));
      resolve({ exitCode: code, signal, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
    });
  });
}
