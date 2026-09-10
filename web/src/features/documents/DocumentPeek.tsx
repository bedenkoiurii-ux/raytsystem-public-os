import { ArrowLeft, ArrowRight, ExternalLink, X } from "lucide-react";
import { EmptyState, ErrorState, LoadingState } from "../../components/StatePanel";
import { useDocumentDetail, useDocumentLinks } from "./documentHooks";
import { matchingDocumentLink } from "./Documents";
import { useState } from "react";
import { flushSync } from "react-dom";
import { SafeMarkdownView, type WikilinkTarget } from "./SafeMarkdownView";
import { InlineStack } from "../InlineEntity";

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
  // Картка нередагована — їй не потрібен точний збіг зрізу з рештою застосунку
  // (snapshotId тут — лише пропс сумісності, не передаємо його в запит). Пінований
  // зріз, узятий у видимому документі, старіє від щохвилинних комітів фонового
  // конвеєра швидше, ніж вкладка встигає його оновити — і картка мовчки переставала
  // відкриватись (409 document_index_stale) саме там, де конфлікт версій нікому не
  // загрожує.
  const detail = useDocumentDetail(documentId, null);
  const links = useDocumentLinks(documentId, null);
  const doc = detail.data;

  // Каскад: клік у картці відкриває наступну картку панелі (Юрій — це і є
  // двовіконний режим, заради якого peek існує).
  const [inline, setInline] = useState<string[]>([]);
  // Та сама пастка, що в основному полі документів: врізка йде в кінець
  // картки, а не під абзац, — у довгій картці це поза видимістю. `flushSync`
  // комітить DOM одразу, тож скрол можна давати синхронно тут-таки.
  const addInline = (name: string) => {
    let added = false;
    flushSync(() => setInline((s) => {
      if (s.includes(name)) return s.filter((x) => x !== name);
      added = true;
      return [...s, name];
    }));
    if (added) {
      document.querySelector(`[data-inline-name="${CSS.escape(name)}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };
  const resolve = (target: WikilinkTarget, event?: { altKey: boolean }) => {
    const name = target.target.trim();
    if (event?.altKey) { addInline(name); return; }
    const match = matchingDocumentLink(target, links.data?.items ?? []);
    const id = match?.target_document_id ?? (match?.candidates?.length === 1 ? match.candidates[0].document_id : null);
    if (id) onOpenLink(index, id, target.heading ?? match?.heading ?? undefined);
    else addInline(name);
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
        {inline.length ? <InlineStack names={inline} setNames={setInline} onOpenPanel={(id) => onOpenLink(index, id, undefined)} /> : null}
      </div>
    </aside>
  );
}
