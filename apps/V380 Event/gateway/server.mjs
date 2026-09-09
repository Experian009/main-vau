import http from "node:http";
import { URL } from "node:url";

const port = Number(process.env.PORT ?? 8787);
const apiToken = process.env.GATEWAY_TOKEN ?? "";
const allowedOrigin = process.env.ALLOWED_ORIGIN ?? "*";
const decoderOrigin = new URL(process.env.DECODER_ORIGIN ?? "http://decoder:8080");
const mediaOrigin = new URL(process.env.MEDIA_ORIGIN ?? "http://mediamtx:8889");
const motionOrigin = new URL(process.env.MOTION_ORIGIN ?? "http://127.0.0.1:8091");
const notifierOrigin = new URL(process.env.NOTIFIER_ORIGIN ?? "http://127.0.0.1:8090");
const archiveOrigin = new URL(process.env.ARCHIVE_ORIGIN ?? "http://127.0.0.1:8092");
const continuousOrigin = new URL(process.env.CONTINUOUS_ORIGIN ?? "http://127.0.0.1:8093");
const continuousArchiveOrigin = new URL(process.env.CONTINUOUS_ARCHIVE_ORIGIN ?? "http://127.0.0.1:8094");

if (!apiToken) {
  throw new Error("GATEWAY_TOKEN is required");
}

const PTZ_DIRECTIONS = new Set(["up", "down", "left", "right"]);

function applyCors(response, requestOrigin) {
  const origin = allowedOrigin === "*" ? "*" : requestOrigin === allowedOrigin ? requestOrigin : allowedOrigin;
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, If-Match");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  response.setHeader("Access-Control-Expose-Headers", "Location, Link, ETag, Accept-Patch");
  response.setHeader("Vary", "Origin");
}

