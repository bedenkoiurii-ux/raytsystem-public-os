import { ArrowRight, Ban, CircleSlash2, Columns3, MoreHorizontal, Plus, Search, X } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ApiError, formatDate, postJson, shortId } from "../api";
import { useTasks } from "../hooks";
import { localizeError, priorityLabel, taskStatusLabel } from "../presentation";
import type { AgentTask, Selection, TaskCommandResult, TaskPriority, TaskStatus } from "../types";
import { EmptyState, ErrorState, LoadingState, StatusPill } from "../components/StatePanel";
import { Dialog } from "../components/Dialog";
import { ActionMenu } from "../components/Menu";

const columns: Array<{ status: TaskStatus; label: string }> = [
  { status: "inbox", label: "Вхідні" },
  { status: "planned", label: "Заплановано" },
  { status: "ready", label: "Готово" },
  { status: "running", label: "У роботі" },
  { status: "review", label: "На перевірці" },
  { status: "blocked", label: "Заблоковано" },
  { status: "done", label: "Завершено" },
  { status: "cancelled", label: "Скасовано" }
];

const advance: Partial<Record<TaskStatus, TaskStatus>> = {
  inbox: "planned",
  planned: "ready",
  ready: "running",
  running: "review",
  review: "done",
  blocked: "planned"
};

interface TasksProps {
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
  onSelect: (selection: Selection) => void;
}

