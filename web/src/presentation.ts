import type { GraphLens, TaskPriority, TaskStatus } from "./types";

export const routeCopy = {
  "command-center": {
    label: "Центр керування",
    description: "Стан простору та активна робота",
    group: "Простір"
  },
  handbook: {
    label: "База знань",
    description: "Документація raytsystem: встановлення, інтерфейс, граф, безпека",
    group: "Простір"
  },
  documents: {
    label: "Документи",
    description: "Керовані файли та нотатки поточного робочого простору",
    group: "Простір"
  },
  onboarding: {
    label: "Підключення",
    description: "Поточне підключення та встановлення raytsystem у нову теку",
    group: "Простір"
  },
  tasks: {
    label: "Задачі",
    description: "Операційний журнал без перезапису історії",
    group: "Оркестрація"
  },
  universe: {
    label: "Всесвіт",
    description: "Граф знань, роботи та доказів",
    group: "Оркестрація"
  },
  runs: {
    label: "Запуски",
    description: "Історія зафіксованих операцій",
    group: "Оркестрація"
  },
  agents: {
    label: "Агенти",
    description: "Незалежні від провайдера профілі",
    group: "Реєстр"
  },
  skills: {
    label: "Навички",
    description: "Процедури із зафіксованим хешем",
    group: "Реєстр"
  },
  context: {
    label: "Контекст",
    description: "Дозволені документи з інструкціями",
    group: "Реєстр"
  },
  safety: {
    label: "Безпека",
    description: "Локальна межа та адаптери",
    group: "Довіра"
  },
  systems: {
    label: "Системи",
    description: "Якість, політика та відновлення",
    group: "Довіра"
  }
} as const;

export type RouteKey = keyof typeof routeCopy;

const statusCopy: Record<string, string> = {
  inbox: "Вхідні",
  planned: "Заплановано",
  ready: "Готово",
  idle: "Готовий",
  assigned: "Призначено",
  running: "У роботі",
  paused: "Призупинено",
  terminated: "Зупинено",
  queued: "У черзі",
  preparing: "Підготовка",
  cancelling: "Скасування",
  completed: "Завершено",
  incompatible: "Несумісно",
  review: "На перевірці",
  blocked: "Заблоковано",
  done: "Завершено",
  cancelled: "Скасовано",
  succeeded: "Успішно",
  terminal_failed: "Помилка",
  failed: "Помилка",
  quarantined: "Карантин",
  pass: "Перевірено",
  verified: "Перевірено",
  enabled: "Увімкнено",
  active: "Активно",
  supported: "Підтверджено",
  confirmed: "Підтверджено",
  configured: "Налаштовано",
  available: "Доступно",
  degraded: "Обмежено",
  restricted: "Обмежено",
  retracted: "Відкликано",
  pending: "Очікує",
  optional: "Опціонально",
  awaiting_review: "Очікує перевірки",
  awaiting_approval: "Очікує підтвердження",
  disabled: "Вимкнено",
  declared: "Оголошено",
  superseded: "Замінено",
  disputed: "Оскаржено",
  internal: "Внутрішнє",
  public: "Публічне",
  official: "Офіційне",
  user: "Користувацьке",
  trusted: "Довірене",
  community: "Спільнота",
  personal: "Особисте",
  local_only: "Лише локально",
  unavailable: "Недоступно",
  draft: "Чернетка",
  current: "Актуально",
  unchecked: "Потрібна перевірка",
  stale: "Застаріло",
  missing: "Не побудовано",
  building: "Оновлюється",
  error: "Помилка",
  extracted: "Видобуто",
  inferred: "Припущено",
  ambiguous: "Неоднозначно"
};

