import { createServer } from "node:http";
import { access, mkdir, readdir, rename, rm } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const FFMPEG_BIN = process.env.FFMPEG_BIN || "ffmpeg";
const RTSP_URL = process.env.MOTION_RTSP_URL || "rtsp://127.0.0.1:8554/live";
const ARCHIVE_DIR = resolve(process.env.CONTINUOUS_DIR || "local-data/continuous");
const SEGMENT_SECONDS = Math.max(60, Number(process.env.CONTINUOUS_SEGMENT_SECONDS || 1800));
const PORT = Number(process.env.CONTINUOUS_PORT || 8093);
const SETTINGS_PATH = resolve(process.env.CONTINUOUS_SETTINGS_PATH || "local-data/continuous-settings.json");
const RECORD_AUDIO = process.env.CONTINUOUS_RECORD_AUDIO !== "false";
let enabled = process.env.CONTINUOUS_ENABLED !== "false";

let recorder = null;
let state = "starting";
let lastError = "";
let currentSegment = null;
let startedAt = null;
let segmentsCompleted = 0;

function log(...args) { console.log(new Date().toISOString(), ...args); }
function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}
async function fileExists(path) {
  try { await access(path, fsConstants.F_OK); return true; } catch { return false; }
}
async function listSegments() {
  await mkdir(ARCHIVE_DIR, { recursive: true });
  return (await readdir(ARCHIVE_DIR)).filter((name) => name.endsWith(".mp4")).sort();
}
async function readSettings() { try { const value = JSON.parse(await (await import("node:fs/promises")).readFile(SETTINGS_PATH, "utf8")); if (typeof value.enabled === "boolean") enabled = value.enabled; } catch { /* first start has no settings file */ } }
async function saveSettings() { await mkdir(resolve(SETTINGS_PATH, ".."), { recursive: true }); await (await import("node:fs/promises")).writeFile(SETTINGS_PATH, JSON.stringify({ enabled }, null, 2)); }

function health() {
  return {
    ok: enabled && state === "recording",
    enabled,
    service: "v380-continuous-recorder",
    state,
    source: RTSP_URL,
    directory: ARCHIVE_DIR,
    segmentSeconds: SEGMENT_SECONDS,
    currentSegment,
    startedAt,
    segmentsCompleted,
    lastError,
  };
}

createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
  if (request.method === "GET" && url.pathname === "/health") return json(response, state === "recording" ? 200 : 503, health());
  if (request.method === "GET" && url.pathname === "/segments") return json(response, 200, { ok: true, segments: await listSegments() });
  if (url.pathname === "/config" && request.method === "GET") return json(response, 200, { ok: true, config: { enabled } });
  if (url.pathname === "/config" && request.method === "PATCH") { const chunks = []; for await (const chunk of request) chunks.push(chunk); const patch = JSON.parse(Buffer.concat(chunks).toString("utf8")); if (patch.enabled !== undefined) enabled = Boolean(patch.enabled); await saveSettings(); return json(response, 200, { ok: true, config: { enabled } }); }
  return json(response, 404, { ok: false, error: "Not found" });
}).listen(PORT, "127.0.0.1", () => log(`continuous recorder listening on 127.0.0.1:${PORT}`));

async function recordSegment() {
  await mkdir(ARCHIVE_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const partial = join(ARCHIVE_DIR, `${stamp}.part.mp4`);
  const final = join(ARCHIVE_DIR, `${stamp}.mp4`);
  currentSegment = final;
  state = "recording";
  startedAt = new Date().toISOString();
  const args = ["-hide_banner", "-loglevel", "warning", "-rtsp_transport", "tcp", "-i", RTSP_URL, "-t", String(SEGMENT_SECONDS), "-map", "0:v:0"];
  if (RECORD_AUDIO) args.push("-map", "0:a:0?");
  args.push("-c:v", "copy");
  if (RECORD_AUDIO) args.push("-c:a", "aac", "-b:a", "128k");
  args.push("-movflags", "+faststart", "-y", partial);
  log("starting segment", final);
  const child = spawn(FFMPEG_BIN, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  recorder = child;
  let diagnostics = "";
  child.stderr.on("data", (chunk) => { diagnostics = `${diagnostics}${chunk}`.slice(-2000); });
  const code = await new Promise((resolveCode) => {
    child.once("error", (error) => { diagnostics = `${diagnostics}\n${error.message}`; resolveCode(1); });
    child.once("close", (exitCode) => resolveCode(exitCode ?? 1));
  });
  recorder = null;
  currentSegment = null;
  if (code === 0 && await fileExists(partial)) {
    await rename(partial, final);
    segmentsCompleted += 1;
    lastError = "";
    log("segment completed", final);
    return true;
  }
  await rm(partial, { force: true });
  state = "reconnecting";
  lastError = `FFmpeg segment failed (${code}): ${diagnostics.trim().slice(-1000)}`;
  log(lastError);
  return false;
}

async function main() {
  await readSettings();
  while (true) {
    if (!enabled) { state = "disabled"; currentSegment = null; await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000)); continue; }
    const completed = await recordSegment().catch((error) => {
      state = "reconnecting";
      lastError = error instanceof Error ? error.message : "Recorder failed";
      return false;
    });
    state = completed ? "reconnecting" : "reconnecting";
    await new Promise((resolveDelay) => setTimeout(resolveDelay, completed ? 1000 : 5000));
  }
}

process.on("SIGTERM", () => { if (recorder) recorder.kill("SIGTERM"); process.exit(0); });
process.on("SIGINT", () => { if (recorder) recorder.kill("SIGINT"); process.exit(0); });
void main();
