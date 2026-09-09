import { Eye, LockKeyhole, Plus, Settings2, Wifi, WifiOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { GatewayConnectionState } from "@/lib/v380-gateway";

interface AppHeaderProps {
  connectionState: GatewayConnectionState;
  onMenuToggle: () => void;
  onSetupOpen: () => void;
  onOpenEvents: () => void;
}

export function AppHeader({ connectionState, onMenuToggle, onSetupOpen, onOpenEvents }: AppHeaderProps) {
  const connected = connectionState === "connected";
  return (
    <header className="camera-console__header flex h-16 items-center justify-between border-b border-ploy-border-primary px-4 md:px-6">
      <div className="flex items-center gap-3"><button type="button" aria-label="Открыть навигацию" className="flex size-10 items-center justify-center rounded-button border border-ploy-border-primary md:hidden" onClick={onMenuToggle}><Settings2 className="size-4" /></button><div className="flex size-9 items-center justify-center rounded-card bg-ploy-background-inverse text-ploy-text-inverse"><Eye className="size-5" /></div><div><p className="font-heading text-sm font-semibold tracking-tight">V380 Event</p><p className="text-xs text-ploy-text-secondary">Локальная консоль камеры</p></div></div>
      <div className="flex items-center gap-2"><div className="hidden items-center gap-2 text-xs text-ploy-text-secondary sm:flex">{connected ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}<LockKeyhole className="size-3.5" />{connected ? "Gateway подключён" : "Данные камеры локальны"}</div><Button className="hidden sm:inline-flex" variant="outline" size="sm" onClick={onOpenEvents}>События</Button><Button variant="outline" size="sm" onClick={onSetupOpen}><Plus />Подключить</Button></div>
    </header>
  );
}
