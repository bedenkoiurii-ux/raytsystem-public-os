/** Спільний фокус: яку сутність читач щойно розкрив.
 *
 *  ЗАДУМ ЮРІЯ (2026-07-29): «зробимо реакцію мапи на відкриття карточок або на
 *  відкриття врізок». Документи й Мапа — різні маршрути, які нічого не знають
 *  одне про одного; фокус — тонкий місток між ними. Читаєш есей, розкриваєш
 *  Боголюбського, переходиш на Мапу — вона вже показує його лінію життя.
 *
 *  Через localStorage, а не через React-контекст: вкладки застосунку живуть
 *  окремо, і стан має пережити перехід між ними.
 */
const KEY = "wl_focus_entity";
export const FOCUS_EVENT = "wl:focus-entity";

export function focusEntity(name: string): void {
  const value = name.trim();
  if (!value) return;
  try {
    window.localStorage.setItem(KEY, value);
  } catch { /* приватний режим — фокус лишиться тільки в цій сесії */ }
  window.dispatchEvent(new CustomEvent(FOCUS_EVENT, { detail: value }));
}

export function currentFocus(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearFocus(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch { /* noop */ }
  window.dispatchEvent(new CustomEvent(FOCUS_EVENT, { detail: null }));
}
