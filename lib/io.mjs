import { constants } from "node:fs";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

const MAX_JSON_BYTES = 1024 * 1024;
const READ_ONLY_FILE = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

export async function readJson(path, fallback = null) {
  try {
    const file = await open(path, READ_ONLY_FILE);
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > MAX_JSON_BYTES) throw new Error("expected a regular JSON file of at most 1 MiB");
      const chunks = [];
      let bytes = 0;
      for await (const chunk of file.createReadStream({ autoClose: false, start: 0, end: MAX_JSON_BYTES })) {
        bytes += chunk.length;
        if (bytes > MAX_JSON_BYTES) throw new Error("JSON file exceeds 1 MiB");
        chunks.push(chunk);
      }
      return JSON.parse(Buffer.concat(chunks, bytes).toString("utf8"));
    } finally {
      await file.close();
    }
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw new Error(`cannot parse ${path}: ${error.message}`, { cause: error });
  }
}

export async function writeJson(path, value, mode = 0o600) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode, flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function readLines(path) {
  try { return (await readFile(path, "utf8")).split("\n").filter(Boolean); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
}

export async function readLastLines(path, limit, maxBytes = 1024 * 1024) {
  let file;
  try { file = await open(path, READ_ONLY_FILE); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error("receipt log is not a regular file");
    const chunkSize = 64 * 1024;
    let position = info.size;
    let bytes = 0;
    let newlineCount = 0;
    const chunks = [];
    while (position > 0 && bytes < maxBytes && newlineCount <= limit + 1) {
      const length = Math.min(chunkSize, position, maxBytes - bytes);
      position -= length;
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await file.read(buffer, 0, length, position);
      const received = buffer.subarray(0, bytesRead);
      chunks.unshift(received);
      bytes += length;
      for (const value of received) if (value === 10) newlineCount += 1;
    }
    let text = Buffer.concat(chunks).toString("utf8");
    if (position > 0) {
      const completeLine = text.indexOf("\n");
      if (completeLine === -1) return [];
      text = text.slice(completeLine + 1);
    }
    return text.split("\n").filter(Boolean).slice(-limit);
  } finally { await file.close(); }
}
