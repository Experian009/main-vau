import type { ReactNode } from "react";
import { Archive, BellRing, CircleAlert, CloudUpload, HardDrive, LoaderCircle, RefreshCw, Send, Settings2, Video } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { CameraEvent, EventPipelineStatus, ServiceHealth } from "@/lib/v380-gateway";

interface EventPanelProps {
  view?: "events" | "archive";
  pipeline: EventPipelineStatus | null;
  loading: boolean;
  error: string;
  updatedAt: Date | null;
  onRefresh: () => void;
  onSetupOpen: () => void;
  onQueueAction: (action: "scan" | "retry" | "remove", id?: string) => void;
}

export function EventPanel({ view = "events", pipeline, loading, error, updatedAt, onRefresh, onSetupOpen, onQueueAction }: EventPanelProps) {
  const pendingEvents = pipeline?.events ?? [];
  const history = pipeline?.history ?? [];
  const archiveView = view === "archive";

  return (
    <section className="camera-console__workspace min-w-0 p-3 sm:p-5 lg:p-7">
      <div className="mx-auto max-w-[1500px] space-y-5">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <div className="flex items-center gap-2 text-sm text-ploy-text-secondary">{archiveView ? <CloudUpload className="size-4" /> : <BellRing className="size-4" />}{archiveView ? "TeraBox архив" : "Охранные события"}</div>
            <h1 className="mt-2 font-heading text-2xl font-semibold tracking-tight sm:text-3xl">{archiveView ? "Архив TeraBox" : "События и доставка"}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-ploy-text-secondary">{archiveView ? "Здесь видны клипы, ожидающие загрузки, результат последней загрузки и ошибки авторизации TeraBox." : "После движения сохраняется 5 секунд до события и 20 секунд после него. Telegram получает 20-секундный клип, а полный клип передаётся в TeraBox."}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-ploy-text-secondary">{updatedAt ? `Обновлено ${formatDate(updatedAt.toISOString())}` : "Статус ещё не получен"}</span>
                <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => onQueueAction("scan")} disabled={loading}>Сканировать очередь</Button><Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
                  {loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
                  Обновить
                </Button></div>
          </div>
        </div>

        {!pipeline && !loading ? (
          <div className="rounded-card border border-ploy-border-primary bg-ploy-background-secondary p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-3"><CircleAlert className="mt-0.5 size-5 shrink-0" /><div><h2 className="font-medium">Подключите локальный gateway</h2><p className="mt-1 text-sm text-ploy-text-secondary">Статус motion, Telegram и TeraBox доступен только через защищённый gateway.</p></div></div>
              <Button size="sm" onClick={onSetupOpen}><Settings2 />Подключить</Button>
            </div>
          </div>
        ) : null}

        {error ? <div className="rounded-card border border-ploy-border-primary p-4 text-sm"><strong>Не удалось получить статус:</strong> {error}</div> : null}

        {pipeline ? (
          <>
            <div className="grid gap-3 lg:grid-cols-3">
              <ServiceCard title="Motion detector" icon={<Video className="size-4" />} health={pipeline.motion} detail={motionDetail(pipeline.motion)} />
              <ServiceCard title="Telegram" icon={<Send className="size-4" />} health={pipeline.notifier} detail={telegramDetail(pipeline.notifier)} />
              <ServiceCard title="TeraBox archive" icon={<CloudUpload className="size-4" />} health={pipeline.archive} detail={archiveDetail(pipeline.archive)} />
              <ServiceCard title="Continuous recording" icon={<HardDrive className="size-4" />} health={pipeline.continuous} detail={continuousDetail(pipeline.continuous, pipeline.continuousArchive)} />
            </div>

            <section className="rounded-card border border-ploy-border-primary">
              <div className="flex items-start justify-between gap-4 border-b border-ploy-border-primary p-4 sm:p-5">
                <div><h2 className="font-heading text-lg font-semibold">Очередь архива</h2><p className="mt-1 text-sm text-ploy-text-secondary">Локальные файлы удаляются только после подтверждённой загрузки полного клипа в TeraBox.</p></div>
                <span className="rounded-button bg-ploy-background-secondary px-2.5 py-1 text-xs font-medium">{pendingEvents.length} в очереди</span>
              </div>
              {pendingEvents.length ? <div className="divide-y divide-ploy-border-primary">{pendingEvents.map((event) => <EventRow key={event.id} event={event} active onAction={onQueueAction} />)}</div> : <EmptyState text="Очередь пуста: новые клипы появятся здесь сразу после обнаружения движения." />}
            </section>

            {!archiveView ? <section className="rounded-card border border-ploy-border-primary">
              <div className="border-b border-ploy-border-primary p-4 sm:p-5"><h2 className="font-heading text-lg font-semibold">История событий</h2><p className="mt-1 text-sm text-ploy-text-secondary">История хранит результат доставки даже после очистки локальных файлов.</p></div>
              {history.length ? <div className="divide-y divide-ploy-border-primary">{history.slice(0, 20).map((event) => <EventRow key={event.id} event={event} />)}</div> : <EmptyState text="Пока нет завершённых событий." />}
            </section> : null}
          </>
        ) : null}
      </div>
    </section>
  );
}

