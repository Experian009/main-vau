import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

const env = process.env;
const FFMPEG = env.FFMPEG_BIN || "ffmpeg";
const RTSP_URL = env.MOTION_RTSP_URL || "rtsp://127.0.0.1:8554/live";
const EVENTS_DIR = env.EVENTS_DIR || join(process.cwd(), "local-data", "events");
const PORT = Number(env.MOTION_PORT || 8091);
const FPS = Math.max(1, Number(env.DETECT_FPS || 2));
const WIDTH = Math.max(160, Number(env.DETECT_WIDTH || 640));
const HEIGHT = Math.max(90, Number(env.DETECT_HEIGHT || 360));
const EVENT_FPS = Math.max(1, Number(env.EVENT_RECORD_FPS || 10));
const EVENT_WIDTH = Math.max(320, Number(env.EVENT_RECORD_WIDTH || 1280));
const EVENT_HEIGHT_VALUE = Number(env.EVENT_RECORD_HEIGHT || -2);
const EVENT_HEIGHT = EVENT_HEIGHT_VALUE === -2 ? -2 : Math.max(180, EVENT_HEIGHT_VALUE);
const detectorConfig = {
  enabled: env.MOTION_ENABLED !== "false",
  minChangedRatio: Number(env.MIN_CHANGED_RATIO || 0.035),
  consecutiveFrames: Math.max(1, Number(env.CONSECUTIVE_FRAMES || 3)),
  cooldownSeconds: Math.max(0, Number(env.COOLDOWN_SECONDS || 30)),
};
const PRE_SECONDS = Math.max(0, Number(env.PREBUFFER_SECONDS || 5));
const POST_SECONDS = Math.max(1, Number(env.POSTBUFFER_SECONDS || 20));
const MAX_HISTORY = Math.max(10, Number(env.EVENT_HISTORY_LIMIT || 100));
const RAW_FRAME_BYTES = WIDTH * HEIGHT;
const RING_LIMIT = Math.max(1, Math.ceil(PRE_SECONDS * EVENT_FPS));
const HISTORY_PATH = join(EVENTS_DIR, "history.json");

await mkdir(EVENTS_DIR, { recursive: true });

let previous = null;
let changedStreak = 0;
let lastEventAt = 0;
let capturing = null;
let frameBuffer = Buffer.alloc(0);
let jpegBuffer = Buffer.alloc(0);
let sourceState = "starting";
let sourceError = "";
let lastChangedRatio = 0;
const ring = [];

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

function addRing(frame) {
  ring.push(frame);
  while (ring.length > RING_LIMIT) ring.shift();
}

function changedRatio(frame) {
  if (!previous) {
    previous = Buffer.from(frame);
    return 0;
  }
  let changed = 0;
  for (let i = 0; i < frame.length; i += 4) {
    if (Math.abs(frame[i] - previous[i]) > 22) changed++;
  }
  const ratio = changed / Math.ceil(frame.length / 4);
  previous = Buffer.from(frame);
  return ratio;
}

function splitJpegs(chunk) {
  jpegBuffer = Buffer.concat([jpegBuffer, chunk]);
  const frames = [];
  while (true) {
    const start = jpegBuffer.indexOf(Buffer.from([0xff, 0xd8]));
    if (start < 0) {
      if (jpegBuffer.length > 1_048_576) jpegBuffer = Buffer.alloc(0);
      break;
    }
    const end = jpegBuffer.indexOf(Buffer.from([0xff, 0xd9]), start + 2);
    if (end < 0) {
      if (start > 0) jpegBuffer = jpegBuffer.subarray(start);
      break;
    }
    frames.push(Buffer.from(jpegBuffer.subarray(start, end + 2)));
    jpegBuffer = jpegBuffer.subarray(end + 2);
  }
  return frames;
}

async function encodeClip(jpegs, outputPath, durationSeconds) {
  if (!jpegs.length) throw new Error("No JPEG frames collected");
  const args = [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "image2pipe", "-framerate", String(EVENT_FPS), "-i", "pipe:0",
    "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
  ];
  if (durationSeconds) args.push("-t", String(durationSeconds));
  args.push(outputPath);
  const encoder = spawn(FFMPEG, args, { stdio: ["pipe", "ignore", "pipe"] });
  let errors = "";
  encoder.stderr.on("data", (data) => { errors += data.toString(); });
  for (const jpeg of jpegs) encoder.stdin.write(jpeg);
  encoder.stdin.end();
  const code = await new Promise((resolve, reject) => {
    encoder.once("error", reject);
    encoder.once("close", resolve);
  });
  if (code !== 0) throw new Error(`FFmpeg encode failed: ${errors || `exit ${code}`}`);
}

