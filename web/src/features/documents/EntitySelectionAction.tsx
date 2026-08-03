import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import type { EntityOrderRequest } from "./EntityOrderDialog";

/** Скільки тексту навколо виділення несе замовлення. Речення, а не абзац:
 *  контекст має дати змогу знайти місце, не переносячи пів документа. */
const CONTEXT_CHARS = 220;

function sentenceAround(node: Node, from: number, to: number): string {
  const whole = node.textContent ?? "";
  const left = whole.lastIndexOf(".", Math.max(0, from - 1));
  const right = whole.indexOf(".", to);
  const start = Math.max(left + 1, from - CONTEXT_CHARS);
  const end = Math.min(right < 0 ? whole.length : right + 1, to + CONTEXT_CHARS);
  return whole.slice(start, end).replace(/\s+/g, " ").trim();
}

/**
 * Плаваюча кнопка «У сутності» над виділеним текстом у читанні.
 *
 * Хоткей ⌥E робить те саме — рука на клавіатурі не мусить іти до миші.
 * Кнопка не показується, доки виділення порожнє або надто довге: замовляють
 * термін, а не абзац.
 */
export function EntitySelectionAction({ documentPath, onOrder }: {
  documentPath: string;
  onOrder: (request: EntityOrderRequest) => void;
}) {
  const [spot, setSpot] = useState<{ x: number; y: number; term: string; context: string } | null>(null);

  useEffect(() => {
    const read = () => {
      const selection = window.getSelection();
      const term = selection?.toString().trim() ?? "";
      if (!selection || selection.rangeCount === 0 || term.length < 2 || term.length > 120) {
        setSpot(null);
        return null;
      }
      const range = selection.getRangeAt(0);
      // Виділення поза тілом документа (дерево, панель) нас не стосується.
      const host = (range.commonAncestorContainer as Element).closest?.(".document-content")
        ?? (range.commonAncestorContainer.parentElement?.closest(".document-content") ?? null);
      if (!host) {
        setSpot(null);
        return null;
      }
      const box = range.getBoundingClientRect();
      const context = sentenceAround(range.startContainer, range.startOffset, range.endOffset);
      const next = { x: box.left + box.width / 2, y: box.top - 8, term, context };
      setSpot(next);
      return next;
    };
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.key.toLowerCase() !== "e") return;
      const current = read();
      if (current) {
        event.preventDefault();
        onOrder({ term: current.term, document: documentPath, context: current.context });
      }
    };
    document.addEventListener("selectionchange", read);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("selectionchange", read);
      document.removeEventListener("keydown", onKey);
    };
  }, [documentPath, onOrder]);

  if (!spot) return null;
  return (
    <button
      type="button"
      className="doc-entity-order"
      style={{ left: spot.x, top: spot.y }}
      title="Замовити картку сутності для виділеного (⌥E)"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onOrder({ term: spot.term, document: documentPath, context: spot.context })}
    >
      <Sparkles size={13} aria-hidden="true" /> У сутності
    </button>
  );
}
