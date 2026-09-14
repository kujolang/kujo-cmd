import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generated = join(root, ".generated", "local-runtime.mjs");
const manifestPath = join(root, ".generated", "BUILD.json");
const [body, manifestBody] = await Promise.all([
  readFile(generated),
  readFile(manifestPath, "utf8"),
]);
const manifest = JSON.parse(manifestBody);
const actual = createHash("sha256").update(body).digest("hex");
if (manifest.schema !== "kujo.cmd.generated-build/v1") throw new Error("unsupported generated runtime manifest");
if (actual !== manifest.sha256) throw new Error(`generated Ability runtime digest mismatch: expected ${manifest.sha256}, received ${actual}`);
