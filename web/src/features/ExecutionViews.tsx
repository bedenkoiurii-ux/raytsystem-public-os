import {
  Activity,
  Bot,
  Clock3,
  FileClock,
  Filter,
  Gauge,
  Search,
  ShieldCheck
} from "lucide-react";
import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { formatDate, shortId } from "../api";
import { ErrorState, EmptyState, LoadingState, StatusPill } from "../components/StatePanel";
import { useDigitalEmployees, useExecutionRuns } from "../executionHooks";
import type { DigitalEmployeeView, ExecutionRunView } from "../executionTypes";
import { roleLabel, statusLabel } from "../presentation";
import type { Selection } from "../types";

interface ExecutionViewProps {
  onSelect: (selection: Selection) => void;
}

function BoundaryNotice({ children, tone = "gold" }: { children: ReactNode; tone?: "gold" | "cyan" }) {
  return (
    <div className="trust-strip" role="status">
      <span className={tone === "cyan" ? "local-indicator" : "boundary-chip"}>
        <ShieldCheck size={14} aria-hidden="true" /> {children}
      </span>
      <span>GET · read-only</span>
      <span>приховані команди та шляхи не видаються</span>
    </div>
  );
}

function employeeAccent(status: string): string {
  if (status === "running") return "var(--cyan)";
  if (["blocked", "error"].includes(status)) return "var(--rose)";
  if (["idle", "assigned"].includes(status)) return "var(--mint)";
  return "var(--periwinkle)";
}

function employeeReason(reason: string): string {
  const labels: Record<string, string> = {
    digital_employees_disabled: "співробітники вимкнені",
    runtime_execution_disabled: "runtime вимкнено",
    runtime_adapter_disabled: "адаптер вимкнено",
    catalog_definition_disabled: "профіль не активовано",
    operational_state_uninitialized: "лише каталог",
    configuration_revision_changed: "конфігурація змінилася",
    persisted_operational_state: "операційний стан"
  };
  return labels[reason] ?? statusLabel(reason);
}

function filesystemLabel(mode: string): string {
  if (mode === "task_worktree") return "ізольований worktree";
  if (mode === "workspace_root_readonly") return "корінь read-only";
  return mode;
}

function employeeSelection(employee: DigitalEmployeeView, snapshotId: string): Selection {
  return {
    id: employee.employee_id,
    kind: "employee",
    label: employee.name,
    status: employee.status,
    subtitle: employee.description,
    metadata: {
      role: roleLabel(employee.role),
      runtime_adapter_id: employee.runtime_adapter_id,
      state_source: employee.state_source,
      reason_code: employee.reason_code,
      current_task_id: employee.current_task_id ?? "none",
      current_session_id: employee.current_session_id ?? "none",
      configuration_current:
        employee.configuration_current === null
          ? "uninitialized"
          : String(employee.configuration_current)
    },
    snapshotId
  };
}

