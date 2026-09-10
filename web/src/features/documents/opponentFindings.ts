// Знахідки опонента: підсвітка в тексті + resolve на варіант-документ.
//
// Задум 2026-09-10 (`10-Projects/1-Ideas/Опонент — детектор напруг у самому
// застосунку (задум).md`): відкриті `Версії/*.md` варіанти (`variant_of` +
// `anchor_quote`) — одна легка вкладка над рідером, не окрема сторінка.
// Дані йдуть із похідного `90-Meta/opponent-index.json`, той самий патерн,
// що entity-forms: один запит на сеанс, кеш на весь сеанс.
//
// Клікабельність вирішена тим самим шляхом, що й банер відкритих питань
// (`App.tsx: openQueueAlert`) — `/api/v1/documents/search?q=<назва файла>`
// резолвить шлях у `document_id`, а не власний окремий бекенд-маршрут:
// варіант — звичайний документ, той самий резолвер підходить.
import { useQuery } from "@tanstack/react-query";
import { getJson } from "../../api";

export interface OpponentFinding {
  variant_path: string;
  variant_title: string;
  canon_path: string;
  quote: string;
  based_on: string;
}

interface FindingsResponse { items: OpponentFinding[]; count: number; stale: boolean }

export function useOpponentFindings() {
  return useQuery({
    queryKey: ["opponent", "findings"],
    staleTime: 60_000,
    queryFn: () => getJson<FindingsResponse>("/api/v1/opponent/findings")
  });
}

/** `variant_title` → `document_id`, по одному запиту на відкритий варіант.
 *  Список зазвичай порожній або з 1–2 пунктів — резолвити все одразу дешевше,
 *  ніж чекати кліку: клік має відкривати панель миттєво, не після round-trip.
 *
 *  Помилку НЕ ковтаємо — кидаємо далі, щоб query сам повторив спробу.
 *  Живий баг 10.09: пошук варіанта попав під 409 (гонка з переіндексацією
 *  щойно створеного файла); тихий catch на кожен пункт перетворював це на
 *  «успішну» порожню мапу — react-query бачив success і більше не пробував,
 *  targetId лишався undefined назавжди, врізка стояла на «Готую…».
 *
 *  Друга живa знахідка того самого дня: /documents/search падає 409
 *  (`document_index_stale`, «exceeded its safe query budget») на запиті
 *  з тире «—» — а тире є в майже кожній назві файла в бібліотеці. Це
 *  бекенд-баг ширший за цю фічу (той самий пошук веде й банер черги питань
 *  в App.tsx); тут — обхід: тире прибираємо з рядка пошуку, решта назви
 *  й так однозначно знаходить файл. */
export function useOpponentTargets(items: OpponentFinding[]) {
  return useQuery({
    queryKey: ["opponent", "targets", items.map((i) => i.variant_path).join("|")],
    enabled: items.length > 0,
    staleTime: 60_000,
    retry: 3,
    retryDelay: (attempt) => Math.min(300 * 2 ** attempt, 2_000),
    queryFn: async () => {
      const out = new Map<string, string>();
      await Promise.all(items.map(async (item) => {
        const filename = (item.variant_path.split("/").pop()?.replace(/\.md$/, "") ?? item.variant_title)
          .replace(/[—–-]/g, " ").replace(/\s+/g, " ").trim();
        const found = await getJson<{ items: Array<{ path: string; document_id: string }> }>(
          `/api/v1/documents/search?q=${encodeURIComponent(filename)}`
        );
        const hit = found.items.find((x) => x.path === item.variant_path) ?? found.items[0];
        if (hit) out.set(item.variant_title, hit.document_id);
      }));
      return out;
    }
  });
}

/** Уривки канону з активними знахідками для цього документа. */
export function findingsForDocument(items: OpponentFinding[], documentPath: string): OpponentFinding[] {
  return items.filter((item) => item.canon_path === documentPath);
}

/** Обгортає дослівну цитату знахідки в `[[Варіант|цитата]]` — той самий
 *  синтаксис, що `autolink` для сутностей, тому рендериться й клікається
 *  наявним рендерером без жодної правки `SafeMarkdownView`.
 *
 *  Матч — РІВНО дослівний (не за основою слова, як entityStem): цитата в
 *  `anchor_quote` — те саме речення з канону, скопійоване, не переказане.
 *  Перше входження, поза вже наявними посиланнями/кодом/заголовками —
 *  та сама охорона, що в `autolink`. */
export function markFindings(text: string, findings: OpponentFinding[]): string {
  if (!findings.length) return text;
  const guard = new RegExp("(" + [
    "```[\\s\\S]*?```",
    "`[^`]*`",
    "\\[\\[[^\\]]*\\]\\]",
    "\\[\\^[^\\]\\n]+\\]",
    "\\[[^\\]]*\\]\\([^)]*\\)",
    "https?://\\S+",
    "^#{1,6} .*$",
  ].map((x) => `(?:${x})`).join("|") + ")", "gm");

  let head = "";
  let body = text;
  if (text.startsWith("---\n")) {
    const close = text.indexOf("\n---", 4);
    if (close >= 0) { head = text.slice(0, close + 4); body = text.slice(close + 4); }
  }

  return head + body.split(guard).map((piece, index) => {
    if (index % 2 === 1 || !piece) return piece;
    let out = piece;
    for (const finding of findings) {
      const at = out.indexOf(finding.quote);
      if (at < 0) continue;                        // канон уже розійшовся з цитатою — мовчимо
      const before = out.slice(0, at);
      const matched = out.slice(at, at + finding.quote.length);
      const after = out.slice(at + finding.quote.length);
      out = `${before}[[${finding.variant_title}|${matched}]]${after}`;
    }
    return out;
  }).join("");
}
