"""Знахідки опонента: відкриті варіанти правки, що чекають вердикту Юрія.

Вузький ендпойнт навмисно — той самий вибір, що в `entity_routes`: читає один
похідний файл (`90-Meta/opponent-index.json`, будує `opponent_index.py`) і
віддає як є. Жодного запису сюди немає: правку в канон вносить лише Юрій
(рукою чи, коли з'явиться, кнопкою «Прийняти варіант»), не цей роут.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, Depends

INDEX = "90-Meta/opponent-index.json"


def create_opponent_router(root: Path, *, require_session: Callable[..., Any]) -> APIRouter:
    router = APIRouter(prefix="/api/v1")
    index_path = root / INDEX

    @router.get("/opponent/findings")
    def opponent_findings(_session=Depends(require_session)) -> Any:
        try:
            data = json.loads(index_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {"items": [], "count": 0, "stale": True}
        return {**data, "stale": False}

    return router
