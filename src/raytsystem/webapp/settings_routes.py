"""Налаштування Writer-Lab — керування списками, якими живляться фонові задачі.

Принцип (рішення Юрія 2026-07-26): **налаштування задаються в застосунку, а не
в діалозі з ШІ**. Витрачати токени й розмову на список тек — безглуздо; це
звичайний функціонал, яким автор оперує сам.

Механізм навмисно узагальнений: кожен список — простий текстовий файл у
~/.writer-lab (по рядку на запис). Додати нову категорію = дописати рядок у
LISTS, а не будувати нову підсистему. Наступні задачі (теки для інших
конвеєрів, виключення, джерела) вбудовуються тим самим ендпойнтом.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

STORE = Path.home() / ".writer-lab"

# ключ → (файл, людська назва, пояснення)
LISTS: dict[str, tuple[str, str, str]] = {
    "watch": (
        "inbox-watch.txt",
        "Теки стеження",
        "Варта інбоксу перевіряє ці теки на нові тексти. Знайдене конвертується, "
        "розбирається й потрапляє в Приймальню — не в бібліотеку.",
    ),
}


class ListEdit(BaseModel):
    key: str = Field(min_length=1, max_length=40)
    value: str = Field(min_length=1, max_length=1000)
    action: str = Field(default="add")   # add | remove


def _read(fname: str) -> list[str]:
    path = STORE / fname
    if not path.is_file():
        return []
    return [l.strip() for l in path.read_text(encoding="utf-8").splitlines() if l.strip() and not l.startswith("#")]


def _write(fname: str, items: list[str]) -> None:
    STORE.mkdir(parents=True, exist_ok=True)
    (STORE / fname).write_text("\n".join(items) + ("\n" if items else ""), encoding="utf-8")


def create_settings_router(root: Path, *, require_session: Callable[..., Any]) -> APIRouter:
    router = APIRouter(prefix="/api/v1")

    @router.get("/settings/lists")
    def lists(_session=Depends(require_session)) -> dict[str, Any]:
        out = []
        for key, (fname, label, hint) in LISTS.items():
            items = _read(fname)
            out.append({
                "key": key,
                "label": label,
                "hint": hint,
                # existing: чи шлях реально доступний — щоб автор бачив мертві записи,
                # а не гадав, чому варта мовчить (macOS може не дати доступу до теки).
                "items": [{"value": v, "exists": Path(v).expanduser().is_dir()} for v in items],
            })
        return {"lists": out}

    @router.post("/settings/lists/edit")
    def edit(payload: ListEdit, _session=Depends(require_session)) -> Any:
        entry = LISTS.get(payload.key)
        if entry is None:
            return JSONResponse(status_code=404, content={"error": {"code": "unknown_list"}})
        fname = entry[0]
        value = payload.value.strip().rstrip("/")
        items = _read(fname)

        if payload.action == "remove":
            items = [i for i in items if i != value]
        else:
            path = Path(value).expanduser()
            if not path.is_absolute():
                return JSONResponse(status_code=400, content={"error": {"code": "path_not_absolute",
                    "message": "Потрібен повний шлях, наприклад /Users/Nemo/Тексти"}})
            if not path.is_dir():
                return JSONResponse(status_code=400, content={"error": {"code": "path_not_found",
                    "message": "Теки за цим шляхом немає або немає доступу до неї."}})
            value = str(path)
            if value in items:
                return {"ok": True, "items": items}     # ідемпотентно: повтор не дублює
            items.append(value)

        _write(fname, items)
        return {"ok": True, "items": items}

    return router
