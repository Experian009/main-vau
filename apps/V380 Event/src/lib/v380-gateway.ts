export interface GatewayConfig {
  baseUrl: string;
  token: string;
}

export type GatewayConnectionState = "not-configured" | "connecting" | "connected" | "error";

export interface ServiceHealth {
  ok: boolean;
  service?: string;
  error?: string;
  sourceState?: string;
  sourceError?: string;
  telegramConfigured?: boolean;
  internalEndpointConfigured?: boolean;
  enabled?: boolean;
  uploaderInstalled?: boolean;
  scanInProgress?: boolean;
  lastSuccessAt?: string | null;
  lastError?: string;
  remoteDirectory?: string;
  directory?: string;
  segmentSeconds?: number;
  detectorConfig?: MotionConfig;
}

export interface MotionConfig {
  enabled: boolean;
  minChangedRatio: number;
  consecutiveFrames: number;
  cooldownSeconds: number;
}

export interface EventDelivery {
  state?: "sending" | "sent" | "disabled" | "failed" | "pending" | "retrying" | "uploaded";
  message?: string;
  uploadedAt?: string;
  remoteDirectory?: string;
}

export interface CameraEvent {
  id: string;
  createdAt: string;
  preSeconds?: number;
  postSeconds?: number;
  frameCount?: number;
  telegram?: EventDelivery;
  archive?: EventDelivery;
  archiveReady?: boolean;
}

export interface EventPipelineStatus {
  ok: boolean;
  motion: ServiceHealth;
  notifier: ServiceHealth;
  archive: ServiceHealth;
  continuous: ServiceHealth;
  continuousArchive: ServiceHealth;
  events: CameraEvent[];
  history: CameraEvent[];
}

const STORAGE_KEY = "v380-gateway-config";

export function loadGatewayConfig(): GatewayConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<GatewayConfig> | null;
    if (!value?.baseUrl || !value.token) return null;
    return { baseUrl: normalizeBaseUrl(value.baseUrl), token: value.token };
  } catch {
    return null;
  }
}

export function saveGatewayConfig(config: GatewayConfig) {
  const normalized = { ...config, baseUrl: normalizeBaseUrl(config.baseUrl) };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export async function testGateway(config: GatewayConfig) {
  const response = await gatewayFetch(config, "/api/status");
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(readError(payload, `Gateway returned ${response.status}`));
  return payload;
}

export async function fetchEventPipeline(config: GatewayConfig): Promise<EventPipelineStatus> {
  const response = await gatewayFetch(config, "/api/events");
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) throw new Error(readError(payload, "Gateway authorization failed"));
  if (!payload || typeof payload !== "object") throw new Error("Gateway returned an invalid event status response");
  return {
    ok: Boolean(payload.ok),
    motion: asServiceHealth(payload.motion),
    notifier: asServiceHealth(payload.notifier),
    archive: asServiceHealth(payload.archive),
    continuous: asServiceHealth(payload.continuous),
    continuousArchive: asServiceHealth(payload.continuousArchive),
    events: Array.isArray(payload.events) ? payload.events as CameraEvent[] : [],
    history: Array.isArray(payload.history) ? payload.history as CameraEvent[] : [],
  };
}

export async function sendPtz(config: GatewayConfig, direction: "up" | "down" | "left" | "right") {
  const response = await gatewayFetch(config, `/api/ptz/${direction}`, { method: "POST" });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(readError(payload, `PTZ returned ${response.status}`));
  }
}

export async function fetchSnapshot(config: GatewayConfig) {
  const response = await gatewayFetch(config, "/snapshot");
  if (!response.ok) throw new Error(`Snapshot returned ${response.status}`);
  return URL.createObjectURL(await response.blob());
}

export async function fetchMotionConfig(config: GatewayConfig): Promise<MotionConfig> {
  const response = await gatewayFetch(config, "/api/motion/config");
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(readError(payload, `Motion config returned ${response.status}`));
  return payload.config as MotionConfig;
}

