import { useEffect, useState } from "react";
import { FolderCog, Gauge, Save, ShieldCheck, TerminalSquare } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { EventPipelineStatus, GatewayConfig, MotionConfig, RuntimeService } from "@/lib/v380-gateway";
import { fetchMotionConfig, fetchRuntimeService, saveMotionConfig, setRuntimeService } from "@/lib/v380-gateway";

interface SettingsPanelProps {
  gatewayConfig: GatewayConfig | null;
  pipeline: EventPipelineStatus | null;
  onSetupOpen: () => void;
  onOpenEvents: () => void;
}

type ServiceSwitch = { key: RuntimeService; label: string; description: string };
const serviceSwitches: ServiceSwitch[] = [
  { key: "notifier", label: "Telegram", description: "Отправка клипов движения в Telegram." },
  { key: "archive", label: "TeraBox events", description: "Загрузка event-клипов в /V380/events." },
  { key: "continuous", label: "Continuous recording", description: "Постоянная запись 30-минутных сегментов." },
  { key: "continuous-archive", label: "TeraBox continuous", description: "Загрузка сегментов в /V380/archive." },
];

export function SettingsPanel({ gatewayConfig, onOpenEvents }: SettingsPanelProps) {
  const [config, setConfig] = useState<MotionConfig | null>(null);
  const [switches, setSwitches] = useState<Record<RuntimeService, boolean>>({ notifier: true, archive: true, continuous: true, "continuous-archive": true });
  const [saving, setSaving] = useState(false);
  const [switchSaving, setSwitchSaving] = useState<RuntimeService | "motion" | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!gatewayConfig) return;
    Promise.all([
      fetchMotionConfig(gatewayConfig),
      ...serviceSwitches.map(async ({ key }) => [key, await fetchRuntimeService(gatewayConfig, key)] as const),
    ]).then(([motion, ...services]) => {
      setConfig(motion as MotionConfig);
      setSwitches((current) => ({ ...current, ...Object.fromEntries(services) }));
    }).catch((error) => setMessage(error instanceof Error ? error.message : "Не удалось загрузить настройки сервисов"));
  }, [gatewayConfig]);

  const save = async () => {
    if (!gatewayConfig || !config) return;
    setSaving(true);
    setMessage("");
    try {
      setConfig(await saveMotionConfig(gatewayConfig, config));
      setMessage("Настройки детектора применены сразу.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось сохранить настройки");
    } finally {
      setSaving(false);
    }
  };

  const toggleMotion = async () => {
    if (!gatewayConfig || !config) return;
    setSwitchSaving("motion");
    try {
      const next = await saveMotionConfig(gatewayConfig, { enabled: !config.enabled });
      setConfig(next);
      setMessage(`MotionDetector ${next.enabled ? "включён" : "выключен"}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось изменить MotionDetector");
    } finally {
      setSwitchSaving(null);
    }
  };

  const toggleService = async (service: RuntimeService) => {
    if (!gatewayConfig) return;
    const nextValue = !switches[service];
    setSwitchSaving(service);
    setSwitches((current) => ({ ...current, [service]: nextValue }));
    try {
      const actual = await setRuntimeService(gatewayConfig, service, nextValue);
      setSwitches((current) => ({ ...current, [service]: actual }));
      setMessage(`${serviceSwitches.find((item) => item.key === service)?.label} ${actual ? "включён" : "выключен"}.`);
    } catch (error) {
      setSwitches((current) => ({ ...current, [service]: !nextValue }));
      setMessage(error instanceof Error ? error.message : "Не удалось изменить состояние сервиса");
    } finally {
      setSwitchSaving(null);
    }
  };

  return <section className="camera-console__workspace min-w-0 p-3 sm:p-5 lg:p-7"><div className="mx-auto max-w-[1000px] space-y-5">
    <div><p className="text-sm text-ploy-text-secondary">Локальная конфигурация</p><h1 className="mt-2 font-heading text-2xl font-semibold tracking-tight sm:text-3xl">Настройки</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-ploy-text-secondary">Секреты остаются в <code>.env.windows</code>. Переключатели применяются без перезапуска процессов.</p></div>
    <section className="rounded-card border border-ploy-border-primary p-5"><div className="flex gap-3"><Gauge className="mt-0.5 size-5 shrink-0" /><div className="w-full"><div className="flex items-start justify-between gap-4"><div><h2 className="font-medium">MotionDetector</h2><p className="mt-1 text-sm leading-6 text-ploy-text-secondary">Детектор движения и создание event-клипов.</p></div><Toggle enabled={Boolean(config?.enabled)} busy={switchSaving === "motion"} onClick={() => void toggleMotion()} /></div>{config ? <div className="mt-5 grid gap-4 sm:grid-cols-3"><label className="text-sm">Порог изменения<span className="mt-1 block text-xs text-ploy-text-secondary">0.001–1.0; меньше = чувствительнее</span><input className="mt-2 w-full rounded-button border border-ploy-border-primary bg-transparent px-3 py-2" type="number" min="0.001" max="1" step="0.001" value={config.minChangedRatio} onChange={(event) => setConfig({ ...config, minChangedRatio: Number(event.target.value) })} /></label><label className="text-sm">Подряд кадров<span className="mt-1 block text-xs text-ploy-text-secondary">1–30 кадров выше порога</span><input className="mt-2 w-full rounded-button border border-ploy-border-primary bg-transparent px-3 py-2" type="number" min="1" max="30" step="1" value={config.consecutiveFrames} onChange={(event) => setConfig({ ...config, consecutiveFrames: Number(event.target.value) })} /></label><label className="text-sm">Пауза между событиями<span className="mt-1 block text-xs text-ploy-text-secondary">секунды; защита от повторов</span><input className="mt-2 w-full rounded-button border border-ploy-border-primary bg-transparent px-3 py-2" type="number" min="0" max="3600" step="1" value={config.cooldownSeconds} onChange={(event) => setConfig({ ...config, cooldownSeconds: Number(event.target.value) })} /></label></div> : <p className="mt-4 text-sm text-ploy-text-secondary">Загрузка параметров…</p>}<div className="mt-4 flex items-center gap-3"><Button onClick={() => void save()} disabled={!config || saving}><Save />{saving ? "Сохранение…" : "Применить параметры"}</Button></div></div></div></section>
    <section className="rounded-card border border-ploy-border-primary p-5"><div className="flex gap-3"><ShieldCheck className="mt-0.5 size-5 shrink-0" /><div className="w-full"><h2 className="font-medium">Сервисы доставки и записи</h2><div className="mt-4 divide-y divide-ploy-border-primary">{serviceSwitches.map((service) => <div key={service.key} className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0"><div><p className="font-medium">{service.label}</p><p className="mt-1 text-sm text-ploy-text-secondary">{service.description}</p></div><Toggle enabled={switches[service.key]} busy={switchSaving === service.key} onClick={() => void toggleService(service.key)} /></div>)}</div></div></div></section>
    {message ? <div className="rounded-card border border-ploy-border-primary p-4 text-sm">{message}</div> : null}
    <section className="rounded-card border border-ploy-border-primary p-5"><div className="flex gap-3"><FolderCog className="mt-0.5 size-5 shrink-0" /><div><h2 className="font-medium">Event pipeline</h2><p className="mt-1 text-sm leading-6 text-ploy-text-secondary">Статусы и очередь доступны на экране событий.</p><Button className="mt-4" variant="outline" onClick={onOpenEvents}>Открыть события</Button></div></div></section>
    <section className="rounded-card border border-ploy-border-primary p-5"><div className="flex gap-3"><TerminalSquare className="mt-0.5 size-5 shrink-0" /><div><h2 className="font-medium">Управление на Windows</h2><p className="mt-1 text-sm leading-6 text-ploy-text-secondary">Запуск и остановка: <code>windows\start.cmd</code> и <code>windows\stop.cmd</code>. Диагностика: <code>windows\check-events.cmd</code>.</p></div></div></section>
  </div></section>;
}

function Toggle({ enabled, busy, onClick }: { enabled: boolean; busy: boolean; onClick: () => void }) {
  return <button type="button" role="switch" aria-checked={enabled} aria-label={enabled ? "Выключить" : "Включить"} onClick={onClick} disabled={busy} className={`relative inline-flex h-7 w-14 shrink-0 items-center rounded-full border transition ${enabled ? "bg-ploy-accent-primary" : "bg-ploy-background-secondary"} ${busy ? "opacity-50" : ""}`}><span className={`absolute size-5 rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-8" : "translate-x-1"}`} /><span className="sr-only">{enabled ? "ВКЛ" : "ВЫКЛ"}</span></button>;
}
