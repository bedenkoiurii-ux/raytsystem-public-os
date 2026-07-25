import { ArrowLeft, ArrowRight, ExternalLink, X } from "lucide-react";
import { EmptyState, ErrorState, LoadingState } from "../../components/StatePanel";
import { useDocumentDetail, useDocumentLinks } from "./documentHooks";
import { matchingDocumentLink } from "./Documents";
import { SafeMarkdownView, type WikilinkTarget } from "./SafeMarkdownView";

interface DocumentPeekProps {
  documentId: string;
  heading?: string;
  index: number;
  snapshotId: string | null;
  showNav?: boolean;
  canBack?: boolean;
  canForward?: boolean;
  onBack?: () => void;
  onForward?: () => void;
  onClose: () => void;
  onOpenFull: (documentId: string, heading?: string) => void;
  onOpenLink: (index: number, documentId: string, heading?: string) => void;
  /** Світлий «аркуш» — той самий режим, що й в основному полі: картка не має
      бути темною поруч зі світлим документом. */
  sheetLight?: boolean;
  sheetTone?: string;
}

// Каскадна картка-колонка. Клік по вікілінку ВСЕРЕДИНІ додає наступну колонку праворуч (onOpenLink),
// тож сторінка → картка 1 → картка 2 → … Стрілки ←/→ згортають/розгортають каскад (повернутися до
// попередніх карток аж до першої). Кожна картка сама фетчить свій документ — незалежна.
export function DocumentPeek({ documentId, heading, index, snapshotId, showNav = false, canBack = false, canForward = false, onBack, onForward, onClose, onOpenFull, onOpenLink, sheetLight = false, sheetTone }: DocumentPeekProps) {
  const detail = useDocumentDetail(documentId, snapshotId);
  const links = useDocumentLinks(documentId, snapshotId);
  const doc = detail.data;

  const resolve = (target: WikilinkTarget) => {
    const match = matchingDocumentLink(target, links.data?.items ?? []);
    const id = match?.target_document_id ?? (match?.candidates?.length === 1 ? match.candidates[0].document_id : null);
    if (id) onOpenLink(index, id, target.heading ?? match?.heading ?? undefined);
  };

  return (
    <aside className={`doc-peek${sheetLight ? " sheet-light" : ""}`} data-sheet-tone={sheetLight ? sheetTone : undefined} aria-label={`Картка ${index + 1}`}>
      <header className="doc-peek-head">
        {showNav ? (
          <div className="doc-peek-nav" role="group" aria-label="Навігація в картці">
            <button type="button" className="icon-button" onClick={onBack} disabled={!canBack} aria-label="Назад" title="Назад по історії картки"><ArrowLeft size={15} /></button>
            <button type="button" className="icon-button" onClick={onForward} disabled={!canForward} aria-label="Вперед" title="Вперед по історії картки"><ArrowRight size={15} /></button>
          </div>
        ) : null}
        <div className="doc-peek-titles">
          <span className="eyebrow">Картка {index + 1}</span>
          <strong>{doc?.document.title || doc?.document.filename || "…"}</strong>
        </div>
        <div className="doc-peek-actions">
          <button type="button" className="icon-button" onClick={() => onOpenFull(documentId, heading)} aria-label="Відкрити повністю" title="Відкрити повністю"><ExternalLink size={15} /></button>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Закрити картку" title="Закрити цю картку й наступні"><X size={15} /></button>
        </div>
      </header>
      <div className="doc-peek-body">
        {detail.isLoading ? (
          <LoadingState label="Відкриваємо картку…" />
        ) : detail.isError || !doc ? (
          <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
        ) : doc.format !== "markdown" || doc.content == null ? (
          <EmptyState title="Перегляд недоступний">Цей формат показується лише при повному відкритті.</EmptyState>
        ) : (
          <SafeMarkdownView
            content={doc.content}
            onOpenWikilink={resolve}
            resolveImage={(target) => { const asset = doc.assets?.[target]; return typeof asset === "string" ? asset : asset?.url ?? null; }}
          />
        )}
      </div>
    </aside>
  );
}
