// Діф на рівні слів для читання прозою — не код-діф для рядків/фронтматтера.
//
// Юрій (2026-09-10), дивлячись на DocumentDiff: «я не хочу правити код, я
// хочу правити зрозумілий текст як у ворді». Той компонент — для git-історії,
// рядок за рядком, разом з YAML — правильний для розробника, не для автора.
// Тут — те саме LCS-порівняння, що в DocumentDiff.computeDiff, тільки токени
// не рядки, а слова/пробіли/`**`, і фронтматтер відрізається до порівняння.
export type WordDiffKind = "context" | "added" | "removed";
export interface WordToken { kind: WordDiffKind; text: string }

/** `**` окремим токеном (для жирного в рендері), пробіли — рунами (щоб
 *  подвійний перенос рядка лишався одним токеном — межа абзацу). */
const TOKEN = /\*\*|\s+|[^\s*]+|\*/g;

function tokenize(text: string): string[] {
  return text.match(TOKEN) ?? [];
}

/** Тіло без frontmatter — паспорт документа тут не порівнюємо. */
export function stripFrontmatter(text: string): string {
  if (!text.startsWith("---\n")) return text;
  const close = text.indexOf("\n---", 4);
  return close < 0 ? text : text.slice(close + 4).replace(/^\n+/, "");
}

/** Технічний апарат (`<!-- apparatus:start -->`) — службовий блок канону,
 *  якого чернетка правки не тримає й не мусить. Без цього кожен варіант
 *  «губив» апарат у діфі: сотні слів джерел і сутностей рахувались
 *  видаленими через незмінену тезу. */
export function stripApparatus(text: string): string {
  const at = text.indexOf("<!-- apparatus:start");
  return at < 0 ? text.trimEnd() : text.slice(0, at).trimEnd();
}

const MAX_TOKENS_FOR_EXACT = 6_000;

export function computeWordDiff(before: string, after: string): WordToken[] {
  const b = tokenize(stripApparatus(stripFrontmatter(before)));
  const a = tokenize(stripApparatus(stripFrontmatter(after)));

  // Спільний префікс/суфікс відрізаємо перед LCS — реальні правки локальні
  // (кілька речень серед тисяч слів), тож середина, яку рахує DP, лишається
  // малою навіть на цілому розділі.
  let prefix = 0;
  while (prefix < b.length && prefix < a.length && b[prefix] === a[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < b.length - prefix && suffix < a.length - prefix &&
    b[b.length - 1 - suffix] === a[a.length - 1 - suffix]
  ) suffix += 1;

  const midB = b.slice(prefix, b.length - suffix);
  const midA = a.slice(prefix, a.length - suffix);
  const out: WordToken[] = b.slice(0, prefix).map((text) => ({ kind: "context", text }));

  if (midB.length * midA.length > MAX_TOKENS_FOR_EXACT * MAX_TOKENS_FOR_EXACT) {
    // Надто велика середина (майже нічого спільного) — без апроксимації тут
    // сенсу нема, показуємо як суцільну заміну.
    out.push(...midB.map((text) => ({ kind: "removed" as const, text })));
    out.push(...midA.map((text) => ({ kind: "added" as const, text })));
  } else {
    const widths = midA.length + 1;
    const table = new Uint32Array((midB.length + 1) * widths);
    for (let left = midB.length - 1; left >= 0; left -= 1) {
      for (let right = midA.length - 1; right >= 0; right -= 1) {
        table[left * widths + right] = midB[left] === midA[right]
          ? table[(left + 1) * widths + right + 1] + 1
          : Math.max(table[(left + 1) * widths + right], table[left * widths + right + 1]);
      }
    }
    let left = 0;
    let right = 0;
    while (left < midB.length || right < midA.length) {
      if (left < midB.length && right < midA.length && midB[left] === midA[right]) {
        out.push({ kind: "context", text: midB[left] }); left += 1; right += 1;
      } else if (right < midA.length && (left >= midB.length || table[left * widths + right + 1] >= table[(left + 1) * widths + right])) {
        out.push({ kind: "added", text: midA[right] }); right += 1;
      } else {
        out.push({ kind: "removed", text: midB[left] }); left += 1;
      }
    }
  }

  out.push(...b.slice(b.length - suffix).map((text) => ({ kind: "context" as const, text })));
  return out;
}
