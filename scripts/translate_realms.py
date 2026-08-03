#!/usr/bin/env python3
"""Українські назви утворень історичного атласу — масово, локальною моделлю.

ЗАУВАГА ЮРІЯ (2026-07-29): «де переклад областей?.. нічого не перекладено».
Причина була в способі: я вписував переклади руками для тих назв, які бачив
на екрані, а в двадцяти одному зрізі їх **2 520**. Ручний список так не
закрити — на кожному новому році вилазить наступна сотня.

Переклад — робота механічна, не судження: тут локальна модель на місці, і
коштує нічого. Ручний словник у `MapView.tsx` лишається сильнішим за машинний:
ключові назви нашого регіону (Київська Русь, Золота Орда, Галицько-Волинське)
мають бути точними, а не «приблизно правильними».

  uv run python3 scripts/translate_realms.py            # доперекласти нове
  uv run python3 scripts/translate_realms.py --all      # перекласти все наново
"""
from __future__ import annotations

import argparse
import json
import re
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SLICES = ROOT / "web" / "src" / "features" / "historical"
OUT = SLICES / "realm-names.json"
HOST = "http://127.0.0.1:11434"
MODEL = "qwen2.5:32b"
BATCH = 20

PROMPT = """Ти перекладаєш назви історичних держав, народів і культур з англійської українською.

Правила:
- Уживай усталену українську форму, якщо вона є: «Byzantine Empire» → «Візантія»,
  «Golden Horde» → «Золота Орда», «Cuman Khanates» → «Половецькі ханства».
- Для народів і культур — множина або усталений термін: «Polynesians» → «Полінезійці»,
  «Adena Culture» → «Культура Адена».
- Не транслітеруй наосліп: спершу згадай, чи є український відповідник.
- «state», «kingdom», «empire» — це «держава», «королівство», «імперія»,
  а не «штат»: «Chola state» → «Держава Чола».
- Нічого не пояснюй, не додавай дужок і коментарів.

Формат відповіді — рівно по одному рядку на назву, з повтором оригіналу:
<номер>. <оригінал англійською> = <український переклад>
"""


def names_in_slices() -> list[str]:
    found: set[str] = set()
    for path in sorted(SLICES.glob("*.json")):
        if path.name in {"index.json", "own-layers.json", "places.json", "rivers.json", OUT.name}:
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        for feature in data.get("features", []):
            name = feature.get("properties", {}).get("name")
            if name and name.strip():
                found.add(name.strip())
    return sorted(found)


def ask(chunk: list[str]) -> dict[str, str]:
    body = "\n".join(f"{i + 1}. {name}" for i, name in enumerate(chunk))
    payload = {
        "model": MODEL,
        "prompt": f"{PROMPT}\nНазви:\n{body}\n\nПереклад:\n",
        "stream": False,
        "options": {"temperature": 0, "seed": 42, "num_ctx": 8192, "num_predict": 900},
    }
    request = urllib.request.Request(
        f"{HOST}/api/generate",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=600) as response:
        answer = json.loads(response.read())["response"]
    # Прив'язка за повтореним оригіналом, а не за номером: варто моделі пропустити
    # чи перенумерувати рядок — і решта батча приписалася б чужим назвам. Мовчазний
    # зсув гірший за брак перекладу: на мапі це неправда, яку ніхто не помітить.
    by_name = {n.casefold(): n for n in chunk}
    out: dict[str, str] = {}
    for line in answer.splitlines():
        m = re.match(r"\s*\d+[.)]\s*(.+?)\s*=\s*(.+?)\s*$", line)
        if not m:
            continue
        source = by_name.get(m.group(1).strip().strip("«»\"").casefold())
        value = m.group(2).strip().strip("«»\"")
        # Модель іноді повертає англійську як є — такий «переклад» не потрібен.
        if source and value and re.search(r"[а-яіїєґА-ЯІЇЄҐ]", value):
            out[source] = value
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true", help="перекласти все наново")
    args = ap.parse_args()

    known: dict[str, str] = {}
    if OUT.is_file() and not args.all:
        known = json.loads(OUT.read_text(encoding="utf-8"))
    todo = [n for n in names_in_slices() if n not in known]
    print(f"назв у зрізах: {len(names_in_slices())} · перекладено: {len(known)} · до роботи: {len(todo)}")

    for start in range(0, len(todo), BATCH):
        chunk = todo[start : start + BATCH]
        try:
            known.update(ask(chunk))
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            print(f"  батч {start // BATCH + 1} пропущено: {error}", flush=True)
            continue
        OUT.write_text(json.dumps(known, ensure_ascii=False, indent=0, sort_keys=True),
                       encoding="utf-8")
        print(f"  {min(start + BATCH, len(todo))}/{len(todo)} · у словнику {len(known)}", flush=True)

    print(f"\nсловник: {len(known)} назв · {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
