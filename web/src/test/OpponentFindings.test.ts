// markFindings — обгортає дослівну цитату знахідки опонента у вікілінк на
// варіант, тим самим синтаксисом, що autolink для сутностей (Прозе — 10.09).
import { describe, expect, it } from "vitest";
import { findingsForDocument, markFindings, type OpponentFinding } from "../features/documents/opponentFindings";

const finding: OpponentFinding = {
  variant_path: "Версії/Розділ 19 (варіант).md",
  variant_title: "Розділ 19 (варіант за заувагою опонента)",
  canon_path: "Розділи/Розділ 19.md",
  quote: "не провокувати, не формулювати радикальних позицій",
  based_on: "ОПОНЕНТ-журнал · розділ 19",
};

describe("markFindings", () => {
  it("обгортає перше входження цитати вікілінком на варіант", () => {
    const out = markFindings("Логіка: не викликати, не провокувати, не формулювати радикальних позицій. Зберегти школи.", [finding]);
    expect(out).toContain("[[Розділ 19 (варіант за заувагою опонента)|не провокувати, не формулювати радикальних позицій]]");
  });

  it("мовчить, якщо цитата вже розійшлася з текстом (канон правлено повз варіант)", () => {
    const out = markFindings("Зовсім інший текст розділу.", [finding]);
    expect(out).not.toContain("[[");
  });

  it("не чіпає код і вже наявні вікілінки", () => {
    const withCode = "`не провокувати, не формулювати радикальних позицій` — цитата в лапках.";
    expect(markFindings(withCode, [finding])).toBe(withCode);
  });

  it("не подвоює обгортку всередині вже вставленого вікілінку", () => {
    const already = "[[Х|не провокувати, не формулювати радикальних позицій]]";
    expect(markFindings(already, [finding])).toBe(already);
  });
});

describe("findingsForDocument", () => {
  it("фільтрує лише за canon_path", () => {
    const other: OpponentFinding = { ...finding, canon_path: "Розділи/Розділ 20.md" };
    expect(findingsForDocument([finding, other], "Розділи/Розділ 19.md")).toEqual([finding]);
    expect(findingsForDocument([finding, other], "Розділи/Розділ 21.md")).toEqual([]);
  });
});
