import {
  AlertOctagon,
  AlertTriangle,
  CircleCheck,
  CircleDashed,
  Clock3,
  LockKeyhole,
  ShieldQuestion,
  WifiOff
} from "lucide-react";
import type { ReactNode } from "react";
import type { OperationalState } from "../featureTypes";
import { StatusPill } from "./StatePanel";

const stateCopy: Record<string, { title: string; detail: string; icon: typeof AlertTriangle }> = {
  empty: {
    title: "Поки немає записів",
    detail: "Система готова і покаже тут перший підтверджений запис.",
    icon: CircleDashed
  },
  disabled: {
    title: "Функцію вимкнено",
    detail: "Вона залишиться недоступною, поки не буде явно увімкнена в локальній конфігурації.",
    icon: LockKeyhole
  },
  unavailable: {
    title: "Локальне джерело недоступне",
    detail: "Ініціалізуйте операційне сховище або виконайте перевірку стану.",
    icon: WifiOff
  },
  stale: {
    title: "Зріз застарів",
    detail: "Оновіть дані перед будь-якою дією — запис за старим зрізом буде відхилено.",
    icon: Clock3
  },
  degraded: {
    title: "Робота обмежена",
    detail: "Частина локальних можливостей недоступна; безпечні дані нижче лишаються доступними.",
    icon: AlertTriangle
  },
  blocked: {
    title: "Операції заблоковано",
    detail: "Політика або аварійний контур заборонили виконання. Причина збережена в аудиті.",
    icon: AlertOctagon
  },
  approval_required: {
    title: "Потрібне підтвердження",
    detail: "Дія не почнеться, поки не з'явиться нове підтвердження з відповідною областю.",
    icon: ShieldQuestion
  },
  error: {
    title: "Система повідомила про помилку",
    detail: "Стан збережено без спроби приховати збій. Перевірте журнал і повторіть безпечну операцію.",
    icon: AlertTriangle
  },
  success: {
    title: "Операцію підтверджено",
    detail: "Результат зафіксовано в локальному журналі.",
    icon: CircleCheck
  }
};

export function OperationalNotice({ state }: { state: OperationalState }) {
  const normalized = state === "catalog_only" ? "degraded" : state;
  if (normalized === "ready") return null;
  const copy = stateCopy[normalized] ?? stateCopy.degraded;
  const Icon = copy.icon;
  return (
    <aside className={`systems-notice systems-notice-${normalized}`} role={normalized === "error" || normalized === "blocked" ? "alert" : "status"}>
      <Icon size={19} aria-hidden="true" />
      <span><strong>{copy.title}</strong><small>{copy.detail}</small></span>
      <StatusPill status={state} />
    </aside>
  );
}

export function ActionBoundary({
  scope,
  effect,
  approval,
  recovery,
  children
}: {
  scope: string;
  effect: string;
  approval: string;
  recovery: string;
  children?: ReactNode;
}) {
  return (
    <div className="action-boundary">
      <dl>
        <div><dt>Область</dt><dd>{scope}</dd></div>
        <div><dt>Очікуваний ефект</dt><dd>{effect}</dd></div>
        <div><dt>Підтвердження</dt><dd>{approval}</dd></div>
        <div><dt>Відновлення</dt><dd>{recovery}</dd></div>
      </dl>
      {children}
    </div>
  );
}