export type RuntimeService = "notifier" | "archive" | "continuous" | "continuous-archive";

const runtimeServicePaths: Record<RuntimeService, string> = {
  notifier: "/api/notifier/config",
  archive: "/api/archive/config",
  continuous: "/api/continuous/config",
  "continuous-archive": "/api/continuous-archive/config",
};

export async function fetchRuntimeService(config: GatewayConfig, service: RuntimeService): Promise<boolean> {
  const response = await gatewayFetch(config, runtimeServicePaths[service]);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(readError(payload, `Service config returned ${response.status}`));
  return Boolean(payload.config?.enabled);
}

export async function setRuntimeService(config: GatewayConfig, service: RuntimeService, enabled: boolean): Promise<boolean> {
  const response = await gatewayFetch(config, runtimeServicePaths[service], { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(readError(payload, `Service config returned ${response.status}`));
  return Boolean(payload.config?.enabled);
}

export async function saveMotionConfig(config: GatewayConfig, patch: Partial<MotionConfig>): Promise<MotionConfig> {
  const response = await gatewayFetch(config, "/api/motion/config", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(readError(payload, `Motion config returned ${response.status}`));
  return payload.config as MotionConfig;
}

export async function archiveAction(config: GatewayConfig, action: "scan" | "retry" | "remove", id?: string) {
  const path = action === "scan" ? "/api/archive/scan" : `/api/archive/queue/${encodeURIComponent(id || "")}`;
  const response = await gatewayFetch(config, path, { method: action === "remove" ? "DELETE" : "POST" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(readError(payload, `Archive action returned ${response.status}`));
  return payload;
}

export async function connectWhep(
  config: GatewayConfig,
  onTrack: (stream: MediaStream) => void,
): Promise<() => Promise<void>> {
  const peer = new RTCPeerConnection();
  const stream = new MediaStream();
  peer.addTransceiver("video", { direction: "recvonly" });
  peer.addTransceiver("audio", { direction: "recvonly" });
  peer.ontrack = (event) => {
    stream.addTrack(event.track);
    onTrack(stream);
  };

  try {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await waitForIceGathering(peer);

    const response = await gatewayFetch(config, "/whep/live", {
      method: "POST",
      headers: { "Content-Type": "application/sdp" },
      body: peer.localDescription?.sdp ?? offer.sdp,
    });
    if (!response.ok) throw new Error(`WHEP returned ${response.status}: ${await response.text()}`);

    const location = response.headers.get("Location");
    const answer = await response.text();
    await peer.setRemoteDescription({ type: "answer", sdp: answer });

    return async () => {
      peer.close();
      if (location) {
        const resource = new URL(location, `${normalizeBaseUrl(config.baseUrl)}/`);
        await gatewayFetch(config, `${resource.pathname}${resource.search}`, { method: "DELETE" }).catch(() => undefined);
      }
    };
  } catch (error) {
    peer.close();
    throw error;
  }
}

function gatewayFetch(config: GatewayConfig, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${config.token}`);
  return fetch(`${normalizeBaseUrl(config.baseUrl)}${path}`, { ...init, headers });
}

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function asServiceHealth(value: unknown): ServiceHealth {
  return value && typeof value === "object" ? value as ServiceHealth : { ok: false, error: "Service status unavailable" };
}

function readError(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") {
    return payload.error;
  }
  return fallback;
}

function waitForIceGathering(peer: RTCPeerConnection) {
  if (peer.iceGatheringState === "complete") return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timeout = window.setTimeout(done, 4_000);
    function done() {
      window.clearTimeout(timeout);
      peer.removeEventListener("icegatheringstatechange", handleChange);
      resolve();
    }
    function handleChange() {
      if (peer.iceGatheringState === "complete") done();
    }
    peer.addEventListener("icegatheringstatechange", handleChange);
  });
}
