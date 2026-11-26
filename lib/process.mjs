import { spawn } from "node:child_process";

export function isolatedKujoEnvironment(overrides = {}) {
  const env = { ...process.env, ...overrides, KUJO_ISOLATED_IMPORTS: "1" };
  delete env.KUJO_MODULE_PATH;
  return env;
}

export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const signal = options.signal;
    if (signal?.aborted) {
      reject(Object.assign(new Error("operation cancelled"), { name: "AbortError" }));
      return;
    }

    const child = spawn(command, args, { cwd: options.cwd, env: options.env || process.env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const stdout = [];
    const stderr = [];
    const limit = options.maxBytes || 8 * 1024 * 1024;
    let bytes = 0;
    let failure;
    let abortTimer;
    const forceStop = () => {
      child.kill("SIGKILL");
      child.stdout.destroy();
      child.stderr.destroy();
    };

    const collect = (bucket) => (chunk) => {
      if (failure) return;
      bytes += chunk.length;
      if (bytes > limit) {
        failure = Object.assign(new Error("command output exceeded safety limit"), { code: "ability_output_limit" });
        forceStop();
        return;
      }
      bucket.push(chunk);
    };
    const abort = () => {
      if (failure) return;
      failure = Object.assign(new Error("operation cancelled"), { name: "AbortError" });
      child.kill("SIGTERM");
      abortTimer = setTimeout(forceStop, 1000);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => {
      if (!failure) failure = Object.assign(new Error("command exceeded time limit"), { code: "ability_command_timeout" });
      forceStop();
    }, options.timeoutMs || 120_000);
    child.once("error", (error) => { if (!failure) failure = error; });
    child.once("close", (code, exitSignal) => {
      clearTimeout(timer);
      clearTimeout(abortTimer);
      signal?.removeEventListener("abort", abort);
      if (failure) return reject(failure);
      resolve({ exitCode: code, signal: exitSignal, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
    });
  });
}
