// Проводка кнопки «У сутності»: звідки вона бере координати.
//
// Геометрію перевіряє `EntitySelectionPlacement.test.ts`. Тут інше: первісна
// вада була не в арифметиці, а в тому, ВІД ЧОГО рахувалось — від вікна замість
// панелі читання, і кнопка зʼявлялась біля панелі властивостей. Тест ставить
// панель у неочевидне місце (лівий край 320, прокрут 900) і дивиться, чи
// кнопка опинилась там, де виділення, а не там, де вікно.
import { render, screen, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EntitySelectionAction } from "../features/documents/EntitySelectionAction";

const PANE = { left: 320, top: 140, width: 900, height: 600 };
const SELECTION = { left: 700, right: 780, top: 400, bottom: 424 };

function mountPane() {
  const pane = document.createElement("div");
  pane.className = "document-content";
  Object.defineProperty(pane, "scrollLeft", { value: 0, writable: true });
  Object.defineProperty(pane, "scrollTop", { value: 900, writable: true });
  pane.getBoundingClientRect = () => ({ ...PANE, right: PANE.left + PANE.width,
    bottom: PANE.top + PANE.height, x: PANE.left, y: PANE.top, toJSON: () => "" });
  // Текст і кнопка — СУСІДИ всередині панелі, як у застосунку: React-корінь
  // чистить свій контейнер, тож монтувати компонент поверх тексту не можна.
  const article = document.createElement("article");
  const text = document.createTextNode("Тут стоїть Девід Гʼюм посеред тексту");
  article.appendChild(text);
  const mount = document.createElement("div");
  pane.append(article, mount);
  document.body.appendChild(pane);
  return { pane, text, mount };
}

function selectWord(text: Text, from: number, to: number) {
  const range = document.createRange();
  range.setStart(text, from);
  range.setEnd(text, to);
  // jsdom не рахує геометрію тексту — підставляємо прямокутник, який дав би
  // браузер. Перевіряємо не вимірювання, а те, що воно взагалі береться.
  range.getClientRects = (() => {
    const rect = { ...SELECTION, width: 80, height: 24, x: SELECTION.left, y: SELECTION.top, toJSON: () => "" };
    return Object.assign([rect], { item: () => rect, length: 1 });
  }) as unknown as Range["getClientRects"];
  vi.spyOn(window, "getSelection").mockReturnValue({
    rangeCount: 1,
    getRangeAt: () => range,
    toString: () => text.data.slice(from, to),
  } as unknown as Selection);
  act(() => { document.dispatchEvent(new Event("selectionchange")); });
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("проводка кнопки замовлення", () => {
  it("стає за координатами панелі читання з поправкою на прокрут", () => {
    const { text, mount } = mountPane();
    const view = render(<EntitySelectionAction documentPath="a.md" onOrder={() => {}} />, { container: mount });
    selectWord(text, 11, 21);
    const button = screen.getByRole("button", { name: /У сутності/ });
    // 780 − 320 = 460 по горизонталі; 400 − 140 + 900 − 6 = 1154 по вертикалі.
    expect(button.style.left).toBe("460px");
    expect(button.style.top).toBe("1154px");
    view.unmount();
  });

  it("зникає при прокруті", () => {
    const { pane, text, mount } = mountPane();
    render(<EntitySelectionAction documentPath="a.md" onOrder={() => {}} />, { container: mount });
    selectWord(text, 11, 21);
    expect(screen.queryByRole("button", { name: /У сутності/ })).not.toBeNull();
    act(() => { pane.dispatchEvent(new Event("scroll", { bubbles: false })); });
    expect(screen.queryByRole("button", { name: /У сутності/ })).toBeNull();
  });

  it("зникає при кліку повз", () => {
    const { text, mount } = mountPane();
    render(<EntitySelectionAction documentPath="a.md" onOrder={() => {}} />, { container: mount });
    selectWord(text, 11, 21);
    act(() => { document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); });
    expect(screen.queryByRole("button", { name: /У сутності/ })).toBeNull();
  });

  it("виділення поза панеллю читання кнопки не показує", () => {
    const outside = document.createElement("div");     // ані .document-content, ані всередині неї
    document.body.appendChild(outside);
    const text = document.createTextNode("Текст у панелі властивостей");
    outside.appendChild(text);
    const host = mountPane();
    render(<EntitySelectionAction documentPath="a.md" onOrder={() => {}} />, { container: host.mount });
    selectWord(text, 0, 5);
    expect(screen.queryByRole("button", { name: /У сутності/ })).toBeNull();
  });
});