function sendJson(response, status, payload, requestOrigin) {
  applyCors(response, requestOrigin);
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function isAuthorized(request) {
  return request.headers.authorization === `Bearer ${apiToken}`;
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url, timeoutMs = 5_000) {
  try {
    const response = await fetchWithTimeout(url, {}, timeoutMs);
    const data = await response.json().catch(() => ({ ok: false, error: `Invalid JSON from ${url}` }));
    return { ok: response.ok, status: response.status, ...data };
  } catch (error) {
    return { ok: false, status: 503, error: error instanceof Error ? error.message : "Service unavailable" };
  }
}

async function proxy(request, response, targetUrl, requestOrigin, { rewriteLocation } = {}) {
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : await readBody(request);
  const headers = {};
  for (const name of ["content-type", "if-match", "accept", "authorization"]) {
    const value = request.headers[name];
    if (typeof value === "string") headers[name] = value;
  }
  delete headers.authorization;

  const upstream = await fetchWithTimeout(targetUrl, {
    method: request.method,
    headers,
    body,
    redirect: "manual",
  }, 20_000);

  applyCors(response, requestOrigin);
  response.statusCode = upstream.status;
  for (const name of ["content-type", "etag", "link", "accept-patch", "cache-control"]) {
    const value = upstream.headers.get(name);
    if (value) response.setHeader(name, value);
  }

  const location = upstream.headers.get("location");
  if (location) response.setHeader("Location", rewriteLocation ? rewriteLocation(location) : location);
  response.end(Buffer.from(await upstream.arrayBuffer()));
}

function mapWhepPath(pathname) {
  return pathname.replace(/^\/whep\/live/, "/live/whep");
}

function rewriteWhepLocation(location) {
  const parsed = new URL(location, mediaOrigin);
  return parsed.pathname.replace(/^\/live\/whep/, "/whep/live") + parsed.search;
}

const server = http.createServer(async (request, response) => {
  const requestOrigin = typeof request.headers.origin === "string" ? request.headers.origin : "";
  if (request.method === "OPTIONS") {
    applyCors(response, requestOrigin);
    response.writeHead(204);
    response.end();
    return;
  }

  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  try {
    if (requestUrl.pathname === "/health") {
      sendJson(response, 200, { ok: true, service: "v380-gateway" }, requestOrigin);
      return;
    }

    if (!isAuthorized(request)) {
      sendJson(response, 401, { ok: false, error: "Unauthorized" }, requestOrigin);
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/status") {
      const decoderResponse = await fetchWithTimeout(new URL("/api/status", decoderOrigin));
      const decoderText = await decoderResponse.text();
      let decoder = decoderText;
      try {
        decoder = JSON.parse(decoderText);
      } catch {
        // Preserve non-JSON decoder diagnostics for the local console.
      }
      sendJson(response, decoderResponse.ok ? 200 : 502, {
        ok: decoderResponse.ok,
        decoder,
        streamPath: "/whep/live",
      }, requestOrigin);
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/events") {
      const [motion, notifier, archive, queue, continuous, continuousArchive] = await Promise.all([
        fetchJson(new URL("/events", motionOrigin)),
        fetchJson(new URL("/health", notifierOrigin)),
        fetchJson(new URL("/health", archiveOrigin)),
        fetchJson(new URL("/queue", archiveOrigin)),
        fetchJson(new URL("/health", continuousOrigin)),
        fetchJson(new URL("/health", continuousArchiveOrigin)),
      ]);
      const ready = motion.ok && (notifier.enabled === false || notifier.ok) && (archive.enabled === false || archive.ok) && (continuous.enabled === false || continuous.ok) && (continuousArchive.enabled === false || continuousArchive.ok);
      // Health is diagnostic data: return it with HTTP 200 even when one
      // worker is down, so the browser can show the exact service error.
      sendJson(response, 200, {
        ok: ready,
        motion,
        notifier,
        archive,
        continuous,
        continuousArchive,
        events: Array.isArray(queue.events) ? queue.events : (Array.isArray(motion.events) ? motion.events : []),
        history: Array.isArray(motion.history) ? motion.history : [],
      }, requestOrigin);
      return;
    }

    if (requestUrl.pathname === "/api/motion/config") {
      await proxy(request, response, new URL(`/config${requestUrl.search}`, motionOrigin), requestOrigin);
      return;
    }

    const serviceConfigRoutes = {
      "/api/notifier/config": notifierOrigin,
      "/api/archive/config": archiveOrigin,
      "/api/continuous/config": continuousOrigin,
      "/api/continuous-archive/config": continuousArchiveOrigin,
    };
    if (serviceConfigRoutes[requestUrl.pathname]) {
      await proxy(request, response, new URL(`/config${requestUrl.search}`, serviceConfigRoutes[requestUrl.pathname]), requestOrigin);
      return;
    }

    if (requestUrl.pathname === "/api/archive/scan") {
      await proxy(request, response, new URL(`/scan${requestUrl.search}`, archiveOrigin), requestOrigin);
      return;
    }

    if (requestUrl.pathname === "/api/archive/queue" || requestUrl.pathname.startsWith("/api/archive/queue/")) {
      const targetPath = requestUrl.pathname.replace(/^\/api\/archive/, "");
      await proxy(request, response, new URL(`${targetPath}${requestUrl.search}`, archiveOrigin), requestOrigin);
      return;
    }

    if (requestUrl.pathname.startsWith("/api/events/")) {
      const targetPath = requestUrl.pathname.replace(/^\/api/, "");
      await proxy(request, response, new URL(`${targetPath}${requestUrl.search}`, motionOrigin), requestOrigin);
      return;
    }

    const ptzMatch = requestUrl.pathname.match(/^\/api\/ptz\/(up|down|left|right)$/);
    if (request.method === "POST" && ptzMatch && PTZ_DIRECTIONS.has(ptzMatch[1])) {
      await proxy(request, response, new URL(`/api/ptz/${ptzMatch[1]}`, decoderOrigin), requestOrigin);
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/snapshot") {
      await proxy(request, response, new URL("/snapshot", decoderOrigin), requestOrigin);
      return;
    }

    if (requestUrl.pathname.startsWith("/whep/live")) {
      const target = new URL(mapWhepPath(requestUrl.pathname) + requestUrl.search, mediaOrigin);
      await proxy(request, response, target, requestOrigin, { rewriteLocation: rewriteWhepLocation });
      return;
    }

    sendJson(response, 404, { ok: false, error: "Not found" }, requestOrigin);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gateway request failed";
    sendJson(response, 502, { ok: false, error: message }, requestOrigin);
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`V380 gateway listening on :${port}`);
});
