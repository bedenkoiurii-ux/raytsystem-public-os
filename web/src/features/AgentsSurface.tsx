import { Bot, Filter, Search, Settings2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { shortId } from "../api";
import { Surface } from "../components/SurfaceTabs";
import { EmptyState, ErrorState, LoadingState, StatusPill } from "../components/StatePanel";
import { useAgents } from "../executionHooks";
import type { AgentReadiness, AgentViewModel } from "../executionTypes";
import {
  canonicalAgentName,
  catalogDescription,
  localizedCatalogLabel,
  roleLabel,
  statusLabel
} from "../presentation";
import { AgentDetailView } from "./AgentDetailView";
import { agentReadinessLabel, agentReasonLabel, filesystemModeLabel } from "./agentPresentation";

type AgentFilter = "all" | "ready" | "disabled" | "catalog_only" | "running" | "setup";

const filterCopy: Array<{ id: AgentFilter; label: string }> = [
  { id: "all", label: "Усі" },
  { id: "ready", label: "Готові" },
  { id: "disabled", label: "Вимкнені" },
  { id: "catalog_only", label: "Лише каталог" },
  { id: "running", label: "Виконують завдання" },
  { id: "setup", label: "Потребують налаштування" }
];

function selectedAgentFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("agent");
}

function matchesFilter(agent: AgentViewModel, filter: AgentFilter): boolean {
  if (filter === "all") return true;
  if (filter === "ready") return agent.readiness === "ready";
  if (filter === "disabled") return agent.readiness === "disabled";
  if (filter === "catalog_only") return agent.definition !== null && agent.execution === null;
  if (filter === "running") return agent.readiness === "running" || agent.current_task_id !== null;
  return ["requires_configuration", "degraded"].includes(agent.readiness);
}

function readinessAccent(readiness: AgentReadiness): string {
  if (readiness === "ready") return "var(--mint)";
  if (readiness === "running") return "var(--cyan)";
  if (readiness === "degraded") return "var(--rose)";
  if (readiness === "requires_configuration") return "var(--gold)";
  return "var(--periwinkle)";
}

export function AgentsSurface({ onOpenSkill }: { onOpenSkill: (skillId: string) => void }) {
  const agents = useAgents();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AgentFilter>("all");
  const [selectedAgent, setSelectedAgent] = useState<string | null>(selectedAgentFromUrl);

  useEffect(() => {
    const handlePopState = () => setSelectedAgent(selectedAgentFromUrl());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("uk-UA");
    return (agents.data?.agents ?? []).filter((agent) => {
      if (!matchesFilter(agent, filter)) return false;
      if (!needle) return true;
      return [
        agent.name,
        agent.agent_id,
        agent.employee_id,
        agent.role,
        roleLabel(agent.role),
        agent.description,
        catalogDescription(agent.agent_id, agent.description),
        agent.runtime_adapter.adapter_id,
        agent.runtime_adapter.name,
        ...agent.skill_ids
      ].join(" ").toLocaleLowerCase("uk-UA").includes(needle);
    });
  }, [agents.data?.agents, filter, query]);

  const openAgent = (agentId: string) => {
    window.history.pushState({}, "", `/agents?agent=${encodeURIComponent(agentId)}`);
    setSelectedAgent(agentId);
  };
  const closeAgent = () => {
    window.history.pushState({}, "", "/agents");
    setSelectedAgent(null);
  };

  return (
    <Surface className="route agents-surface" aria-label="Агенти">
      {agents.isLoading ? <LoadingState label="Поєднуємо визначення та execution-стан за стабільними ID…" /> : null}
      {agents.isError ? <ErrorState error={agents.error} onRetry={() => void agents.refetch()} /> : null}

      {agents.data && selectedAgent ? (
        <AgentDetailView
          agentId={selectedAgent}
          catalogSha256={agents.data.catalog_sha256}
          onBack={closeAgent}
          onOpenSkill={onOpenSkill}
        />
      ) : null}

      {agents.data && !selectedAgent ? (
        <>
          <div className="route-tools agent-tools">
            <label className="search-field">
              <Search size={16} aria-hidden="true" />
              <input
                aria-label="Знайти агента"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Ім'я, ID, роль, адаптер або skill"
              />
            </label>
            <label className="select-field">
              <Filter size={15} aria-hidden="true" />
              <select
                aria-label="Фільтр агентів"
                value={filter}
                onChange={(event) => setFilter(event.target.value as AgentFilter)}
              >
                {filterCopy.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}
              </select>
            </label>
            <span className="inert-badge"><Bot size={14} /> {agents.data.total_agents} агентів</span>
          </div>

          <div className="agent-plane-state panel" role="status">
            <Settings2 size={16} aria-hidden="true" />
            <span>
              {agents.data.storage_state === "uninitialized"
                ? "Runtime не налаштований"
                : "Визначення та стан виконання об'єднані в одній проекції"}
            </span>
            {!agents.data.features.runtime_execution_enabled
              ? <StatusPill status="disabled" label="Виконання вимкнено" />
              : null}
          </div>

          {!filtered.length ? (
            <EmptyState
              title="Агентів не знайдено"
              action={<button className="secondary-button" type="button" onClick={() => { setQuery(""); setFilter("all"); }}>Скинути фільтри</button>}
            >
              Змініть запит або виберіть інший статус.
            </EmptyState>
          ) : (
            <div className="catalog-grid agent-grid" aria-label="Єдиний список агентів">
              {filtered.map((agent, index) => (
                <article
                  className="agent-card unified-agent-card panel"
                  key={agent.agent_id}
                  aria-labelledby={`agent-card-title-${agent.agent_id}`}
                  style={{
                    "--agent-accent": agent.definition?.accent ?? readinessAccent(agent.readiness),
                    "--stagger": `${Math.min(index, 8) * 45}ms`
                  } as CSSProperties}
                >
                  <span className="agent-aura"><Bot size={23} aria-hidden="true" /></span>
                  <span className="eyebrow">Роль: {roleLabel(agent.role)}</span>
                  <h3 id={`agent-card-title-${agent.agent_id}`}>{canonicalAgentName(agent)}</h3>
                  <p>{catalogDescription(agent.agent_id, agent.description)}</p>
                  <dl className="agent-card-facts">
                    <div><dt>Адаптер</dt><dd>{localizedCatalogLabel(agent.runtime_adapter.adapter_id, agent.runtime_adapter.name)}</dd></div>
                    <div><dt>Виконання</dt><dd>{statusLabel(agent.execution_status)}</dd></div>
                    <div><dt>Навички</dt><dd>{agent.skills_count}</dd></div>
                    <div><dt>Файли</dt><dd>{filesystemModeLabel(agent.filesystem_policy.mode)}</dd></div>
                    <div><dt>Паралельність</dt><dd>×{agent.concurrency_limit}</dd></div>
                    <div><dt>Завдання</dt><dd>{agent.current_task_id ? shortId(agent.current_task_id) : "Немає"}</dd></div>
                  </dl>
                  <footer>
                    <StatusPill status={agent.readiness} label={agentReadinessLabel(agent.readiness)} />
                    <span>{agentReasonLabel(agent.unavailable_reason)}</span>
                  </footer>
                  <button className="agent-card-open" type="button" aria-label={`Відкрити агента ${canonicalAgentName(agent)}`} onClick={() => openAgent(agent.agent_id)} />
                </article>
              ))}
            </div>
          )}
          <p className="route-footnote">
            Кожен stable agent_id показано один раз. Credentials, абсолютні шляхи та runtime-команди не розкриваються.
          </p>
        </>
      ) : null}
    </Surface>
  );
}
