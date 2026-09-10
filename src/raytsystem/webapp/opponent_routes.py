"""Знахідки опонента: відкриті варіанти правки, що чекають вердикту Юрія.

Вузький ендпойнт навмисно — той самий вибір, що в `entity_routes`: читає один
похідний файл (`90-Meta/opponent-index.json`, будує `opponent_index.py`) і
віддає як є.

`/opponent/accept` — єдине місце, що пише: переносить (можливо, відредаговану
Юрієм) заміну в канон і позначає варіант `accepted`. Ціль перевіряється проти
самого індексу — приймається лише те, що застосунок і так показав як
відкриту знахідку, не довільний шлях від клієнта.
"""
from __future__ import annotations

import importlib.util
import json
import re
from datetime import date
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

INDEX = "90-Meta/opponent-index.json"
INDEX_SCRIPT = "90-Meta/scripts/opponent_index.py"


class AcceptRequest(BaseModel):
    canon_path: str
    variant_path: str
    old_text: str = Field(min_length=1)
    new_text: str = Field(min_length=1)


def _rebuild_index(root: Path) -> None:
    """Той самий `opponent_index.py`, викликаний у процесі — не subprocess:
    логіка проста (стдліб, без залежностей), а `uv run` на кожен «Прийняти»
    додав би непотрібну затримку інтерактивній дії."""
    spec = importlib.util.spec_from_file_location("opponent_index", root / INDEX_SCRIPT)
    if spec is None or spec.loader is None:
        return
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    data = module.build(root)
    (root / INDEX).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def create_opponent_router(root: Path, *, require_session: Callable[..., Any]) -> APIRouter:
    router = APIRouter(prefix="/api/v1")
    index_path = root / INDEX

    def _current_items() -> list[dict[str, str]]:
        try:
            return json.loads(index_path.read_text(encoding="utf-8")).get("items", [])
        except (OSError, ValueError):
            return []

    @router.get("/opponent/findings")
    def opponent_findings(_session=Depends(require_session)) -> Any:
        try:
            data = json.loads(index_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {"items": [], "count": 0, "stale": True}
        return {**data, "stale": False}

    @router.post("/opponent/accept")
    def opponent_accept(payload: AcceptRequest, _session=Depends(require_session)) -> Any:
        match = next(
            (
                item for item in _current_items()
                if item["canon_path"] == payload.canon_path and item["variant_path"] == payload.variant_path
            ),
            None,
        )
        if match is None:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Цієї знахідки вже нема в індексі — перечитайте сторінку."})

        canon_file = root / payload.canon_path
        variant_file = root / payload.variant_path
        canon_text = canon_file.read_text(encoding="utf-8")
        if payload.old_text not in canon_text:
            raise HTTPException(status_code=409, detail={"code": "stale_region", "message": "Канон змінився з моменту відкриття — старий фрагмент уже не збігається дослівно."})
        canon_file.write_text(canon_text.replace(payload.old_text, payload.new_text, 1), encoding="utf-8")

        variant_text = variant_file.read_text(encoding="utf-8")
        variant_text, n = re.subn(r"(?m)^status:\s*proposed\s*$", "status: accepted", variant_text, count=1)
        if n and "\naccepted:" not in variant_text:
            variant_text = variant_text.replace("status: accepted", f"status: accepted\naccepted: '{date.today().isoformat()}'", 1)
        variant_file.write_text(variant_text, encoding="utf-8")

        _rebuild_index(root)
        return {"ok": True}

    return router