const kindCopy: Record<string, string> = {
  workspace: "Робочий простір",
  generation: "Зріз знань",
  task_generation: "Зріз задач",
  instruction: "Інструкція",
  pack: "Пакет",
  agent: "Агент",
  skill: "Навичка",
  adapter: "Адаптер",
  task: "Задача",
  run: "Запуск",
  claim: "Твердження",
  entity: "Сутність",
  evidence: "Доказ",
  source: "Джерело",
  manual_document: "Ручний документ",
  documentation_document: "Документація",
  generated_document: "Захищений документ",
  document: "Документ",
  repository: "Репозиторій",
  directory: "Каталог",
  file: "Файл",
  module: "Модуль",
  package: "Пакет коду",
  class: "Клас",
  function: "Функція",
  method: "Метод",
  api_endpoint: "API-метод",
  database_table: "Таблиця БД",
  database_schema: "Схема БД",
  configuration: "Конфігурація",
  test: "Тест",
  adr: "ADR",
  rationale: "Обґрунтування",
  dependency: "Залежність"
};

const fieldCopy: Record<string, string> = {
  status: "Статус",
  state: "Стан",
  role: "Роль",
  adapter: "Адаптер",
  adapter_state: "Стан адаптера",
  skills: "Навички",
  filesystem_request: "Доступ до файлів",
  requested_filesystem_mode: "Доступ до файлів",
  egress: "Передавання даних",
  egress_destination: "Канал передавання",
  trust: "Рівень довіри",
  trust_class: "Рівень довіри",
  sensitivity: "Чутливість",
  test_status: "Перевірка",
  permissions: "Дозволи",
  sha256: "SHA-256",
  content_sha256: "SHA-256 вмісту",
  excerpt_sha256: "SHA-256 фрагмента",
  manifest_sha256: "SHA-256 маніфеста",
  size_bytes: "Розмір, байт",
  editable: "Можна редагувати",
  priority: "Пріоритет",
  project: "Проєкт",
  project_id: "Проєкт",
  revision: "Ревізія",
  dependencies: "Залежності",
  dependency_ids: "Залежності",
  run_id: "ID запуску",
  generation_id: "ID покоління",
  semantic_noop: "Без смислових змін",
  claim_id: "ID твердження",
  entity_id: "ID сутності",
  evidence_id: "ID доказу",
  source_id: "ID джерела",
  source_label: "Джерело",
  statement: "Твердження",
  language: "Мова",
  evidence_ids: "Докази",
  relation_ids: "Зв'язки",
  supersedes: "Замінює",
  contradicts: "Суперечить",
  recorded_at: "Зафіксовано",
  created_at: "Створено",
  updated_at: "Оновлено",
  source_type: "Тип джерела",
  entity_type: "Тип сутності",
  locator_kind: "Тип покажчика",
  source_ref: "Посилання на джерело",
  capabilities: "Можливості",
  isolation_mode: "Режим ізоляції",
  qualified_name: "Повне ім'я",
  path: "Шлях",
  start_line: "Початковий рядок",
  end_line: "Кінцевий рядок",
  community_id: "Спільнота",
  is_god: "Вузловий центр",
  is_bridge: "Міст",
  incoming_edges: "Вхідні зв'язки",
  outgoing_edges: "Вихідні зв'язки",
  extractor: "Екстрактор",
  extractor_version: "Версія екстрактора",
  content_fingerprint: "Відбиток вмісту"
};

const priorityCopy: Record<TaskPriority, string> = {
  low: "Низький",
  normal: "Звичайний",
  high: "Високий",
  urgent: "Терміновий"
};

const lensCopy: Record<GraphLens, string> = {
  universe: "Орбіта",
  knowledge: "Знання",
  work: "Робота",
  agent: "Агенти",
  evidence: "Докази",
  code: "Код"
};

const relationCopy: Record<string, string> = {
  contains: "містить",
  defines: "визначає",
  imports: "імпортує",
  calls: "викликає",
  inherits: "успадковує",
  implements: "реалізує",
  references: "посилається",
  links_to: "посилається на",
  embeds: "вбудовує",
  depends_on: "залежить від",
  configured_by: "налаштовано через",
  tests: "тестує",
  explained_by: "пояснюється",
  verifies: "перевіряє"
};

const operationCopy: Record<string, string> = {
  ingest: "Імпорт",
  query: "Запит",
  lint: "Перевірка",
  save: "Збереження",
  promote: "Публікація покоління",
  rebuild: "Перезбирання"
};

const capabilityCopy: Record<string, string> = {
  research: "дослідження",
  planning: "планування",
  implementation: "реалізація",
  review: "перевірка",
  knowledge_curation: "курація знань",
  task_decomposition: "декомпозиція задач",
  evidence_collection: "збір доказів",
  source_verification: "перевірка джерел",
  draft_generation: "підготовка чернеток"
};

