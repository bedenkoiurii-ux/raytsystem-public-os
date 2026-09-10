// computeWordDiff — LCS на словах, не рядках; читання прозою (Юрій, 10.09).
import { describe, expect, it } from "vitest";
import { computeWordDiff, extractChangedRegion, stripApparatus, stripFrontmatter } from "../features/documents/wordDiff";

describe("stripFrontmatter", () => {
  it("зрізає паспорт, лишає тіло", () => {
    expect(stripFrontmatter('---\ntitle: X\n---\n\nТекст.')).toBe("Текст.");
  });
  it("без паспорта — без змін", () => {
    expect(stripFrontmatter("Просто текст.")).toBe("Просто текст.");
  });
});

describe("stripApparatus", () => {
  it("зрізає технічний апарат канону", () => {
    const text = "Тіло розділу.\n\n<!-- apparatus:start -->\n## Технічний апарат\n16 джерел.";
    expect(stripApparatus(text)).toBe("Тіло розділу.");
  });
  it("без апарату — без змін", () => {
    expect(stripApparatus("Просто тіло.")).toBe("Просто тіло.");
  });
});

describe("computeWordDiff", () => {
  it("не тягне апарат канону в діф проти чернетки без апарату", () => {
    const canon = "Теза без змін.\n\n<!-- apparatus:start -->\n## Апарат\n" + "Джерело ".repeat(200);
    const variant = "Теза без змін.";
    const tokens = computeWordDiff(canon, variant);
    expect(tokens.filter((t) => t.kind === "removed").length).toBe(0);
  });


  it("однакові тексти — самий контекст, нуль змін", () => {
    const tokens = computeWordDiff("Це той самий текст.", "Це той самий текст.");
    expect(tokens.every((t) => t.kind === "context")).toBe(true);
  });

  it("одне слово замінено — решта лишається контекстом", () => {
    const tokens = computeWordDiff("Він тримає меч.", "Він тримає щит.");
    const removed = tokens.filter((t) => t.kind === "removed").map((t) => t.text);
    const added = tokens.filter((t) => t.kind === "added").map((t) => t.text);
    expect(removed).toContain("меч.");
    expect(added).toContain("щит.");
    expect(tokens.filter((t) => t.kind === "context" && t.text === "тримає").length).toBe(1);
  });

  it("довгий спільний текст із локальною правкою — префікс/суфікс лишаються контекстом", () => {
    const before = "Косів мислив державу як проєкт. " + "Слово ".repeat(50) + "Кінець розділу.";
    const after = "Косів мислив державу як задум. " + "Слово ".repeat(50) + "Кінець розділу.";
    const tokens = computeWordDiff(before, after);
    expect(tokens.some((t) => t.kind === "removed" && t.text === "проєкт.")).toBe(true);
    expect(tokens.some((t) => t.kind === "added" && t.text === "задум.")).toBe(true);
    expect(tokens.filter((t) => t.text === "Кінець")[0].kind).toBe("context");
  });
});

describe("extractChangedRegion", () => {
  it("бере лише абзац із цитатою, ігноруючи решту документа", () => {
    const canon = "Перший абзац, незмінний.\n\nДругий абзац зі старою фразою тут.\n\nТретій абзац, теж незмінний.";
    const variant = "Перший абзац, незмінний.\n\nДругий абзац із новою фразою тут.\n\nТретій абзац, теж незмінний.";
    const region = extractChangedRegion(canon, variant, "зі старою фразою");
    expect(region).not.toBeNull();
    expect(region!.oldText).toContain("зі старою фразою");
    expect(region!.oldText).not.toContain("Перший абзац");
    expect(region!.newText).toContain("із новою фразою");
  });

  it("сусідні змінені абзаци — один блок", () => {
    const canon = "Незмінний вступ.\n\nАбзац зі старим текстом.\n\nЩе один незмінний абзац.";
    const variant = "Незмінний вступ.\n\nАбзац із новим текстом.\n\nНовий абзац посередині.\n\nЩе один незмінний абзац.";
    const region = extractChangedRegion(canon, variant, "зі старим текстом");
    expect(region!.newText).toContain("Новий абзац посередині");
  });

  it("цитата не знайдена — null", () => {
    expect(extractChangedRegion("Текст.", "Текст.", "Немає такого")).toBeNull();
  });
});
