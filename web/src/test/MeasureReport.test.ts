// Показ заміру — той самий код і ті самі тести, що й у вимірюваного.
//
// Три випадки за два дні (сьомий клас у patterns.md) звелись до одного: топ-N
// різав багатослівну назву по пробілу. Тут це закріплено тестом, щоб четвертого
// разу не було.
import { describe, expect, it } from "vitest";
import { countHits, formatTop, hitKey, parseHitKey, topHits } from "../features/documents/measureReport";

describe("показ результатів заміру", () => {
  it("багатослівна назва лишається цілою", () => {
    const key = hitKey({ title: "Розгром Києва Боголюбським", word: "1169" });
    expect(parseHitKey(key)).toEqual({ title: "Розгром Києва Боголюбським", word: "1169" });
  });

  it("назва з дужками, дефісом і лапками теж", () => {
    for (const title of ["Істр (Дунай)", "Ордін-Нащокін", "Філофей (старець Псковський)", "«Тренос»"]) {
      expect(parseHitKey(hitKey({ title, word: "слово" })).title).toBe(title);
    }
  });

  it("слово з пробілом усередині не ламає пару", () => {
    const hit = { title: "Річ Посполита", word: "Річ Посполиту" };
    expect(parseHitKey(hitKey(hit))).toEqual(hit);
  });

  it("рахує пари, а не рядки", () => {
    const counted = countHits([
      { title: "Москва", word: "Москви" },
      { title: "Москва", word: "Москви" },
      { title: "Москва", word: "Москву" },
    ]);
    expect(counted.size).toBe(2);
    const top = topHits(counted);
    expect(top[0]).toEqual({ title: "Москва", word: "Москви", count: 2 });
  });

  it("верхівка впорядкована за кількістю", () => {
    const counted = countHits([
      { title: "А", word: "а" },
      { title: "Б", word: "б" }, { title: "Б", word: "б" }, { title: "Б", word: "б" },
      { title: "В", word: "в" }, { title: "В", word: "в" },
    ]);
    expect(topHits(counted).map((h) => h.title)).toEqual(["Б", "В", "А"]);
  });

  it("обмеження верхівки працює", () => {
    const counted = countHits(Array.from({ length: 50 }, (_, i) => ({ title: `К${i}`, word: "с" })));
    expect(topHits(counted, 20)).toHaveLength(20);
  });

  it("рядок друку показує обидва поля цілими", () => {
    const counted = countHits([{ title: "Розгром Києва Боголюбським", word: "1169" }]);
    expect(formatTop(counted)[0]).toBe("  1×  Розгром Києва Боголюбським  ←  «1169»");
  });

  it("чужий ключ не ріжеться навмання", () => {
    // Ключ, зроблений не hitKey: чесніше віддати все як назву, ніж розрізати
    // по пробілу й показати «Розгром ← Києва».
    expect(parseHitKey("Розгром Києва Боголюбським 1169"))
      .toEqual({ title: "Розгром Києва Боголюбським 1169", word: "" });
  });

  it("порожній вхід не падає", () => {
    expect(topHits(countHits([]))).toEqual([]);
    expect(formatTop(new Map())).toEqual([]);
  });
});
