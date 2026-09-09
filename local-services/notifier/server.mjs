import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";

const PORT = Number(process.env.NOTIFIER_PORT || 8090);
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CHAT_ID = String(process.env.TELEGRAM_CHAT_ID || "");
const INTERNAL_TOKEN = process.env.INTERNAL_NOTIFY_TOKEN || "";
const EVENTS_DIR = process.env.EVENTS_DIR || "local-data/events";
const TELEGRAM_MAX_BYTES = Math.max(1, Number(process.env.TELEGRAM_MAX_VIDEO_MB || 45)) * 1_024 * 1_024;
let lastError = "";
let lastAttemptAt = null;
let lastSuccessAt = null;
const retrying = new Set();
const TELEGRAM_PROXY = process.env.TELEGRAM_HTTPS_PROXY || "";
const SETTINGS_PATH = join(EVENTS_DIR, "../telegram-settings.json");
let enabled = process.env.TELEGRAM_ENABLED !== "false";
async function readSettings() { try { const value = JSON.parse(await readFile(SETTINGS_PATH, "utf8")); if (typeof value.enabled === "boolean") enabled = value.enabled; } catch { /* first start has no settings file */ } }
async function saveSettings() { await writeFile(SETTINGS_PATH, JSON.stringify({ enabled }, null, 2)); }

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function configured() {
  return Boolean(TOKEN && CHAT_ID);
}

async function telegram(method, body) {
  if (!configured()) throw new Error("Telegram is not configured");
  const response = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, { method: "POST", body });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.description || `Telegram HTTP ${response.status}`);
  return data;
}

function telegramVideoViaCurl(filePath, caption) {
  return new Promise((resolve, reject) => {
    const curl = process.platform === "win32" ? "curl.exe" : "curl";
    const args = ["--silent", "--show-error", "--fail-with-body", "--proxy", TELEGRAM_PROXY,
      `https://api.telegram.org/bot${TOKEN}/sendVideo`,
      "-F", `chat_id=${CHAT_ID}`, "-F", `caption=${caption || "V380: обнаружено движение"}`,
      "-F", "supports_streaming=true", "-F", `video=@${filePath};type=video/mp4`];
    const child = spawn(curl, args, { windowsHide: true });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.once("error", (error) => reject(new Error(`Telegram proxy upload failed: ${error.message}`)));
    child.once("close", (code) => {
      let data = {};
      try { data = JSON.parse(output); } catch { /* retain curl output below */ }
      if (code !== 0 || !data.ok) reject(new Error(data.description || output.trim() || `curl exit ${code}`));
      else resolve(data);
    });
  });
}

async function sendVideo(filePath, caption) {
  const file = await stat(filePath);
  if (file.size > TELEGRAM_MAX_BYTES) {
    throw new Error(`Telegram clip is ${(file.size / 1_024 / 1_024).toFixed(1)} MB, above the configured ${TELEGRAM_MAX_BYTES / 1_024 / 1_024} MB limit`);
  }
  const form = new FormData();
  form.append("chat_id", CHAT_ID);
  form.append("caption", caption || "V380: обнаружено движение");
  form.append("supports_streaming", "true");
  form.append("video", new Blob([await readFile(filePath)], { type: "video/mp4" }), "v380-motion-event.mp4");
  if (TELEGRAM_PROXY) return telegramVideoViaCurl(filePath, caption);
  return telegram("sendVideo", form);
}

async function retryPendingVideos() {
  if (!enabled || !configured()) return;
  let names;
  try {
    names = await readdir(EVENTS_DIR);
  } catch {
    return;
  }
  for (const name of names.filter((value) => value.endsWith(".json") && value !== "history.json")) {
    const metadataPath = join(EVENTS_DIR, name);
    if (retrying.has(metadataPath)) continue;
    try {
      const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
      if (!metadata.telegramPath || !["failed", "sending"].includes(metadata.telegram?.state)) continue;
      retrying.add(metadataPath);
      await sendVideo(metadata.telegramPath, `V380: движение ${metadata.createdAt || ""}`);
      metadata.telegram = { state: "sent" };
      await writeFile(metadataPath, JSON.stringify(metadata, null, 2));
      try {
        const historyPath = join(EVENTS_DIR, "history.json");
        const history = JSON.parse(await readFile(historyPath, "utf8"));
        if (Array.isArray(history)) {
          await writeFile(historyPath, JSON.stringify(history.map((item) => item.id === metadata.id ? { ...item, telegram: { state: "sent" } } : item), null, 2));
        }
      } catch {
        // Delivery itself succeeded; history repair is best-effort.
      }
      lastError = "";
      lastSuccessAt = new Date().toISOString();
      console.log(`Telegram retry succeeded for ${metadata.id}`);
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Telegram retry failed";
    } finally {
      retrying.delete(metadataPath);
    }
  }
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      return json(res, 200, {
        ok: enabled,
        enabled,
        service: "v380-notifier",
        telegramConfigured: configured(),
        internalEndpointConfigured: Boolean(INTERNAL_TOKEN),
        maxVideoMb: TELEGRAM_MAX_BYTES / 1_024 / 1_024,
        lastError,
        lastAttemptAt,
        lastSuccessAt,
        telegramProxyConfigured: Boolean(TELEGRAM_PROXY),
      });
    }
    if (req.method === "GET" && req.url === "/config") return json(res, 200, { ok: true, config: { enabled } });
    if (req.method === "PATCH" && req.url === "/config") { const chunks = []; for await (const chunk of req) chunks.push(chunk); const patch = JSON.parse(Buffer.concat(chunks).toString("utf8")); if (patch.enabled !== undefined) enabled = Boolean(patch.enabled); await saveSettings(); return json(res, 200, { ok: true, config: { enabled } }); }
    if (req.method !== "POST" || req.url !== "/internal/v1/notify") return json(res, 404, { ok: false, error: "Not found" });
    if (req.headers.authorization !== `Bearer ${INTERNAL_TOKEN}` || !INTERNAL_TOKEN) return json(res, 401, { ok: false, error: "Unauthorized" });
    if (!enabled) return json(res, 202, { ok: true, skipped: true, reason: "Telegram disabled" });
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const filePath = payload.telegramPath || `${EVENTS_DIR}/${payload.id}-event-telegram.mp4`;
    await stat(filePath);
    if (!configured()) return json(res, 202, { ok: true, skipped: true, reason: "Telegram is not configured" });
    lastAttemptAt = new Date().toISOString();
    await sendVideo(filePath, `V380: движение ${payload.createdAt || ""}`);
    lastError = "";
    lastSuccessAt = new Date().toISOString();
    return json(res, 202, { ok: true, sent: filePath });
  } catch (error) {
    lastError = error instanceof Error ? error.message : "Notification failed";
    return json(res, 500, { ok: false, error: lastError });
  }
});
await readSettings();
server.listen(PORT, "127.0.0.1", () => console.log(`notifier listening on 127.0.0.1:${PORT}`));
setInterval(() => void retryPendingVideos(), 30_000);
setTimeout(() => void retryPendingVideos(), 2_000);