async function readHistory() {
  try {
    const parsed = JSON.parse(await readFile(HISTORY_PATH, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function addHistory(entry) {
  const history = await readHistory();
  const withoutCurrent = history.filter((item) => item.id !== entry.id);
  withoutCurrent.unshift(entry);
  await writeFile(HISTORY_PATH, JSON.stringify(withoutCurrent.slice(0, MAX_HISTORY), null, 2));
}

async function readPendingEvents() {
  const names = await readdir(EVENTS_DIR);
  const entries = await Promise.all(names.filter((name) => name.endsWith(".json") && name !== "history.json").map(async (name) => {
    try {
      return JSON.parse(await readFile(join(EVENTS_DIR, name), "utf8"));
    } catch {
      return null;
    }
  }));
  return entries.filter(Boolean).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

async function notify(state, metadataPath, metadata) {
  const notifyUrl = env.NOTIFIER_URL || "http://127.0.0.1:8090/internal/v1/notify";
  const token = env.INTERNAL_NOTIFY_TOKEN || "";
  if (!token) {
    metadata.telegram = { state: "disabled", message: "INTERNAL_NOTIFY_TOKEN is not configured" };
    metadata.archiveReady = true;
    await writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    return;
  }

  try {
    const response = await fetch(notifyUrl, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: state.id, createdAt: state.createdAt, telegramPath: metadata.telegramPath }),
    });
    const body = await response.json().catch(() => ({}));
    metadata.telegram = response.ok ? { state: body.skipped ? "disabled" : "sent" } : { state: "failed", message: body.error || `HTTP ${response.status}` };
  } catch (error) {
    metadata.telegram = { state: "failed", message: error instanceof Error ? error.message : "Notifier unavailable" };
  }
  metadata.archiveReady = true;
  await writeFile(metadataPath, JSON.stringify(metadata, null, 2));
}

async function finishCapture(state) {
  const fullPath = join(EVENTS_DIR, `${state.id}-event-full.mp4`);
  const telegramPath = join(EVENTS_DIR, `${state.id}-event-telegram.mp4`);
  const metadataPath = join(EVENTS_DIR, `${state.id}.json`);
  const postFrames = state.frames.slice(state.preCount);
  await encodeClip(state.frames, fullPath);
  await encodeClip(postFrames, telegramPath, POST_SECONDS);

  const metadata = {
    id: state.id,
    createdAt: state.createdAt,
    fullPath,
    telegramPath,
    preSeconds: PRE_SECONDS,
    postSeconds: POST_SECONDS,
    frameCount: state.frames.length,
    archiveReady: false,
    telegram: { state: "sending" },
  };
  await writeFile(metadataPath, JSON.stringify(metadata, null, 2));
  await notify(state, metadataPath, metadata);
  await addHistory({
    id: state.id,
    createdAt: state.createdAt,
    preSeconds: PRE_SECONDS,
    postSeconds: POST_SECONDS,
    frameCount: state.frames.length,
    telegram: metadata.telegram,
    archive: { state: "pending" },
  });
  log("event completed", state.id, fullPath);
}

async function startCapture() {
  if (!detectorConfig.enabled || capturing || Date.now() - lastEventAt < detectorConfig.cooldownSeconds * 1_000) return;
  lastEventAt = Date.now();
  const state = {
    id: `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 8)}`,
    createdAt: new Date().toISOString(),
    frames: [...ring],
    preCount: ring.length,
    until: Date.now() + POST_SECONDS * 1_000,
  };
  capturing = state;
  log("motion detected", state.id);
}

function acceptJpeg(jpeg) {
  addRing(jpeg);
  if (!capturing) return;
  capturing.frames.push(jpeg);
  if (Date.now() >= capturing.until) {
    const completed = capturing;
    capturing = null;
    finishCapture(completed).catch((error) => log("event encoding error", error.message));
  }
}

const healthServer = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
  if (request.method !== "GET" && request.method !== "PATCH" && request.method !== "POST" && request.method !== "DELETE") return json(response, 405, { ok: false, error: "Method not allowed" });
  if (url.pathname === "/health") {
    return json(response, sourceState === "running" ? 200 : 503, {
      ok: sourceState === "running",
      service: "v380-motion",
      sourceState,
      sourceError,
      lastChangedRatio,
      detectorConfig,
      ringFrames: ring.length,
      capture: capturing ? {
        id: capturing.id,
        createdAt: capturing.createdAt,
        postRemainingSeconds: Math.max(0, Math.ceil((capturing.until - Date.now()) / 1_000)),
      } : null,
    });
  }
  if (url.pathname === "/config") {
    if (request.method === "GET") return json(response, 200, { ok: true, service: "v380-motion", config: detectorConfig, restartRequired: ["DETECT_FPS", "DETECT_WIDTH", "DETECT_HEIGHT", "EVENT_RECORD_FPS", "EVENT_RECORD_WIDTH", "EVENT_RECORD_HEIGHT"] });
    if (request.method === "PATCH") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const patch = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (patch.enabled !== undefined) detectorConfig.enabled = Boolean(patch.enabled);
      if (patch.minChangedRatio !== undefined) detectorConfig.minChangedRatio = Math.min(1, Math.max(0.001, Number(patch.minChangedRatio)));
      if (patch.consecutiveFrames !== undefined) detectorConfig.consecutiveFrames = Math.min(30, Math.max(1, Math.round(Number(patch.consecutiveFrames))));
      if (patch.cooldownSeconds !== undefined) detectorConfig.cooldownSeconds = Math.min(3600, Math.max(0, Number(patch.cooldownSeconds)));
      return json(response, 200, { ok: true, config: detectorConfig });
    }
  }
  if (url.pathname === "/events") {
    const [events, history] = await Promise.all([readPendingEvents(), readHistory()]);
    return json(response, sourceState === "running" ? 200 : 503, {
      ok: sourceState === "running",
      service: "v380-motion",
      sourceState,
      sourceError,
      lastChangedRatio,
      detectorConfig,
      ringFrames: ring.length,
      capture: capturing ? {
        id: capturing.id,
        createdAt: capturing.createdAt,
        postRemainingSeconds: Math.max(0, Math.ceil((capturing.until - Date.now()) / 1_000)),
      } : null,
      events,
      history,
    });
  }
  const eventMatch = url.pathname.match(/^\/events\/([^/]+)$/);
  if (eventMatch && (request.method === "DELETE" || request.method === "POST")) {
    const id = decodeURIComponent(eventMatch[1]);
    if (!/^[A-Za-z0-9._-]+$/.test(id)) return json(response, 400, { ok: false, error: "Invalid event id" });
    const metadataPath = join(EVENTS_DIR, `${id}.json`);
    let metadata;
    try { metadata = JSON.parse(await readFile(metadataPath, "utf8")); } catch { return json(response, 404, { ok: false, error: "Event not found" }); }
    if (request.method === "POST") {
      metadata.archiveReady = Boolean(metadata.fullPath);
      if (metadata.telegramPath && metadata.telegram?.state !== "sent") metadata.telegram = { state: "failed", message: "Retry requested by operator" };
      await writeFile(metadataPath, JSON.stringify(metadata, null, 2));
      return json(response, 200, { ok: true, event: metadata });
    }
    for (const path of [metadata.fullPath, metadata.telegramPath, metadataPath]) if (path) await rm(path, { force: true }).catch(() => {});
    return json(response, 200, { ok: true, removed: id });
  }
  return json(response, 404, { ok: false, error: "Not found" });
});
healthServer.listen(PORT, "127.0.0.1", () => log(`motion status listening on 127.0.0.1:${PORT}`));

