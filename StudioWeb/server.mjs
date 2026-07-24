import { createServer } from "node:http";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { engines, engineMap } from "./engines.mjs";

const studioDir = fileURLToPath(new URL(".", import.meta.url));
const repoDir = resolve(studioDir, "..");
const publicDir = join(studioDir, "public");
const dataDir = join(studioDir, ".studio-data");
const outputDir = join(dataDir, "outputs");
const uploadDir = join(dataDir, "uploads");
const historyPath = join(dataDir, "history.json");
const port = Number(process.env.SPEECH_STUDIO_PORT || 4173);
const host = "127.0.0.1";
const maxBodyBytes = 96 * 1024 * 1024;

await mkdir(outputDir, { recursive: true });
await mkdir(uploadDir, { recursive: true });

const speechBinary = findBinary([
  process.env.SPEECH_SWIFT_BIN,
  join(repoDir, ".build", "release", "speech"),
  resolve(repoDir, "..", "speech-swift", ".build", "release", "speech"),
]);
const omniBinary = findBinary([
  process.env.SPEECH_OMNI_BIN,
  join(repoDir, ".build", "release", "speech-omni"),
  resolve(repoDir, "..", "speech-swift", ".build", "release", "speech-omni"),
]);

const jobs = new Map();
const modelTotals = new Map();
let history = await loadHistory();

function findBinary(candidates) {
  return candidates.find((candidate) => candidate && existsSync(candidate)) || null;
}

async function loadHistory() {
  try {
    const parsed = JSON.parse(await readFile(historyPath, "utf8"));
    return Array.isArray(parsed) ? parsed.slice(0, 40) : [];
  } catch {
    return [];
  }
}

async function persistHistory() {
  await writeFile(historyPath, JSON.stringify(history.slice(0, 40), null, 2));
}

function json(response, status = 200) {
  return { status, type: "application/json; charset=utf-8", body: Buffer.from(JSON.stringify(response)) };
}

