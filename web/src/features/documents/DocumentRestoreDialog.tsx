import { RotateCcw, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { Dialog } from "../../components/Dialog";
import type { DocumentHistoryEntry, DocumentRestorePreviewEnvelope } from "./documentTypes";
import { DocumentDiff } from "./DocumentDiff";

interface DocumentRestoreDialogProps {
  revision: DocumentHistoryEntry;
  preview: DocumentRestorePreviewEnvelope;
  fallbackCurrentContent: string;
  pending: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DocumentRestoreDialog({
  revision,
  preview,
  fallbackCurrentContent,
  pending,
  error,
  onCancel,
  onConfirm
}: DocumentRestoreDialogProps) {
  const [confirmed, setConfirmed] = useState(false);
  const sourceAvailable = typeof preview.restored_content === "string";
  const currentContent = preview.current_content ?? fallbackCurrentContent;

  return (
      <Dialog className="doc-restore-dialog" backdropClassName="doc-modal-backdrop" role="alertdialog" labelledBy="doc-restore-title" describedBy="doc-restore-description" closeOnBackdrop={false} initialFocus="cancel" busy={pending} onClose={onCancel}>
        <header><span><RotateCcw size={19} aria-hidden="true" /></span><div><small>Окрема audited операція</small><h2 id="doc-restore-title">Попередній перегляд відновлення</h2></div><button type="button" onClick={onCancel} disabled={pending} aria-label="Закрити"><X size={18} /></button></header>
        <p id="doc-restore-description">Версія {revision.history_id.slice(0, 16)} не буде застосована, поки ви явно не підтвердите відновлення. Git commit автоматично не створюється.</p>
        <div className="doc-conflict-hashes"><code>зараз {preview.current_sha256.slice(0, 12)}</code><code>після {preview.restored_sha256.slice(0, 12)}</code><code>preview {preview.preview_token.slice(0, 12)}</code></div>
        {sourceAvailable ? <DocumentDiff original={currentContent} current={preview.restored_content ?? ""} /> : <div className="doc-visual-unavailable" role="alert"><strong>Відновлення недоступне</strong><p>Revision source не розкрив вміст. raytsystem закриває операцію без запису.</p></div>}
        {sourceAvailable ? <label className="doc-restore-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span><ShieldCheck size={16} aria-hidden="true" />Я перевірив diff і підтверджую атомарний запис старої версії поверх поточної.</span></label> : null}
        {error ? <p className="doc-form-error" role="alert">{error}</p> : null}
        <footer><button type="button" data-dialog-cancel onClick={onCancel} disabled={pending}>Скасувати</button><button type="button" className="primary" disabled={!sourceAvailable || !confirmed || pending} onClick={onConfirm}>{pending ? "Відновлюємо…" : "Підтвердити відновлення"}</button></footer>
      </Dialog>
  );
}