let ffmpeg = null;
let stopping = false;
let reconnectTimer = null;

function scheduleReconnect(reason) {
  if (stopping || reconnectTimer) return;
  sourceState = "reconnecting";
  sourceError = reason;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startStream();
  }, 5_000);
}

function startStream() {
  sourceState = "connecting";
  frameBuffer = Buffer.alloc(0);
  jpegBuffer = Buffer.alloc(0);
  const processRef = spawn(FFMPEG, [
    "-hide_banner", "-loglevel", "warning", "-rtsp_transport", "tcp", "-i", RTSP_URL,
    "-an", "-vf", `fps=${FPS},scale=${WIDTH}:${HEIGHT}:flags=fast_bilinear,format=gray`,
    "-f", "rawvideo", "pipe:1",
    "-an", "-vf", `fps=${EVENT_FPS},scale=${EVENT_WIDTH}:${EVENT_HEIGHT}:flags=fast_bilinear`,
    "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:3",
  ], { stdio: ["ignore", "pipe", "pipe", "pipe"] });
  ffmpeg = processRef;

  processRef.stderr.on("data", (data) => log("ffmpeg", data.toString().trim()));
  processRef.once("error", (error) => {
    log("capture process error", error.message);
    scheduleReconnect(error.message);
  });
  processRef.on("close", (code) => {
    if (ffmpeg === processRef) ffmpeg = null;
    if (!stopping) {
      const reason = `FFmpeg stopped with code ${code}`;
      log("capture stopped", code);
      scheduleReconnect(reason);
    }
  });

  processRef.stdio[1].on("data", (chunk) => {
    sourceState = "running";
    sourceError = "";
    frameBuffer = Buffer.concat([frameBuffer, chunk]);
    while (frameBuffer.length >= RAW_FRAME_BYTES) {
      const frame = frameBuffer.subarray(0, RAW_FRAME_BYTES);
      frameBuffer = frameBuffer.subarray(RAW_FRAME_BYTES);
      const ratio = changedRatio(frame);
      lastChangedRatio = ratio;
      if (ratio >= detectorConfig.minChangedRatio) changedStreak++; else changedStreak = 0;
      if (changedStreak >= detectorConfig.consecutiveFrames) {
        changedStreak = 0;
        startCapture().catch((error) => log("capture start error", error.message));
      }
    }
  });
  processRef.stdio[3].on("data", (chunk) => {
    for (const jpeg of splitJpegs(chunk)) acceptJpeg(jpeg);
  });
}

function shutdown() {
  stopping = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  ffmpeg?.kill("SIGINT");
  healthServer.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
log("motion detector started", { RTSP_URL, FPS, WIDTH, HEIGHT, EVENT_FPS, EVENT_WIDTH, EVENT_HEIGHT, PRE_SECONDS, POST_SECONDS, detectorConfig });
startStream();
await sleep(1_000);