export function DigitalEmployeesView({ onSelect }: ExecutionViewProps) {
  const employees = useDigitalEmployees();
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("uk-UA");
    if (!needle) return employees.data?.employees ?? [];
    return (employees.data?.employees ?? []).filter((employee) =>
      [
        employee.name,
        employee.role,
        employee.description,
        employee.employee_id,
        employee.runtime_adapter_id,
        employee.status
      ]
        .join(" ")
        .toLocaleLowerCase("uk-UA")
        .includes(needle)
    );
  }, [employees.data?.employees, query]);

  if (employees.isLoading) {
    return <LoadingState label="Звіряємо цифрових співробітників з поточним каталогом…" />;
  }
  if (employees.isError || !employees.data) {
    return <ErrorState error={employees.error} onRetry={() => void employees.refetch()} />;
  }

  const disabled = !employees.data.features.digital_employees_enabled;
  const catalogOnly = employees.data.state === "catalog_only" || employees.data.storage_state === "uninitialized";
  return (
    <div className="route-list">
      <div className="route-tools">
        <label className="search-field">
          <Search size={16} aria-hidden="true" />
          <input
            aria-label="Знайти цифрового співробітника"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Ім'я, роль, адаптер або ID"
          />
        </label>
        <span className="inert-badge">
          <Bot size={14} aria-hidden="true" /> {employees.data.total_catalog_employees} у каталозі
        </span>
      </div>

      {disabled ? (
        <BoundaryNotice>Цифрові співробітники вимкнені feature gate</BoundaryNotice>
      ) : catalogOnly ? (
        <BoundaryNotice tone="cyan">
          Каталог готовий; операційне сховище ще не ініціалізовано
        </BoundaryNotice>
      ) : (
        <BoundaryNotice tone="cyan">Стан прочитано з локального execution store</BoundaryNotice>
      )}

      {!filtered.length ? (
        <EmptyState
          title={query ? "Співробітників не знайдено" : "У каталозі немає цифрових співробітників"}
          action={
            query ? (
              <button className="secondary-button" type="button" onClick={() => setQuery("")}>
                Скинути фільтр
              </button>
            ) : undefined
          }
        >
          {query
            ? "Змініть запит або скиньте фільтр."
            : "Співробітники з'являються лише з перевірених AgentDefinition і RuntimeAdapterDefinition."}
        </EmptyState>
      ) : (
        <div className="catalog-grid agent-grid" aria-label="Цифрові співробітники">
          {filtered.map((employee, index) => (
            <button
              className="agent-card panel"
              type="button"
              key={employee.employee_id}
              style={
                {
                  "--agent-accent": employeeAccent(employee.status),
                  "--stagger": `${Math.min(index, 8) * 45}ms`,
                  minHeight: 250,
                  padding: 18
                } as CSSProperties
              }
              aria-label={`Відкрити співробітника ${employee.name}`}
              onClick={() => onSelect(employeeSelection(employee, employees.data.snapshot_id))}
            >
              <span className="agent-aura" style={{ marginBottom: 18 }}>
                <Bot size={23} aria-hidden="true" />
              </span>
              <span className="eyebrow">{roleLabel(employee.role)}</span>
              <h3>{employee.name}</h3>
              <p>{employee.description}</p>
              <span className="agent-capabilities">
                <i>{filesystemLabel(employee.filesystem_policy.mode)}</i>
                <i>{employee.enabled_skill_ids.length} навичок</i>
                <i>×{employee.concurrency_limit}</i>
              </span>
              <footer>
                <StatusPill status={employee.status} />
                <span>{employee.current_task_id ? `задача ${shortId(employee.current_task_id)}` : employeeReason(employee.reason_code)}</span>
              </footer>
            </button>
          ))}
        </div>
      )}
      <p className="route-footnote">
        Картки містять лише очищену проекцію. Instruction paths і runtime credentials навмисно відсутні.
      </p>
    </div>
  );
}

function totalTokens(run: ExecutionRunView): number {
  return run.usage.input_tokens + run.usage.output_tokens + run.usage.cached_tokens;
}

function runSelection(run: ExecutionRunView, snapshotId: string): Selection {
  return {
    id: run.run_id,
    kind: "execution_run",
    label: `${run.provider} · ${shortId(run.run_id, 9, 6)}`,
    status: run.status,
    subtitle: run.summary || `Задача ${shortId(run.task_id)}`,
    metadata: {
      task_id: run.task_id,
      employee_id: run.employee_id,
      runtime_adapter_id: run.runtime_adapter_id,
      provider: run.provider,
      model: run.model ?? "default",
      workspace_id: run.workspace_id,
      graph_scope_id: run.graph_scope_id,
      fencing_token: String(run.fencing_token),
      token_usage: String(totalTokens(run)),
      tests: `${run.tests.filter((test) => test.status === "passed").length}/${run.tests.length}`,
      changed_file_count: String(run.changed_file_count)
    },
    snapshotId
  };
}

function RunMetrics({ runs }: { runs: ExecutionRunView[] }) {
  const running = runs.filter((run) => ["queued", "preparing", "running"].includes(run.status)).length;
  const review = runs.filter((run) => run.status === "review").length;
  const attention = runs.filter((run) => ["blocked", "failed", "cancelled"].includes(run.status)).length;
  const tokens = runs.reduce((total, run) => total + totalTokens(run), 0);
  return (
    <section className="metric-quartet" aria-label="Зведення запусків">
      <div><strong>{running}</strong><span>активно</span></div>
      <div><strong>{review}</strong><span>на перевірці</span></div>
      <div><strong>{attention}</strong><span>потребують уваги</span></div>
      <div><strong>{tokens.toLocaleString("uk-UA")}</strong><span>tokens враховано</span></div>
    </section>
  );
}

