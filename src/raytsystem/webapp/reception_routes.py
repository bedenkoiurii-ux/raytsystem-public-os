"""Приймальня — черга матеріалів на входження в бібліотеку.

Черга двофазна (рішення Юрія 2026-07-27): модель не працює над матеріалом,
поки автор не сказав «у роботу».

  queued  ── «У роботу» ─→ in_work ── варта розібрала ─→ proposed ─→ accepted
     │                                                       ├─→ revise
     └── «Не треба» ─→ rejected                              └─→ rejected

  queued   — знайдено скануванням (`inbox_scan.py`, без моделі): назва, звідки,
             обсяг, повний текст. Жодного судження ще не робилось.
  in_work  — автор запустив у роботу; варта бере В РОБОТУ ЛИШЕ ЦЕ.
  proposed — розібрано, чекає остаточної резолюції.

Резолюція пишеться назад у frontmatter; конвеєр наступним прогоном її виконує.

Вузький ендпойнт навмисно: наріжний API документів вимагає sha/snapshot/CSRF
заради двох полів frontmatter — для трьох кнопок це зайве.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Annotated, Any, Callable

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

PROPOSALS = "00-Inbox/Пропозиції"
REJECTED = "00-Inbox/Відхилені"
# Що дозволено з якої фази: нерозібране не можна «прийняти», розібране —
# не можна вдруге «пустити в роботу».
ALLOWED = {
    "queued": {"in_work", "rejected"},
    "proposed": {"accepted", "revise", "rejected"},
}
VERDICTS = {v for s in ALLOWED.values() for v in s}


class Resolution(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    verdict: str
    resolution: str = Field(default="", max_length=4000)


def _split(text: str) -> tuple[str, str]:
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.S)
    return (m.group(1), m.group(2)) if m else ("", text)


def _field(fm: str, key: str) -> str:
    m = re.search(rf"^{key}:\s*(.+)$", fm, re.M)
    return m.group(1).strip().strip("'\"") if m else ""


def _lead(body: str) -> str:
    for line in body.splitlines():
        s = line.strip()
        if s and not s.startswith(("#", ">", "-", "|", "*")):
            return re.sub(r"[*\[\]]", "", s)[:180]
    return ""


def create_reception_router(root: Path, *, require_session: Callable[..., Any]) -> APIRouter:
    router = APIRouter(prefix="/api/v1")
    inbox = (root / PROPOSALS).resolve()

    def _safe(name: str) -> Path | None:
        """Ім'я приходить від клієнта — жодних шляхів, лише файл усередині черги."""
        if "/" in name or "\\" in name or name.startswith("."):
            return None
        path = (inbox / name).resolve()
        if not str(path).startswith(str(inbox)) or path.suffix != ".md" or not path.is_file():
            return None
        return path

    @router.get("/reception")
    def reception(_session=Depends(require_session)) -> dict[str, Any]:
        items = []
        if inbox.is_dir():
            for p in sorted(inbox.glob("*.md"), key=lambda x: x.stat().st_mtime, reverse=True):
                fm, body = _split(p.read_text(encoding="utf-8", errors="ignore"))
                status = _field(fm, "status")
                if status not in ALLOWED:
                    continue
                items.append({
                    "name": p.name,
                    "title": _field(fm, "title") or p.stem,
                    "kind": _field(fm, "kind") or "матеріал",
                    "phase": status,
                    "size_chars": _field(fm, "size_chars"),
                    "source_origin": _field(fm, "source_origin"),
                    "proposed_at": _field(fm, "proposed_at") or _field(fm, "found_at"),
                    "lead": _lead(body),
                    "body": body[:20_000],
                })
        return {"items": items}

    @router.post("/reception/resolve")
    def resolve(payload: Resolution, _session=Depends(require_session)) -> Any:
        if payload.verdict not in VERDICTS:
            return JSONResponse(status_code=400, content={"error": {"code": "bad_verdict"}})
        path = _safe(payload.name)
        if path is None:
            return JSONResponse(status_code=404, content={"error": {"code": "not_found"}})
        if payload.verdict == "revise" and not payload.resolution.strip():
            return JSONResponse(status_code=400, content={"error": {"code": "resolution_required"}})

        text = path.read_text(encoding="utf-8")
        fm, body = _split(text)
        phase = _field(fm, "status")
        if payload.verdict not in ALLOWED.get(phase, set()):
            # Головна перепона двофазності: «прийняти» нерозібране неможливо.
            return JSONResponse(status_code=409, content={"error": {"code": "wrong_phase",
                "message": f"З фази «{phase}» так вчинити не можна."}})
        fm = re.sub(r"^status:.*$", f"status: {payload.verdict}", fm, count=1, flags=re.M) or fm
        if payload.resolution.strip():
            line = "resolution: " + payload.resolution.strip().replace("\n", " ")
            fm = re.sub(r"^resolution:.*$", line, fm, count=1, flags=re.M) if re.search(r"^resolution:", fm, re.M) else fm + "\n" + line
        path.write_text(f"---\n{fm}\n---\n{body}", encoding="utf-8")

        # Відхилене прибираємо з черги одразу — історія рішень зберігається.
        if payload.verdict == "rejected":
            dest = (root / REJECTED)
            dest.mkdir(parents=True, exist_ok=True)
            path.rename(dest / path.name)

        return {"ok": True, "verdict": payload.verdict}

    return router