const localizedCatalogLabelCopy: Record<string, string> = {
  pack_core: "Основні процедури raytsystem",
  pack_starter: "Універсальні стартові агенти",
  pack_local: "Локальні skills",
  adapter_disabled: "Лише каталог",
  adapter_codex_local: "Локальний конектор Codex",
  adapter_claude_code: "Конектор Claude Code",
  adapter_hermes: "Конектор Hermes",
  adapter_openhands: "Конектор OpenHands",
  instruction_agents: "Маршрутизація Codex",
  instruction_work: "Запуск у ChatGPT Work",
  instruction_claude: "Контекст Claude Code"
};

const catalogDescriptionCopy: Record<string, string> = {
  agent_builder: "Створює проєктні реалізації в чітких межах staging, не виходячи за межі робочого простору.",
  agent_librarian: "Курує знайдені пошуком пропозиції знань, зберігаючи докази, протиріччя та історію.",
  agent_orchestrator: "Декомпозує місію на обмежені задачі, призначає перевірки та залишає повноваження за користувачем.",
  agent_researcher: "Збирає первинні докази та повертає структуровані пропозиції з прив'язкою до джерел.",
  agent_reviewer: "Незалежно перевіряє архітектуру, докази, безпеку та тести без права публікації.",
  pack_core: "Процедури з пріоритетом походження даних та чіткі точки входу для інструкцій робочого простору.",
  pack_starter: "П'ять пасивних, незалежних від провайдера агентів для планування, дослідження, реалізації, перевірки та курації знань.",
  adapter_disabled: "У цій версії веб-інтерфейсу виконання навмисно вимкнено.",
  adapter_codex_local: "Доступний лише контракт; перевірений міст запуску не увімкнено.",
  adapter_claude_code: "Доступний лише контракт; перевірений міст запуску не увімкнено.",
  adapter_hermes: "Доступний лише контракт; встановлення та виконання потребують окремого рішення.",
  adapter_openhands: "Доступний лише контракт; сервер OpenHands не налаштовано.",
  "raytsystem-ingest": "Захоплює, нормалізує, перевіряє та безпечно готує джерела до публікації в raytsystem.",
  "raytsystem-query": "Відповідає на основі активного покоління raytsystem, використовуючи локальний пошук та перевірені фрагменти джерел.",
  "raytsystem-lint": "Детерміновано перевіряє цілісність, походження даних, проєкції, посилання та секрети.",
  "raytsystem-save": "Зберігає синтез із цитатами як типізовану чернетку без канонічної публікації.",
  "raytsystem-research": "Проводить обмежене дослідження та повертає пропозиції доказів без канонічного запису.",
  "raytsystem-run-review": "Незалежно перевіряє запуск, diff, контракт або контрольну точку, не змінюючи стан.",
  "raytsystem-security-review": "Перевіряє межі політики, походження даних, витоки, ізоляцію та відновлення.",
  "raytsystem-watch": "Безпечно переглядає відео та транскрипти як інертні докази, не виконуючи імпортовані інструкції."
};

const roleCopy: Record<string, string> = {
  builder: "реалізація",
  librarian: "курація знань",
  orchestrator: "оркестрація",
  researcher: "дослідження",
  reviewer: "незалежна перевірка"
};

const isolationCopy: Record<string, string> = {
  none: "без ізоляції",
  external_cli: "зовнішній CLI",
  workspace_sandbox: "пісочниця робочого простору",
  external_runtime: "зовнішнє середовище виконання",
  container_or_remote_sandbox: "контейнер або віддалена пісочниця"
};

