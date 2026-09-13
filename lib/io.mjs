import { mkdir, open, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export async function readJson(path, fallback = null) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return fallback; throw new Error(`cannot parse ${path}: ${error.message}`); }
}

export async function writeJson(path, value, mode = 0o600) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode });
  await rename(temporary, path);
}

export async function readLines(path) {
  try { return (await readFile(path, "utf8")).split("\n").filter(Boolean); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
}

export async function readLastLines(path, limit, maxBytes = 1024 * 1024) {
  let size;
  try { size = (await stat(path)).size; }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
  const file = await open(path, "r");
  try {
    const chunkSize = 64 * 1024;
    let position = size;
    let bytes = 0;
    let newlineCount = 0;
    const chunks = [];
    while (position > 0 && bytes < maxBytes && newlineCount <= limit + 1) {
      const length = Math.min(chunkSize, position, maxBytes - bytes);
      position -= length;
      const buffer = Buffer.alloc(length);
      await file.read(buffer, 0, length, position);
      chunks.unshift(buffer);
      bytes += length;
      for (const value of buffer) if (value === 10) newlineCount += 1;
    }
    let text = Buffer.concat(chunks).toString("utf8");
    if (position > 0) text = text.slice(text.indexOf("\n") + 1);
    return text.split("\n").filter(Boolean).slice(-limit);
  } finally { await file.close(); }
}
