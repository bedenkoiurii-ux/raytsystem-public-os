"""Чи знає бібліотека це слово — три рубежі, від точного до нечіткого.

Привід (Юрій зловив живцем 03.08): виділення «Великому терору» діалог оголосив
невідомим, хоча картка «Великий терор» існує. Перевірка йшла точним рядком, а
індекс імен зберігає **поверхневі форми**: там є «великий терор» (з назви) і
«великого терору» (бо автор один раз написав `[[Великий терор|Великого
терору]]`). Давального відмінка ніхто руками не писав — отже його немає.

**Це один діагноз на обидва боки.** Підсвітка в тексті мовчить рівно з тієї ж
причини й ще й з другої: її правило меж терпить хвіст до трьох літер у КІНЦІ
форми, а «великий терор» → «Великому терору» розходиться посередині першого
слова. Хвіст тут не рятує, бо змінилось не закінчення останнього слова, а
закінчення першого.

Тому зіставлення йде основами слів, а не буквою:

  рубіж 1  точна форма в індексі          → та сама сутність, певно
  рубіж 2  збіг основ у тому ж порядку    → та сама сутність в іншому відмінку
  рубіж 3  нечіткий ключ (набір основ)    → «можливо, це …», без певності

Третій рубіж — та сама механіка, що в `sources_queue_check`: набір значущих слів
замість рядка. Різниця одна — там слова, тут основи, бо ловимо відмінки, а не
переказ.
"""
from __future__ import annotations

import re
import unicodedata

#: Довжина основи. Пʼять — бо «велик|ому» і «велик|ий» розходяться на шостій
#: літері, а коротші основи вже злипаються («крим» і «криміналістика»).
STEM = 5
#: Скільки слів ключа мусить збігтися на третьому рубежі. Два з трьох —
#: та сама пропорція, що в `sources_queue_check`.
FUZZY_SHARE = 0.66


def norm(text: str) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", text)).strip().lower()


def stems(text: str) -> tuple[str, ...]:
    """Слова терміна, вкорочені до основи. Порядок збережено."""
    words = re.findall(r"\w+", norm(text))
    return tuple(word[:STEM] for word in words if len(word) >= 3)


def _cards(uids, cards: dict) -> list[dict]:
    out = []
    for uid in uids:
        card = cards.get(uid)
        if card:
            out.append({"uid": uid, "title": card["title"], "path": card["path"]})
    return out


def find(term: str, forms: dict[str, list[str]], cards: dict) -> dict[str, list[dict]]:
    """Три рубежі. Порожній усюди — сутність справді нова."""
    key = norm(term)
    if not key:
        return {"exact": [], "inflected": [], "fuzzy": []}

    exact = _cards(forms.get(key, []), cards)
    if exact:
        return {"exact": exact, "inflected": [], "fuzzy": []}

    want = stems(term)
    if not want:
        return {"exact": [], "inflected": [], "fuzzy": []}

    inflected: list[dict] = []
    fuzzy: list[dict] = []
    want_set = frozenset(want)
    # Щонайменше ДВА спільні слова. Частка сама по собі бреше на коротких
    # термінах: для двослівного «Великому терору» 66 % округлялись до одного
    # слова, і у відповідь прилітали «Скіфія» та «Великий розкол» — усе, де
    # трапилось «велик». Одне спільне слово доказом не є.
    need = max(2, round(len(want_set) * FUZZY_SHARE))
    if len(want_set) < 2:
        # Однослівний термін: або збіг основи (рубіж 2), або нічого. Здогадам
        # тут нема на чому стояти.
        need = len(want_set) + 1
    seen: set[str] = set()

    for form, uids in forms.items():
        got = stems(form)
        if not got:
            continue
        if got == want:                       # той самий склад і порядок
            for card in _cards(uids, cards):
                if card["uid"] not in seen:
                    seen.add(card["uid"])
                    inflected.append(card)
            continue
        # Нечіткий рубіж: перестановка, зайве або пропущене слово.
        if len(frozenset(got) & want_set) >= need:
            for card in _cards(uids, cards):
                if card["uid"] not in seen:
                    seen.add(card["uid"])
                    fuzzy.append(card)

    # Знайдене точніше витісняє здогад: одна картка не має стояти двічі.
    strong = {card["uid"] for card in inflected}
    fuzzy = [card for card in fuzzy if card["uid"] not in strong]
    return {"exact": [], "inflected": inflected, "fuzzy": fuzzy[:8]}
