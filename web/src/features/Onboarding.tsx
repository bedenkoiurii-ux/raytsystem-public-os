import { CheckCircle2, FolderPlus, PlugZap, RotateCcw, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { getJson, postJson } from "../api";
import { ErrorState, StatusPill } from "../components/StatePanel";

interface SystemState {
  connection?: { name: string; status: string; kind: string; pinned: string };
  safety?: { binding: string };
}

interface DocRoot {
  root_id: string;
  label: string;
  path: string;
  mode: string;
  kind: string;
  editable: boolean;
}

interface DocumentsIndex {
  index?: {
    file_count: number;
    error_count: number;
    last_refresh_at: string;
    roots: DocRoot[];
  };
}

interface SourceRoot {
  relative_path: string;
  source_type: string;
  policy: string;
}

interface BootstrapPlan {
  target_name: string;
  template_id: string;
  mode: string;
  classification: { primary_type: string; is_mixed: boolean };
  source_map: { roots: SourceRoot[] };
  files_to_create: string[];
  conflicts: string[];
  protected_collisions: string[];
  preflight: { blockers: string[]; warnings: string[]; already_initialized: boolean };
  post_init_steps: string[];
  fingerprint: string;
}

interface ApplyResult {
  status: string;
  created: string[];
  merged: string[];
  skipped: string[];
  source_roots: string[];
  index_rebuilt: boolean;
  next: string[];
}

export function Onboarding() {
  const [target, setTarget] = useState("");
  const [plan, setPlan] = useState<BootstrapPlan | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [system, setSystem] = useState<SystemState | null>(null);
  const [docs, setDocs] = useState<DocumentsIndex | null>(null);

  const canInstall = plan !== null && plan.preflight.blockers.length === 0;

  useEffect(() => {
    let alive = true;
    void Promise.allSettled([
      getJson<SystemState>("/api/v1/system"),
      getJson<DocumentsIndex>("/api/v1/documents")
    ]).then(([sys, dc]) => {
      if (!alive) return;
      if (sys.status === "fulfilled") setSystem(sys.value);
      if (dc.status === "fulfilled") setDocs(dc.value);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function preview() {
    setBusy(true);
    setError(null);
    setResult(null);
    setPlan(null);
    try {
      const data = await getJson<BootstrapPlan>(
        `/api/v1/onboarding/plan?target=${encodeURIComponent(target.trim())}`
      );
      setPlan(data);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  async function install() {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const data = await postJson<ApplyResult>("/api/v1/onboarding/apply", {
        target: target.trim(),
        confirm: plan.fingerprint
      });
      setResult(data);
      setPlan(null);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  async function uninstall() {
    setBusy(true);
    setError(null);
    try {
      await postJson("/api/v1/onboarding/uninstall", { target: target.trim() });
      setResult(null);
      setPlan(null);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="route onboarding-route">
      <section className="panel onboarding-hero">
        <div className="onboarding-seal">
          <PlugZap size={30} aria-hidden="true" />
        </div>
        <div>
          <span className="eyebrow">Підключення</span>
          <h2>Поточне підключення та встановлення в нову теку.</h2>
          <p>
            raytsystem обслуговує <strong>один простір за запуск</strong> (закріплений на старті). Нижче —
            стан активного підключення і, окремо, інсталятор для нової теки.
          </p>
        </div>
      </section>

      {system?.connection ? (
        <section className="panel onboarding-current">
          <header className="panel-header">
            <div>
              <span className="eyebrow">Активне підключення</span>
              <h3>
                <CheckCircle2 size={18} aria-hidden="true" style={{ verticalAlign: "-3px", marginRight: 6 }} />
                {system.connection.name}
              </h3>
            </div>
            <StatusPill status="verified" label="активне" />
          </header>
          <div className="onboarding-facts">
            <div>
              <span className="onboarding-metric">{docs?.index?.file_count ?? "—"}</span>
              <span>документів</span>
            </div>
            <div>
              <span className="onboarding-metric">{docs?.index?.roots.length ?? "—"}</span>
              <span>джерел-тек</span>
            </div>
            <div>
              <span className="onboarding-metric">{docs?.index?.error_count ?? "—"}</span>
              <span>з помилками</span>
            </div>
          </div>

          {docs?.index?.roots.length ? (
            <div className="onboarding-roots">
              <span className="eyebrow">Джерела простору</span>
              <ul>
                {docs.index.roots.map((root) => (
                  <li key={root.root_id}>
                    <code>{root.label}</code> · {root.kind} ·{" "}
                    {root.editable ? "читання-запис" : "тільки читання"}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="onboarding-hint">
            Адреса: <code>{window.location.host}</code> · зв'язування:{" "}
            <code>{system.safety?.binding ?? "loopback_only"}</code> · простір закріплено на старті
            (<code>--root</code>). Один запуск = один простір; щоб працювати з іншою текою — встанови її
            нижче й запусти окремим процесом на іншому порту.
          </p>
        </section>
      ) : null}

      <section className="panel onboarding-form">
        <span className="eyebrow">Встановити в нову теку</span>
        <label className="onboarding-label" htmlFor="onboarding-target">
          Шлях до репозиторію або теки
        </label>
        <div className="onboarding-input-row">
          <input
            id="onboarding-target"
            type="text"
            className="onboarding-input"
            placeholder="/path/to/your-repository"
            value={target}
            spellCheck={false}
            onChange={(event) => setTarget(event.target.value)}
          />
          <button
            type="button"
            className="onboarding-action"
            disabled={busy || target.trim().length === 0}
            onClick={() => void preview()}
          >
            <Sparkles size={16} aria-hidden="true" /> Попередній перегляд
          </button>
        </div>
        <p className="onboarding-hint">
          Вкажіть поточний проєкт або іншу локальну теку. Абсолютний шлях залишається у вас — у
          браузер повертається лише назва теки.
        </p>
      </section>

      {error ? <ErrorState error={error} onRetry={() => setError(null)} /> : null}

      {plan ? (
        <section className="panel onboarding-plan">
          <header className="panel-header">
            <div>
              <span className="eyebrow">План · {plan.target_name}</span>
              <h3>
                Тип: {plan.classification.primary_type} · шаблон: {plan.template_id}
              </h3>
            </div>
            <StatusPill status={canInstall ? "verified" : "blocked"} label={plan.mode} />
          </header>

          {plan.preflight.blockers.length > 0 ? (
            <div className="onboarding-notice onboarding-blockers">
              <strong>Блокери встановлення:</strong>
              <ul>
                {plan.preflight.blockers.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {plan.preflight.warnings.length > 0 ? (
            <div className="onboarding-notice onboarding-warnings">
              <strong>Попередження:</strong>
              <ul>
                {plan.preflight.warnings.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="onboarding-facts">
            <div>
              <span className="onboarding-metric">{plan.files_to_create.length}</span>
              <span>файлів буде створено</span>
            </div>
            <div>
              <span className="onboarding-metric">{plan.source_map.roots.length}</span>
              <span>джерел для індексації</span>
            </div>
            <div>
              <span className="onboarding-metric">{plan.post_init_steps.length}</span>
              <span>кроків після встановлення</span>
            </div>
          </div>

          {plan.source_map.roots.length > 0 ? (
            <div className="onboarding-roots">
              <span className="eyebrow">Джерела даних</span>
              <ul>
                {plan.source_map.roots.map((root) => (
                  <li key={root.relative_path}>
                    <code>{root.relative_path}</code> · {root.source_type} · {root.policy}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="onboarding-fingerprint">
            <span className="eyebrow">Відбиток плану</span>
            <code>{plan.fingerprint}</code>
          </div>

          <div className="onboarding-buttons">
            <button
              type="button"
              className="onboarding-action primary"
              disabled={busy || !canInstall}
              onClick={() => void install()}
            >
              <FolderPlus size={16} aria-hidden="true" /> Встановити за цим відбитком
            </button>
          </div>
        </section>
      ) : null}

      {result ? (
        <section className="panel onboarding-result">
          <header className="panel-header">
            <div>
              <span className="eyebrow">Готово</span>
              <h3>raytsystem встановлено</h3>
            </div>
            <StatusPill status="verified" label={result.index_rebuilt ? "індекс зібрано" : "готово"} />
          </header>
          <div className="onboarding-facts">
            <div>
              <span className="onboarding-metric">{result.created.length}</span>
              <span>створено</span>
            </div>
            <div>
              <span className="onboarding-metric">{result.merged.length}</span>
              <span>об'єднано</span>
            </div>
            <div>
              <span className="onboarding-metric">{result.skipped.length}</span>
              <span>залишено як є</span>
            </div>
          </div>
          <p className="onboarding-hint">
            Далі запустіть інтерфейс командою <code>uv run raytsystem start --root {"<шлях>"}</code>.
          </p>
          <div className="onboarding-buttons">
            <button
              type="button"
              className="onboarding-action"
              disabled={busy}
              onClick={() => void uninstall()}
            >
              <RotateCcw size={16} aria-hidden="true" /> Відкотити встановлення
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
