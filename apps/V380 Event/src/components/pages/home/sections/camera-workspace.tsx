import type { ComponentType, ReactNode, RefObject } from "react";
import {
  BellRing,
  Camera,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  House,
  LoaderCircle,
  Maximize2,
  Mic,
  Move,
  Radio,
  RotateCcw,
  ShieldCheck,
  Speaker,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import type { GatewayConnectionState } from "@/lib/v380-gateway";

interface CameraWorkspaceProps {
  playerRef: RefObject<HTMLDivElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  soundEnabled: boolean;
  lastCommand: string;
  connectionState: GatewayConnectionState;
  connectionError: string;
  queuedEvents: number;
  onSetupOpen: () => void;
  onReconnect: () => void;
  onSoundToggle: () => void;
  onFullscreen: () => void;
  onSnapshot: () => void;
  onPtz: (direction: "up" | "down" | "left" | "right") => void;
  onOpenEvents: () => void;
}

export function CameraWorkspace({
  playerRef,
  videoRef,
  soundEnabled,
  lastCommand,
  connectionState,
  connectionError,
  queuedEvents,
  onSetupOpen,
  onReconnect,
  onSoundToggle,
  onFullscreen,
  onSnapshot,
  onPtz,
  onOpenEvents,
}: CameraWorkspaceProps) {
  const connected = connectionState === "connected";
  const statusLabel = {
    "not-configured": "Не настроено",
    connecting: "Подключение…",
    connected: "Подключено",
    error: "Ошибка",
  }[connectionState];

  return (
    <section className="camera-console__workspace min-w-0 p-3 sm:p-5 lg:p-7">
      <div className="mx-auto max-w-[1500px]">
        <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <div className="flex items-center gap-2 text-sm text-ploy-text-secondary"><House className="size-4" />Локальная камера<ChevronRight className="size-3.5" />Live</div>
            <h1 className="mt-2 font-heading text-2xl font-semibold tracking-tight sm:text-3xl">Камера V380</h1>
          </div>
          <div className="flex items-center gap-2"><span className="text-xs text-ploy-text-secondary">{statusLabel}</span><Button variant="outline" size="sm" onClick={connectionState === "not-configured" ? onSetupOpen : onReconnect}><RotateCcw />Переподключить</Button></div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-5">
            <div ref={playerRef} className="camera-console__player relative aspect-video overflow-hidden rounded-card bg-ploy-background-inverse text-ploy-text-inverse">
              <video ref={videoRef} autoPlay playsInline muted={!soundEnabled} className={`absolute inset-0 size-full object-contain ${connected ? "block" : "hidden"}`} />
              {!connected ? <DisconnectedOverlay state={connectionState} error={connectionError} onSetupOpen={onSetupOpen} /> : null}
              <div className="absolute inset-x-0 top-0 flex items-start justify-between p-3 sm:p-4"><div className="bg-ploy-background-inverse/85 px-2.5 py-1.5 text-xs font-medium text-ploy-text-inverse">{connected ? "LIVE · WEBRTC" : "ОЖИДАНИЕ ПОТОКА"}</div><div className="bg-ploy-background-inverse/85 px-2.5 py-1.5 font-mono text-xs text-ploy-text-inverse">RTSP → WHEP</div></div>
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-ploy-background-inverse/85 p-2 sm:p-3">
                <button type="button" aria-label={soundEnabled ? "Выключить звук" : "Включить звук"} className="flex size-9 items-center justify-center hover:bg-ploy-neutral-inverse-s3" onClick={onSoundToggle}>{soundEnabled ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}</button>
                <div className="flex items-center gap-1"><button type="button" aria-label="Сделать снимок" className="flex size-9 items-center justify-center hover:bg-ploy-neutral-inverse-s3" onClick={onSnapshot}><Camera className="size-4" /></button><button type="button" aria-label="Полноэкранный режим" className="flex size-9 items-center justify-center hover:bg-ploy-neutral-inverse-s3" onClick={onFullscreen}><Maximize2 className="size-4" /></button></div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3"><StatusMetric icon={connected ? Wifi : Radio} label="Соединение" value={statusLabel} /><StatusMetric icon={Radio} label="Канал" value="RTSP → WebRTC" /><StatusMetric icon={ShieldCheck} label="Передача" value={connected ? "Защищённый gateway" : "Ожидает настройки"} /></div>
          </div>

          <aside className="camera-console__controls space-y-5">
            <section className="rounded-card border border-ploy-border-primary p-4"><div className="flex items-center justify-between"><div><h2 className="font-heading text-base font-semibold">Управление PTZ</h2><p className="mt-1 text-xs text-ploy-text-secondary">Поворот и наклон камеры</p></div><Move className="size-4 text-ploy-text-secondary" /></div><div className="mx-auto mt-6 grid w-44 grid-cols-3 gap-2"><div /><PtzButton label="Вверх" disabled={!connected} onClick={() => onPtz("up")}><ChevronUp /></PtzButton><div /><PtzButton label="Влево" disabled={!connected} onClick={() => onPtz("left")}><ChevronLeft /></PtzButton><div className="flex aspect-square items-center justify-center rounded-full bg-ploy-background-inverse text-xs text-ploy-text-inverse">PTZ</div><PtzButton label="Вправо" disabled={!connected} onClick={() => onPtz("right")}><ChevronRight /></PtzButton><div /><PtzButton label="Вниз" disabled={!connected} onClick={() => onPtz("down")}><ChevronDown /></PtzButton><div /></div><div className="mt-5 border-t border-ploy-border-primary pt-4"><p className="text-xs text-ploy-text-secondary">{lastCommand}</p></div></section>

            <section className="rounded-card border border-ploy-border-primary p-4"><h2 className="font-heading text-base font-semibold">Аудио</h2><div className="mt-4 grid grid-cols-2 gap-2"><button type="button" className={`flex items-center justify-center gap-2 rounded-button border px-3 py-3 text-sm ${soundEnabled ? "border-ploy-button-primary-border bg-ploy-button-primary-background text-ploy-button-primary-text" : "border-ploy-border-primary"}`} onClick={onSoundToggle}><Speaker className="size-4" />{soundEnabled ? "Звук включён" : "Без звука"}</button><button type="button" disabled className="flex cursor-not-allowed items-center justify-center gap-2 rounded-button border border-ploy-border-primary px-3 py-3 text-sm opacity-50" title="Talkback не поддерживается текущим decoder"><Mic className="size-4" />Говорить</button></div></section>

            <section className="rounded-card bg-ploy-background-secondary p-4"><div className="flex items-start gap-3"><BellRing className="mt-0.5 size-4 shrink-0" /><div><h2 className="text-sm font-medium">Event pipeline</h2><p className="mt-1 text-xs leading-5 text-ploy-text-secondary">{queuedEvents ? `В локальной очереди: ${queuedEvents}.` : "Движение запустит запись и доставку в Telegram/TeraBox."}</p><Button className="mt-3" variant="outline" size="sm" onClick={onOpenEvents}>Открыть события</Button></div></div></section>
          </aside>
        </div>
      </div>
    </section>
  );
}

function DisconnectedOverlay({ state, error, onSetupOpen }: { state: GatewayConnectionState; error: string; onSetupOpen: () => void }) {
  return <div className="absolute inset-0 flex items-center justify-center p-4"><div className="max-w-sm bg-ploy-background-inverse/90 p-4 text-center shadow-lg sm:p-5">{state === "connecting" ? <LoaderCircle className="mx-auto size-6 animate-spin" /> : state === "error" ? <CircleAlert className="mx-auto size-6" /> : <WifiOff className="mx-auto size-6" />}<p className="mt-3 text-sm font-medium">{state === "connecting" ? "Открываем локальный поток…" : state === "error" ? "Поток не открылся" : "Локальный gateway пока не настроен"}</p><p className="mt-1 break-words text-xs leading-5 text-ploy-text-inverse-secondary">{state === "error" ? error : "Нажмите «Подключить» и укажите http://localhost:8787 и GATEWAY_TOKEN из .env.windows."}</p><button type="button" className="mt-3 text-xs font-medium underline underline-offset-4" onClick={onSetupOpen}>Настроить подключение</button></div></div>;
}

function PtzButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" aria-label={label} disabled={disabled} className="flex aspect-square items-center justify-center rounded-full border border-ploy-border-primary hover:bg-ploy-neutral-primary-s2 disabled:cursor-not-allowed disabled:opacity-35 [&_svg]:size-5" onClick={onClick}>{children}</button>;
}

function StatusMetric({ icon: Icon, label, value }: { icon: ComponentType<{ className?: string }>; label: string; value: string }) {
  return <div className="rounded-card border border-ploy-border-primary p-4"><div className="flex items-center justify-between gap-3"><p className="text-xs text-ploy-text-secondary">{label}</p><Icon className="size-4 text-ploy-text-secondary" /></div><p className="mt-3 text-sm font-medium">{value}</p></div>;
}
