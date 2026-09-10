import { Fragment, useEffect, useMemo, useRef } from "react";
import { computeWordDiff, type WordToken } from "./wordDiff";

/** Читання-діф: слова, не рядки коду. Абзаци лишаються абзацами, `**жирне**`
 *  лишається жирним — той самий вигляд, що й у звичайному читанні, тільки
 *  вилучене закреслене рожевим, додане підкреслене м'ятним. */
export function ProseDiff({ original, current }: { original: string; current: string }) {
  const tokens = useMemo(() => computeWordDiff(original, current), [original, current]);
  const added = tokens.filter((t) => t.kind === "added").length;
  const removed = tokens.filter((t) => t.kind === "removed").length;

  // Юрій (2026-09-10): Diff відкривається згори документа — саму зміну,
  // заради якої це все, треба шукати прокруткою. Стрибаємо до першого
  // позначеного слова одразу після рендеру.
  const host = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const mark = host.current?.querySelector(".prose-diff-removed, .prose-diff-added");
    mark?.scrollIntoView({ block: "center" });
  }, [tokens]);

  const paragraphs: WordToken[][] = [[]];
  for (const token of tokens) {
    if (token.kind === "context" && /\n\s*\n/.test(token.text)) { paragraphs.push([]); continue; }
    paragraphs[paragraphs.length - 1].push(token);
  }

  return (
    <div className="prose-diff">
      <header className="prose-diff-summary">
        <strong>Зміни в тексті</strong>
        <span className="added">+{added}</span>
        <span className="removed">−{removed}</span>
        {added === 0 && removed === 0 ? <span className="prose-diff-same">без відмінностей</span> : null}
      </header>
      <div className="prose-diff-body sheet-light" data-sheet-tone="warm" ref={host}>
        {paragraphs.filter((p) => p.some((t) => t.text.trim())).map((paragraph, index) => {
          let bold = false;
          return (
            <p key={index}>
              {paragraph.map((token, i) => {
                if (token.text === "**") { bold = !bold; return null; }
                if (!token.text) return null;
                const content = bold ? <strong>{token.text}</strong> : token.text;
                if (token.kind === "context") return <Fragment key={i}>{content}</Fragment>;
                if (token.kind === "removed") return <s key={i} className="prose-diff-removed">{content}</s>;
                return <mark key={i} className="prose-diff-added">{content}</mark>;
              })}
            </p>
          );
        })}
      </div>
    </div>
  );
}
