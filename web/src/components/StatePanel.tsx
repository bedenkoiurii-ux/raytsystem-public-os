import { AlertTriangle, LoaderCircle, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import { ApiError } from "../api";
import { localizeError, statusLabel } from "../presentation";

export function LoadingState({ label = "Читаємо перевірений локальний стан…" }: { label?: string }) {
  return (
    <div className="state-panel state-loading" role="status">
      <LoaderCircle size={20} className="spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message =
    error instanceof ApiError
      ? localizeError(error.code, "Локальний стан недоступний. Оновіть сторінку та повторіть спробу.")
      : "Перевірений локальний стан недоступний. Запустіть перевірку цілісності та повторіть спробу.";
  return (
    <div className="state-panel state-error" role="alert">
      <AlertTriangle size={21} aria-hidden="true" />
      <div>
        <strong>Зріз недоступний</strong>
        <p>{message}</p>
      </div>
      {onRetry ? (
        <button className="text-button" type="button" onClick={onRetry}>
          <RotateCcw size={15} aria-hidden="true" /> Повторити
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-orbit" aria-hidden="true" />
      <strong>{title}</strong>
      <p>{children}</p>
      {action}
    </div>
  );
}

export function StatusPill({ status, label }: { status: string; label?: string }) {
  return (
    <span className={`status-pill status-${status.replaceAll("_", "-")}`}>
      <span className="status-shape" aria-hidden="true" />
      {label ?? statusLabel(status)}
    </span>
  );
}
