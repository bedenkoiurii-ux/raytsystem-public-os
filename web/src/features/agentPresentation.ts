import type { AgentReadiness } from "../executionTypes";

const reasonCopy: Record<string, string> = {
  digital_employees_disabled: "Цифрові співробітники вимкнені",
  runtime_execution_disabled: "Виконання вимкнено",
  runtime_adapter_disabled: "Адаптер вимкнено",
  catalog_definition_disabled: "Визначення не активовано",
  execution_store_uninitialized: "Runtime не налаштований",
  operational_record_missing: "Лише каталог",
  configuration_revision_changed: "Конфігурація змінилася",
  definition_missing: "Визначення агента відсутнє",
  duplicate_execution_records: "Знайдено конфліктуючі execution records",
  employee_identity_mismatch: "Execution identity не збігається з визначенням",
  persisted_operational_state: "Операційний стан доступний"
};

const readinessCopy: Record<AgentReadiness, string> = {
  ready: "Готовий",
  disabled: "Вимкнено",
  catalog_only: "Лише каталог",
  running: "Виконує завдання",
  requires_configuration: "Потребує налаштування",
  degraded: "Порушена цілісність"
};

const boundaryCopy: Record<string, string> = {
  canonical_knowledge_write: "Запис у канонічні знання",
  external_side_effects: "Зовнішні побічні ефекти",
  runtime_output_is_untrusted: "Runtime output вважається недовіреним"
};

const limitationCopy: Record<string, string> = {
  catalog_definition_is_inert: "Визначення каталогу інертне і саме по собі не виконується",
  sensitive_runtime_fields_are_omitted: "Чутливі runtime-поля приховані з проекції"
};

const valueCopy: Record<string, string> = {
  approval_required: "Потребує підтвердження",
  allow: "Дозволено",
  allowed: "Дозволено",
  deny: "Заборонено",
  denied: "Заборонено",
  read: "Читання",
  write: "Запис",
  read_write: "Читання і запис",
  none: "Немає",
  block_new: "Блокувати нові запуски",
  cancel_active: "Скасовувати активні запуски",
  external_send: "Зовнішнє надсилання",
  filesystem_write: "Запис у файлову систему",
  git_write: "Запис у Git",
  network_egress: "Зовнішній мережевий доступ",
  tool_use: "Використання інструмента",
  workspace_read: "Читання workspace",
  staged_write: "Запис у staged-область",
  agent_configuration_changed: "Конфігурація агента змінена",
  assignment_created: "Призначення створено",
  run_started: "Запуск розпочато",
  run_completed: "Запуск завершено"
};

function humanize(value: string): string {
  const normalized = value.replaceAll("_", " ").trim();
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : "Не вказано";
}

export function agentReasonLabel(reason: string): string {
  return reasonCopy[reason] ?? humanize(reason);
}

export function agentReadinessLabel(readiness: AgentReadiness): string {
  return readinessCopy[readiness];
}

export function filesystemModeLabel(mode: string): string {
  if (mode === "task_worktree") return "ізольований worktree";
  if (mode === "workspace_root_readonly") return "корінь лише для читання";
  if (mode === "approved_external_root") return "схвалений зовнішній корінь";
  if (mode === "read_only") return "лише читання";
  if (mode === "staging_only") return "лише staged-зміни";
  if (mode === "none") return "без доступу";
  return humanize(mode);
}

export function booleanLabel(value: boolean): string {
  return value ? "Так" : "Ні";
}

export function boundaryLabel(boundary: string): string {
  return boundaryCopy[boundary] ?? humanize(boundary);
}

export function safeValueLabel(value: boolean | string): string {
  if (typeof value === "boolean") return value ? "Дозволено" : "Заборонено";
  return valueCopy[value.toLowerCase()] ?? humanize(value);
}

export function limitationLabel(limitation: string): string {
  return limitationCopy[limitation] ?? humanize(limitation);
}

export function accessValueLabel(value: string): string {
  return valueCopy[value.toLowerCase()] ?? humanize(value);
}

export function activityLabel(value: string): string {
  return valueCopy[value.toLowerCase()] ?? humanize(value);
}