function parseRawArgs(source = "") {
  const tokens = [];
  let current = "";
  let quote = null;
  let escaping = false;
  for (const character of source.trim()) {
    if (escaping) {
      current += character;
      escaping = false;
    } else if (character === "\\" && quote !== "'") {
      escaping = true;
    } else if (quote) {
      if (character === quote) quote = null;
      else current += character;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (/\s/.test(character)) {
      if (current) tokens.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  if (quote) throw new Error("Незакрытая кавычка в raw arguments");
  if (escaping) current += "\\";
  if (current) tokens.push(current);
  if (tokens.some((token) => token === "-o" || token === "--output" || token.startsWith("--output="))) {
    throw new Error("Output path управляется студией и недоступен в raw arguments");
  }
  return tokens;
}

function safeExtension(name, accept) {
  const extension = extname(name || "").toLowerCase();
  if (extension && extension.length <= 12) return extension;
  if (accept === ".txt") return ".txt";
  if (accept === ".safetensors") return ".safetensors";
  return ".wav";
}

async function materializeFile(jobId, field, value) {
  if (!value || typeof value.data !== "string") return null;
  const match = value.data.match(/^data:.*?;base64,(.*)$/s);
  const encoded = match ? match[1] : value.data;
  const target = join(uploadDir, `${jobId}-${field.key}${safeExtension(value.name, field.accept)}`);
  await writeFile(target, Buffer.from(encoded, "base64"));
  return target;
}

async function buildCommand(jobId, payload) {
  const engine = engineMap.get(payload.engine);
  if (!engine) throw new Error("Неизвестный TTS-движок");
  const binary = engine.binary === "omni" ? omniBinary : speechBinary;
  if (!binary) throw new Error(engine.binary === "omni" ? "Сначала соберите speech-omni" : "Не найден release binary speech");

  const output = join(outputDir, `${jobId}.wav`);
  const args = [];
  if (engine.command !== "speech-omni") args.push(engine.command);
  if (payload.text?.trim()) args.push(payload.text.trim());
  args.push(...(engine.staticArgs || []));

  const values = payload.values || {};
  for (const field of engine.fields) {
    const value = values[field.key];
    if (value === undefined || value === null || value === "" || value === false) continue;
    if (field.type === "toggle") {
      args.push(field.cli);
      continue;
    }
    const resolvedValue = field.type === "file" ? await materializeFile(jobId, field, value) : String(value);
    if (resolvedValue) args.push(field.cli, resolvedValue);
  }
  args.push("--output", output);
  args.push(...parseRawArgs(payload.rawArgs));
  return { engine, binary, args, output };
}

function commandForDisplay(binary, args) {
  const quote = (value) => /^[a-zA-Z0-9_./:=+-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
  return [binary, ...args].map(quote).join(" ");
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 1024 * 1024) return `${Math.max(0, Math.round(bytes || 0) / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function modelRepoFromLockPath(path) {
  const match = path.match(/\.locks\/models--([^/]+)\/blobs\//);
  return match ? match[1].replaceAll("--", "/") : null;
}

async function modelTotalBytes(repo) {
  if (!repo) return null;
  if (modelTotals.has(repo)) return modelTotals.get(repo);
  const pending = fetch(`https://huggingface.co/api/models/${repo}/tree/main?recursive=true`, {
    signal: AbortSignal.timeout(5000),
    headers: { Accept: "application/json" },
  }).then(async (response) => {
    if (!response.ok) return null;
    const files = await response.json();
    const total = (Array.isArray(files) ? files : []).reduce((sum, file) => {
      const size = Number(file.size ?? 0);
      return sum + (Number.isFinite(size) ? size : 0);
    }, 0);
    return total || null;
  }).catch(() => null);
  modelTotals.set(repo, pending);
  const total = await pending;
  modelTotals.set(repo, total);
  return total;
}

async function directoryBytes(path) {
  let total = 0;
  let entries;
  try { entries = await readdir(path, { withFileTypes: true }); } catch { return 0; }
  for (const entry of entries) {
    const entryPath = join(path, entry.name);
    if (entry.isDirectory()) total += await directoryBytes(entryPath);
    else {
      try { total += (await stat(entryPath)).size; } catch {}
    }
  }
  return total;
}

async function cachedModelBytes(repo) {
  if (!repo) return 0;
  const cachePath = join(process.env.HOME || "", "Library", "Caches", "qwen3-speech", "models", ...repo.split("/"));
  return directoryBytes(cachePath);
}

function inspectDownload(processId) {
  return new Promise((resolve) => {
    execFile("lsof", ["-p", String(processId)], { maxBuffer: 2 * 1024 * 1024 }, async (error, stdout) => {
      if (error) return resolve(null);
      const lines = stdout.split("\n");
      const tempPath = lines.map((line) => line.trim().split(/\s+/).at(-1)).find((path) => path?.includes("/CFNetworkDownload_"));
      const lockPath = lines.map((line) => line.trim().split(/\s+/).at(-1)).find((path) => path?.includes("/.locks/models--") && path.endsWith(".lock"));
      if (!tempPath && !lockPath) return resolve(null);
      let downloaded = 0;
      if (tempPath) {
        try { downloaded = (await stat(tempPath)).size; } catch {}
      }
      const repo = modelRepoFromLockPath(lockPath || "");
      downloaded += await cachedModelBytes(repo);
      const total = await modelTotalBytes(repo);
      resolve({ downloaded, total, repo });
    });
  });
}

function startDownloadMonitor(job, appendLog) {
  let checking = false;
  const check = async () => {
    if (checking || job.status !== "running" || !job.process) return;
    checking = true;
    try {
      const progress = await inspectDownload(job.process.pid);
      if (progress) {
        const percent = progress.total ? ` · ${Math.min(99, Math.round(progress.downloaded / progress.total * 100))}%` : "";
        const repo = progress.repo ? ` ${progress.repo}` : " модели";
        const signature = `${progress.downloaded}:${progress.total}:${progress.repo}`;
        if (signature !== job.downloadSignature) {
          job.downloadSignature = signature;
          appendLog(`[Загрузка${repo}] ${formatBytes(progress.downloaded)}${progress.total ? ` из ${formatBytes(progress.total)}` : ""}${percent}`);
        }
      }
    } finally {
      checking = false;
    }
  };
  job.downloadTimer = setInterval(check, 1000);
  check();
}

async function startJob(payload) {
  if ([...jobs.values()].some((job) => job.status === "running")) {
    throw new Error("Дождитесь завершения текущего синтеза или отмените его");
  }
  if (!payload.text?.trim() && !payload.values?.batchFile) throw new Error("Введите текст для синтеза");

  const id = randomUUID();
  const built = await buildCommand(id, payload);
  const startedAt = new Date().toISOString();
  const job = {
    id, engine: built.engine.id, engineName: built.engine.name, text: payload.text || "",
    status: "running", startedAt, finishedAt: null, log: "", error: null,
    output: built.output, command: commandForDisplay(built.binary, built.args), process: null,
  };
  jobs.set(id, job);

  const child = spawn(built.binary, built.args, {
    cwd: repoDir,
    env: { ...process.env, MLX_METAL_LIBRARY: findMetalLibrary() || "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  job.process = child;
  const appendLog = (chunk) => {
    job.log = `${job.log}${chunk.toString()}`.slice(-24000);
  };
  startDownloadMonitor(job, appendLog);
  child.stdout.on("data", appendLog);
  child.stderr.on("data", appendLog);
  child.on("error", (error) => {
    job.status = "failed";
    job.error = error.message;
    job.finishedAt = new Date().toISOString();
  });
  child.on("close", async (code, signal) => {
    clearInterval(job.downloadTimer);
    job.process = null;
    job.finishedAt = new Date().toISOString();
    if (job.status === "cancelled") return;
    if (code === 0 && existsSync(job.output)) {
      job.status = "completed";
      const item = publicJob(job);
      history = [item, ...history.filter((entry) => entry.id !== job.id)].slice(0, 40);
      await persistHistory();
    } else {
      job.status = "failed";
      job.error = signal ? `Процесс завершён сигналом ${signal}` : `speech завершился с кодом ${code}`;
    }
  });
  return publicJob(job);
}

async function startStudioEnhancement(sourceId) {
  if ([...jobs.values()].some((job) => job.status === "running")) {
    throw new Error("Дождитесь завершения текущего задания или отмените его");
  }
  const source = jobs.get(sourceId) || history.find((entry) => entry.id === sourceId);
  const sourcePath = source?.output || join(outputDir, `${sourceId}.wav`);
  if (!source || !existsSync(sourcePath)) throw new Error("Исходное аудио не найдено");
  if (!speechBinary) throw new Error("Не найден release binary speech");
  const id = randomUUID();
  const output = join(outputDir, `${id}.wav`);
  const args = ["studio-enhance", sourcePath, "--output", output];
  const job = {
    id, engine: "studio-enhance", engineName: "Студийная версия", text: source.text || "",
    status: "running", startedAt: new Date().toISOString(), finishedAt: null, log: "", error: null,
    output, command: commandForDisplay(speechBinary, args), process: null, originalAudioUrl: `/api/audio/${sourceId}`,
  };
  jobs.set(id, job);
  const child = spawn(speechBinary, args, {
    cwd: repoDir,
    env: { ...process.env, MLX_METAL_LIBRARY: findMetalLibrary() || "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  job.process = child;
  const appendLog = (chunk) => { job.log = `${job.log}${chunk.toString()}`.slice(-24000); };
  child.stdout.on("data", appendLog);
  child.stderr.on("data", appendLog);
  child.on("error", (error) => { job.status = "failed"; job.error = error.message; job.finishedAt = new Date().toISOString(); });
  child.on("close", async (code, signal) => {
    job.process = null;
    job.finishedAt = new Date().toISOString();
    if (job.status === "cancelled") return;
    if (code === 0 && existsSync(job.output)) {
      job.status = "completed";
      const item = publicJob(job);
      history = [item, ...history.filter((entry) => entry.id !== job.id)].slice(0, 40);
      await persistHistory();
    } else {
      job.status = "failed";
      job.error = signal ? `Процесс завершён сигналом ${signal}` : `studio-enhance завершился с кодом ${code}`;
    }
  });
  return publicJob(job);
}

function findMetalLibrary() {
  return findBinary([
    join(repoDir, ".build", "release", "mlx.metallib"),
    resolve(repoDir, "..", "speech-swift", ".build", "release", "mlx.metallib"),
  ]);
}

function publicJob(job) {
  return {
    id: job.id, engine: job.engine, engineName: job.engineName, text: job.text,
    status: job.status, startedAt: job.startedAt, finishedAt: job.finishedAt,
    log: job.log, error: job.error, command: job.command,
    audioUrl: job.status === "completed" ? `/api/audio/${job.id}` : null,
    originalAudioUrl: job.originalAudioUrl || null,
  };
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new Error("Файлы слишком большие: лимит запроса 96 МБ");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Некорректный JSON запроса");
  }
}

async function serveAudio(id) {
  const item = jobs.get(id) || history.find((entry) => entry.id === id);
  const path = item?.output || join(outputDir, `${id}.wav`);
  if (!existsSync(path)) return json({ error: "Аудио не найдено" }, 404);
  return { status: 200, type: "audio/wav", body: await readFile(path) };
}

async function serveStatic(pathname) {
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const safePath = resolve(publicDir, requested);
  if (!safePath.startsWith(`${publicDir}${sep}`) || !existsSync(safePath)) return null;
  const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };
  return { status: 200, type: types[extname(safePath)] || "application/octet-stream", body: await readFile(safePath) };
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    let result;
    if (request.method === "GET" && url.pathname === "/api/config") {
      result = json({
        engines,
        system: {
          speechReady: Boolean(speechBinary), omniReady: Boolean(omniBinary),
          speechBinary, omniBinary, metalReady: Boolean(findMetalLibrary()),
        },
      });
    } else if (request.method === "GET" && url.pathname === "/api/history") {
      result = json(history);
    } else if (request.method === "POST" && url.pathname === "/api/jobs") {
      result = json(await startJob(await readJsonBody(request)), 202);
    } else if (request.method === "POST" && url.pathname.match(/^\/api\/audio\/[^/]+\/studio$/)) {
      const sourceId = url.pathname.split("/").at(-2);
      result = json(await startStudioEnhancement(sourceId), 202);
    } else if (request.method === "GET" && url.pathname.startsWith("/api/jobs/")) {
      const job = jobs.get(url.pathname.split("/").at(-1));
      result = job ? json(publicJob(job)) : json({ error: "Задание не найдено" }, 404);
    } else if (request.method === "DELETE" && url.pathname.startsWith("/api/jobs/")) {
      const job = jobs.get(url.pathname.split("/").at(-1));
      if (!job || job.status !== "running") result = json({ error: "Нет активного задания" }, 404);
      else {
        job.status = "cancelled";
        job.finishedAt = new Date().toISOString();
        job.process.kill("SIGTERM");
        result = json(publicJob(job));
      }
    } else if (request.method === "GET" && url.pathname.startsWith("/api/audio/")) {
      result = await serveAudio(url.pathname.split("/").at(-1));
    } else {
      result = await serveStatic(url.pathname) || json({ error: "Not found" }, 404);
    }
    response.writeHead(result.status, { "Content-Type": result.type, "Cache-Control": url.pathname.startsWith("/api/") ? "no-store" : "no-cache" });
    response.end(result.body);
  } catch (error) {
    const result = json({ error: error.message || "Внутренняя ошибка" }, 400);
    response.writeHead(result.status, { "Content-Type": result.type });
    response.end(result.body);
  }
});

server.listen(port, host, () => {
  const studioURL = `http://${host}:${port}`;
  console.log(`Speech Studio: ${studioURL}`);
  if (!speechBinary) console.warn("speech binary не найден; задайте SPEECH_SWIFT_BIN");
  if (!omniBinary) console.warn("speech-omni ещё не собран; OmniVoice будет недоступен");
  if (process.platform === "darwin" && process.env.SPEECH_STUDIO_NO_OPEN !== "1") {
    spawn("open", [studioURL], { stdio: "ignore", detached: true }).unref();
  }
});
