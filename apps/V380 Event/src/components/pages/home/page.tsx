import { useCallback, useEffect, useRef, useState } from "react";

import {
  connectWhep,
  archiveAction,
  fetchEventPipeline,
  fetchSnapshot,
  loadGatewayConfig,
  saveGatewayConfig,
  sendPtz,
  type EventPipelineStatus,
  type GatewayConfig,
  type GatewayConnectionState,
} from "@/lib/v380-gateway";
import { SetupDialog } from "./components/setup-dialog";
import { AppHeader } from "./sections/app-header";
import { CameraSidebar, type ConsoleView } from "./sections/camera-sidebar";
import { CameraWorkspace } from "./sections/camera-workspace";
import { EventPanel } from "./sections/event-panel";
import { SettingsPanel } from "./sections/settings-panel";

export function HomePage() {
  const playerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const soundEnabledRef = useRef(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [lastCommand, setLastCommand] = useState("Ожидание команды");
  const [navOpen, setNavOpen] = useState(false);
  const [activeView, setActiveView] = useState<ConsoleView>("camera");
  const [gatewayConfig, setGatewayConfig] = useState<GatewayConfig | null>(() => loadGatewayConfig());
  const [connectionState, setConnectionState] = useState<GatewayConnectionState>(() => loadGatewayConfig() ? "connecting" : "not-configured");
  const [connectionError, setConnectionError] = useState("");
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [pipeline, setPipeline] = useState<EventPipelineStatus | null>(null);
  const [pipelineLoading, setPipelineLoading] = useState(false);
  const [pipelineError, setPipelineError] = useState("");
  const [pipelineUpdatedAt, setPipelineUpdatedAt] = useState<Date | null>(null);

  const refreshPipeline = useCallback(async () => {
    if (!gatewayConfig) {
      setPipeline(null);
      setPipelineError("");
      return;
    }
    setPipelineLoading(true);
    try {
      const next = await fetchEventPipeline(gatewayConfig);
      setPipeline(next);
      setPipelineError("");
      setPipelineUpdatedAt(new Date());
    } catch (error) {
      setPipelineError(error instanceof Error ? error.message : "Не удалось получить статус event pipeline");
    } finally {
      setPipelineLoading(false);
    }
  }, [gatewayConfig]);

  useEffect(() => {
    if (!gatewayConfig) return;
    const initialRefresh = window.setTimeout(() => void refreshPipeline(), 0);
    const interval = window.setInterval(() => void refreshPipeline(), 10_000);
    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(interval);
    };
  }, [gatewayConfig, refreshPipeline]);

  useEffect(() => {
    if (!gatewayConfig) return;

    let disposed = false;
    let closeSession: (() => Promise<void>) | undefined;
    const video = videoRef.current;
    const connectTimer = window.setTimeout(() => {
      setConnectionState("connecting");
      setConnectionError("");
      connectWhep(gatewayConfig, (stream) => {
        if (disposed || !video) return;
        video.srcObject = stream;
        video.muted = !soundEnabledRef.current;
        video.play().catch(() => undefined);
        setConnectionState("connected");
      })
        .then((close) => {
          closeSession = close;
        })
        .catch((error) => {
          if (disposed) return;
          setConnectionState("error");
          setConnectionError(error instanceof Error ? error.message : "Не удалось открыть WebRTC-поток");
        });
    }, 0);

    return () => {
      disposed = true;
      window.clearTimeout(connectTimer);
      closeSession?.().catch(() => undefined);
      if (video) video.srcObject = null;
    };
  }, [gatewayConfig, connectionAttempt]);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
    if (videoRef.current) videoRef.current.muted = !soundEnabled;
  }, [soundEnabled]);

  const openFullscreen = async () => {
    await playerRef.current?.requestFullscreen?.();
  };

  const openEvents = () => {
    setActiveView("events");
    void refreshPipeline();
  };

  const handleQueueAction = async (action: "scan" | "retry" | "remove", id?: string) => {
    if (!gatewayConfig) return setShowSetup(true);
    try {
      await archiveAction(gatewayConfig, action, id);
      await refreshPipeline();
    } catch (error) {
      setPipelineError(error instanceof Error ? error.message : "Не удалось выполнить действие очереди");
    }
  };

  async function handlePtz(direction: "up" | "down" | "left" | "right") {
    if (!gatewayConfig) return setShowSetup(true);
    const label = { up: "вверх", down: "вниз", left: "влево", right: "вправо" }[direction];
    setLastCommand(`Отправка команды: ${label}…`);
    try {
      await sendPtz(gatewayConfig, direction);
      setLastCommand(`Камера повернута ${label}`);
    } catch (error) {
      setLastCommand(error instanceof Error ? error.message : "Ошибка PTZ");
    }
  }

  async function handleSnapshot() {
    if (!gatewayConfig) return setShowSetup(true);
    setLastCommand("Создание снимка…");
    try {
      const snapshotUrl = await fetchSnapshot(gatewayConfig);
      window.open(snapshotUrl, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(snapshotUrl), 60_000);
      setLastCommand("Снимок открыт в новой вкладке");
    } catch (error) {
      setLastCommand(error instanceof Error ? error.message : "Ошибка снимка");
    }
  }

  const queuedEvents = pipeline?.events.length ?? 0;
  const content = activeView === "camera"
    ? <CameraWorkspace playerRef={playerRef} videoRef={videoRef} soundEnabled={soundEnabled} lastCommand={lastCommand} connectionState={connectionState} connectionError={connectionError} queuedEvents={queuedEvents} onSetupOpen={() => setShowSetup(true)} onReconnect={() => setConnectionAttempt((attempt) => attempt + 1)} onSoundToggle={() => setSoundEnabled((enabled) => !enabled)} onFullscreen={openFullscreen} onSnapshot={handleSnapshot} onPtz={handlePtz} onOpenEvents={openEvents} />
    : activeView === "settings"
      ? <SettingsPanel gatewayConfig={gatewayConfig} pipeline={pipeline} onSetupOpen={() => setShowSetup(true)} onOpenEvents={openEvents} />
      : <EventPanel view={activeView === "archive" ? "archive" : "events"} pipeline={pipeline} loading={pipelineLoading} error={pipelineError} updatedAt={pipelineUpdatedAt} onRefresh={() => void refreshPipeline()} onSetupOpen={() => setShowSetup(true)} onQueueAction={(action, id) => void handleQueueAction(action, id)} />;

  return (
    <main className="camera-console min-h-screen bg-ploy-background-primary font-sans text-ploy-text-primary">
      <AppHeader connectionState={connectionState} onMenuToggle={() => setNavOpen((open) => !open)} onSetupOpen={() => setShowSetup(true)} onOpenEvents={openEvents} />
      <div className="camera-console__shell grid min-h-[calc(100vh-4rem)] md:grid-cols-[240px_minmax(0,1fr)]">
        <CameraSidebar open={navOpen} activeView={activeView} connectionState={connectionState} queuedEvents={queuedEvents} onClose={() => setNavOpen(false)} onNavigate={setActiveView} onSetupOpen={() => setShowSetup(true)} />
        {content}
      </div>
      <SetupDialog key={showSetup ? "setup-open" : "setup-closed"} open={showSetup} initialConfig={gatewayConfig} onClose={() => setShowSetup(false)} onSave={(config) => {
        setGatewayConfig(saveGatewayConfig(config));
        setLastCommand("Настройки gateway сохранены");
        setShowSetup(false);
      }} />
    </main>
  );
}
