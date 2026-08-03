// Позиція кнопки «У сутності» — чотири випадки зі скарги Юрія 03.08.
//
// Перша редакція ставила кнопку `position: fixed` за координатами вікна, і вона
// зʼявлялась біля правої панелі властивостей замість виділеного слова. Тепер
// координати рахуються ВІДНОСНО панелі читання з поправкою на її прокрут, тож
// тест перевіряє саме цю арифметику, а не наявність елемента.
import { describe, expect, it } from "vitest";
import { place } from "../features/documents/EntitySelectionAction";

/** Панель читання: лівий край 320 (за деревом), верх 140 (за вкладками й шапкою). */
const PANE = { left: 320, top: 140, width: 900 };
const NO_SCROLL = { left: 0, top: 0 };

describe("позиція кнопки замовлення", () => {
  it("стає біля КІНЦЯ виділення, а не біля лівого краю абзацу", () => {
    // Слово посеред рядка: 700…780 по горизонталі.
    const spot = place({ left: 700, right: 780, top: 400, bottom: 424 }, PANE, NO_SCROLL);
    expect(spot.left).toBe(780 - 320);
    expect(spot.below).toBe(false);
  });

  it("виділення на початку рядка не виносить кнопку за лівий край панелі", () => {
    // Кінець виділення — 40 від краю панелі, але кнопка центрується по цій точці
    // і половиною вилізла б назовні. Тому анкер затиснуто півшириною.
    const spot = place({ left: 322, right: 360, top: 400, bottom: 424 }, PANE, NO_SCROLL);
    expect(spot.left).toBe(58);
  });

  it("виділення в кінці рядка не виносить кнопку на сусідню панель", () => {
    // Панель завширшки 900 — далі неї вже властивості, саме туди кнопка й
    // тікала у першій редакції.
    const spot = place({ left: 1180, right: 1240, top: 400, bottom: 424 }, PANE, NO_SCROLL);
    expect(spot.left).toBe(900 - 58);
  });

  it("посеред рядка не затискається зовсім", () => {
    const spot = place({ left: 700, right: 780, top: 400, bottom: 424 }, PANE, NO_SCROLL);
    expect(spot.left).toBe(460);
  });

  it("біля верхнього краю кнопка стає ПІД виділенням, а не над", () => {
    // Рядок майже впритул до верху панелі: над ним кнопці немає місця.
    const spot = place({ left: 700, right: 780, top: 150, bottom: 174 }, PANE, NO_SCROLL);
    expect(spot.below).toBe(true);
    expect(spot.top).toBeGreaterThan(174 - 140);      // під нижнім краєм виділення
  });

  it("нижче в тексті кнопка стає над виділенням", () => {
    const spot = place({ left: 700, right: 780, top: 500, bottom: 524 }, PANE, NO_SCROLL);
    expect(spot.below).toBe(false);
    expect(spot.top).toBe(500 - 140 - 6);
  });

  it("після прокруту кнопка лишається впритул до виділеного", () => {
    // Панель прокручена на 900 px: екранні координати ті самі, а всередині
    // панелі точка лежить на 900 нижче. Без цієї поправки кнопка з'їхала б
    // до початку документа.
    const scrolled = place({ left: 700, right: 780, top: 400, bottom: 424 }, PANE, { left: 0, top: 900 });
    const still = place({ left: 700, right: 780, top: 400, bottom: 424 }, PANE, NO_SCROLL);
    expect(scrolled.top - still.top).toBe(900);
    expect(scrolled.left).toBe(still.left);
  });

  it("горизонтальний прокрут враховується так само", () => {
    const spot = place({ left: 700, right: 780, top: 400, bottom: 424 }, PANE, { left: 120, top: 0 });
    expect(spot.left).toBe(780 - 320 + 120);
  });
});
