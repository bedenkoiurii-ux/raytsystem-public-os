// Показ результатів заміру — СПІЛЬНИЙ код із тестами, а не одноразовий розбір.
//
// Сьомий клас (`patterns.md`) укусив тричі в тому самому місці: топ-N різав
// багатослівні назви по пробілу й показував «Розгром ← Києва» замість
// «Розгром Києва Боголюбським ← 1169». Щоразу вимірник писався наново під
// конкретний замір — і щоразу відроджував ту саму помилку.
//
// Тому пари «картка ↔ слово» тепер не склеюються в рядок узагалі: вони
// лишаються парою до самого друку. Розбирати нічого — отже й розібрати
// неправильно нічого.

export interface Hit {
  /** Канонічна назва картки — може містити пробіли, дефіси, дужки. */
  title: string;
  /** Слово, як воно стоїть у тексті. */
  word: string;
}

export interface CountedHit extends Hit {
  count: number;
}

/** Ключ для лічильника. Роздільник — символ, якого в тексті бути не може. */
const SEP = "";

export function hitKey(hit: Hit): string {
  return `${hit.title}${SEP}${hit.word}`;
}

export function parseHitKey(key: string): Hit {
  const at = key.indexOf(SEP);
  // Роздільника немає — значить ключ зроблено не цією функцією; чесніше
  // віддати все як назву, ніж мовчки розрізати по пробілу.
  if (at < 0) return { title: key, word: "" };
  return { title: key.slice(0, at), word: key.slice(at + 1) };
}

/** Порахувати збіги. Пари не склеюються — рахуємо по обох полях одразу. */
export function countHits(hits: Iterable<Hit>): Map<string, number> {
  const out = new Map<string, number>();
  for (const hit of hits) {
    const key = hitKey(hit);
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}

/** Верхівка за кількістю, від найчастішого. */
export function topHits(counted: Map<string, number>, limit = 20): CountedHit[] {
  return [...counted.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "uk"))
    .slice(0, limit)
    .map(([key, count]) => ({ ...parseHitKey(key), count }));
}

/** Готові рядки для друку. Формат один на всі заміри. */
export function formatTop(counted: Map<string, number>, limit = 20): string[] {
  return topHits(counted, limit).map(
    (hit) => `  ${hit.count}×  ${hit.title}  ←  «${hit.word}»`
  );
}
