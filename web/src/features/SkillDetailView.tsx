import {
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  Code2,
  Copy,
  Eye,
  FileText,
  History,
  KeyRound,
  Pencil,
  TestTube2,
  Wrench
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { shortId } from "../api";
import { SafeMarkdown } from "../components/SafeMarkdown";
import { Dialog } from "../components/Dialog";
import { Surface, SurfaceContent, SurfaceTabs, type SurfaceTab } from "../components/SurfaceTabs";
import { EmptyState, ErrorState, LoadingState, StatusPill } from "../components/StatePanel";
import { catalogDescription, localizedCatalogLabel, roleLabel, statusLabel } from "../presentation";
import { useSkillDetail } from "../skillHooks";
import type { SkillWriteResult } from "../types";
import { SkillEditor } from "./SkillEditor";
import { SkillForkPanel } from "./SkillForkPanel";

type SkillDetailTab = "overview" | "instruction" | "permissions" | "tools" | "tests" | "history";
type InstructionMode = "preview" | "raw";

const skillTabs: readonly SurfaceTab<SkillDetailTab>[] = [
  { id: "overview", label: "Огляд", icon: <ClipboardCheck size={15} />, panelId: "skill-detail-panel", tabId: "skill-tab-overview" },
  { id: "instruction", label: "Інструкція", icon: <FileText size={15} />, panelId: "skill-detail-panel", tabId: "skill-tab-instruction" },
  { id: "permissions", label: "Permissions", icon: <KeyRound size={15} />, panelId: "skill-detail-panel", tabId: "skill-tab-permissions" },
  { id: "tools", label: "Tools", icon: <Wrench size={15} />, panelId: "skill-detail-panel", tabId: "skill-tab-tools" },
  { id: "tests", label: "Tests", icon: <TestTube2 size={15} />, panelId: "skill-detail-panel", tabId: "skill-tab-tests" },
  { id: "history", label: "Історія", icon: <History size={15} />, panelId: "skill-detail-panel", tabId: "skill-tab-history" }
];

const readOnlyReasonCopy: Record<string, string> = {
  official_skill: "Офіційний вбудований skill доступний лише для читання.",
  installed_pinned_pack: "Встановлений закріплений pack доступний лише для читання.",
  generated_skill: "Згенерований skill не можна змінювати напряму.",
  sensitivity_restricted: "Запис заборонено sensitivity policy.",
  skill_disabled: "Вимкнений skill не можна редагувати.",
  source_path_not_allowlisted: "Джерело перебуває поза дозволеним skills/<skill_id>/SKILL.md.",
  unverified_provenance: "Походження skill не підтверджено.",
  non_local_pack: "Skill належить зовнішньому або нередагованому pack."
};

function availabilityLabel(value: string): string {
  if (value === "not_modeled") return "Не моделюється";
  if (value === "declared_ids_only") return "Лише заявлені ID";
  if (value === "available") return "Доступно";
  return statusLabel(value);
}

function boundaryValue(section: { availability: string; items: string[] }): React.ReactNode {
  return section.items.length
    ? <span>{section.items.map((item) => <code key={item}>{item} </code>)}</span>
    : availabilityLabel(section.availability);
}

interface SkillDetailViewProps {
  skillId: string;
  expectedCatalogSha256: string;
  onBack: () => void;
  onRevisionChanged: (result: SkillWriteResult) => void;
  onForkCreated: (result: SkillWriteResult) => void;
}

function DetailList({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return <dl className="surface-detail-list">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

export function SkillDetailView({
  skillId,
  expectedCatalogSha256,
  onBack,
  onRevisionChanged,
  onForkCreated
}: SkillDetailViewProps) {
  const detailQuery = useSkillDetail(skillId, expectedCatalogSha256);
  const [activeTab, setActiveTab] = useState<SkillDetailTab>("overview");
  const [instructionMode, setInstructionMode] = useState<InstructionMode>("preview");
  const [editing, setEditing] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const [forking, setForking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [backConfirmOpen, setBackConfirmOpen] = useState(false);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const editButtonRef = useRef<HTMLButtonElement | null>(null);
  const forkButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!detailQuery.data) return;
    const frame = window.requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [detailQuery.data]);

  const closeEditor = useCallback(() => {
    setEditing(false);
    setEditorDirty(false);
    window.requestAnimationFrame(() => editButtonRef.current?.focus());
  }, []);

  const closeFork = useCallback(() => {
    setForking(false);
    window.requestAnimationFrame(() => forkButtonRef.current?.focus());
  }, []);

  if (detailQuery.isLoading) return <LoadingState label={`Відкриваємо ${skillId}…`} />;
  if (detailQuery.isError || !detailQuery.data) {
    return (
      <section className="detail-error-stack">
        <button className="secondary-button" type="button" onClick={onBack}><ArrowLeft size={15} />До списку skills</button>
        <ErrorState error={detailQuery.error} onRetry={() => void detailQuery.refetch()} />
      </section>
    );
  }

  const detail = detailQuery.data;
  const { skill, policy } = detail;
  const panelLabelledBy = `skill-tab-${activeTab}`;
  const saved = (result: SkillWriteResult) => {
    setEditing(false);
    setEditorDirty(false);
    setNotice(`Revision ${result.record_revision} збережена. Test status: pending.`);
    onRevisionChanged(result);
  };
  const forked = (result: SkillWriteResult) => {
    setForking(false);
    onForkCreated(result);
  };
  const requestBack = () => {
    if (editorDirty) setBackConfirmOpen(true);
    else onBack();
  };

  return (
    <div className="skill-detail-stack">
      <section className="detail-hero skill-detail-hero panel">
        <span className="agent-aura skill-detail-aura"><Wrench size={27} /></span>
        <div className="detail-hero-copy">
          <span className="eyebrow">{localizedCatalogLabel(skill.pack_id, skill.pack_id)} · {skill.version}</span>
          <h2 ref={headingRef} tabIndex={-1}>{skill.skill_id}</h2>
          <p>{catalogDescription(skill.skill_id, skill.description)}</p>
        </div>
        <div className="detail-hero-state">
          <div><StatusPill status={skill.enabled ? "enabled" : "restricted"} /><StatusPill status={skill.test_status} /></div>
          <span>{policy.editable ? "Можна редагувати локально" : (readOnlyReasonCopy[policy.read_only_reason ?? ""] ?? "Лише читання")}</span>
        </div>
        <div className="detail-hero-actions">
          <button className="secondary-button" type="button" onClick={requestBack}><ArrowLeft size={15} />До списку</button>
          {policy.editable && detail.content !== null ? <button ref={editButtonRef} className="primary-button" type="button" onClick={() => { setActiveTab("instruction"); setEditing(true); setForking(false); }}><Pencil size={15} />Редагувати</button> : null}
          {!policy.editable && policy.forkable ? <button ref={forkButtonRef} className="primary-button" type="button" onClick={() => { setForking(true); setEditing(false); }}><Copy size={15} />Створити локальну копію</button> : null}
        </div>
      </section>

      {notice ? <div className="skill-save-notice" role="status"><CheckCircle2 size={16} />{notice}</div> : null}
      {editing ? <SkillEditor detail={detail} onCancel={closeEditor} onDirtyChange={setEditorDirty} onSaved={saved} /> : null}
      {forking ? <SkillForkPanel detail={detail} onCancel={closeFork} onCreated={forked} /> : null}

      {!editing && !forking ? (
        <Surface className="detail-tab-surface">
          <SurfaceTabs tabs={skillTabs} activeTab={activeTab} onTabChange={setActiveTab} ariaLabel="Розділи skill" id="skill-detail-tabs" />
          <SurfaceContent id="skill-detail-panel" labelledBy={panelLabelledBy}>
            {activeTab === "overview" ? (
              <div className="detail-section-grid">
                <section className="detail-section panel">
                  <h3>Визначення</h3>
                  <DetailList rows={[
                    ["skill_id", <code>{skill.skill_id}</code>],
                    ["Ім'я в frontmatter", skill.name],
                    ["Опис", catalogDescription(skill.skill_id, skill.description)],
                    ["Версія", skill.version],
                    ["Пакет", localizedCatalogLabel(skill.pack_id, skill.pack_id)],
                    ["Довіра", statusLabel(skill.trust_class)],
                    ["Чутливість", statusLabel(skill.sensitivity)],
                    ["Статус перевірки", <StatusPill status={skill.test_status} />],
                    ["SHA-256 джерела", <code title={skill.source_sha256}>{shortId(skill.source_sha256, 14, 10)}</code>],
                    ["Шлях джерела", <code>{policy.source_path}</code>]
                  ]} />
                </section>
                <section className="detail-section panel">
                  <h3>Зв'язки</h3>
                  {detail.related_agents.length ? <div className="related-object-list static">{detail.related_agents.map((agent) => <div key={agent.agent_id}><span><strong>{agent.name}</strong><small>{roleLabel(agent.role)} · {agent.agent_id}</small></span></div>)}</div> : <EmptyState title="Немає призначених агентів">Catalog не пов'язує цей skill із жодним AgentDefinition.</EmptyState>}
                  <h3 className="section-subheading">Workflows</h3>
                  {detail.workflows.items.length ? <div className="related-object-list static">{detail.workflows.items.map((workflow) => <div key={workflow.workflow_id}><span><strong>{workflow.name}</strong><small>{workflow.workflow_id}</small></span><StatusPill status={workflow.active ? "running" : "disabled"} /></div>)}</div> : <p className="muted-copy">Typed workflow relationships поки не оголошені; UI не видобуває їх із тексту інструкції.</p>}
                </section>
              </div>
            ) : null}

            {activeTab === "instruction" ? (
              <section className="detail-section panel skill-instruction-section">
                <header className="instruction-toolbar">
                  <div><h3>SKILL.md</h3><p>Документ відображається як inert data: HTML та embeds не виконуються.</p></div>
                  <div className="document-mode-switch" role="group" aria-label="Режим інструкції">
                    <button type="button" aria-pressed={instructionMode === "preview"} className={instructionMode === "preview" ? "active" : ""} onClick={() => setInstructionMode("preview")}><Eye size={14} />Попередній перегляд</button>
                    <button type="button" aria-pressed={instructionMode === "raw"} className={instructionMode === "raw" ? "active" : ""} onClick={() => setInstructionMode("raw")}><Code2 size={14} />Вихідний Markdown</button>
                  </div>
                </header>
                {detail.content === null ? (
                  <EmptyState title="Вміст обмежено">Sensitivity policy дозволяє показати лише безпечні метадані цього skill.</EmptyState>
                ) : instructionMode === "preview" ? <SafeMarkdown content={detail.content} /> : <pre className="skill-raw-markdown"><code>{detail.content}</code></pre>}
              </section>
            ) : null}

            {activeTab === "permissions" ? (
              <div className="detail-section-grid">
                <section className="detail-section panel">
                  <h3>Оголошені permissions</h3>
                  {skill.permissions.length ? <ul className="permission-id-list">{skill.permissions.map((permission) => <li key={permission}><code>{permission}</code></li>)}</ul> : <EmptyState title="Permissions не оголошені">Порожній список не означає необмежений доступ: діють системні boundaries та approvals.</EmptyState>}
                </section>
                <section className="detail-section panel">
                  <h3>Фактичні межі</h3>
                  <DetailList rows={[
                    ["Файлова система", boundaryValue(detail.permission_boundary.filesystem)],
                    ["Мережа та egress", boundaryValue(detail.permission_boundary.network)],
                    ["Інструменти", boundaryValue(detail.permission_boundary.tools)],
                    ["Вимоги до секретів", boundaryValue(detail.permission_boundary.secrets)],
                    ["Підтвердження", boundaryValue(detail.permission_boundary.approvals)],
                    ["Побічні ефекти", boundaryValue(detail.permission_boundary.side_effects)],
                    ["Чутливість", statusLabel(detail.permission_boundary.sensitivity)]
                  ]} />
                </section>
              </div>
            ) : null}

            {activeTab === "tools" ? (
              <section className="detail-section panel">
                <h3>Tool Hub</h3>
                {detail.tools.items.length ? <div className="tool-detail-table">{detail.tools.items.map((tool) => <div key={tool.tool_id}><code>{tool.tool_id}</code><span>{tool.provider}</span><span>{tool.access}</span><span>{tool.approval_policy}</span><StatusPill status={tool.health} /></div>)}</div> : <EmptyState title="Пов'язані tools не оголошені">Typed Tool Hub relationships відсутні. raytsystem не вгадує інструменти з команд або prose в SKILL.md.</EmptyState>}
              </section>
            ) : null}

            {activeTab === "tests" ? (
              <div className="detail-section-grid">
                <section className="detail-section panel"><h3>Перевірка</h3><DetailList rows={[["Test status", <StatusPill status={detail.tests.test_status} />], ["Остання перевірка", detail.tests.last_checked_at ?? "Немає підтвердженої перевірки"], ["Evals", detail.tests.evals.length ? detail.tests.evals.map((item) => item.eval_id).join(", ") : "Не оголошені"]]} /></section>
                <section className="detail-section panel"><h3>Команди та обмеження</h3>{detail.tests.commands.length ? <pre className="safe-source-block">{detail.tests.commands.join("\n")}</pre> : <p className="muted-copy">Перевірочна команда не оголошена typed metadata.</p>}{detail.tests.known_limitations.length ? <ul>{detail.tests.known_limitations.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="muted-copy">Known limitations не зареєстровані.</p>}</section>
              </div>
            ) : null}

            {activeTab === "history" ? (
              <section className="detail-section panel">
                <h3>Revisions та hashes</h3>
                {detail.history.revisions.length ? <div className="skill-history-list">{detail.history.revisions.map((revision) => <div className="history-row" key={revision.skill_revision_id ?? revision.record_revision}><code>{revision.skill_revision_id ?? `revision-${revision.record_revision}`}</code><StatusPill status={revision.test_status ?? revision.record_state} /><span>{revision.operation ?? "revision"} · {shortId(revision.source_sha256, 10, 7)} · {revision.changed_at ?? "час не записано"}</span></div>)}</div> : <EmptyState title="Історія поки недоступна">Для вихідного визначення немає безпечних revision records.</EmptyState>}
              </section>
            ) : null}
          </SurfaceContent>
        </Surface>
      ) : null}
      {backConfirmOpen ? (
        <Dialog className="small-modal panel" role="alertdialog" labelledBy="leave-skill-title" describedBy="leave-skill-description" closeOnBackdrop={false} initialFocus="cancel" onClose={() => setBackConfirmOpen(false)}>
          <header><div><span className="eyebrow">Незбережені зміни</span><h2 id="leave-skill-title">Повернутися до списку без збереження?</h2></div></header>
          <p id="leave-skill-description">Змінений Markdown не був записаний. Skill та його історія залишилися без змін.</p>
          <footer><button type="button" data-dialog-cancel onClick={() => setBackConfirmOpen(false)}>Продовжити редагування</button><button className="danger-button" type="button" onClick={onBack}>Повернутися без збереження</button></footer>
        </Dialog>
      ) : null}
    </div>
  );
}
