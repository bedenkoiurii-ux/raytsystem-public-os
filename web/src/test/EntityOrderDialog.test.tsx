// Поле «Термін» у діалозі «У сутності» — скарга Юрія 03.08: довгий термін
// обрізався («Правила мистецтва», 1992 було видно шматком).
//
// Перевіряємо три речі, які видно з коду, а не з ока: термін приходить у поле
// вже очищеним; поле багаторядкове й без внутрішнього скролу; довгий контекст
// переноситься, а не тікає за край.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EntityOrderDialog } from "../features/documents/EntityOrderDialog";

const LONG = "«Правила мистецтва: генезис і структура поля літератури», П'єр Бурдьє, 1992";
const CONTEXT = "У «Правилах мистецтва» Бурдьє показує, що поле літератури має власну "
  + "економіку престижу, і саме вона визначає, хто в ньому має право говорити від імені мистецтва.";

/** Відповідь `/entities/known`: три рубежі. За замовчуванням — нічого не знайдено. */
const answer = (body: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ exact: [], inflected: [], fuzzy: [], stale: false, ...body }),
    { status: 200, headers: { "content-type": "application/json" } });

const VELYKYI = { uid: "ent-vt", title: "Великий терор", path: "30-Research/Events/Великий терор.md" };

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(answer()));
});
// Автоочищення RTL у цьому наборі не ввімкнене — попередній діалог лишався
// в DOM, і другий тест бачив два поля «Термін».
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const show = (term: string, context = "") => render(
  <EntityOrderDialog
    request={{ term, document: "20-Essays/ЕСЕЙ №5 Основа.md", context }}
    onClose={() => {}}
    onDone={() => {}}
  />
);

const termField = () => screen.getByLabelText("Термін") as HTMLTextAreaElement;

describe("діалог «У сутності»", () => {
  it("термін приходить у поле вже очищеним", () => {
    show("(«Правила мистецтва», 1992");
    expect(termField().value).toBe("«Правила мистецтва», 1992");
  });

  it("сміття на краях знято, а вміст лишився", () => {
    show(" Маслоу, ");
    expect(termField().value).toBe("Маслоу");
  });

  it("поле багаторядкове — довгий термін не обрізається", () => {
    show(LONG);
    const field = termField();
    expect(field.tagName).toBe("TEXTAREA");
    expect(field.value).toBe(LONG);
    expect(field.value.length).toBeGreaterThan(60);
    // Значення не вкорочене: у полі рівно те, що прийшло.
    expect(field.value.endsWith("1992")).toBe(true);
  });

  it("короткий термін не роздуває поле — висоту веде вміст", () => {
    show("Маслоу");
    // rows=1 як стартова висота; далі її задає ефект за scrollHeight.
    expect(termField().rows).toBe(1);
  });

  it("довгий контекст показується цілком", () => {
    show("Бурдьє", CONTEXT);
    expect(screen.getByText(CONTEXT)).not.toBeNull();
  });

  it("порожній контекст не малює порожню цитату", () => {
    const view = show("Бурдьє", "");
    expect(view.container.querySelector(".doc-entity-quote")).toBeNull();
  });

  it("кнопка замовлення неактивна, поки термін закороткий", () => {
    show("«»");                       // після очищення лишається порожньо
    expect(termField().value).toBe("");
    expect(screen.getByRole("button", { name: "Нова сутність" })).toBeDisabled();
  });
});

describe("три рубежі «схоже вже є»", () => {
  it("відмінок знайденої сутності показує КАНОНІЧНУ назву картки", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(answer({ inflected: [VELYKYI] })));
    show("Великому терору");
    // Виділено «Великому терору», а показано «Великий терор» — під цим іменем
    // сутність живе в бібліотеці.
    expect(await screen.findByText("Великий терор")).not.toBeNull();
    expect(screen.getByText("Схоже, вже є")).not.toBeNull();
  });

  it("знайдене НЕ закриває «Нову сутність» — перевірка це підказка, не брама", () => {
    // Рішення Юрія 03.08: омоніми існують, і система не має права вирішувати
    // за автора. Юрій не зміг завести поняття «максима» саме через це.
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(answer({ inflected: [VELYKYI] })));
    show("Великому терору");
    expect(screen.getByRole("button", { name: "Нова сутність" })).not.toBeDisabled();
  });

  it("дві дії на знайденій картці: відкрити й дописати alias", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(answer({ inflected: [VELYKYI] })));
    render(
      <EntityOrderDialog
        request={{ term: "Великому терору", document: "a.md", context: "" }}
        onClose={() => {}} onDone={() => {}} onOpenCard={() => {}}
      />
    );
    await screen.findByText("Великий терор");
    expect(screen.getByRole("button", { name: "відкрити картку" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "додати форму як alias" })).not.toBeNull();
  });

  it("нечіткий збіг подається як здогад, а не як факт", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(answer({ fuzzy: [VELYKYI] })));
    show("терор великий сталінський");
    expect(await screen.findByText("Можливо, це")).not.toBeNull();
    expect(screen.queryByText("Схоже, вже є")).toBeNull();
  });

  it("порожні всі три рубежі — і лише тоді «Нова сутність» доступна", async () => {
    show("Незнанославльському вивертові");
    expect(await screen.findByText(/справді нова сутність/)).not.toBeNull();
    expect(screen.getByRole("button", { name: "Нова сутність" })).not.toBeDisabled();
  });
});
