import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  copyFile,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";

export async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export async function ensureDir(path, mode = 0o700) {
  await mkdir(path, { recursive: true, mode });
  if (process.platform !== "win32") await chmod(path, mode);
}

export async function atomicWrite(path, contents, mode = 0o600) {
  await ensureDir(dirname(path));
  const temporary = join(
    dirname(path),
    `.${path.split(/[\\/]/).at(-1)}.${process.pid}.${randomBytes(5).toString("hex")}.tmp`,
  );
  try {
    await writeFile(temporary, contents, { mode });
    if (process.platform !== "win32") await chmod(temporary, mode);
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export async function atomicCopy(source, destination, mode = 0o755) {
  await ensureDir(dirname(destination));
  const temporary = `${destination}.${process.pid}.${randomBytes(5).toString("hex")}.tmp`;
  try {
    await copyFile(source, temporary);
    if (process.platform !== "win32") await chmod(temporary, mode);
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function download(url, destination) {
  await ensureDir(dirname(destination));
  const response = await fetch(url, {
    headers: { "User-Agent": "cliproxy-oauth" },
    redirect: "follow",
  });
  if (!response.ok || !response.body) {
    throw new Error(`download failed (${response.status}) for ${url}`);
  }
  const temporary = `${destination}.${process.pid}.${randomBytes(5).toString("hex")}.partial`;
  try {
    await pipeline(Readable.fromWeb(response.body), await openWriteStream(temporary));
    if (process.platform !== "win32") await chmod(temporary, 0o755);
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function openWriteStream(path) {
  const handle = await open(path, "wx", 0o600);
  return handle.createWriteStream();
}

export function randomSecret(prefix = "local") {
  return `${prefix}-${randomBytes(32).toString("hex")}`;
}

export function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function run(command, args = [], options = {}) {
  const {
    cwd,
    env,
    input,
    stdio = "pipe",
    timeout = 30_000,
    allowFailure = false,
  } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      stdio,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    if (child.stdout) child.stdout.setEncoding("utf8").on("data", (data) => (stdout += data));
    if (child.stderr) child.stderr.setEncoding("utf8").on("data", (data) => (stderr += data));
    if (input !== undefined && child.stdin) {
      child.stdin.end(input);
    }
    let timedOut = false;
    const timer = timeout
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
          setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
        }, timeout)
      : undefined;
    child.once("error", (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      const result = { code: code ?? 1, signal, stdout, stderr, timedOut };
      if (result.code === 0 || allowFailure) return resolve(result);
      const detail = stderr.trim() || stdout.trim() || `exit ${result.code}`;
      reject(new Error(`${command} failed: ${detail}`));
    });
  });
}

export async function withFileLock(path, operation) {
  await ensureDir(dirname(path));
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(`another cliproxy-oauth operation is already running (${path})`);
    }
    throw error;
  }
  try {
    await handle.writeFile(`${process.pid}\n`);
    return await operation();
  } finally {
    await handle.close().catch(() => {});
    await rm(path, { force: true }).catch(() => {});
  }
}

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export function sanitizeReleasePart(value) {
  return String(value).replaceAll(/[^a-zA-Z0-9._-]+/g, "-").replaceAll(/^-+|-+$/g, "");
}
