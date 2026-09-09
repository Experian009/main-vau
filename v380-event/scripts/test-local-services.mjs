#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const children = [];
const servers = [];
const temp = await mkdtemp(join(tmpdir(), "v380-event-test-"));

function startServer(handler) {
  const server = createServer(handler);
  servers.push(server);
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function startProcess(file, env) {
  const child = spawn(process.execPath, [file], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ["ignore", "ignore", "ignore"],
  });
  children.push(child);
  return child;
}

async function waitFor(url, expected = 200, timeoutMs = 8_000) {
  const until = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < until) {
    try {
      const response = await fetch(url);
      if (response.status === expected) return response;
      lastError = `expected ${expected}, got ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError}`);
}

try {
  const decoderPort = await startServer((req, res) => {
    if (req.url === "/api/status") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ connected: true }));
      return;
    }
    if (req.url === "/snapshot") {
      res.writeHead(200, { "content-type": "image/jpeg" });
      res.end("snapshot");
      return;
    }
    res.writeHead(404).end();
  });
  const mediaPort = await startServer((req, res) => {
    if (req.url === "/live/whep" && req.method === "POST") {
      res.writeHead(201, { "content-type": "application/sdp", location: "/live/whep/session-1" });
      res.end("v=0\r\n");
      return;
    }
    if (req.url === "/live/whep/session-1" && req.method === "DELETE") {
      res.writeHead(200).end();
      return;
    }
    res.writeHead(404).end();
  });
  const motionPort = await startServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "v380-motion", events: [], history: [], sourceState: "running" }));
  });
  const notifierPort = await startServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "v380-notifier", telegramConfigured: true, internalEndpointConfigured: true }));
  });
  const archivePort = await startServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "v380-archive", enabled: true, uploaderInstalled: true }));
  });
  const gatewayPort = 19087;
  startProcess("gateway/server.mjs", {
    PORT: String(gatewayPort),
    GATEWAY_TOKEN: "test-token",
    DECODER_ORIGIN: `http://127.0.0.1:${decoderPort}`,
    MEDIA_ORIGIN: `http://127.0.0.1:${mediaPort}`,
    MOTION_ORIGIN: `http://127.0.0.1:${motionPort}`,
    NOTIFIER_ORIGIN: `http://127.0.0.1:${notifierPort}`,
    ARCHIVE_ORIGIN: `http://127.0.0.1:${archivePort}`,
  });
  await waitFor(`http://127.0.0.1:${gatewayPort}/health`);

  const unauthorized = await fetch(`http://127.0.0.1:${gatewayPort}/api/events`);
  assert.equal(unauthorized.status, 401);

  const status = await fetch(`http://127.0.0.1:${gatewayPort}/api/status`, { headers: { authorization: "Bearer test-token" } });
  assert.equal(status.status, 200);
  assert.equal((await status.json()).streamPath, "/whep/live");

  const events = await fetch(`http://127.0.0.1:${gatewayPort}/api/events`, { headers: { authorization: "Bearer test-token" } });
  const eventsJson = await events.json();
  assert.equal(events.status, 200);
  assert.equal(eventsJson.motion.service, "v380-motion");
  assert.deepEqual(eventsJson.events, []);

  const whep = await fetch(`http://127.0.0.1:${gatewayPort}/whep/live`, {
    method: "POST",
    headers: { authorization: "Bearer test-token", "content-type": "application/sdp" },
    body: "v=0\r\n",
  });
  assert.equal(whep.status, 201);
  assert.equal(whep.headers.get("location"), "/whep/live/session-1");

  const motionStatusPort = 19091;
  startProcess("local-services/motion/server.mjs", {
    FFMPEG_BIN: "v380-missing-ffmpeg-for-test",
    MOTION_PORT: String(motionStatusPort),
    EVENTS_DIR: join(temp, "motion-events"),
  });
  const motionHealth = await waitFor(`http://127.0.0.1:${motionStatusPort}/health`, 503);
  const motionHealthJson = await motionHealth.json();
  assert.ok(["connecting", "reconnecting"].includes(motionHealthJson.sourceState));

  const notifierStatusPort = 19090;
  startProcess("local-services/notifier/server.mjs", { NOTIFIER_PORT: String(notifierStatusPort) });
  const notifierHealth = await waitFor(`http://127.0.0.1:${notifierStatusPort}/health`);
  assert.equal((await notifierHealth.json()).telegramConfigured, false);

  const archiveStatusPort = 19092;
  startProcess("local-services/archive/server.mjs", {
    ARCHIVE_PORT: String(archiveStatusPort),
    EVENTS_DIR: join(temp, "archive-events"),
    ARCHIVE_ROOT: join(temp, "archive"),
    ARCHIVE_INTERVAL_SECONDS: "10",
  });
  const archiveHealth = await waitFor(`http://127.0.0.1:${archiveStatusPort}/health`, 503);
  assert.equal((await archiveHealth.json()).enabled, false);

  console.log("Local service integration tests passed.");
} finally {
  for (const child of children) child.kill("SIGTERM");
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  await rm(temp, { recursive: true, force: true });
}
