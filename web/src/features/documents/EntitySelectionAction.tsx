import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import type { EntityOrderRequest } from "./EntityOrderDialog";

/** Скільки тексту навколо виділення несе замовлення. Речення, а не абзац:
 *  контекст має дати змогу знайти місце, не переносячи пів документа. */
const CONTEXT_CHARS = 220;
/** Висота кнопки з відступом — щоб вирішити, чи влізе вона над виділенням. */
const BUTTON_H = 30;
const GAP = 6;
/** Півширини кнопки: вона центрується по точці, тож біля країв панелі половина
 *  вилізла б назовні — праворуч якраз на сусідню панель властивостей. */
const HALF_W = 58;

export interface Placement {
  left: number;
  top: number;
  below: boolean;
}

/**
 * Де стати кнопці. Координати — ВІДНОСНО панелі читання, з поправкою на її
 * прокрут, а не від вікна.
 *
 * Чому не `position: fixed` від viewport: так було в першій редакції, і кнопка
 * зʼявлялася біля правої панелі властивостей замість виділеного слова —
 * достатньо будь-якого предка з власним контекстом (`transform`, `filter`,
 * `contain`), щоб `fixed` рахувався від нього, а не від вікна. Прив'язка до
 * панелі читання цю залежність знімає зовсім і заразом виконує вимогу: кнопка
 * живе в межах панелі, а не поверх сусідніх.
 *
 * Точка відліку — КІНЕЦЬ виділення (останній прямокутник діапазону), бо
 * виділення на кілька рядків має «хвіст», і кнопка біля початку опинялась би
 * далеко від того місця, де людина відпустила мишу.
 */
export function place(
  selection: { left: number; right: number; top: number; bottom: number },
  pane: { left: number; top: number; width: number },
  scroll: { left: number; top: number }
): Placement {
  const anchor = selection.right - pane.left + scroll.left;
  // Затиск у межі панелі: кнопка живе в панелі читання, не поверх сусідніх.
  const x = Math.min(Math.max(anchor, HALF_W), Math.max(HALF_W, pane.width + scroll.left - HALF_W));
  const above = selection.top - pane.top + scroll.top;
  // Виділення притиснуте до верху панелі — кнопці немає куди стати над ним.
  const below = selection.top - pane.top < BUTTON_H + GAP;
  const y = below
    ? selection.bottom - pane.top + scroll.top + GAP
    : above - GAP;
  return { left: x, top: Math.max(0, y), below };
}

function sentenceAround(node: Node, from: number, to: number): string {
  const whole = node.textContent ?? "";
  const left = whole.lastIndexOf(".", Math.max(0, from - 1));
  const right = whole.indexOf(".", to);
  const start = Math.max(left + 1, from - CONTEXT_CHARS);
  const end = Math.min(right < 0 ? whole.length : right + 1, to + CONTEXT_CHARS);
  return whole.slice(start, end).replace(/\s+/g, " ").trim();
}

function paneOf(range: Range): HTMLElement | null {
  const node = range.commonAncestorContainer;
  const element = node.nodeType === 1 ? (node as Element) : node.parentElement;
  return (element?.closest(".document-content") as HTMLElement | null) ?? null;
}

/**
 * Плаваюча кнопка «У сутності» над виділеним текстом у читанні.
 *
 * ⌥E робить те саме — рука на клавіатурі не мусить іти до миші. Кнопка зникає
 * при прокруті й при кліку повз: інакше вона лишалась би висіти над місцем,
 * якого на екрані вже немає.
 */
export function EntitySelectionAction({ documentPath, onOrder }: {
  documentPath: string;
  onOrder: (request: EntityOrderRequest) => void;
}) {
  const [spot, setSpot] = useState<(Placement & { term: string; context: string }) | null>(null);

  useEffect(() => {
    const read = () => {
      const selection = window.getSelection();
      const term = selection?.toString().trim() ?? "";
      if (!selection || selection.rangeCount === 0 || term.length < 2 || term.length > 120) {
        setSpot(null);
        return null;
      }
      const range = selection.getRangeAt(0);
      const pane = paneOf(range);
      if (!pane) {                       // виділення поза тілом документа — не наша справа
        setSpot(null);
        return null;
      }
      // Останній прямокутник діапазону — кінець виділення. getBoundingClientRect()
      // на кількох рядках дав би рамку навколо всього блоку, і кнопка поїхала б
      // до лівого краю абзацу.
      const rects = range.getClientRects();
      const box = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
      const paneBox = pane.getBoundingClientRect();
      const placement = place(
        box,
        { left: paneBox.left, top: paneBox.top, width: paneBox.width },
        { left: pane.scrollLeft, top: pane.scrollTop }
      );
      const context = sentenceAround(range.startContainer, range.startOffset, range.endOffset);
      const next = { ...placement, term, context };
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
    const hide = () => setSpot(null);
    // Клік повз кнопки. `selectionchange` тут не рятує: клік по інтерфейсу
    // (панель властивостей, вкладка) виділення в документі не скидає, і кнопка
    // лишалась би висіти над текстом, до якого вже ніхто не звертається.
    const away = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest?.(".doc-entity-order")) hide();
    };

    document.addEventListener("selectionchange", read);
    document.addEventListener("keydown", onKey);
    // Прокрут ловимо на фазі захоплення: панель читання прокручується сама,
    // і подія до document у фазі спливання не дійшла б.
    document.addEventListener("scroll", hide, true);
    document.addEventListener("pointerdown", away, true);
    return () => {
      document.removeEventListener("selectionchange", read);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("scroll", hide, true);
      document.removeEventListener("pointerdown", away, true);
    };
  }, [documentPath, onOrder]);

  if (!spot) return null;
  return (
    <button
      type="button"
      className={spot.below ? "doc-entity-order is-below" : "doc-entity-order"}
      style={{ left: spot.left, top: spot.top }}
      title="Замовити картку сутності для виділеного (⌥E)"
      onMouseDown={(event) => event.preventDefault()}   // не гасити виділення до кліку
      onClick={() => onOrder({ term: spot.term, document: documentPath, context: spot.context })}
    >
      <Sparkles size={13} aria-hidden="true" /> У сутності
    </button>
  );
}
