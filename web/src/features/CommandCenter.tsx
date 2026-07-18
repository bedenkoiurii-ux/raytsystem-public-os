import {
  ArrowUpRight,
  Bot,
  CheckCircle2,
  CircleAlert,
  Database,
  FileCheck2,
  ListTodo,
  LockKeyhole,
  Orbit,
  Plus,
  ShieldCheck
} from "lucide-react";
import { formatDate, shortId } from "../api";
import { useRuns, useSystem, useTasks } from "../hooks";
import type { Selection, TaskStatus } from "../types";
import { operationLabel, pluralRu, taskStatusLabel } from "../presentation";
import { ErrorState, LoadingState, StatusPill } from "../components/StatePanel";

const workStates: TaskStatus[] = ["inbox", "planned", "ready", "running", "review", "blocked", "done"];

interface CommandCenterProps {
  onCreateTask: () => void;
  onNavigate: (route: string) => void;
  onSelect: (selection: Selection) => void;
}

export function CommandCenter({ onCreateTask, onNavigate, onSelect }: CommandCenterProps) {
  const system = useSystem();
  const tasks = useTasks();
  const runs = useRuns();

  if (system.isLoading) return <LoadingState label="Читаємо перевірену панель керування…" />;
  if (system.isError || !system.data) return <ErrorState error={system.error} onRetry={() => void system.refetch()} />;
  const data = system.data;
  const attentionTotal =
    data.attention.blocked_tasks + data.attention.failed_runs + data.attention.restricted_skills;
  const totalKnowledge = data.counts.claims + data.counts.entities + data.counts.sources + data.counts.evidence;

  return (
    <div className="route route-command-center">
      <section className="trust-strip" aria-label="Межа поточного зрізу">
        <span className="local-indicator"><i /> Тільки локально</span>
        <span><Database size={14} /> знання <code>{shortId(data.fingerprint.knowledge_generation_id)}</code></span>
        <span><ListTodo size={14} /> задачі <code>{shortId(data.fingerprint.task_generation_id)}</code></span>
        <span><ShieldCheck size={14} /> каталог <code>{shortId(data.fingerprint.catalog_sha256)}</code></span>
      </section>

      <div className="command-grid">
        <section className="mission-hero panel panel-glow">
          <div className="hero-copy">
            <span className="eyebrow">Центр керування · перевірений зріз</span>
            <h2>Усі ваші системи —<br /><em>в одному полі зору.</em></h2>
            <p>
              Знання, робота, агенти та точні докази залишаються пов'язаними, а браузер не отримує
              прав виконувати команди.
            </p>
            <div className="hero-actions">
              <button className="primary-button" type="button" onClick={() => onNavigate("universe")}>
                <Orbit size={17} /> Відкрити Всесвіт
              </button>
              <button className="secondary-button" type="button" onClick={onCreateTask}>
                <Plus size={17} /> Створити задачу
              </button>
            </div>
          </div>
          <div className="mini-universe" aria-hidden="true">
            <span className="mini-ring ring-a" />
            <span className="mini-ring ring-b" />
            <span className="mini-ring ring-c" />
            <i className="mini-core"><span>OS</span></i>
            <i className="mini-node n1" /><i className="mini-node n2" /><i className="mini-node n3" />
            <i className="mini-node n4" /><i className="mini-node n5" /><i className="mini-node n6" />
            <div className="orbit-caption"><strong>{totalKnowledge}</strong><span>{pluralRu(totalKnowledge, "перевірений об'єкт", "перевірених об'єкти", "перевірених об'єктів")}</span></div>
          </div>
        </section>

        <section className={`attention-panel panel ${attentionTotal ? "has-attention" : "is-clear"}`}>
          <header className="panel-header">
            <div>
              <span className="eyebrow">Потребує уваги</span>
              <h3>{attentionTotal ? `${attentionTotal} ${pluralRu(attentionTotal, "сигнал", "сигнали", "сигналів")}` : "Все гаразд"}</h3>
            </div>
            {attentionTotal ? <CircleAlert size={22} /> : <CheckCircle2 size={22} />}
          </header>
          <div className="attention-list">
            <button type="button" onClick={() => onNavigate("tasks")}>
              <span className="attention-icon rose"><ListTodo size={17} /></span>
              <span><strong>Заблоковані задачі</strong><small>Тільки операційний стан</small></span>
              <b>{data.attention.blocked_tasks}</b>
            </button>
            <button type="button" onClick={() => onNavigate("runs")}>
              <span className="attention-icon gold"><FileCheck2 size={17} /></span>
              <span><strong>Невдалі запуски</strong><small>Зафіксовані записи</small></span>
              <b>{data.attention.failed_runs}</b>
            </button>
            <button type="button" onClick={() => onNavigate("skills")}>
              <span className="attention-icon violet"><LockKeyhole size={17} /></span>
              <span><strong>Обмежені навички</strong><small>Контроль чутливості</small></span>
              <b>{data.attention.restricted_skills}</b>
            </button>
          </div>
        </section>

        <section className="work-panel panel">
          <header className="panel-header">
            <div><span className="eyebrow">Стан роботи</span><h3>Операційний журнал</h3></div>
            <button className="text-button" type="button" onClick={() => onNavigate("tasks")}>Відкрити дошку <ArrowUpRight size={14} /></button>
          </header>
          <div className="work-bars">
            {workStates.map((status) => {
              const count = data.counts.tasks[status] ?? 0;
              const max = Math.max(1, ...Object.values(data.counts.tasks));
              return (
                <div className="work-bar" key={status}>
                  <span>{taskStatusLabel(status)}</span>
                  <i><b style={{ width: `${Math.max(count ? 8 : 0, (count / max) * 100)}%` }} /></i>
                  <strong>{count}</strong>
                </div>
              );
            })}
          </div>
          {tasks.data?.tasks.slice(0, 3).map((task) => (
            <button
              className="compact-object"
              type="button"
              key={task.task_id}
              onClick={() =>
                onSelect({
                  id: task.task_id,
                  kind: "task",
                  label: task.title,
                  status: task.status,
                  subtitle: task.priority,
                  snapshotId: tasks.data?.generation_id ?? undefined
                })
              }
            >
              <span className={`priority-mark priority-${task.priority}`} />
              <span><strong>{task.title}</strong><small>{shortId(task.task_id)}</small></span>
              <StatusPill status={task.status} />
            </button>
          ))}
        </section>

        <section className="runs-panel panel">
          <header className="panel-header">
            <div><span className="eyebrow">Останні запуски</span><h3>Зафіксована історія</h3></div>
            <button className="text-button" type="button" onClick={() => onNavigate("runs")}>Відкрити <ArrowUpRight size={14} /></button>
          </header>
          <div className="timeline-list">
            {runs.data?.runs.slice(0, 5).map((run) => (
              <button
                type="button"
                key={run.run_id}
                onClick={() => onSelect({
                  id: run.run_id,
                  kind: "run",
                  label: operationLabel(run.operation_type),
                  status: run.state,
                  subtitle: formatDate(run.updated_at),
                  metadata: { manifest_sha256: run.manifest_sha256, semantic_noop: String(run.semantic_noop) }
                })}
              >
                <i className={`timeline-dot run-${run.state}`} />
                <span><strong>{operationLabel(run.operation_type)}</strong><small>{formatDate(run.updated_at)}</small></span>
                <StatusPill status={run.state} />
              </button>
            ))}
            {!runs.data?.runs.length ? <p className="muted-copy">Зафіксованих запусків поки немає.</p> : null}
          </div>
        </section>

        <section className="knowledge-panel panel">
          <header className="panel-header">
            <div><span className="eyebrow">Шар знань</span><h3>{data.counts.claims} {pluralRu(data.counts.claims, "канонічне твердження", "канонічних твердження", "канонічних тверджень")}</h3></div>
            <Database size={21} />
          </header>
          <div className="metric-quartet">
            <div><strong>{data.counts.claims}</strong><span>твердження</span></div>
            <div><strong>{data.counts.entities}</strong><span>сутності</span></div>
            <div><strong>{data.counts.sources}</strong><span>джерела</span></div>
            <div><strong>{data.counts.evidence}</strong><span>фрагменти</span></div>
          </div>
          <div className="generation-line"><span>Активне покоління</span><code>{shortId(data.fingerprint.knowledge_generation_id, 12, 8)}</code></div>
        </section>

        <section className="agents-panel panel">
          <header className="panel-header">
            <div><span className="eyebrow">Реєстр агентів</span><h3>{data.counts.agents} {pluralRu(data.counts.agents, "оголошений профіль", "оголошених профілі", "оголошених профілів")}</h3></div>
            <Bot size={21} />
          </header>
          <p>Наявність профілю або призначеної задачі не означає, що агент виконується.</p>
          <div className="boundary-chip"><LockKeyhole size={14} /> виконання вимкнено</div>
        </section>
      </div>
    </div>
  );
}
