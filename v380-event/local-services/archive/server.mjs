import { createServer } from "node:http";
import { access, copyFile, mkdir, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const EVENTS_DIR = resolve(process.env.EVENTS_DIR || "local-data/events");
const TERABOX_DIR = process.env.TERABOX_EVENTS_DIR || "/V380/events";
const INTERVAL = Math.max(10, Number(process.env.ARCHIVE_INTERVAL_SECONDS || 30)) * 1_000;
const ARCHIVE_ROOT = resolve(process.env.ARCHIVE_ROOT || "local-services/archive");
const TERABOX_APP = resolve(process.env.TERABOX_APP || join(ARCHIVE_ROOT, "node_modules", "terabox-node", "app"));
const TERABOX_CONFIG = resolve(process.env.TERABOX_CONFIG || join(TERABOX_APP, ".config.yaml"));
const UPLOADER_SCRIPT = resolve(process.env.TERABOX_UPLOADER_SCRIPT || join(TERABOX_APP, "app-uploader.js"));
const STAGING_ROOT = resolve(process.env.ARCHIVE_STAGING_DIR || join(ARCHIVE_ROOT, ".upload-staging"));
const NDUS = process.env.TERABOX_NDUS || "";
const PORT = Number(process.env.ARCHIVE_PORT || 8092);
const UPLOAD_TIMEOUT = Math.max(30, Number(process.env.ARCHIVE_UPLOAD_TIMEOUT_SECONDS || 900)) * 1_000;
const HISTORY_PATH = join(EVENTS_DIR, "history.json");
const SETTINGS_PATH = join(EVENTS_DIR, "../terabox-settings.json");
let enabled = process.env.TERABOX_EVENTS_ENABLED !== "false";
async function readSettings() { try { const value = JSON.parse(await readFile(SETTINGS_PATH, "utf8")); if (typeof value.enabled === "boolean") enabled = value.enabled; } catch { /* first start has no settings file */ } }
async function saveSettings() { await writeFile(SETTINGS_PATH, JSON.stringify({ enabled }, null, 2)); }

let lastScanAt = null;
let lastSuccessAt = null;
let lastError = "";
let scanInProgress = false;

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

async function fileExists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function getWorkerState() {
  const uploaderInstalled = await fileExists(UPLOADER_SCRIPT);
  return {
    ok: enabled && uploaderInstalled,
    enabled: enabled && Boolean(NDUS),
    runtimeEnabled: enabled,
    service: "v380-archive",
    teraboxConfigured: Boolean(NDUS),
    uploaderInstalled,
    archiveRoot: ARCHIVE_ROOT,
    eventsDirectory: EVENTS_DIR,
    remoteDirectory: TERABOX_DIR,
    intervalSeconds: INTERVAL / 1_000,
    scanInProgress,
    lastScanAt,
    lastSuccessAt,
    lastError,
  };
}

const healthServer = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
  if (request.method === "GET" && url.pathname === "/health") {
    const state = await getWorkerState();
    return json(response, state.ok ? 200 : 503, state);
  }
  if (url.pathname === "/queue" && request.method === "GET") return json(response, 200, { ok: true, events: (await readReadyEvents()).map((entry) => entry.data) });
  if (url.pathname === "/config" && request.method === "GET") return json(response, 200, { ok: true, config: { enabled } });
  if (url.pathname === "/config" && request.method === "PATCH") { const chunks = []; for await (const chunk of request) chunks.push(chunk); const patch = JSON.parse(Buffer.concat(chunks).toString("utf8")); if (patch.enabled !== undefined) enabled = Boolean(patch.enabled); await saveSettings(); return json(response, 200, { ok: true, config: { enabled } }); }
  const queueMatch = url.pathname.match(/^\/queue\/([^/]+)$/);
  if (queueMatch && (request.method === "POST" || request.method === "DELETE")) {
    const id = decodeURIComponent(queueMatch[1]);
    if (!/^[A-Za-z0-9._-]+$/.test(id)) return json(response, 400, { ok: false, error: "Invalid event id" });
    const metadataPath = join(EVENTS_DIR, `${id}.json`);
    let data;
    try { data = JSON.parse(await readFile(metadataPath, "utf8")); } catch { return json(response, 404, { ok: false, error: "Event not found" }); }
    if (request.method === "POST") {
      data.archiveReady = Boolean(data.fullPath);
      data.archive = { state: "pending", message: "Retry requested by operator", remoteDirectory: TERABOX_DIR };
      await writeFile(metadataPath, JSON.stringify(data, null, 2));
      await updateHistory(id, { archive: data.archive });
      void scan();
      return json(response, 200, { ok: true, event: data });
    }
    for (const path of [data.fullPath, data.telegramPath, metadataPath]) if (path) await unlink(resolve(path)).catch(() => {});
    await updateHistory(id, { archive: { state: "canceled", message: "Removed by operator" } });
    return json(response, 200, { ok: true, removed: id });
  }
  if (url.pathname === "/scan" && request.method === "POST") {
    void scan();
    return json(response, 202, { ok: true, message: "Archive scan requested" });
  }
  return json(response, 404, { ok: false, error: "Not found" });
});
healthServer.listen(PORT, "127.0.0.1", () => log(`archive status listening on 127.0.0.1:${PORT}`));

