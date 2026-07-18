import { Activity, CheckCircle2, Clock3, FileClock, Filter, History, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { formatDate, shortId } from "../api";
import { Surface, SurfaceContent, SurfaceTabs, type SurfaceTab } from "../components/SurfaceTabs";
import { useRuns } from "../hooks";
import { operationLabel, statusLabel } from "../presentation";
import type { Selection } from "../types";
import { EmptyState, ErrorState, LoadingState, StatusPill } from "../components/StatePanel";
import { ExecutionRunsView } from "./ExecutionViews";

export function Runs({ onSelect }: { onSelect: (selection: Selection) => void }) {
  const [plane, setPlane] = useState<"execution" | "operations">("execution");
  const tabs: readonly SurfaceTab<"execution" | "operations">[] = [
    { id: "execution", label: "Live execution", icon: <Activity size={15} />, panelId: "runs-surface-panel", tabId: "runs-tab-execution" },
    { id: "operations", label: "Зафіксовані операції", icon: <History size={15} />, panelId: "runs-surface-panel", tabId: "runs-tab-operations" }
  ];
  return (
    <Surface className="route runs-surface">
      <SurfaceTabs tabs={tabs} activeTab={plane} onTabChange={setPlane} ariaLabel="Тип журналу запусків" id="runs-surface-tabs" />
      <SurfaceContent id="runs-surface-panel" labelledBy={`runs-tab-${plane}`}>
        {plane === "execution" ? <ExecutionRunsView onSelect={onSelect} /> : <LegacyRuns onSelect={onSelect} />}
      </SurfaceContent>
    </Surface>
  );
}

function LegacyRuns({ onSelect }: { onSelect: (selection: Selection) => void }) {
  const runs = useRuns();
  const [query, setQuery] = useState("");
  const [state, setState] = useState("all");
  const filtered = useMemo(
    () =>
      (runs.data?.runs ?? []).filter(
        (run) =>
          (state === "all" || run.state === state) &&
          `${run.operation_type} ${operationLabel(run.operation_type)} ${statusLabel(run.state)} ${run.run_id}`.toLowerCase().includes(query.toLowerCase())
      ),
    [query, runs.data?.runs, state]
  );

  if (runs.isLoading) return <LoadingState label="Читаємо маніфести зафіксованих запусків…" />;
  if (runs.isError) return <ErrorState error={runs.error} onRetry={() => void runs.refetch()} />;
  return (
    <div className="route-list">
      <div className="route-tools">
        <label className="search-field"><Search size={16} /><input aria-label="Знайти запуск за операцією або ID" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Операція або ID запуску" /></label>
        <label className="select-field"><Filter size={15} /><select aria-label="Фільтр запусків за станом" value={state} onChange={(event) => setState(event.target.value)}><option value="all">Усі стани</option><option value="succeeded">Успішно</option><option value="terminal_failed">Помилка</option><option value="quarantined">Карантин</option></select></label>
      </div>
      {!filtered.length ? (
        <EmptyState
          title={query || state !== "all" ? "Запуски не знайдено" : "Зафіксованих запусків поки немає"}
          action={query || state !== "all" ? <button className="secondary-button" type="button" onClick={() => { setQuery(""); setState("all"); }}>Скинути фільтри</button> : undefined}
        >{query || state !== "all" ? "Змініть запит або скиньте фільтри." : "Історія з'явиться після того, як детермінований CLI-процес зафіксує маніфест."}</EmptyState>
      ) : (
        <section className="data-table panel" aria-label="Зафіксовані запуски">
          <header className="table-row table-head"><span>Операція</span><span>Стан</span><span>Оновлено</span><span>Покоління</span><span>Маніфест</span></header>
          {filtered.map((run) => (
            <button
              className="table-row"
              type="button"
              key={run.run_id}
              onClick={() => onSelect({
                id: run.run_id,
                kind: "run",
                label: operationLabel(run.operation_type),
                status: run.state,
                subtitle: formatDate(run.updated_at),
                metadata: {
                  run_id: run.run_id,
                  manifest_sha256: run.manifest_sha256,
                  generation_id: run.generation_id ?? "none",
                  semantic_noop: String(run.semantic_noop)
                }
              })}
            >
              <span className="table-primary"><i className="object-glyph small"><FileClock size={15} /></i><span><strong>{operationLabel(run.operation_type)}</strong><small>{shortId(run.run_id, 10, 7)}</small></span></span>
              <span><StatusPill status={run.state} /></span>
              <span><Clock3 size={14} /> {formatDate(run.updated_at)}</span>
              <code>{shortId(run.generation_id)}</code>
              <span className="manifest-ok"><CheckCircle2 size={14} /> {shortId(run.manifest_sha256)}</span>
            </button>
          ))}
        </section>
      )}
      <p className="route-footnote">Запуски доступні лише для перегляду. Повтор, продовження та виконання й далі керуються через CLI.</p>
    </div>
  );
}
