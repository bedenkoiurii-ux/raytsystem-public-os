"""Сутності в документах: підсвітка покриття і замовлення з виділення.

Рішення Юрія 2026-08-03. Дві речі, одна причина — **побачити, де бібліотека
знає сутність, а де ні**:

  підсвітка   — кожне входження кожної сутності, що має картку. Немає
                підсвітки = картки немає або форма не впізнана. Це індикатор
                покриття, а не прикраса, тому підсвічуються ВСІ входження, а
                не перше на сторінці (скасоване правило початку проєкту).
  замовлення  — виділив у читанні слово, якого бібліотека не знає → рядок у
                реєстрі; далі його бере конвеєр `karty` звичайним порядком.

**Підсвітка живе тільки в рендері.** Тут віддається мапа форм; markdown-файл
не змінюється ніколи — ні цим модулем, ні фронтом.

**Вузький ендпойнт навмисно** — той самий вибір, що в `reception_routes`:
наріжний API документів вимагає sha/snapshot/Idempotency-Key і заводить
ревізію на кожен запис, а тут дописується рядок таблиці в один відомий файл.
Шлях реєстру зашитий у модулі: з клієнта приходить лише вміст рядка.
"""
from __future__ import annotations

import json
import re
import unicodedata
from datetime import date
from pathlib import Path
from typing import Annotated, Any, Callable

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

INDEX = "90-Meta/entity-index.json"
ORDERS = "00-Inbox/ЗАМОВЛЕННЯ-СУТНОСТЕЙ.md"
STATUSES = ("замовлено", "картка є", "у sources", "закрито")

ORDERS_HEADER = """---
title: "Замовлення сутностей"
type: moc
status: linked
lang: uk
topics: [сутності, картки, замовлення]
tags: []
aliases: []
ai_generated: true
audience: internal
---

# Замовлення сутностей

Вхід конвеєра `karty`. Один рядок — один термін, замовлений із читання документа.

**Документ-джерело не редагується ніколи.** Прив'язка тримається на шляху й
цитаті-контексті, а не на позначці всередині тексту: текст автора недоторканний
(правило 4), і замовлення не має права лишати в ньому слід.

**Статуси:** замовлено · картка є · у sources · закрито.

| Термін | Документ | Контекст | Дата | Статус |
|---|---|---|---|---|
"""


class Order(BaseModel):
    term: str = Field(min_length=2, max_length=120)
    document: str = Field(min_length=1, max_length=400)
    context: str = Field(default="", max_length=600)


class AliasProposal(BaseModel):
    term: str = Field(min_length=2, max_length=120)
    card_path: str = Field(min_length=1, max_length=400)
    card_title: str = Field(min_length=1, max_length=200)
    document: str = Field(min_length=1, max_length=400)
    context: str = Field(default="", max_length=600)


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", text)).strip().lower()


def _wake_karty() -> None:
    """Знімає сентинел «робота вичерпана» з конвеєра карток.

    Без цього замовлення лягало б у реєстр і не рухалось: `karty` поставив
    `karty.done`, вичерпавши чергу недобору, а `ConveyorResume` не піднімає
    цикл, поки сентинел лежить. Робота зʼявилась — сентинел більше не правда.

    Тихо мовчимо про помилки: замовлення вже записане, і невдале пробудження
    не привід відмовляти автору. Конвеєр підніметься наступним циклом варти.
    """
    try:
        (Path.home() / ".writer-lab" / "karty.done").unlink(missing_ok=True)
    except OSError:
        pass


def _cell(text: str) -> str:
    """Рядок таблиці не має права зламати таблицю: труби й переноси знешкоджуємо."""
    return re.sub(r"\s+", " ", text).replace("|", "¦").strip()