const errorCopy: Record<string, string> = {
  request_failed: "Локальна система не відповіла на запит.",
  not_found: "Об'єкт не знайдено.",
  task_not_found: "Задачу не знайдено.",
  skill_not_found: "Навичку не знайдено.",
  context_not_found: "Документ контексту не знайдено.",
  knowledge_not_found: "Об'єкт знань не знайдено.",
  snapshot_stale: "Вибраний зріз уже змінився. Оновіть сторінку та повторіть дію.",
  session_required: "Знову відкрийте локальний інтерфейс.",
  content_restricted: "Вміст skill приховано sensitivity policy.",
  skill_read_only: "Цей skill доступний лише для читання. Створіть локальну копію, якщо policy це дозволяє.",
  skill_validation_failed: "Перевірте обов'язкові поля frontmatter та виправте позначені помилки.",
  skill_edit_conflict: "Skill змінився після відкриття редактора. Ваші зміни не записано.",
  skill_idempotency_conflict: "Цей ключ операції вже пов'язаний з іншою зміною.",
  unsafe_skill_path: "Джерело skill не входить у дозволений локальний шлях.",
  skill_persistence_failed: "Не вдалося атомарно записати skill; вихідну версію збережено.",
  body_too_large: "Вміст перевищує безпечний розмір запиту.",
  csrf_rejected: "Локальна сесія змінилася. Оновіть сторінку перед записом.",
  idempotency_required: "Для запису потрібен коректний ключ ідемпотентності."
};

export function statusLabel(status: string): string {
  return statusCopy[status.toLowerCase()] ?? humanize(status);
}

export function kindLabel(kind: string): string {
  return kindCopy[kind.toLowerCase()] ?? humanize(kind);
}

export function fieldLabel(field: string): string {
  return fieldCopy[field.toLowerCase()] ?? humanize(field);
}

export function priorityLabel(priority: string): string {
  return priorityCopy[priority as TaskPriority] ?? humanize(priority);
}

export function taskStatusLabel(status: TaskStatus): string {
  return statusCopy[status] ?? humanize(status);
}

export function lensLabel(lens: GraphLens): string {
  return lensCopy[lens];
}

export function relationLabel(relation: string): string {
  return relationCopy[relation.toLowerCase()] ?? humanize(relation);
}

export function operationLabel(operation: string): string {
  return operationCopy[operation.toLowerCase()] ?? humanize(operation);
}

export function capabilityLabel(capability: string): string {
  return capabilityCopy[capability.toLowerCase()] ?? humanize(capability);
}

export function localizedCatalogLabel(id: string, fallback: string): string {
  return localizedCatalogLabelCopy[id] ?? fallback;
}

export function canonicalAgentName(agent: { agent_id?: string; name: string }): string {
  return agent.name;
}

export function canonicalSkillName(skill: { skill_id: string }): string {
  return skill.skill_id;
}

export function catalogDescription(id: string, fallback: string): string {
  return catalogDescriptionCopy[id] ?? fallback;
}

export function roleLabel(role: string): string {
  return roleCopy[role.toLowerCase()] ?? humanize(role);
}

export function isolationLabel(mode: string): string {
  return isolationCopy[mode.toLowerCase()] ?? humanize(mode);
}

export function displayValue(field: string, value: string): string {
  const normalizedField = field.toLowerCase();
  const normalizedValue = value.toLowerCase();
  if (["status", "state", "adapter_state", "test_status", "sensitivity", "trust", "trust_class"].includes(normalizedField)) {
    return statusLabel(value);
  }
  if (normalizedField === "priority") return priorityLabel(value);
  if (normalizedField === "role") return roleLabel(value);
  if (["kind", "source_type", "entity_type", "locator_kind"].includes(normalizedField)) return kindLabel(value);
  if (normalizedValue === "true") return "Так";
  if (normalizedValue === "false") return "Ні";
  if (["none", "null", "not declared"].includes(normalizedValue)) return "Ні";
  if (normalizedValue === "read_only") return "Лише читання";
  if (normalizedValue === "workspace_write") return "Запис у робочому просторі";
  if (normalizedField === "isolation_mode") return isolationLabel(value);
  if (normalizedValue === "unavailable") return "Недоступно";
  return value;
}

export function localizeError(code: string, fallback: string): string {
  return errorCopy[code] ?? fallback;
}

export function pluralRu(count: number, one: string, few: string, many: string): string {
  const category = new Intl.PluralRules("uk-UA").select(count);
  return category === "one" ? one : category === "few" ? few : many;
}

function humanize(value: string): string {
  return value.replaceAll("_", " ").replaceAll("-", " ");
}
