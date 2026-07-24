#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""karty-status.py — живий дашборд конвеєра карток «Крові».

Читає стан з git / логу / файлів бібліотеки (ЛИШЕ на читання — з автономним
циклом не конфліктує) і малює самодостатній HTML у стилі Райта.

  ./karty-status.py           — згенерувати один знімок → ~/.writer-lab/karty-status.html
  ./karty-status.py --watch   — перегенеровувати кожні 15 с (для живого монітора)
  ./karty-status.py --open    — згенерувати й відкрити в браузері
"""
from __future__ import annotations
import subprocess, re, sys, time, html, webbrowser
from pathlib import Path
from datetime import datetime

VAULT = Path.home() / "Writer-Lab/Library"
CHAP_DIR = VAULT / "10-Projects/4-Books/Камінь на роздоріжжі/Розділи"
EDIT_DIR = VAULT / "35-Editorial"
QUEUE = EDIT_DIR / "ЧЕРГА-ПИТАНЬ.md"
LOG = Path.home() / ".writer-lab/karty-loop.log"
PIDF = Path.home() / ".writer-lab/karty-loop.pid"
DONE = Path.home() / ".writer-lab/karty.done"
OUT = Path.home() / ".writer-lab/karty-status.html"

# Робоча послідовність за наказом (жорстка) — драйвить «поточний»
WORK_ORDER = ["09","11","12","13","14","15","16","17","18","19","01","02","03","04","05","06","07","10"]
# 08 закрито до появи практики зведень — у робочому порядку його немає, але на
# дашборді показуємо ВСІ розділи (щоб нічого не «випадало»).


def sh(*a) -> str:
    try:
        return subprocess.run(a, cwd=VAULT, capture_output=True, text=True, timeout=20).stdout.strip()
    except Exception:
        return ""


def loop_alive() -> tuple[bool, str]:
    if not PIDF.exists():
        return False, "—"
    pid = PIDF.read_text().strip()
    try:
        subprocess.run(["kill", "-0", pid], check=True, capture_output=True)
        return True, pid
    except Exception:
        return False, pid


def chapter_titles() -> dict[str, str]:
    out = {}
    for f in CHAP_DIR.glob("Камінь — Розділ *.md"):
        m = re.search(r"Розділ (\d+)\.\s*(.+)\.md$", f.name)
        if m:
            out[m.group(1)] = m.group(2)
    return out


def closed_chapters() -> set[str]:
    s = set()
    for f in EDIT_DIR.glob("Розділ * — місця*.md"):
        m = re.search(r"Розділ (\d+)", f.name)
        if m:
            s.add(m.group(1))
    return s


def current_chapter(closed: set[str], alive: bool) -> str | None:
    # Детерміновано: коли цикл живий, поточний = перший незакритий за робочим
    # порядком наказу. Надійніше за парсинг логу (claude -p буферизує вивід).
    if not alive:
        return None
    for c in WORK_ORDER:
        if c not in closed:
            return c
    return None


def display_order(titles: dict[str, str]) -> list[str]:
    # Показуємо ВСІ розділи, що існують як файли, у числовому порядку 01…19 —
    # щоб жоден (як-от 08) не «випадав» лише тому, що його немає в WORK_ORDER.
    nums = set(titles) | set(WORK_ORDER)
    return sorted(nums, key=lambda x: int(x))


def counts() -> tuple[int, int]:
    enr = len(sh("grep", "-rl", "^status: enriched", "30-Research").splitlines()) if (VAULT/"30-Research").exists() else 0
    linked = len(sh("grep", "-rl", "^status: linked", "30-Research").splitlines()) if (VAULT/"30-Research").exists() else 0
    return enr, linked


def queue_open() -> int:
    if not QUEUE.exists():
        return 0
    t = QUEUE.read_text(errors="ignore")
    m = re.search(r"## Відкриті(.*?)(?:\n## |\Z)", t, re.S)
    return len(re.findall(r"^### ", m.group(1), re.M)) if m else 0


def run_no() -> str:
    if LOG.exists():
        ms = re.findall(r"прогін #(\d+)", LOG.read_text(errors="ignore"))
        if ms:
            return ms[-1]
    return "—"


def commits(n=6) -> list[str]:
    return sh("git", "log", "--oneline", f"-{n}").splitlines()


def log_tail(n=10) -> list[str]:
    if not LOG.exists():
        return []
    lines = [l for l in LOG.read_text(errors="ignore").splitlines()
             if not l.startswith("Ignoring ")]
    return lines[-n:]


TOKENS = """
--carbon:#090a0d;--carbon-soft:#0d1014;--surface:#12161b;--surface-2:#171c22;
--raised:#1a2027;--raised-2:#202832;--line:#29313a;--line-soft:#20262d;
--bone:#f2eee6;--muted:#a6afbb;--muted-2:#808b97;
--tangerine:#ff8a5b;--periwinkle:#a99cf8;--cyan:#63d8d2;--gold:#ddbb65;
--rose:#ff7085;--mint:#75d4a1;--blue:#78a9ff;--on-accent:#15100d;
--radius-xs:7px;--radius-sm:11px;--radius:16px;--radius-lg:24px;
--shadow:0 24px 70px rgba(0,0,0,.3);
--sans:"IBM Plex Sans",system-ui,sans-serif;--mono:"IBM Plex Mono","SFMono-Regular",monospace;
"""

def esc(s): return html.escape(str(s))


def render() -> str:
    alive, pid = loop_alive()
    done = DONE.exists()
    titles = chapter_titles()
    closed = closed_chapters()
    cur = current_chapter(closed, alive)
    enr, linked = counts()
    qopen = queue_open()
    rn = run_no()
    gen = datetime.now().strftime("%F %T")

    # стан циклу
    if done:
        loop_pill = ('mint', 'ГОТОВО — усі розділи закрито')
    elif alive:
        loop_pill = ('mint', f'живий · pid {pid}')
    else:
        loop_pill = ('rose', 'зупинено')

    # плитки статів
    disp = display_order(titles)
    n_closed = len([c for c in disp if c in closed])
    stats = [
        ("розділів закрито", f"{n_closed}/{len(disp)}", 'mint'),
        ("картки до стандарту", str(enr), 'cyan'),
        ("старих лишилось", str(linked), 'gold' if linked else 'mint'),
        ("черга-питань", str(qopen), 'gold' if qopen else 'mint'),
        ("прогін №", rn, 'periwinkle'),
    ]
    stat_html = "".join(
        f'<div class="tile"><div class="tile-v" style="color:var(--{c})">{esc(v)}</div>'
        f'<div class="tile-k">{esc(k)}</div></div>' for k, v, c in stats)

    # дошка розділів — усі, числовим порядком
    rows = []
    for c in disp:
        title = titles.get(c, "—")
        if c in closed:
            st, lbl, dot = 'mint', 'закрито', '●'
        elif c == cur and alive:
            st, lbl, dot = 'gold', 'у роботі', '◐'
        elif c not in WORK_ORDER:
            # 08: закрито до появи практики зведень — картки є, редакційного нема
            st, lbl, dot = 'cyan', 'картки є · без зведення', '◍'
        else:
            st, lbl, dot = 'muted-2', 'чекає', '○'
        cls = "chap cur" if (c == cur and alive) else "chap"
        rows.append(
            f'<div class="{cls}"><span class="dot" style="color:var(--{st})">{dot}</span>'
            f'<span class="cnum">{c}</span>'
            f'<span class="ctitle">{esc(title)}</span>'
            f'<span class="cst" style="color:var(--{st})">{lbl}</span></div>')
    chap_html = "".join(rows)

    commit_html = "".join(
        f'<div class="ln"><span class="hash">{esc(l[:7])}</span>{esc(l[8:])}</div>'
        for l in commits()) or '<div class="ln muted">— немає комітів —</div>'

    log_html = "".join(f'<div class="ln">{esc(l)}</div>' for l in log_tail()) \
        or '<div class="ln muted">— лог порожній —</div>'

    lp_col, lp_txt = loop_pill
    return f"""<!doctype html><html lang="uk"><head>
