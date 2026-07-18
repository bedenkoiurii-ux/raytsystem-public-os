import { FolderPlus, PlugZap, RotateCcw, Sparkles } from "lucide-react";
import { useState } from "react";
import { getJson, postJson } from "../api";
import { ErrorState, StatusPill } from "../components/StatePanel";

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

  const canInstall = plan !== null && plan.preflight.blockers.length === 0;

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
          <span className="eyebrow">Підключити простір</span>
          <h2>Встановіть raytsystem у репозиторій за один попередній перегляд.</h2>
          <p>
            Попередній перегляд нічого не записує. Встановлення лише створює нові файли й оборотне — файли
            користувача не перезаписуються, вихідні дані індексуються на місці.
          </p>
        </div>
      </section>

      <section className="panel onboarding-form">
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
