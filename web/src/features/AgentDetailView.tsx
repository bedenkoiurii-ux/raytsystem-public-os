import {
  ArrowLeft,
  BookOpenText,
  Boxes,
  Clock3,
  KeyRound,
  PlayCircle,
  ShieldCheck
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { shortId } from "../api";
import { Surface, SurfaceContent, SurfaceTabs } from "../components/SurfaceTabs";
import { ErrorState, LoadingState, StatusPill } from "../components/StatePanel";
import { useAgentDetail } from "../executionHooks";
import {
  canonicalAgentName,
  capabilityLabel,
  catalogDescription,
  localizedCatalogLabel,
  roleLabel,
  statusLabel
} from "../presentation";
import {
  accessValueLabel,
  activityLabel,
  agentReadinessLabel,
  agentReasonLabel,
  booleanLabel,
  boundaryLabel,
  filesystemModeLabel,
  limitationLabel,
  safeValueLabel
} from "./agentPresentation";

type AgentDetailTab = "overview" | "instruction" | "skills" | "runtime" | "access" | "history";

const detailTabs = [
  { id: "overview", label: "Огляд", icon: <Boxes size={15} /> },
  { id: "instruction", label: "Інструкція", icon: <BookOpenText size={15} /> },
  { id: "skills", label: "Skills", icon: <ShieldCheck size={15} /> },
  { id: "runtime", label: "Runtime", icon: <PlayCircle size={15} /> },
  { id: "access", label: "Доступ", icon: <KeyRound size={15} /> },
  { id: "history", label: "Історія", icon: <Clock3 size={15} /> }
] as const;

type DetailValue = string | number | boolean | null;

function DetailList({ values }: { values: Array<[string, DetailValue]> }) {
  return (
    <dl className="surface-detail-list">
      {values.map(([label, value], index) => (
        <div key={`${label}-${index}`}>
          <dt>{label}</dt>
          <dd>{value === null || value === "" ? "Не вказано" : typeof value === "boolean" ? booleanLabel(value) : String(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function EmptyState({ children }: { children: string }) {
  return <p className="muted-copy">{children}</p>;
}

function safeRecordText(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function safeRecordNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function shortSafeId(value: string | null, left = 12, right = 6): string {
  return value ? shortId(value, left, right) : "Не вказано";
}

function dateTimeLabel(value: string | null): string {
  if (!value) return "Не вказано";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Не вказано";
  return new Intl.DateTimeFormat("uk-UA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC"
  }).format(date);
}

function contextSourcesLabel(paths: string[]): string {
  if (!paths.length) return "Не заявлені";
  return `${paths.length} · значення шляхів приховані в безпечній проекції`;
}

function tokenLimitLabel(tokens: { input_tokens: number; output_tokens: number; cached_tokens: number }): string {
  return `вхід ${tokens.input_tokens} · вихід ${tokens.output_tokens} · кеш ${tokens.cached_tokens}`;
}

export function AgentDetailView({
  agentId,
  catalogSha256,
  onBack,
  onOpenSkill
}: {
  agentId: string;
  catalogSha256: string;
  onBack: () => void;
  onOpenSkill: (skillId: string) => void;
}) {
  const detail = useAgentDetail(agentId, catalogSha256);
  const [tab, setTab] = useState<AgentDetailTab>("overview");
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (detail.data) headingRef.current?.focus();
  }, [agentId, detail.data]);

  if (detail.isLoading) return <LoadingState label="Збираємо визначення та execution-стан агента…" />;
  if (detail.isError || !detail.data) {
    return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />;
  }

  const { agent } = detail.data;
  const panelId = `agent-${agent.agent_id}-panel`;
  const returnToAgentList = () => {
    const returnTargetLabel = `Відкрити агента ${canonicalAgentName(agent)}`;
    onBack();
    window.requestAnimationFrame(() => {
      const target = Array.from(document.querySelectorAll<HTMLButtonElement>("button[aria-label]"))
        .find((button) => button.getAttribute("aria-label") === returnTargetLabel);
      target?.focus();
    });
  };
  return (
    <>
      <header className="detail-hero panel">
        <button className="secondary-button" type="button" onClick={returnToAgentList}>
          <ArrowLeft size={15} /> Усі агенти
        </button>
        <div className="detail-hero-copy">
          <span className="eyebrow">Роль: {roleLabel(agent.role)}</span>
          <h2 ref={headingRef} tabIndex={-1}>{canonicalAgentName(agent)}</h2>
          <p>{catalogDescription(agent.agent_id, agent.description)}</p>
        </div>
        <div className="detail-hero-state">
          <StatusPill status={agent.readiness} label={agentReadinessLabel(agent.readiness)} />
          <span>{agentReasonLabel(agent.unavailable_reason)}</span>
        </div>
      </header>

      <Surface className="detail-tab-surface" aria-label={`Деталі агента ${agent.name}`}>
        <SurfaceTabs
          tabs={detailTabs.map((item) => ({
            ...item,
            panelId
          }))}
          activeTab={tab}
          onTabChange={setTab}
          ariaLabel="Розділи деталей агента"
          id={`agent-detail-tabs-${agent.agent_id}`}
        />
        <SurfaceContent id={panelId} labelledBy={`agent-detail-tabs-${agent.agent_id}-tab-${tab}`}>
          {tab === "overview" ? (
            <section className="detail-section panel">
              <h3>Профіль агента</h3>
              <DetailList values={[
                ["Ім'я", canonicalAgentName(agent)],
                ["ID", agent.agent_id],
                ["Роль", roleLabel(agent.role)],
                ["Опис", catalogDescription(agent.agent_id, agent.description)],
                ["Пакет", agent.pack_id],
                ["Версія", agent.version],
                ["Статус визначення", statusLabel(agent.definition_state)],
                ["Призначення", agent.definition?.capabilities.map(capabilityLabel).join(", ") ?? null]
              ]} />
            </section>
          ) : null}

          {tab === "instruction" ? (
            <div className="detail-section-grid">
              <section className="detail-section panel">
                <h3>Контекст і можливості</h3>
                <DetailList values={[
                  ["Контекстні джерела", contextSourcesLabel(detail.data.instruction.context_paths)],
                  ["Можливості", detail.data.instruction.capabilities.map(capabilityLabel).join(", ") || "Не заявлені"],
                  ["Обмеження", detail.data.instruction.limitations.map(limitationLabel).join(" · ") || "Не заявлені"]
                ]} />
              </section>
              <section className="detail-section panel">
                <h3>Системні межі</h3>
                {Object.entries(detail.data.instruction.system_boundaries).length ? (
                  <DetailList values={Object.entries(detail.data.instruction.system_boundaries).map(([key, value]) => [
                    boundaryLabel(key),
                    safeValueLabel(value)
                  ])} />
                ) : <EmptyState>Системні межі не заявлені.</EmptyState>}
              </section>
              <section className="detail-section panel">
                <h3>Безпечна проекція визначення</h3>
                {agent.definition ? (
                  <DetailList values={[
                    ["ID", agent.definition.agent_id],
                    ["Ім'я", canonicalAgentName(agent.definition)],
                    ["Роль", roleLabel(agent.definition.role)],
                    ["Опис", catalogDescription(agent.definition.agent_id, agent.definition.description)],
                    ["Версія", agent.definition.version],
                    ["Пакет", agent.definition.pack_id],
                    ["Адаптер виконання", agent.definition.runtime_adapter_id],
                    ["Skills", agent.definition.skill_ids.join(", ") || "Не призначені"],
                    ["Запитаний доступ до файлів", filesystemModeLabel(agent.definition.requested_filesystem_mode)],
                    ["Класи даних", agent.definition.approved_data_classes.map(statusLabel).join(", ") || "Не заявлені"],
                    ["Зовнішня передача даних заявлена", agent.definition.egress_declared],
                    ["Визначення увімкнено", agent.definition.enabled]
                  ]} />
                ) : <EmptyState>Визначення агента відсутнє; показано лише execution-запис.</EmptyState>}
              </section>
            </div>
          ) : null}

          {tab === "skills" ? (
            <section className="detail-section panel">
              <h3>Призначені Skills</h3>
              <div className="related-object-list">
                {detail.data.skills.length ? detail.data.skills.map((skill) => (
                  <button type="button" key={skill.skill_id} onClick={() => onOpenSkill(skill.skill_id)}>
                    <span><strong>{skill.skill_id}</strong><small>{skill.permissions.join(", ") || "Дозволи не заявлені"}</small></span>
                    <StatusPill status={skill.status} />
                  </button>
                )) : <p className="muted-copy">Skills не призначені.</p>}
              </div>
            </section>
          ) : null}

          {tab === "runtime" ? (
            <div className="detail-section-grid">
              <section className="detail-section panel">
                <h3>Стан виконання</h3>
                <DetailList values={[
                  ["Адаптер", localizedCatalogLabel(agent.runtime_adapter.adapter_id, agent.runtime_adapter.name)],
                  ["Стан адаптера", statusLabel(agent.runtime_adapter.state)],
                  ["Статус виконання", statusLabel(agent.execution_status)],
                  ["Поточна сесія", agent.current_session_id ? shortId(agent.current_session_id) : null],
                  ["Режим робочого простору", filesystemModeLabel(agent.filesystem_policy.mode)],
                  ["Поточне завдання", agent.current_task_id ? shortId(agent.current_task_id) : null],
                  ["Паралельність", agent.concurrency_limit],
                  ["Причина блокування", agentReasonLabel(agent.unavailable_reason)]
                ]} />
              </section>
              <section className="detail-section panel">
                <h3>Сесії</h3>
                {detail.data.runtime.sessions.length ? detail.data.runtime.sessions.map((session) => (
                  <div className="history-row" key={session.session_id}>
                    <code>{shortId(session.session_id)}</code>
                    <StatusPill status={session.status} label={statusLabel(session.status)} />
                    <span>
                      Завдання {shortSafeId(session.task_id)} · {session.provider}
                      {session.model ? ` · ${session.model}` : ""} · старт {dateTimeLabel(session.started_at)}
                    </span>
                  </div>
                )) : <EmptyState>Сесії ще не створювалися або сховище виконання не ініціалізоване.</EmptyState>}
              </section>
              <section className="detail-section panel">
                <h3>Бюджети</h3>
                {detail.data.runtime.budgets.length ? detail.data.runtime.budgets.map((budget) => (
                  <div className="history-row" key={budget.budget_policy_id}>
                    <code>{shortId(budget.budget_policy_id)}</code>
                    <StatusPill status="configured" label="Налаштовано" />
                    <span>
                      Ліміти: {tokenLimitLabel(budget.token_limit)} · запуски {budget.usage?.run_count ?? 0}/{budget.run_limit}
                      {` · при ліміті: ${accessValueLabel(budget.active_run_action)}`}
                    </span>
                  </div>
                )) : <EmptyState>Бюджети для агента не налаштовані.</EmptyState>}
              </section>
              <section className="detail-section panel">
                <h3>Оренди завдань</h3>
                {detail.data.runtime.leases.length ? detail.data.runtime.leases.map((lease, index) => {
                  const leaseId = safeRecordText(lease, "lease_id");
                  const taskId = safeRecordText(lease, "task_id");
                  const status = safeRecordText(lease, "status") ?? "active";
                  const expiresAt = safeRecordText(lease, "expires_at");
                  const fencingToken = safeRecordNumber(lease, "fencing_token");
                  return (
                    <div className="history-row" key={leaseId ?? `lease-${index}`}>
                      <code>{shortSafeId(leaseId)}</code>
                      <StatusPill status={status} label={statusLabel(status)} />
                      <span>
                        Завдання {shortSafeId(taskId)} · до {dateTimeLabel(expiresAt)}
                        {fencingToken === null ? "" : ` · маркер огородження ${fencingToken}`}
                      </span>
                    </div>
                  );
                }) : <EmptyState>Активних оренд завдань немає.</EmptyState>}
                <p className="muted-copy">Команди, робочі шляхи та сесія провайдера приховані з цієї проекції.</p>
              </section>
            </div>
          ) : null}

          {tab === "access" ? (
            <div className="detail-section-grid">
              <section className="detail-section panel">
                <h3>Файлова система та дані</h3>
                <DetailList values={[
                  ["Режим", filesystemModeLabel(detail.data.access.filesystem.mode)],
                  ["Читання робочого простору", detail.data.access.filesystem.allow_workspace_read],
                  ["Запис у staged-область", detail.data.access.filesystem.allow_staged_write],
                  ["Читання Git", detail.data.access.filesystem.allow_git_read],
                  ["Запис у Git", detail.data.access.filesystem.allow_git_write],
                  ["Класи даних", detail.data.access.data_classes.map(statusLabel).join(", ") || "Не заявлені"]
                ]} />
              </section>
              <section className="detail-section panel">
                <h3>Ефективні дозволи</h3>
                <DetailList values={[
                  ["Читання робочого простору", detail.data.access.effective_permissions.workspace_read],
                  ["Запис у staged-область", detail.data.access.effective_permissions.staged_write],
                  ["Запис у Git", detail.data.access.effective_permissions.git_write],
                  ["Мережевий доступ", detail.data.access.effective_permissions.network],
                  ["Зовнішня передача даних заявлена", detail.data.access.network.egress_declared],
                  ["Підтвердження обов'язкове", detail.data.access.network.approval_required]
                ]} />
              </section>
              <section className="detail-section panel">
                <h3>Інструменти</h3>
                {detail.data.access.tools.length ? detail.data.access.tools.map((tool, index) => {
                  const toolId = safeRecordText(tool, "tool_id", "id") ?? `tool-${index + 1}`;
                  const provider = safeRecordText(tool, "provider");
                  const access = safeRecordText(tool, "access", "mode");
                  const status = safeRecordText(tool, "health", "status") ?? "available";
                  const approvalPolicy = safeRecordText(tool, "approval_policy");
                  return (
                    <div className="history-row" key={toolId}>
                      <code>{toolId}</code>
                      <StatusPill status={status} label={statusLabel(status)} />
                      <span>
                        {provider ? `Провайдер ${provider}` : "Провайдер не вказаний"}
                        {access ? ` · ${accessValueLabel(access)}` : ""}
                        {approvalPolicy ? ` · політика: ${accessValueLabel(approvalPolicy)}` : ""}
                      </span>
                    </div>
                  );
                }) : <EmptyState>Пов'язані інструменти Tool Hub не заявлені.</EmptyState>}
              </section>
              <section className="detail-section panel">
                <h3>Підтвердження</h3>
                {detail.data.access.approvals.length ? detail.data.access.approvals.map((approval) => (
                  <div className="history-row" key={approval.approval_id}>
                    <code>{shortId(approval.approval_id)}</code>
                    <StatusPill status="confirmed" label="Підтверджено" />
                    <span>
                      {activityLabel(approval.action)} · область: {approval.scope.map(activityLabel).join(", ") || "не вказана"} · до {dateTimeLabel(approval.expires_at)}
                      {approval.destination_present ? " · призначення приховано" : ""}
                    </span>
                  </div>
                )) : <EmptyState>Активних підтверджень немає.</EmptyState>}
              </section>
            </div>
          ) : null}

          {tab === "history" ? (
            <section className="detail-section panel">
              <h3>Безпечна історія виконання</h3>
              <DetailList values={[
                ["Ревізія конфігурації", shortId(detail.data.history.configuration_revision, 12, 8)],
                ["Призначення", detail.data.history.assignments.length],
                ["Запуски", detail.data.history.runs.length],
                ["Аудит-події", detail.data.history.audit_events.length]
              ]} />
              <h3 className="section-subheading">Призначення</h3>
              {detail.data.history.assignments.length ? detail.data.history.assignments.map((assignment) => (
                <div className="history-row" key={assignment.assignment_id}>
                  <code>{shortId(assignment.assignment_id)}</code>
                  <StatusPill status="assigned" label={statusLabel("assigned")} />
                  <span>
                    Завдання {shortId(assignment.task_id)} · ревізія {assignment.task_revision} · адаптер {assignment.runtime_adapter_id}
                  </span>
                </div>
              )) : <EmptyState>Призначень завдань ще немає.</EmptyState>}

              <h3 className="section-subheading">Запуски</h3>
              {detail.data.history.runs.length ? detail.data.history.runs.map((run) => (
                <div className="history-row" key={run.run_id}>
                  <code>{shortId(run.run_id)}</code>
                  <StatusPill status={run.status} label={statusLabel(run.status)} />
                  <span>
                    Завдання {shortId(run.task_id)} · {run.provider}{run.model ? ` / ${run.model}` : ""} · змінено файлів: {run.changed_file_count} · тестів: {run.tests.length}
                  </span>
                </div>
              )) : <EmptyState>Запусків для агента ще немає.</EmptyState>}

              <h3 className="section-subheading">Аудит-події</h3>
              {detail.data.history.audit_events.length ? detail.data.history.audit_events.map((event, index) => {
                const eventId = safeRecordText(event, "event_id", "audit_event_id") ?? `audit-${index + 1}`;
                const eventType = safeRecordText(event, "event_type", "type", "action") ?? "event";
                const eventStatus = safeRecordText(event, "status", "state") ?? "confirmed";
                const recordedAt = safeRecordText(event, "recorded_at", "created_at");
                const sequence = safeRecordNumber(event, "sequence");
                return (
                  <div className="history-row" key={eventId}>
                    <code>{shortId(eventId)}</code>
                    <StatusPill status={eventStatus} label={statusLabel(eventStatus)} />
                    <span>
                      {activityLabel(eventType)}{sequence === null ? "" : ` · #${sequence}`} · {dateTimeLabel(recordedAt)}
                    </span>
                  </div>
                );
              }) : <EmptyState>Аудит-події для цього агента не зафіксовані.</EmptyState>}
            </section>
          ) : null}
        </SurfaceContent>
      </Surface>
    </>
  );
}