<meta charset="utf-8"><meta http-equiv="refresh" content="15">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Конвеєр карток · стан</title>
<style>
:root{{{TOKENS}}}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--carbon);color:var(--bone);font-family:var(--sans);
 font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased}}
.wrap{{max-width:1080px;margin:0 auto;padding:28px 26px 60px}}
.eyebrow{{font-size:10px;text-transform:uppercase;letter-spacing:.09em;color:var(--muted-2);font-family:var(--mono)}}
h1{{font-family:var(--sans);font-size:26px;font-weight:650;margin:.15em 0 0;letter-spacing:-.01em}}
.head{{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:22px}}
.sub{{color:var(--muted);font-size:14px;margin-left:10px;font-weight:400}}
.pill{{display:inline-flex;align-items:center;gap:7px;font-family:var(--mono);font-size:12px;
 padding:7px 13px;border:1px solid var(--line);border-radius:var(--radius-xs);background:var(--surface)}}
.pill .b{{width:8px;height:8px;border-radius:50%;background:currentColor;box-shadow:0 0 10px currentColor}}
.stats{{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:24px}}
.tile{{background:var(--surface);border:1px solid var(--line-soft);border-radius:var(--radius);padding:16px 18px}}
.tile-v{{font-size:30px;font-weight:680;font-family:var(--sans);letter-spacing:-.02em;line-height:1}}
.tile-k{{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted-2);margin-top:8px;font-family:var(--mono)}}
.section{{margin-bottom:24px}}
.label{{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted-2);
 font-family:var(--mono);margin-bottom:11px}}