def create_entity_router(root: Path, *, require_session: Callable[..., Any]) -> APIRouter:
    router = APIRouter(prefix="/api/v1")
    index_path = root / INDEX
    orders_path = root / ORDERS

    @router.get("/entities/known")
    def entity_known(term: str, _session=Depends(require_session)) -> Any:
        """Чи знає бібліотека це слово — для діалогу «схоже вже є».

        Окремо від `/entities/forms` (`map_routes`), який віддає словник для
        підсвітки: там потрібні всі форми одразу, тут — відповідь про одне
        слово, з підказками. Дублювати підсвітку тут було б помилкою: механізм
        автопідсвітки живе з 28.07 і працює.
        """
        try:
            data = json.loads(index_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {"exact": [], "similar": [], "stale": True}
        cards, forms = data.get("cards", {}), data.get("forms", {})
        key = _norm(term)
        card = lambda uid: {"uid": uid, **{k: cards[uid][k] for k in ("title", "path")}} if uid in cards else None
        exact = [c for c in (card(u) for u in forms.get(key, [])) if c]
        similar = []
        if not exact:
            for form, uids in forms.items():
                if key in form or form in key:
                    similar += [c for c in (card(u) for u in uids) if c]
                if len(similar) >= 8:
                    break
        seen, unique = set(), []
        for c in similar:
            if c["uid"] not in seen:
                seen.add(c["uid"])
                unique.append(c)
        return {"exact": exact, "similar": unique[:8], "stale": False}

    def _rows() -> list[dict[str, str]]:
        if not orders_path.is_file():
            return []
        out = []
        for line in orders_path.read_text(encoding="utf-8").splitlines():
            if not line.startswith("| ") or line.startswith("| Термін") or set(line) <= set("| -"):
                continue
            cells = [c.strip() for c in line.strip("|").split("|")]
            if len(cells) >= 5:
                out.append({"term": cells[0], "document": cells[1], "context": cells[2],
                            "date": cells[3], "status": cells[4]})
        return out

    @router.get("/entity-orders")
    def entity_orders(_session=Depends(require_session)) -> Any:
        rows = _rows()
        return {"items": rows,
                "queued": sum(1 for r in rows if r["status"] == "замовлено")}

    @router.post("/entity-orders")
    def add_entity_order(payload: Order, _session=Depends(require_session)) -> Any:
        term = payload.term.strip()
        if not orders_path.is_file():
            orders_path.parent.mkdir(parents=True, exist_ok=True)
            orders_path.write_text(ORDERS_HEADER, encoding="utf-8")
        rows = _rows()
        # Той самий термін із того самого документа — не новий рядок. Ідемпотентність
        # за змістом рядка, не за часом натискання: подвійний клік не має плодити чергу.
        for row in rows:
            if _norm(row["term"]) == _norm(term) and row["document"] == payload.document:
                return {"ok": True, "added": False, "reason": "вже замовлено"}
        line = "| {} | {} | {} | {} | замовлено |\n".format(
            _cell(term), _cell(payload.document), _cell(payload.context), date.today().isoformat())
        with orders_path.open("a", encoding="utf-8") as fh:
            fh.write(line)
        _wake_karty()
        return {"ok": True, "added": True, "queued": sum(1 for r in rows if r["status"] == "замовлено") + 1}

    @router.post("/entity-orders/alias")
    def propose_alias(payload: AliasProposal, _session=Depends(require_session)) -> Any:
        """Alias до наявної картки — пропозицією в Приймальню, не правкою картки.

        Різниця принципова. Замовлення нової сутності нічого чужого не чіпає й
        іде прямо в чергу. Alias дописується в **чужу картку**, а картка —
        канон: її правка проходить воротами, де слово каже Юрій. Тому тут
        зʼявляється лише `status: queued`, і далі звичайний шлях Приймальні.
        """
        proposals = root / "00-Inbox" / "Пропозиції"
        proposals.mkdir(parents=True, exist_ok=True)
        term = payload.term.strip()
        safe = re.sub(r'[/\\:#^|\[\]]', " ", f"Alias «{term}» → {payload.card_title}")[:80].strip()
        path = proposals / f"{safe}.md"
        if path.exists():
            return {"ok": True, "added": False, "reason": "така пропозиція вже в Приймальні"}
        path.write_text(
            "---\n"
            f'title: "{safe}"\n'
            "type: proposal\n"
            "status: queued\n"
            "kind: alias сутності\n"
            f'source_origin: "виділення в документі → {payload.document}"\n'
            f"found_at: '{date.today().isoformat()}'\n"
            "found_by: замовлення сутностей\n"
            "lang: uk\n"
            "ai_generated: true\n"
            "audience: internal\n"
            "---\n\n"
            f"# {safe}\n\n"
            f"**Запропонований alias:** {term}\n\n"
            f"**Картка:** `{payload.card_path}`\n\n"
            f"**Що зробити після «у роботу»:** звірити, що це справді та сама сутність, "
            "і дописати alias у картку. Автоматично картка не змінюється.\n\n"
            "## Контекст, де слово трапилось\n\n"
            f"Документ: `{payload.document}`\n\n"
            f"> {payload.context or '(контексту не передано)'}\n",
            encoding="utf-8")
        return {"ok": True, "added": True}

    return router
