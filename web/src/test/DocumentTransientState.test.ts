// Тимчасовий стан вікна прив'язаний до ДОКУМЕНТА, а не до застосунку.
//
// Скарга Юрія 03.08: врізка «Максим (митрополит)» висіла поверх будь-якого
// наступного документа, банер «Замовлено…» — так само. Причина була не в
// одному місці: `card1` скидався при зміні документа, а `inline` — ніколи,
// і банер не скидався теж.
//
// Тест тримає САМЕ правило, а не реалізацію: перелічує весь тимчасовий стан і
// вимагає, щоб кожен його шматок скидався в одному й тому самому місці. Нове
// поле, додане повз цей список, впаде тут.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  "/Users/Nemo/Writer-Lab/raytsystem/web/src/features/documents/Documents.tsx", "utf-8");

/** Рядок, що скидає тимчасовий стан при зміні активного документа. */
const RESET = SOURCE.match(/useEffect\(\(\) => \{[^}]*\}, \[activeId, closeCard1\]\);/)?.[0] ?? "";

describe("скидання тимчасового стану", () => {
  it("ефект прив'язаний саме до зміни документа", () => {
    expect(RESET).not.toBe("");
    expect(RESET).toContain("[activeId, closeCard1]");
  });

  it("панель картки скидається", () => {
    expect(RESET).toContain("closeCard1()");
  });

  it("врізки сутностей скидаються — саме вони й висіли", () => {
    expect(RESET).toContain("setInline([])");
  });

  it("банер повідомлення скидається", () => {
    expect(RESET).toContain("setNotice(null)");
  });

  it("банер гасне сам за таймером", () => {
    expect(SOURCE).toMatch(/setTimeout\(\(\) => setNotice\(null\), \d+\)/);
  });

  it("Esc закриває врізки, коли картки вже немає", () => {
    expect(SOURCE).toContain("else setInline([]);");
  });

  it("клік повз закриває врізки, але не по самій панелі", () => {
    expect(SOURCE).toContain(".map-inline, .doc-peek, .doc-wikilink, .doc-entity");
  });

  it("оголошення inline стоїть ВИЩЕ за ефект скидання", () => {
    // Інакше складання не проходить, а помилка виглядає як «змінна не існує».
    expect(SOURCE.indexOf("const [inline, setInline]")).toBeLessThan(SOURCE.indexOf("setInline([]); setNotice(null);"));
  });
});