.board{{background:var(--surface);border:1px solid var(--line-soft);border-radius:var(--radius);overflow:hidden}}
.chap{{display:flex;align-items:center;gap:12px;padding:9px 16px;border-top:1px solid var(--line-soft)}}
.chap:first-child{{border-top:none}}
.chap.cur{{background:var(--surface-2)}}
.dot{{font-size:12px;width:14px;text-align:center}}
.cnum{{font-family:var(--mono);font-size:12px;color:var(--muted-2);width:22px}}
.ctitle{{flex:1;font-size:13.5px}}
.cst{{font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.05em}}
.cols{{display:grid;grid-template-columns:1fr 1fr;gap:16px}}
@media(max-width:720px){{.cols{{grid-template-columns:1fr}}}}
.panel{{background:var(--surface);border:1px solid var(--line-soft);border-radius:var(--radius);
 padding:14px 16px;font-family:var(--mono);font-size:11.5px;max-height:280px;overflow:auto}}
.ln{{padding:3px 0;color:var(--muted);white-space:pre-wrap;word-break:break-word}}
.ln .hash{{color:var(--cyan);margin-right:8px}}
.ln.muted{{color:var(--muted-2)}}
.statusbar{{margin-top:26px;padding-top:14px;border-top:1px solid var(--line-soft);
 font-family:var(--mono);font-size:11px;color:var(--muted-2);display:flex;gap:18px;flex-wrap:wrap}}
</style></head><body><div class="wrap">
 <div class="head">
  <div><div class="eyebrow">ОРКЕСТРАЦІЯ · КАМІНЬ НА РОЗДОРІЖЖІ</div>
   <h1>Конвеєр карток<span class="sub">безголовий цикл · дворівневий</span></h1></div>
  <div class="pill" style="color:var(--{lp_col})"><span class="b"></span>{esc(lp_txt)}</div>
 </div>
 <div class="stats">{stat_html}</div>
 <div class="section"><div class="label">Розділи 01–19 · робочий порядок 09→19→01–07→10</div>
  <div class="board">{chap_html}</div></div>
 <div class="cols">
  <div class="section"><div class="label">Останні коміти</div><div class="panel">{commit_html}</div></div>
  <div class="section"><div class="label">Лог циклу</div><div class="panel">{log_html}</div></div>
 </div>
 <div class="statusbar"><span>згенеровано {gen}</span><span>оновлення кожні 15 с</span>
  <span>~/.writer-lab/karty-loop.log</span></div>
</div></body></html>"""


def write_once():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(render(), encoding="utf-8")


if __name__ == "__main__":
    args = sys.argv[1:]
    write_once()
    if "--open" in args:
        webbrowser.open(f"file://{OUT}")
    if "--watch" in args:
        print(f"дашборд: file://{OUT}  (оновлення кожні 15 с, Ctrl+C — вийти)")
        try:
            while True:
                time.sleep(15)
                write_once()
        except KeyboardInterrupt:
            print("\nстоп монітора (цикл не чіпав)")
    else:
        print(f"file://{OUT}")
