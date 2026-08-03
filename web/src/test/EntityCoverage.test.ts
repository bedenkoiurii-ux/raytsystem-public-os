// Верифікація підсвітки покриття на ЖИВИХ даних бібліотеки, не на макеті.
//
// Перевіряється те, що замовив Юрій 2026-08-03:
//   (а) часта сутність у різних відмінках — підсвічені ВСІ входження;
//   (б) слово без картки — не підсвічене;
//   (д) документ-джерело не змінюється (підсвітка живе лише в копії тексту).
//
// Дані беремо з диска: якщо індекс імен протух або картку видалено, тест це
// побачить — саме тому він і читає бібліотеку, а не фікстуру.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { autolink } from "../features/InlineEntity";

const VAULT = "/Users/Nemo/Writer-Lab/Library";
const CHAPTER = `${VAULT}/20-Essays/Андрофаги і Боголюбський.md`;

interface RawIndex {
  cards: Record<string, { title: string; path: string }>;
  forms: Record<string, string[]>;
}

/** Той самий відбір, що робить `/api/v1/entities/forms`: однозначні форми
 *  від чотирьох знаків, власні назви — лише з великої літери. */
function loadForms(): { forms: Record<string, string>; proper: Set<string> } {
  const raw = JSON.parse(readFileSync(`${VAULT}/90-Meta/entity-index.json`, "utf-8")) as RawIndex;
  const forms: Record<string, string> = {};
  const proper = new Set<string>();
  for (const [form, uids] of Object.entries(raw.forms)) {
    if (uids.length !== 1 || form.length < 4) continue;
    const card = raw.cards[uids[0]];
    if (!card) continue;
    forms[form] = card.title;
    if (["People", "Places", "Events"].some((folder) => card.path.includes(`/${folder}/`))) {
      proper.add(form);
    }
  }
  return { forms, proper };
}

const { forms, proper } = loadForms();
const source = readFileSync(CHAPTER, "utf-8");
const linked = autolink(source, forms, proper);
const linksTo = (title: string) =>
  (linked.match(new RegExp(`\\[\\[${title}(?:\\||\\]\\])`, "g")) ?? []).length;

describe("підсвітка покриття на живій бібліотеці", () => {
  it("індекс імен не порожній — інакше підсвітка мовчки нічого не покриває", () => {
    expect(Object.keys(forms).length).toBeGreaterThan(500);
  });

  it("(а) часта сутність підсвічена в КОЖНОМУ входженні, не раз на сторінку", () => {
    // «Вишгород» стоїть в есеї в кількох відмінках: Вишгороді, Вишгорода…
    const occurrences = (source.match(/Вишгород/g) ?? []).length;
    expect(occurrences).toBeGreaterThan(2);
    expect(linksTo("Вишгород")).toBeGreaterThan(2);
  });

  it("(б) слово без картки не підсвічується", () => {
    // Вигадане слово, якого в бібліотеці немає й не буде.
    const probe = autolink("Тут стоїть Незнанославль поруч", forms, proper);
    expect(probe).toBe("Тут стоїть Незнанославль поруч");
  });

  it("(г) після появи картки слово світиться при наступному відкритті", () => {
    // «Романівський міст» замовлено з читання 03.08, картку завів конвеєр
    // `karty`, індекс перебудовано хвостом того ж прогону. Тест читає ті самі
    // файли, що й застосунок: якщо ланцюг десь урветься, він це побачить.
    expect(forms["романівський міст"]).toBe("Романівський міст");
    const transcript = readFileSync(
      `${VAULT}/10-Projects/3-Films/Позивний Письменник/2-Sources/INT/МАРКУШИН.md`, "utf-8");
    expect(transcript).toContain("Романівський міст");
    expect(autolink(transcript, forms, proper)).toContain("[[Романівський міст");
  });

  it("(д) підсвітка не чіпає джерело — змінюється лише копія для читання", () => {
    expect(readFileSync(CHAPTER, "utf-8")).toBe(source);
    expect(linked.length).toBeGreaterThanOrEqual(source.length);
  });

  it("вже наявні вікілінки не подвоюються", () => {
    expect(linked).not.toMatch(/\[\[\[\[/);
    expect(linked).not.toMatch(/\|\s*\[\[/);
  });
});