export function ExecutionRunsView({ onSelect }: ExecutionViewProps) {
  const runs = useExecutionRuns();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("uk-UA");
    return (runs.data?.runs ?? []).filter(
      (run) =>
        (status === "all" || run.status === status) &&
        (!needle ||
          [
            run.run_id,
            run.task_id,
            run.employee_id,
            run.provider,
            run.model ?? "",
            run.status,
            run.summary
          ]
            .join(" ")
            .toLocaleLowerCase("uk-UA")
            .includes(needle))
    );
  }, [query, runs.data?.runs, status]);

  if (runs.isLoading) {
    return <LoadingState label="Читаємо очищену історію execution runs…" />;
  }
  if (runs.isError || !runs.data) {
    return <ErrorState error={runs.error} onRetry={() => void runs.refetch()} />;
  }
  const uninitialized = runs.data.state === "uninitialized" || runs.data.storage_state === "uninitialized";
  const disabled = runs.data.feature_state === "disabled" || !runs.data.features.runtime_execution_enabled;

  if (uninitialized && !runs.data.runs.length) {
    return (
      <div className="route-list">
        <BoundaryNotice>Runtime вимкнено; execution store ще не ініціалізовано</BoundaryNotice>
        <EmptyState title="Запусків поки немає">
          Історія з'явиться після явно дозволеного запуску. GET не створює базу, workspace або graph snapshot.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="route-list">
      <div className="route-tools">
        <label className="search-field">
          <Search size={16} aria-hidden="true" />
          <input
            aria-label="Знайти execution run"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Задача, співробітник, provider або ID"
          />
        </label>
        <label className="select-field">
          <Filter size={15} aria-hidden="true" />
          <select aria-label="Фільтр execution runs за станом" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">Усі стани</option>
            <option value="running">У роботі</option>
            <option value="review">На перевірці</option>
            <option value="succeeded">Успішно</option>
            <option value="blocked">Заблоковано</option>
            <option value="failed">Помилка</option>
            <option value="cancelled">Скасовано</option>
          </select>
        </label>
        <span className="inert-badge">
          <Activity size={14} aria-hidden="true" /> {runs.data.pagination.returned} записів
        </span>
      </div>

      {disabled ? (
        <BoundaryNotice>Нові запуски вимкнені; збережена історія доступна лише для читання</BoundaryNotice>
      ) : (
        <BoundaryNotice tone="cyan">Runtime увімкнено; відображається очищений журнал</BoundaryNotice>
      )}

      <RunMetrics runs={runs.data.runs} />

      {!filtered.length ? (
        <EmptyState
          title={query || status !== "all" ? "Запуски не знайдено" : "Запусків поки немає"}
          action={
            query || status !== "all" ? (
              <button className="secondary-button" type="button" onClick={() => { setQuery(""); setStatus("all"); }}>
                Скинути фільтри
              </button>
            ) : undefined
          }
        >
          {query || status !== "all"
            ? "Змініть запит або скиньте фільтри."
            : "Execution run з'явиться лише після успішної підготовки policy, workspace і lease."}
        </EmptyState>
      ) : (
        <section className="data-table panel" aria-label="Execution runs">
          <header className="table-row table-head">
            <span>Запуск</span><span>Стан</span><span>Розпочато</span><span>Адаптер</span><span>Ресурс</span>
          </header>
          {filtered.map((run) => (
            <button
              className="table-row"
              type="button"
              key={run.run_id}
              onClick={() => onSelect(runSelection(run, runs.data.snapshot_id))}
            >
              <span className="table-primary">
                <i className="object-glyph small"><FileClock size={15} aria-hidden="true" /></i>
                <span><strong>{run.provider}</strong><small>{shortId(run.run_id, 10, 7)} · {shortId(run.task_id)}</small></span>
              </span>
              <span><StatusPill status={run.status} /></span>
              <span><Clock3 size={14} aria-hidden="true" /> {formatDate(run.started_at)}</span>
              <code>{shortId(run.runtime_adapter_id, 14, 5)}</code>
              <span><Gauge size={14} aria-hidden="true" /> {totalTokens(run).toLocaleString("uk-UA")}</span>
            </button>
          ))}
        </section>
      )}
      <p className="route-footnote">
        Команда, робоча директорія, environment і provider session не входять у цю проекцію.
      </p>
    </div>
  );
}
