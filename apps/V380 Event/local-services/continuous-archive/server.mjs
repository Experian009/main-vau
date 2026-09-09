import { createServer } from "node:http";
import { access, copyFile, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { randomUUID } from "node:crypto";

const CONTINUOUS_DIR = resolve(process.env.CONTINUOUS_DIR || "local-data/continuous");
const ARCHIVE_ROOT = resolve(process.env.ARCHIVE_ROOT || "local-services/archive");
const TERABOX_APP = resolve(process.env.TERABOX_APP || join(ARCHIVE_ROOT, "node_modules", "terabox-node", "app"));
const TERABOX_CONFIG = resolve(process.env.TERABOX_CONFIG || join(TERABOX_APP, ".config.yaml"));
const UPLOADER_SCRIPT = resolve(process.env.TERABOX_UPLOADER_SCRIPT || join(TERABOX_APP, "app-uploader.js"));
const STAGING_ROOT = resolve(process.env.CONTINUOUS_STAGING_DIR || join(ARCHIVE_ROOT, ".continuous-staging"));
const TERABOX_DIR = process.env.TERABOX_CONTINUOUS_DIR || "/V380/archive";
const NDUS = process.env.TERABOX_NDUS || "";
const INTERVAL = Math.max(10, Number(process.env.CONTINUOUS_ARCHIVE_INTERVAL_SECONDS || 30)) * 1000;
const UPLOAD_TIMEOUT = Math.max(30, Number(process.env.ARCHIVE_UPLOAD_TIMEOUT_SECONDS || 900)) * 1000;
const PORT = Number(process.env.CONTINUOUS_ARCHIVE_PORT || 8094);
const MAX_LOCAL_SEGMENTS = Math.max(0, Number(process.env.CONTINUOUS_MAX_LOCAL_SEGMENTS || 0));
const SETTINGS_PATH = resolve(process.env.CONTINUOUS_ARCHIVE_SETTINGS_PATH || "local-data/continuous-archive-settings.json");
let enabled = process.env.CONTINUOUS_ARCHIVE_ENABLED !== "false";

let scanInProgress = false;
let lastScanAt = null;
let lastSuccessAt = null;
let lastError = "";
let uploadedCount = 0;

function log(...args) { console.log(new Date().toISOString(), ...args); }
function json(response, status, body) { response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); response.end(JSON.stringify(body)); }
async function fileExists(path) { try { await access(path, fsConstants.F_OK); return true; } catch { return false; } }
async function writeConfig() {
  if (!NDUS) throw new Error("TERABOX_NDUS is not configured");
  await mkdir(TERABOX_APP, { recursive: true });
  await writeFile(TERABOX_CONFIG, `accounts:\n  MainAcc: ${JSON.stringify(NDUS)}\n`, { encoding: "utf8", mode: 0o600 });
}
async function segments() {
  await mkdir(CONTINUOUS_DIR, { recursive: true });
  const files = await readdir(CONTINUOUS_DIR);
  const result = [];
  // Never upload an FFmpeg file that is still being finalized. The recorder
  // atomically renames *.part.mp4 to *.mp4 only after FFmpeg exits cleanly.
  for (const name of files.filter((item) => item.endsWith(".mp4") && !item.endsWith(".part.mp4")).sort()) {
    const path = join(CONTINUOUS_DIR, name);
    try { const details = await stat(path); result.push({ name, path, size: details.size, modifiedAt: details.mtime.toISOString() }); } catch { /* segment rotated away */ }
  }
  return result;
}
async function readSettings() { try { const value = JSON.parse(await (await import("node:fs/promises")).readFile(SETTINGS_PATH, "utf8")); if (typeof value.enabled === "boolean") enabled = value.enabled; } catch { /* first start has no settings file */ } }
async function saveSettings() { await mkdir(resolve(SETTINGS_PATH, ".."), { recursive: true }); await (await import("node:fs/promises")).writeFile(SETTINGS_PATH, JSON.stringify({ enabled }, null, 2)); }
function state() { return { ok: enabled && Boolean(NDUS && scanInProgress === false && !lastError),
  enabled: enabled && Boolean(NDUS), runtimeEnabled: enabled, service: "v380-continuous-archive", teraboxConfigured: Boolean(NDUS), uploaderInstalled: Boolean(UPLOADER_SCRIPT), localDirectory: CONTINUOUS_DIR, remoteDirectory: TERABOX_DIR, intervalSeconds: INTERVAL / 1000, scanInProgress, uploadedCount, lastScanAt, lastSuccessAt, lastError }; }

createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
  if (request.method === "GET" && url.pathname === "/health") return json(response, state().ok ? 200 : 503, state());
  if (request.method === "GET" && url.pathname === "/queue") return json(response, 200, { ok: true, segments: await segments() });
  if (url.pathname === "/config" && request.method === "GET") return json(response, 200, { ok: true, config: { enabled } });
  if (url.pathname === "/config" && request.method === "PATCH") { const chunks = []; for await (const chunk of request) chunks.push(chunk); const patch = JSON.parse(Buffer.concat(chunks).toString("utf8")); if (patch.enabled !== undefined) enabled = Boolean(patch.enabled); await saveSettings(); return json(response, 200, { ok: true, config: { enabled } }); }
  if (request.method === "POST" && url.pathname === "/scan") { void scan(); return json(response, 202, { ok: true, message: "Continuous archive scan requested" }); }
  return json(response, 404, { ok: false, error: "Not found" });
}).listen(PORT, "127.0.0.1", () => log(`continuous archive listening on 127.0.0.1:${PORT}`));

async function runUpload(stageDir) {
  const child = spawn(process.execPath, [UPLOADER_SCRIPT, "-a", "MainAcc", "-l", stageDir, "-r", TERABOX_DIR], { cwd: ARCHIVE_ROOT, env: { ...process.env, CI: "1" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let output = "";
  child.stdout.on("data", (data) => { output += data.toString(); });
  child.stderr.on("data", (data) => { output += data.toString(); });
  const code = await new Promise((resolveCode, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error(`TeraBox upload timed out after ${UPLOAD_TIMEOUT / 1000} seconds`)); }, UPLOAD_TIMEOUT);
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("close", (exitCode) => { clearTimeout(timeout); resolveCode(exitCode ?? 1); });
  });
  const uploaded = /:: Uploaded:/i.test(output);
  const duplicateSameSize = /same name, skipping/i.test(output) && !/size not match/i.test(output);
  const sizeMismatch = /size not match/i.test(output);
  return { code, output, confirmed: uploaded || duplicateSameSize, sizeMismatch };
}

async function upload(file) {
  const baseName = file.name.replace(/\.mp4$/i, "");
  const stageDir = join(STAGING_ROOT, baseName);
  await rm(stageDir, { recursive: true, force: true });
  await mkdir(stageDir, { recursive: true });
  try {
    let remoteName = file.name;
    await copyFile(file.path, join(stageDir, remoteName));
    let result = await runUpload(stageDir);
    // TeraBox does not overwrite an existing file. If an earlier interrupted
    // run left a same-name partial object, retry with a unique remote name.
    if (result.sizeMismatch) {
      await rm(join(stageDir, remoteName), { force: true });
      remoteName = `${baseName}-${randomUUID().slice(0, 8)}.mp4`;
      await copyFile(file.path, join(stageDir, remoteName));
      result = await runUpload(stageDir);
      log("TeraBox name conflict; uploaded with unique name", { original: file.name, remoteName });
    }
    if (result.code !== 0 || !result.confirmed) throw new Error(`TeraBox upload was not confirmed (${result.code}): ${result.output.slice(-1200)}`);
  } finally { await rm(stageDir, { recursive: true, force: true }); }
}

async function scan() {
  if (!enabled || scanInProgress) return;
  scanInProgress = true;
  lastScanAt = new Date().toISOString();
  try {
    if (!NDUS) { lastError = "TeraBox disabled: TERABOX_NDUS is not configured"; return; }
    if (!await fileExists(UPLOADER_SCRIPT)) { lastError = "terabox-node is not installed; run windows/setup-events.ps1"; return; }
    const files = await segments();
    for (const file of files) {
      try { await writeConfig(); await upload(file); await rm(file.path, { force: true }); uploadedCount += 1; lastSuccessAt = new Date().toISOString(); lastError = ""; log("continuous segment archived", file.name); }
      catch (error) { lastError = error instanceof Error ? error.message : "Continuous archive upload failed"; log("continuous archive retry later", file.name, lastError); break; }
    }
    if (MAX_LOCAL_SEGMENTS > 0) {
      const remaining = await segments();
      for (const old of remaining.slice(0, Math.max(0, remaining.length - MAX_LOCAL_SEGMENTS))) await rm(old.path, { force: true });
    }
  } finally { scanInProgress = false; }
}

await readSettings();
log("continuous archive worker started", { CONTINUOUS_DIR, TERABOX_DIR, INTERVAL });
while (true) { await scan(); await sleep(INTERVAL); }
