// Підсвітка змінює ВИГЛЯД, ніколи — ЗНАЧЕННЯ.
//
// Найгостріше це в дослівних цитатах із 40-Sources: verbatim-ворота порівнюють
// цитату з джерелом буквою. Якщо копіювання приносить дужки й вікілінки,
// цитата перестає бути дослівною — і ворота почнуть відкидати правильне.
//
// Тому тут перевіряється не код, а НАСЛІДОК: що саме опиняється в тексті,
// який людина виділяє й копіює з вікна.
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { autolink } from "../features/InlineEntity";
import { SafeMarkdownView } from "../features/documents/SafeMarkdownView";

const forms: Record<string, string> = {
  "москва": "Москва",
  "катинь": "Катинь",
  "катині": "Катинь",
};
const proper = new Set(Object.keys(forms));

/** Те, що потрапить у буфер: текст як його бачить браузер, без розмітки. */
function clipboardText(markdown: string): string {
  const linked = autolink(markdown, forms, proper);
  const view = render(<SafeMarkdownView content={linked} />);
  const text = view.container.textContent ?? "";
  view.unmount();
  return text;
}

describe("копіювання підсвіченого", () => {
  it("дослівна цитата копіюється чистою", () => {
    const quote = "«У Москві 1940 року ухвалено рішення» — з протоколу.";
    expect(clipboardText(quote)).toContain("«У Москві 1940 року ухвалено рішення»");
  });

  it("у буфері немає ні дужок, ні труби, ні службових символів", () => {
    const text = clipboardText("У Москві поблизу Катині.");
    expect(text).not.toContain("[[");
    expect(text).not.toContain("]]");
    expect(text).not.toContain("|");
    expect(text).not.toContain("\\");
  });

  it("підсвічене слово копіюється тією формою, що стоїть у тексті", () => {
    // Не канонічною назвою картки: «Москві», а не «Москва».
    const text = clipboardText("сталося у Москві");
    expect(text).toContain("у Москві");
    expect(text).not.toContain("Москва");
  });

  it("блок цитати зберігає порядок і пунктуацію", () => {
    const quote = "> «Катинь, Калінін, Харків» — три місця одного наказу.";
    expect(clipboardText(quote)).toContain("«Катинь, Калінін, Харків» — три місця одного наказу.");
  });

  it("довга цитата не втрачає жодного слова", () => {
    const quote = "«Навесні 1940 року в Катині розстріляно польських офіцерів, "
      + "і Москва пʼятдесят років називала це нацистським злочином.»";
    const text = clipboardText(quote);
    for (const word of quote.replace(/[«»,.]/g, " ").split(/\s+/).filter(Boolean)) {
      expect(text).toContain(word);
    }
  });
});

describe("де розмітка значуща — підсвітки немає", () => {
  const link = (t: string) => autolink(t, forms, proper);

  it("YAML-паспорт: значення поля лишається значенням", () => {
    const fm = "---\ntitle: Катинь\nplace: Москва\n---\n\nтекст";
    expect(link(fm)).toBe(fm);
  });

  it("код — блоком і inline", () => {
    expect(link("`Катинь`")).toBe("`Катинь`");
    expect(link("```\nx = Москва\n```")).toBe("```\nx = Москва\n```");
    // Код із відступом у чотири пробіли тут не охороняється навмисно —
    // у прозовій бібліотеці це переважно продовження списку (замір: 70%).
  });

  it("посилання й вікілінки не чіпаються", () => {
    expect(link("[Катинь](https://ex.org/a)")).toBe("[Катинь](https://ex.org/a)");
    expect(link("[[Катинь|Катині]]")).toBe("[[Катинь|Катині]]");
    expect(link("https://ex.org/Катинь")).toBe("https://ex.org/Катинь");
  });

  it("посилання на виноску лишається ідентифікатором", () => {
    expect(link("текст[^Катинь]")).toBe("текст[^Катинь]");
  });

  it("заголовок не підсвічується", () => {
    expect(link("## Катинь у розділі")).toBe("## Катинь у розділі");
  });
});
