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
            out += [f"       {l[:200]}" for l in lines]
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


if __name__ == "__main__":
    mcp.run()
