#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""library_mcp.py — MCP-сервер над бібліотекою Writer-Lab.

Робить бібліотеку знань Юрія видимою будь-якому клієнту Claude, що вміє MCP
(Claude Desktop, Claude Code), а не лише сесіям Code у цій теці.

Запуск (Claude сам не запускає — це робить клієнт через свій конфіг):
    uv run --with mcp python library_mcp.py

Три інструменти. Головний — `library_context`: він відповідає на питання
«що бібліотека вже знає про X», тобто виконує правило «спершу бібліотека,
потім інтернет» для будь-якого нового проєкту.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

from mcp.server.fastmcp import FastMCP

VAULT = Path.home() / "Writer-Lab/Library"
sys.path.insert(0, str(VAULT / "90-Meta/scripts"))
from card_prep import PRIORITY, SKIP, scan  # noqa: E402  — логіка пошуку вже написана, не дублюємо

# Секрети назовні не віддаємо НІКОЛИ — правило бібліотеки, не оптимізація.
SECRET = re.compile(r"secret|token|\.env|credential|keychain|password", re.I)

mcp = FastMCP("writer-lab")


def _safe(rel: Path) -> bool:
    return not SECRET.search(str(rel)) and not any(p in SKIP for p in rel.parts)


def _lead(path: Path) -> str:
    """Перший змістовний абзац документа. За стандартом kartky кожна картка
    починається з жирного ліду («**Митрополит Київський (1647–1657)**, …») —
    він і є найкращою анотацією, окремого поля description заводити не треба."""
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return ""
    body = text.split("---", 2)[-1] if text.startswith("---") else text
    for line in body.splitlines():
        s = line.strip()
        if s and not s.startswith(("#", ">", "-", "|", "*", "=")):
            return re.sub(r"[*\[\]]|\|[^\]]*", "", s)[:220]
    return ""


@mcp.tool()
def library_context(topic: str, per_file: int = 2) -> str:
    """Що бібліотека вже знає про тему. Викликати ПЕРЕД пошуком в інтернеті
    і перед початком будь-якого нового проєкту на цю тему."""
    found = scan(topic, per_file)
    if not found:
        return f"Бібліотека не має документів про «{topic}»."
    out = [f"Бібліотека має документи про «{topic}». Порядок = вага джерела.\n"]
    for root, label in PRIORITY:
        items = [(r, n, ls) for r, n, ls in found.get(root, []) if _safe(r)]
        if not items:
            continue
        out.append(f"── {root} · {label}")
        for rel, n, lines in sorted(items, key=lambda x: -x[1])[:8]:
            out.append(f"   {rel}  ({n} згадок)")
            lead = _lead(VAULT / rel)
            if lead:
                out.append(f"       {lead}")
            out += [f"       · {l[:180]}" for l in lines]
    return "\n".join(out)


@mcp.tool()
def library_search(query: str, limit: int = 20) -> str:
    """Знайти документи бібліотеки за словом у назві або тексті."""
    pat = re.compile(re.escape(query), re.I)
    hits = []
    for path in VAULT.rglob("*.md"):
        rel = path.relative_to(VAULT)
        if not _safe(rel):
            continue
        try:
            in_body = pat.search(path.read_text(encoding="utf-8"))
        except OSError:
            continue
        if pat.search(path.stem) or in_body:
            hits.append((0 if pat.search(path.stem) else 1, str(rel)))
    if not hits:
        return f"Нічого не знайдено за «{query}»."
    return "\n".join(r for _, r in sorted(hits)[:limit])


@mcp.tool()
def library_read(name: str) -> str:
    """Прочитати документ бібліотеки за назвою або відносним шляхом."""
    target = VAULT / name
    if not target.is_file():
        matches = [p for p in VAULT.rglob(f"{name}.md") if _safe(p.relative_to(VAULT))]
        if not matches:
            return f"Документа «{name}» немає. Спробуй library_search."
        target = matches[0]
    rel = target.relative_to(VAULT)
    if not _safe(rel):
        return "Доступ до цього файлу закрито."
    return target.read_text(encoding="utf-8")[:60_000]


INBOX = VAULT / "00-Inbox/Пропозиції"


@mcp.tool()
def library_propose(title: str, content: str, kind: str = "нотатка", rationale: str = "") -> str:
    """Запропонувати новий матеріал у бібліотеку. НЕ пише в бібліотеку — кладе в
    карантин 00-Inbox/Пропозиції на схвалення Юрія. Використовувати, коли в розмові
    народилося щось варте збереження: думка, засівний документ, знахідка."""
    INBOX.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r'[/\\:*?"<>|]', "-", title).strip()[:80] or "без назви"
    path = INBOX / f"{safe}.md"
    n = 2
    while path.exists():
        path = INBOX / f"{safe} ({n}).md"
        n += 1
    from datetime import date
    head = (
        "---\n"
        f"title: {safe}\n"
        "type: proposal\n"
        "status: proposed\n"           # чекає рішення автора: прийняти / доопрацювати / відхилити
        f"kind: {kind}\n"
        f"proposed_at: '{date.today()}'\n"
        "proposed_by: chat\n"          # хто запропонував; думки автора позначати в тілі
        "lang: uk\n"
        "---\n\n"
    )
    body = content if not rationale else f"{content}\n\n---\n\n**Навіщо це в бібліотеці:** {rationale}\n"
    path.write_text(head + body, encoding="utf-8")
    return (f"Пропозицію покладено в карантин: 00-Inbox/Пропозиції/{path.name}\n"
            "Вона НЕ в бібліотеці. Юрій перегляне й вирішить: прийняти, доопрацювати чи відхилити.")


@mcp.tool()
def library_proposals() -> str:
    """Показати пропозиції, що чекають на рішення Юрія."""
    if not INBOX.is_dir():
        return "Пропозицій немає."
    items = sorted(INBOX.glob("*.md"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not items:
        return "Пропозицій немає."
    out = [f"Чекають рішення: {len(items)}\n"]
    for p in items:
        out.append(f"  · {p.stem}")
        lead = _lead(p)
        if lead:
            out.append(f"      {lead[:160]}")
    return "\n".join(out)


if __name__ == "__main__":
    mcp.run()
