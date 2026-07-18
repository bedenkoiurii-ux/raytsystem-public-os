import { AlertTriangle, X } from "lucide-react";
import { useState } from "react";
import { Dialog } from "../../components/Dialog";
import type { DocumentConflictDetails } from "./documentTypes";
import { DocumentDiff } from "./DocumentDiff";

interface DocumentConflictDialogProps {
  conflict: DocumentConflictDetails;
  baseContent: string;
  draftContent: string;
  onCancel: () => void;
  onResolve: (content: string, currentSha256: string, snapshotId: string) => void;
}

export function DocumentConflictDialog({ conflict, baseContent, draftContent, onCancel, onResolve }: DocumentConflictDialogProps) {
  const [merged, setMerged] = useState(draftContent);
  const [manual, setManual] = useState(false);
  const diskContentAvailable = typeof conflict.current_content === "string";
  const proposedHash = conflict.proposed_sha256?.slice(0, 12) ?? "не надано";

  return (
      <Dialog className="doc-conflict-dialog" backdropClassName="doc-modal-backdrop" labelledBy="doc-conflict-title" describedBy="doc-conflict-description" closeOnBackdrop={false} initialFocus="cancel" onClose={onCancel}>
        <header>
          <span className="doc-conflict-icon"><AlertTriangle size={20} aria-hidden="true" /></span>
          <div><span>Безпечний запис зупинено</span><h2 id="doc-conflict-title">Документ змінився на диску</h2></div>
          <button type="button" aria-label="Закрити конфлікт" onClick={onCancel}><X size={18} /></button>
        </header>
        <p id="doc-conflict-description">raytsystem не перезаписав нову версію. Порівняйте вихідник при відкритті, поточний стан диска та свою чернетку.</p>
        <div className="doc-conflict-hashes"><code>відкрито {conflict.expected_sha256.slice(0, 12)}</code><code>диск {conflict.current_sha256.slice(0, 12)}</code><code>чернетка {proposedHash}</code></div>
        <DocumentDiff original={baseContent} disk={conflict.current_content ?? null} current={draftContent} />
        {manual ? (
          <label className="doc-manual-merge"><span>Підсумковий Markdown після ручного merge</span><textarea autoFocus value={merged} onChange={(event) => setMerged(event.target.value)} spellCheck={false} /></label>
        ) : null}
        {!diskContentAvailable ? <p className="doc-conflict-note" role="status">Поточний текст прихований disclosure policy. Оновіть документ і перенесіть зміни вручну в Source mode.</p> : null}
        <footer>
          <button type="button" data-dialog-cancel onClick={onCancel}>Залишити чернетку</button>
          <button type="button" onClick={() => setManual(true)} disabled={!diskContentAvailable}>Ручний merge</button>
          <button type="button" className="primary" disabled={!diskContentAvailable || !manual || merged === conflict.current_content} onClick={() => onResolve(merged, conflict.current_sha256, conflict.snapshot_id)}>Зберегти підсумок</button>
        </footer>
      </Dialog>
  );
}