function ServiceCard({ title, icon, health, detail }: { title: string; icon: ReactNode; health: ServiceHealth; detail: string }) {
  const disabled = health.enabled === false || health.detectorConfig?.enabled === false;
  const healthy = health.ok && !disabled;
  return <section className="rounded-card border border-ploy-border-primary p-4"><div className="flex items-start justify-between gap-3"><div className="flex items-center gap-2 font-medium">{icon}{title}</div><span className={`rounded-button px-2 py-1 text-xs ${healthy ? "bg-ploy-background-secondary" : "border border-ploy-border-primary"}`}>{disabled ? "Выключен" : healthy ? "Работает" : "Требует внимания"}</span></div><p className="mt-4 text-sm leading-5 text-ploy-text-secondary">{detail}</p></section>;
}

function EventRow({ event, active = false, onAction }: { event: CameraEvent; active?: boolean; onAction?: (action: "scan" | "retry" | "remove", id?: string) => void }) {
  const telegramState = event.telegram?.state ?? (active ? "ожидает" : "нет данных");
  const archiveState = event.archive?.state ?? (active ? "ожидает" : "нет данных");
  return <article className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-center sm:p-5">
    <div className="min-w-0"><div className="flex items-center gap-2"><Archive className="size-4 shrink-0" /><h3 className="truncate text-sm font-medium">Движение · {formatDate(event.createdAt)}</h3></div><p className="mt-1 truncate font-mono text-xs text-ploy-text-secondary">{event.id}</p><p className="mt-2 text-xs text-ploy-text-secondary">{event.preSeconds ?? 5} с до + {event.postSeconds ?? 20} с после · {event.frameCount ? `${event.frameCount} кадров` : "подготовка файла"}</p></div>
    <DeliveryBadge label="Telegram" state={telegramState} message={event.telegram?.message} />
    <DeliveryBadge label="TeraBox" state={archiveState} message={event.archive?.message} />
    {active && onAction ? <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => onAction("retry", event.id)}>Повторить</Button><Button variant="outline" size="sm" onClick={() => onAction("remove", event.id)}>Удалить</Button></div> : null}
  </article>;
}

function DeliveryBadge({ label, state, message }: { label: string; state: string; message?: string }) {
  const completed = state === "sent" || state === "uploaded";
  const warning = state === "failed" || state === "retrying";
  return <div className={`max-w-[220px] rounded-button px-3 py-2 text-xs ${completed ? "bg-ploy-background-secondary" : warning ? "border border-ploy-border-primary" : "bg-ploy-neutral-primary-s2"}`} title={message}><span className="block text-ploy-text-secondary">{label}</span><span className="mt-0.5 block font-medium">{deliveryLabel(state)}</span>{message ? <span className="mt-1 block break-words text-[11px] leading-4 text-ploy-text-secondary">{message}</span> : null}</div>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="p-8 text-center text-sm text-ploy-text-secondary">{text}</div>;
}

function motionDetail(health: ServiceHealth) {
  if (health.sourceError) return health.sourceError;
  if (health.sourceState === "running") return "RTSP читается, кадровый буфер и детектор движения активны.";
  return health.sourceState ? `Состояние источника: ${health.sourceState}.` : health.error || "Статус недоступен.";
}

function telegramDetail(health: ServiceHealth) {
  if (!health.telegramConfigured) return "Не настроен: добавьте TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID в .env.windows.";
  if (!health.internalEndpointConfigured) return "Внутренний токен не настроен: проверьте INTERNAL_NOTIFY_TOKEN.";
  if (health.lastError) return `Последняя ошибка Telegram: ${health.lastError}`;
  if (health.lastSuccessAt) return `Последняя успешная отправка: ${formatDate(health.lastSuccessAt)}.`;
  return "Бот настроен для отправки 20-секундного клипа после события.";
}

function continuousDetail(recorder: ServiceHealth, archive: ServiceHealth) {
  if (!recorder.ok) return recorder.lastError || recorder.error || "Постоянная запись не получает RTSP.";
  if (!archive.enabled) return "Запись работает, но TeraBox архив отключён: добавьте TERABOX_NDUS.";
  if (!archive.ok) return archive.lastError || "Сегменты записываются локально и ожидают загрузки в /V380/archive.";
  return `Запись активна: сегменты по 30 минут загружаются в ${archive.remoteDirectory || "/V380/archive"}.`;
}

function archiveDetail(health: ServiceHealth) {
  if (!health.enabled) return "Не настроен: добавьте TERABOX_NDUS в .env.windows.";
  if (!health.uploaderInstalled) return "Не установлен uploader: перезапустите windows/start.cmd или выполните setup-events.ps1.";
  if (health.lastError) return health.lastError;
  if (health.lastSuccessAt) return `Последняя успешная загрузка: ${formatDate(health.lastSuccessAt)}.`;
  return "Ожидает первый готовый event-клип.";
}

function deliveryLabel(state: string) {
  return ({ sending: "отправка", sent: "отправлено", disabled: "отключено", failed: "ошибка", pending: "ожидает", retrying: "повтор", uploaded: "загружено", "нет данных": "нет данных", ожидает: "ожидает" } as Record<string, string>)[state] ?? state;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "medium" }).format(date);
}