export function Tasks({ createOpen, onCreateOpenChange, onSelect }: TasksProps) {
  const tasks = useTasks();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [pendingTask, setPendingTask] = useState<string | null>(null);
  const [actionMenu, setActionMenu] = useState<string | null>(null);
  const [blocking, setBlocking] = useState<AgentTask | null>(null);
  const [cancelling, setCancelling] = useState<AgentTask | null>(null);
  const [blockedReason, setBlockedReason] = useState("");
  const [notice, setNotice] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["tasks"] }),
      queryClient.invalidateQueries({ queryKey: ["system"] }),
      queryClient.invalidateQueries({ queryKey: ["universe"] })
    ]);

  const transition = useMutation({
    mutationFn: ({ task, target, reason }: { task: AgentTask; target: TaskStatus; reason?: string }) =>
      postJson<TaskCommandResult>(
        `/api/v1/tasks/${task.task_id}/transitions`,
        {
          target,
          blocked_reason: reason ?? null,
          expected_generation_id: tasks.data?.generation_id
        },
        crypto.randomUUID()
      ),
    onMutate: ({ task }) => {
      setNotice(null);
      setPendingTask(task.task_id);
      setActionMenu(null);
    },
    onSuccess: (result) => {
      setNotice({ kind: "success", message: `Задача «${result.task.title}» переміщена в «${taskStatusLabel(result.task.status)}».` });
      setBlocking(null);
      setCancelling(null);
      setBlockedReason("");
    },
    onError: (error: unknown) => {
      setNotice({
        kind: "error",
        message: error instanceof ApiError
          ? localizeError(error.code, "Не вдалося змінити стан задачі.")
          : "Не вдалося змінити стан задачі."
      });
    },
    onSettled: () => {
      setPendingTask(null);
      void invalidate();
    }
  });

  const filtered = useMemo(
    () =>
      (tasks.data?.tasks ?? []).filter((task) =>
        `${task.title} ${task.description} ${task.tags.join(" ")} ${taskStatusLabel(task.status)} ${priorityLabel(task.priority)}`.toLowerCase().includes(query.toLowerCase())
      ),
    [query, tasks.data?.tasks]
  );

  if (tasks.isLoading) return <LoadingState label="Читаємо поточне покоління задач…" />;
  if (tasks.isError) return <ErrorState error={tasks.error} onRetry={() => void tasks.refetch()} />;

  return (
    <div className="route tasks-route">
      <div className="route-tools task-tools">
        <label className="search-field"><Search size={16} /><input aria-label="Фільтр задач за назвою, описом або тегами" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Знайти задачу, опис або тег" /></label>
        <span className="generation-badge">покоління <code>{shortId(tasks.data?.generation_id)}</code></span>
        <button className="primary-button" type="button" onClick={() => onCreateOpenChange(true)}><Plus size={16} /> Нова задача</button>
      </div>
      <div className="task-view-switch" aria-label="Представлення задач"><button className="active" aria-pressed="true" type="button"><Columns3 size={15} aria-hidden="true" /> Дошка</button></div>
      {!filtered.length ? (
        <EmptyState
          title={query ? "Задачі не знайдено" : "В операційному журналі поки немає задач"}
          action={query
            ? <button className="secondary-button" type="button" onClick={() => setQuery("")}>Скинути фільтр</button>
            : <button className="primary-button" type="button" onClick={() => onCreateOpenChange(true)}><Plus size={16} /> Створити першу задачу</button>}
        >{query ? "Змініть запит або скиньте фільтр." : "Створіть задачу, не зачіпаючи канонічні знання."}</EmptyState>
      ) : (
        <div className="kanban" aria-label="Дошка задач">
          {columns.map((column) => {
            const items = filtered.filter((task) => task.status === column.status);
            return (
              <section className={`kanban-column column-${column.status}`} key={column.status} aria-labelledby={`column-${column.status}`}>
                <header><span className="column-dot" /><h2 id={`column-${column.status}`}>{column.label}</h2><b>{items.length}</b></header>
                <div className="kanban-stack">
                  {items.map((task) => (
                    <article className={`task-card panel ${pendingTask === task.task_id ? "is-pending" : ""}`} key={task.task_id} aria-busy={pendingTask === task.task_id}>
                      {pendingTask === task.task_id ? <span className="pending-label">Зберігається…</span> : null}
                      <button
                        className="task-card-main"
                        type="button"
                        onClick={() => onSelect({
                          id: task.task_id,
                          kind: "task",
                          label: task.title,
                          status: task.status,
                          subtitle: task.description || priorityLabel(task.priority),
                          metadata: {
                            priority: priorityLabel(task.priority),
                            project: task.project_id,
                            revision: String(task.revision),
                            dependencies: task.dependency_ids.join(", ") || "none"
                          },
                          snapshotId: tasks.data?.generation_id ?? undefined
                        })}
                      >
                        <span className={`priority-label priority-${task.priority}`}>{priorityLabel(task.priority)}</span>
                        <strong>{task.title}</strong>
                        {task.description ? <p>{task.description}</p> : null}
                        <span className="task-meta"><code>{shortId(task.task_id)}</code><small>{formatDate(task.updated_at)}</small></span>
                      </button>
                      <footer>
                        <span className="assignee-stack" aria-label={`Виконавців: ${task.assignee_ids.length}`}>
                          {task.assignee_ids.length ? task.assignee_ids.slice(0, 3).map((id) => <i key={id}>{id.slice(-2).toUpperCase()}</i>) : <i>—</i>}
                        </span>
                        {advance[task.status] ? (
                          <button
                            className="advance-button"
                            type="button"
                            disabled={pendingTask === task.task_id}
                            onClick={() => transition.mutate({ task, target: advance[task.status]! })}
                            aria-label={`Перемістити задачу «${task.title}» в «${taskStatusLabel(advance[task.status]!) }»`}
                          >
                            {taskStatusLabel(advance[task.status]!)} <ArrowRight size={13} />
                          </button>
                        ) : <StatusPill status={task.status} />}
                        {!['done', 'cancelled'].includes(task.status) ? (
                          <ActionMenu
                            id={`task-menu-${task.task_id}`}
                            label={`Дії для задачі «${task.title}»`}
                            triggerLabel={`Інші дії для задачі «${task.title}»`}
                            open={actionMenu === task.task_id}
                            onOpenChange={(open) => setActionMenu(open ? task.task_id : null)}
                            trigger={<MoreHorizontal size={16} aria-hidden="true" />}
                            actions={[
                              ...(task.status !== "inbox" && task.status !== "blocked" ? [{ id: "block", label: "Заблокувати…", icon: <CircleSlash2 size={14} aria-hidden="true" />, onSelect: () => setBlocking(task) }] : []),
                              ...(task.status === "review" ? [{ id: "running", label: "Повернути в роботу", icon: <ArrowRight size={14} aria-hidden="true" />, onSelect: () => transition.mutate({ task, target: "running" }) }] : []),
                              ...(task.status === "blocked" ? [
                                { id: "ready", label: "Повернути в готові", icon: <ArrowRight size={14} aria-hidden="true" />, onSelect: () => transition.mutate({ task, target: "ready" }) },
                                { id: "resume", label: "Повернути в роботу", icon: <ArrowRight size={14} aria-hidden="true" />, onSelect: () => transition.mutate({ task, target: "running" }) }
                              ] : []),
                              { id: "cancel", label: "Скасувати…", icon: <Ban size={14} aria-hidden="true" />, destructive: true, onSelect: () => setCancelling(task) }
                            ]}
                          />
                        ) : null}
                      </footer>
                    </article>
                  ))}
                  {!items.length ? <div className="column-empty">Задач немає</div> : null}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {notice ? <div className={`task-notice notice-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"} aria-live={notice.kind === "error" ? "assertive" : "polite"}><span>{notice.message}</span><button type="button" onClick={() => setNotice(null)} aria-label="Приховати повідомлення"><X size={14} aria-hidden="true" /></button></div> : null}
      {createOpen ? <CreateTaskModal generationId={tasks.data?.generation_id ?? null} onClose={() => onCreateOpenChange(false)} onCreated={() => { onCreateOpenChange(false); void invalidate(); }} /> : null}
      {blocking ? (
        <Dialog className="small-modal panel" labelledBy="block-title" describedBy="block-description" closeOnBackdrop={false} busy={transition.isPending} onClose={() => setBlocking(null)}>
            <header><div><span className="eyebrow">Зміна стану</span><h2 id="block-title">Заблокувати задачу</h2></div><button className="icon-button" type="button" disabled={transition.isPending} onClick={() => setBlocking(null)} aria-label="Закрити вікно"><X size={18} /></button></header>
            <p id="block-description">Вкажіть конкретну причину. Історія задачі залишиться незмінною.</p>
            <label><span>Причина блокування</span><textarea name="blocked_reason" value={blockedReason} onChange={(event) => setBlockedReason(event.target.value)} autoFocus required maxLength={4096} /></label>
            <footer><button className="secondary-button" data-dialog-cancel type="button" disabled={transition.isPending} onClick={() => setBlocking(null)}>Скасувати</button><button className="danger-button" type="button" disabled={!blockedReason.trim() || transition.isPending} onClick={() => transition.mutate({ task: blocking, target: "blocked", reason: blockedReason.trim() })}><CircleSlash2 size={15} /> {transition.isPending ? "Блокуємо…" : "Заблокувати задачу"}</button></footer>
        </Dialog>
      ) : null}
      {cancelling ? (
        <Dialog className="small-modal panel" role="alertdialog" labelledBy="cancel-title" describedBy="cancel-description" closeOnBackdrop={false} initialFocus="cancel" busy={transition.isPending} onClose={() => setCancelling(null)}>
            <header><div><span className="eyebrow">Фінальний стан</span><h2 id="cancel-title">Скасувати задачу?</h2></div><button className="icon-button" type="button" disabled={transition.isPending} onClick={() => setCancelling(null)} aria-label="Закрити вікно"><X size={18} /></button></header>
            <p id="cancel-description">Задача <strong>«{cancelling.title}»</strong> перейде у фінальний стан. Її незмінна історія залишиться доступною.</p>
            <footer><button className="secondary-button" data-dialog-cancel type="button" disabled={transition.isPending} onClick={() => setCancelling(null)}>Залишити задачу</button><button className="danger-button" type="button" disabled={transition.isPending} onClick={() => transition.mutate({ task: cancelling, target: "cancelled" })}><Ban size={15} /> {transition.isPending ? "Скасовуємо…" : "Скасувати задачу"}</button></footer>
        </Dialog>
      ) : null}
    </div>
  );
}

function CreateTaskModal({ generationId, onClose, onCreated }: { generationId: string | null; onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [error, setError] = useState("");
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const create = useMutation({
    mutationFn: () =>
      postJson<TaskCommandResult>("/api/v1/tasks", {
        title,
        description,
        priority,
        expected_generation_id: generationId
      }),
    onSuccess: onCreated,
    onError: (reason: unknown) => setError(
      reason instanceof ApiError ? localizeError(reason.code, "Не вдалося створити задачу.") : "Не вдалося створити задачу."
    )
  });
  const dirty = Boolean(title || description || priority !== "normal");
  const requestClose = () => {
    if (create.isPending) return;
    if (dirty) setDiscardConfirm(true);
    else onClose();
  };
  return (
    <>
      <Dialog className="task-create-modal panel" labelledBy="create-task-title" describedBy="create-task-boundary" busy={create.isPending} onClose={requestClose}>
        <header><div><span className="eyebrow">Операційний журнал</span><h2 id="create-task-title">Створити задачу</h2></div><button className="icon-button" type="button" disabled={create.isPending} onClick={requestClose} aria-label="Закрити вікно"><X size={19} /></button></header>
        <div className="modal-boundary" id="create-task-boundary"><span /> Зміниться лише стан задач. Канонічні знання залишаться недоторканими.</div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <form onSubmit={(event) => { event.preventDefault(); setError(""); create.mutate(); }}>
          <label><span>Назва</span><input name="title" value={title} onChange={(event) => setTitle(event.target.value)} autoFocus required maxLength={4096} placeholder="Конкретний очікуваний результат" /></label>
          <label><span>Опис <small>необов'язково</small></span><textarea name="description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={32768} placeholder="Контекст, обмеження та критерії готовності" /></label>
          <label><span>Пріоритет</span><select name="priority" value={priority} onChange={(event) => setPriority(event.target.value as TaskPriority)}><option value="low">Низький</option><option value="normal">Звичайний</option><option value="high">Високий</option><option value="urgent">Терміновий</option></select></label>
          <div className="generation-line"><span>Очікуване покоління</span><code>{shortId(generationId, 11, 7)}</code></div>
          <footer><button className="secondary-button" data-dialog-cancel type="button" disabled={create.isPending} onClick={requestClose}>Скасувати</button><button className="primary-button" type="submit" disabled={!title.trim() || create.isPending}>{create.isPending ? "Зберігається…" : "Створити задачу"}<ArrowRight size={15} /></button></footer>
        </form>
      </Dialog>
      {discardConfirm ? (
        <Dialog className="small-modal panel" role="alertdialog" labelledBy="discard-task-title" describedBy="discard-task-description" closeOnBackdrop={false} initialFocus="cancel" onClose={() => setDiscardConfirm(false)}>
          <header><div><span className="eyebrow">Незбережені дані</span><h2 id="discard-task-title">Закрити без збереження?</h2></div></header>
          <p id="discard-task-description">Назва і опис нової задачі будуть втрачені. Операційний журнал ще не змінено.</p>
          <footer><button type="button" data-dialog-cancel onClick={() => setDiscardConfirm(false)}>Продовжити редагування</button><button className="danger-button" type="button" onClick={onClose}>Закрити без збереження</button></footer>
        </Dialog>
      ) : null}
    </>
  );
}