async function writeConfig() {
  if (!NDUS) throw new Error("TERABOX_NDUS is not configured");
  await mkdir(TERABOX_APP, { recursive: true });
  // JSON string quoting is valid YAML and safely preserves special cookie characters.
  await writeFile(TERABOX_CONFIG, `accounts:\n  MainAcc: ${JSON.stringify(NDUS)}\n`, { encoding: "utf8", mode: 0o600 });
}

async function runUploader(filePath, eventId) {
  const stageDir = join(STAGING_ROOT, eventId);
  const stagedFile = join(stageDir, filePath.split(/[\\/]/).at(-1));
  await rm(stageDir, { recursive: true, force: true });
  await mkdir(stageDir, { recursive: true });
  await copyFile(filePath, stagedFile);

  try {
    const child = spawn(process.execPath, [UPLOADER_SCRIPT, "-a", "MainAcc", "-l", stageDir, "-r", TERABOX_DIR], {
      cwd: ARCHIVE_ROOT,
      env: { ...process.env, CI: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let output = "";
    child.stdout.on("data", (data) => { output += data.toString(); });
    child.stderr.on("data", (data) => { output += data.toString(); });

    const code = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error(`TeraBox upload timed out after ${UPLOAD_TIMEOUT / 1_000} seconds`));
      }, UPLOAD_TIMEOUT);
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("close", (exitCode) => {
        clearTimeout(timeout);
        resolve(exitCode);
      });
    });
    const duplicate = /same name, skipping/i.test(output) && !/size not match/i.test(output);
    const uploaded = /:: Uploaded:/i.test(output) || duplicate;
    if (code !== 0 || !uploaded) {
      throw new Error(`TeraBox upload was not confirmed (${code}): ${output.slice(-1_200)}`);
    }
  } finally {
    await rm(stageDir, { recursive: true, force: true });
  }
}

async function readHistory() {
  try {
    const history = JSON.parse(await readFile(HISTORY_PATH, "utf8"));
    return Array.isArray(history) ? history : [];
  } catch {
    return [];
  }
}

async function updateHistory(eventId, patch) {
  const history = await readHistory();
  const next = history.map((entry) => entry.id === eventId ? { ...entry, ...patch } : entry);
  await writeFile(HISTORY_PATH, JSON.stringify(next, null, 2));
}

async function readReadyEvents() {
  await mkdir(EVENTS_DIR, { recursive: true });
  const names = await readdir(EVENTS_DIR);
  const metadata = await Promise.all(names.filter((name) => name.endsWith(".json") && name !== "history.json").map(async (name) => {
    try {
      const data = JSON.parse(await readFile(join(EVENTS_DIR, name), "utf8"));
      return { metadataPath: join(EVENTS_DIR, name), data };
    } catch (error) {
      log("invalid event metadata", name, error instanceof Error ? error.message : error);
      return null;
    }
  }));
  return metadata.filter((entry) => entry?.data?.archiveReady && entry.data.fullPath && entry.data.id);
}

async function archiveEvent({ metadataPath, data }) {
  const fullPath = resolve(data.fullPath);
  const telegramPath = data.telegramPath ? resolve(data.telegramPath) : null;
  if (!await fileExists(fullPath)) {
    throw new Error(`Event file is missing: ${fullPath}`);
  }
  await writeConfig();
  await runUploader(fullPath, data.id);
  await unlink(fullPath);
  const telegramNeedsRetry = data.telegram?.state === "failed" || data.telegram?.state === "sending";
  if (telegramPath && !telegramNeedsRetry) await unlink(telegramPath).catch(() => {});
  if (telegramNeedsRetry) {
    // TeraBox is complete, but notifier still needs the local Telegram copy.
    // Keep metadata out of the archive queue while notifier retries it.
    await writeFile(metadataPath, JSON.stringify({ ...data, archiveReady: false, fullPath: null, archive: { state: "uploaded", uploadedAt: new Date().toISOString(), remoteDirectory: TERABOX_DIR } }, null, 2));
  } else {
    await unlink(metadataPath);
  }
  await updateHistory(data.id, { archive: { state: "uploaded", uploadedAt: new Date().toISOString(), remoteDirectory: TERABOX_DIR } });
  lastSuccessAt = new Date().toISOString();
  log("archived", data.id);
}

async function scan() {
  if (!enabled || scanInProgress) return;
  scanInProgress = true;
  lastScanAt = new Date().toISOString();
  try {
    if (!NDUS) {
      lastError = "TeraBox disabled: TERABOX_NDUS is not configured";
      return;
    }
    if (!await fileExists(UPLOADER_SCRIPT)) {
      lastError = "terabox-node is not installed; run windows/setup-events.ps1";
      return;
    }
    const events = await readReadyEvents();
    for (const event of events) {
      try {
        await archiveEvent(event);
        lastError = "";
      } catch (error) {
        const message = error instanceof Error ? error.message : "TeraBox upload failed";
        lastError = message;
        await updateHistory(event.data.id, { archive: { state: "retrying", message, remoteDirectory: TERABOX_DIR } });
        log("archive retry later", event.data.id, message);
      }
    }
  } finally {
    scanInProgress = false;
  }
}

await readSettings();
log("archive worker started", { EVENTS_DIR, TERABOX_DIR, INTERVAL, TERABOX_CONFIG });
while (true) {
  await scan();
  await sleep(INTERVAL);
}
