"""Стрічка сенсів — як наскрізний мотив повертається крізь століття.

П'ята проєкція над тими самими даними (Дерево · Всесвіт · Таймлайн · Мапа).

**Мотив = документ із `throughline: true`** у `70-Synthesis`. Формулювання
питання — авторські, Юрієві; машина їх не чіпає. Таксономію не вигадуємо:
вона написана раніше й лежить у бібліотеці.

**Ланка ланцюга** береться з секції `## Ланцюг повторень` мотиву — там кожен
рядок каже, що саме повторюється, і посилається на документи бібліотеки, які
це тримають.

**Дата ланки — спершу з тексту рядка.** Якщо автор написав «Проповіді
"Adversus Judaeos" (386–387)», то ланка датується 386-м, а не 347-м — роком
народження Златоуста з його картки. Картка йде запасним варіантом: у неї
`time_start` означає початок життя, а не подію, про яку каже ланка.
Ланка без дати не зникає — вона стоїть у послідовності, але поза шкалою.

**Вузол** — ланка, що належить двом мотивам одночасно (Катинь — і «Непокаране
зло», і «Межа реалполітики»). Стрічка малює на цьому вертикаль: саме вузли
показують, де осі розповіді сходяться.

Ланцюг — це **теза**, не вибірка з бази: він стверджує, що явище повторюється.
Тому чернетки ланцюгів (`70-Synthesis/Чернетки`) сюди не потрапляють, поки
автор їх не прийняв, — але видно, що вони чекають.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, Depends

SYNTHESIS = "70-Synthesis"
DRAFTS = "70-Synthesis/Чернетки"
CHAIN_SECTION = "Ланцюг повторень"


def _front(text: str) -> str:
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    return m.group(1) if m else ""


def _field(fm: str, key: str) -> str:
    m = re.search(rf"^{key}:\s*(.+?)$", fm, re.M)
    return m.group(1).strip().strip("'\"") if m else ""


def _section(body: str, name: str) -> str:
    m = re.search(rf"^## {re.escape(name)}\s*\n(.*?)(?=\n## |\Z)", body, re.S | re.M)
    return m.group(1).strip() if m else ""


def _plain(text: str) -> str:
    """Рядок ланки без розмітки — так він читається у стрічці."""
    text = re.sub(r"\[\[([^\]|]+)\|([^\]]+)\]\]", r"\2", text)
    text = re.sub(r"\[\[([^\]]+)\]\]", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    return re.sub(r"[*_`]", "", text).strip(" -•").strip()


def create_senses_router(root: Path, *, require_session: Callable[..., Any]) -> APIRouter:
    router = APIRouter(prefix="/api/v1")

    def _years() -> dict[str, int]:
        """Назва документа → рік. Дату ланки беремо звідси, а не з тексту рядка."""
        out: dict[str, int] = {}
        for path in root.rglob("*.md"):
            if {".git", "graphify-out"} & set(path.relative_to(root).parts):
                continue
            fm = _front(path.read_text(encoding="utf-8", errors="ignore")[:1200])
            year = _field(fm, "time_start")
            if re.fullmatch(r"-?\d+", year or ""):
                out.setdefault(_field(fm, "title") or path.stem, int(year))
        return out

    @router.get("/senses")
    def senses(_session=Depends(require_session)) -> dict[str, Any]:
        years = _years()
        base = root / SYNTHESIS
        motifs: list[dict[str, Any]] = []
        if not base.is_dir():
            return {"motifs": [], "drafts": []}

        for path in sorted(base.glob("*.md")):
            text = path.read_text(encoding="utf-8", errors="ignore")
            fm = _front(text)
            if _field(fm, "throughline") != "true":
                continue
            body = text[len(fm) + 8:] if fm else text
            title = _field(fm, "title") or path.stem

            links: list[dict[str, Any]] = []
            for row in _section(body, CHAIN_SECTION).splitlines():
                if not row.strip().startswith("-"):
                    continue
                targets = [t.strip() for t in re.findall(r"\[\[([^\]|#]+)", row)]
                # Дата з рядка має перевагу: автор пише її там, де вона стосується
                # саме події, а не життя людини, чия картка згадана поруч.
                # Тільки явне датування в дужках: «(386–387)». Числа поза дужками
                # ловлять роки з назв джерел («терор 1917–2025») і брешуть.
                spelled = re.search(r"\((\d{3,4})(?:\s*[–—-]\s*\d{2,4})?\)", row)
                year = anchor = None
                if spelled:
                    year = int(spelled.group(1))
                    anchor = "у тексті ланки"
                else:
                    dated = sorted((years[t], t) for t in targets if t in years)
                    if dated:
                        year, anchor = dated[0]
                links.append({"text": _plain(row), "year": year, "anchor": anchor, "targets": targets})

            motifs.append({
                "title": title,
                "question": _plain(_section(body, "Питання"))[:400],
                "status": _field(fm, "synthesis_status"),
                "path": str(path.relative_to(root)),
                "links": links,
                "dated": sum(1 for x in links if x["year"] is not None),
            })

        # Вузол — ланка, спільна для двох мотивів: там осі розповіді сходяться.
        seen: dict[str, list[str]] = {}
        for motif in motifs:
            for link in motif["links"]:
                for target in link["targets"]:
                    seen.setdefault(target, []).append(motif["title"])
        for motif in motifs:
            for link in motif["links"]:
                link["shared"] = sorted({
                    other for target in link["targets"]
                    for other in seen.get(target, []) if other != motif["title"]
                })

        drafts = []
        draft_dir = root / DRAFTS
        if draft_dir.is_dir():
            for path in sorted(draft_dir.glob("*.md")):
                fm = _front(path.read_text(encoding="utf-8", errors="ignore")[:800])
                drafts.append({
                    "title": _field(fm, "title") or path.stem,
                    "variant_of": _field(fm, "variant_of").strip("[]"),
                    "path": str(path.relative_to(root)),
                })

        motifs.sort(key=lambda m: (-len(m["links"]), m["title"]))
        return {"motifs": motifs, "drafts": drafts}

    return router
