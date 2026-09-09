import { Bell, Camera, CircleHelp, History, Settings, Wifi, WifiOff } from "lucide-react";

import type { GatewayConnectionState } from "@/lib/v380-gateway";
import { Button } from "@/components/ui/button";

export type ConsoleView = "camera" | "events" | "archive" | "settings";

const NAV_ITEMS: Array<{ id: ConsoleView; label: string; icon: typeof Camera }> = [
  { id: "camera", label: "Камера", icon: Camera },
  { id: "events", label: "События", icon: Bell },
  { id: "archive", label: "Архив", icon: History },
  { id: "settings", label: "Настройки", icon: Settings },
];

interface CameraSidebarProps {
  open: boolean;
  activeView: ConsoleView;
  connectionState: GatewayConnectionState;
  queuedEvents: number;
  onClose: () => void;
  onNavigate: (view: ConsoleView) => void;
  onSetupOpen: () => void;
}

export function CameraSidebar({ open, activeView, connectionState, queuedEvents, onClose, onNavigate, onSetupOpen }: CameraSidebarProps) {
  const connected = connectionState === "connected";
  return (
    <aside className={`${open ? "flex" : "hidden"} camera-console__sidebar absolute inset-x-0 top-16 z-30 min-h-[calc(100vh-4rem)] flex-col border-r border-ploy-border-primary bg-ploy-background-primary p-3 md:static md:flex`}>
      <nav className="space-y-1" aria-label="Основная навигация">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeView === item.id;
          return <button key={item.id} type="button" className={`flex w-full items-center gap-3 rounded-button px-3 py-2.5 text-left text-sm transition-colors ${active ? "bg-ploy-background-inverse text-ploy-text-inverse" : "text-ploy-text-secondary hover:bg-ploy-neutral-primary-s2 hover:text-ploy-text-primary"}`} onClick={() => { onNavigate(item.id); onClose(); }}><Icon className="size-4" />{item.label}{item.id === "events" && queuedEvents > 0 ? <span className="ml-auto rounded-full bg-ploy-background-primary px-2 py-0.5 text-[11px] text-ploy-text-primary">{queuedEvents}</span> : null}</button>;
        })}
      </nav>

      <div className="mt-7 border-t border-ploy-border-primary pt-5">
        <div className="mb-3 flex items-center justify-between px-2"><p className="text-xs font-medium uppercase tracking-[0.12em] text-ploy-text-secondary">Устройство</p>{connected ? <Wifi className="size-4" /> : <WifiOff className="size-4 text-ploy-text-secondary" />}</div>
        <button type="button" className="w-full rounded-card border border-ploy-border-primary bg-ploy-background-secondary p-3 text-left" onClick={() => { onNavigate("camera"); onClose(); }}><div className="flex size-10 items-center justify-center rounded-button bg-ploy-background-primary"><Camera className="size-4" /></div><p className="mt-3 text-sm font-medium">Камера V380</p><p className="mt-1 font-mono text-xs text-ploy-text-secondary">1 локальная камера</p><p className="mt-3 text-xs text-ploy-text-secondary">{connected ? "Gateway подключён" : "Gateway не настроен"}</p></button>
      </div>

      <div className="mt-auto rounded-card border border-ploy-border-primary p-3"><div className="flex gap-3"><CircleHelp className="mt-0.5 size-4 shrink-0" /><div><p className="text-sm font-medium">Локальный режим</p><p className="mt-1 text-xs leading-5 text-ploy-text-secondary">Пароль камеры остаётся в .env.windows. В браузере хранится только токен gateway.</p></div></div><Button className="mt-3 w-full" variant="outline" size="sm" onClick={onSetupOpen}><Settings className="size-4" />Настроить gateway</Button></div>
    </aside>
  );
}
