import {
  ArrowUpRight,
  Bot,
  CheckCircle2,
  CircleAlert,
  Database,
  FileCheck2,
  FileText,
  FolderOpen,
  ListTodo,
  LockKeyhole,
  Orbit,
  Plus,
  ShieldCheck
} from "lucide-react";
import { formatDate, shortId } from "../api";
import { useLibrary, useRuns, useSystem, useTasks } from "../hooks";
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
  const library = useLibrary();

  if (system.isLoading) return <LoadingState label="Читаємо перевірену панель керування…" />;
  if (system.isError || !system.data) return <ErrorState error={system.error} onRetry={() => void system.refetch()} />;
  const data = system.data;
  const attentionTotal =
    data.attention.blocked_tasks + data.attention.failed_runs + data.attention.restricted_skills;
  // Живий зріз документної бібліотеки (реальний контент, не порожній граф знань)
  const lib = library.data;
  const libTotal = lib?.index.file_count ?? 0;
  const libFresh = lib?.index.state === "current";
  const libRefresh = lib?.index.last_refresh_at ?? null;
  // Осмислені теки з точними лічильниками (folders — діти коренів, кожна з descendant_count)
  const folderCount = new Map((lib?.folders ?? []).map((folder) => [folder.path, folder.descendant_count]));
  const fc = (path: string) => folderCount.get(path) ?? 0;
  const sections = [
    { label: "Архів (розмови)", count: fc("65-GPT-Archive/extracts") + fc("60-Claude-Archive/extracts") + fc("60-Claude-Archive/projects") },
    { label: "Фільми", count: fc("10-Projects/3-Films") },
    { label: "Люди", count: fc("30-Research/People") },
    { label: "Події", count: fc("30-Research/Events") },
    { label: "Книги (розділи)", count: fc("10-Projects/4-Books") },
    { label: "Поняття", count: fc("30-Research/Concepts") },
    { label: "Місця", count: fc("30-Research/Places") },
    { label: "Ідеї", count: fc("10-Projects/1-Ideas") },
  ].filter((section) => section.count > 0).sort((first, second) => second.count - first.count);
  const sectionMax = Math.max(1, ...sections.map((section) => section.count));
  const recent = lib?.items ?? [];

  return (
    <div className="route route-command-center">
      <section className="trust-strip" aria-label="Межа поточного зрізу">
        <span className="local-indicator"><i /> Тільки локально</span>
        <span><Database size={14} /> знання <code>{shortId(data.fingerprint.knowledge_generation_id)}</code></span>
        <span><ListTodo size={14} /> задачі <code>{shortId(data.fingerprint.task_generation_id)}</code></span>
        <span><ShieldCheck size={14} /> каталог <code>{shortId(data.fingerprint.catalog_sha256)}</code></span>
      </section>

      <div className="command-grid">
        <section className="library-status panel panel-glow">
          <div className="ls-headline">
            <span className="eyebrow">Стан бібліотеки · тут і зараз</span>
            <div className="ls-total">
              <FileText size={24} aria-hidden="true" />
              <strong>{libTotal.toLocaleString("uk-UA")}</strong>
              <span>{pluralRu(libTotal, "документ", "документи", "документів")} у бібліотеці</span>
            </div>
            <div className={`ls-freshness ${libFresh ? "ok" : "stale"}`}>
              <i /> {libFresh ? "індекс актуальний" : "індекс застарілий"}
              {libRefresh ? <> · оновлено {formatDate(libRefresh)}</> : null}
            </div>
            <div className="hero-actions">
              <button className="primary-button" type="button" onClick={() => onNavigate("documents")}>
                <FolderOpen size={17} /> Документи
              </button>
              <button className="secondary-button" type="button" onClick={onCreateTask}>
                <Plus size={17} /> Створити задачу
              </button>
              <button className="text-button" type="button" onClick={() => onNavigate("universe")}>
                <Orbit size={15} /> Всесвіт
              </button>
            </div>
          </div>
          <div className="ls-sections">
            <span className="eyebrow">Розділи</span>
            {sections.length ? sections.map((section) => (
              <button className="ls-bar" type="button" key={section.label} onClick={() => onNavigate("documents")}>
                <span>{section.label}</span>
                <i><b style={{ width: `${Math.max(8, (section.count / sectionMax) * 100)}%` }} /></i>
                <strong>{section.count}</strong>
              </button>
            )) : <p className="muted-copy">Читаємо індекс…</p>}
          </div>
          <div className="ls-recent">
            <span className="eyebrow">Нещодавно змінені</span>
            {recent.length ? recent.slice(0, 6).map((doc) => (
              <button className="ls-recent-row" type="button" key={doc.document_id} onClick={() => onNavigate("documents")} title={doc.path}>
                <span className="ls-recent-title">{doc.title || doc.filename}</span>
                <time>{formatDate(doc.modified_at)}</time>
              </button>
            )) : <p className="muted-copy">—</p>}
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
