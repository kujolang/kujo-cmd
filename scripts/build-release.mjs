import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "..", "kujo-ability", "lib", "local-runtime.mjs");
const destination = join(root, ".generated", "local-runtime.mjs");
await mkdir(dirname(destination), { recursive: true });
await cp(source, destination);
const body = await readFile(destination, "utf8");
await writeFile(join(root, ".generated", "BUILD.json"), `${JSON.stringify({ schema: "kujo.cmd.generated-build/v1", source: "../kujo-ability/lib/local-runtime.mjs", sha256: await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)).then((value) => Buffer.from(value).toString("hex")) }, null, 2)}\n`);
