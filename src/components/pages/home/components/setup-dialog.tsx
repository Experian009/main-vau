import { useState } from "react";
import { LoaderCircle, ShieldCheck, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { testGateway, type GatewayConfig } from "@/lib/v380-gateway";

interface SetupDialogProps {
  open: boolean;
  initialConfig: GatewayConfig | null;
  onClose: () => void;
  onSave: (config: GatewayConfig) => void;
}

export function SetupDialog({ open, initialConfig, onClose, onSave }: SetupDialogProps) {
  const [baseUrl, setBaseUrl] = useState(initialConfig?.baseUrl ?? "http://localhost:8787");
  const [token, setToken] = useState(initialConfig?.token ?? "");
  const [testState, setTestState] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  if (!open) return null;

  const config = { baseUrl: baseUrl.trim().replace(/\/+$/, ""), token: token.trim() };

  async function handleTest() {
    setTestState("testing");
    setMessage("Проверяем decoder и relay-соединение…");
    try {
      await testGateway(config);
      setTestState("success");
      setMessage("Шлюз отвечает. Настройки можно сохранить и открыть live-поток.");
    } catch (error) {
      setTestState("error");
      setMessage(error instanceof Error ? error.message : "Не удалось проверить шлюз");
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    onSave(config);
  }

  return (
    <div className="camera-console__setup fixed inset-0 z-50 flex items-end justify-center bg-ploy-background-inverse/70 p-0 sm:items-center sm:p-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-xl rounded-t-card bg-ploy-background-primary p-5 shadow-xl sm:rounded-card sm:p-7"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="setup-title" className="font-heading text-xl font-semibold">Подключение локального gateway</h2>
            <p className="mt-2 text-sm leading-6 text-ploy-text-secondary">
              ID и пароль камеры хранятся только в <code>.env.windows</code> на этом компьютере. В браузер вводятся только URL gateway и отдельный токен.
            </p>
          </div>
          <button
            type="button"
            aria-label="Закрыть"
            className="flex size-9 shrink-0 items-center justify-center rounded-button border border-ploy-border-primary"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-6 space-y-4">
          <label className="block">
            <span className="text-sm font-medium">URL шлюза</span>
            <input
              type="url"
              required
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="http://localhost:8787"
              className="mt-2 w-full rounded-button border border-ploy-border-primary bg-ploy-background-primary px-3 py-2.5 text-sm outline-none focus:border-ploy-accent-primary"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Gateway token</span>
            <input
              type="password"
              required
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Длинный токен из .env"
              className="mt-2 w-full rounded-button border border-ploy-border-primary bg-ploy-background-primary px-3 py-2.5 text-sm outline-none focus:border-ploy-accent-primary"
            />
          </label>
        </div>

        {message ? (
          <div className={`mt-4 rounded-card p-3 text-sm ${testState === "error" ? "border border-ploy-border-primary" : "bg-ploy-background-secondary"}`}>
            {message}
          </div>
        ) : null}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose}>Закрыть</Button>
          <Button type="button" variant="outline" disabled={!config.baseUrl || !config.token || testState === "testing"} onClick={handleTest}>
            {testState === "testing" ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />}
            Проверить
          </Button>
          <Button type="submit" disabled={!config.baseUrl || !config.token}>Сохранить и подключить</Button>
        </div>
      </form>
    </div>
  );
}
