"""Конвеєри — що зараз меле система і скільки лишилось.

Шоста сторінка над тими самими даними (Дерево · Всесвіт · Таймлайн · Мапа ·
Сенси). Тут дані не з бібліотеки, а з **робочого стану**: `~/.writer-lab`,
черги конвеєрів і git-гілки їхніх worktree.

**Нуль моделі.** Це читання файлів і `git log`, більш нічого. Сторінка не має
права коштувати токен: вона потрібна саме тоді, коли хочеться подивитись, чи
не палить конвеєр гроші даремно.

**Чому лічильники беруться з гілки конвеєра, а не з бібліотеки.** Конвеєр
працює у власному worktree й комітить туди; поки хвилю не злито, у `Library`
цієї роботи немає. Рахувати поступ по бібліотеці означало б показувати нуль
там, де зроблено сорок карток. Тому кожна задача міряється у своїй гілці.

**Черга karty рахується тими самими воротами, що ухвалюють роботу**
(`card_order.py`), а не окремим лічильником «зроблено». Окремий лічильник —
це друге джерело правди, і воно неодмінно розійдеться з першим: рівно так
завели KI-15 на `sources-done.txt`. Ворота розійтися не можуть за побудовою.

**Порожнє поле — це «не знаю», а не нуль.** Якщо черги для задачі немає або
файл не читається, поле лишається `None` і сторінка каже «черги немає», а не
малює порожню смужку, з якої видно «все зроблено».
"""
from __future__ import annotations

import re
import subprocess
import sys
import time
from datetime import date, datetime
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, Depends

STATE = Path.home() / ".writer-lab"
WORK = Path.home() / "Writer-Lab"

# Порядок навмисний: спершу ті, що працюють найчастіше. Гілка й тека worktree
# збігаються з wl-loop.sh — там єдине джерело правди, тут дзеркало.
TASKS: list[dict[str, str]] = [
    {"name": "karty", "title": "Картки", "about": "Картки сутностей до стандарту"},
    {"name": "sources", "title": "Джерела", "about": "Опора під тези без опори"},
    {"name": "apparat", "title": "Апарат", "about": "Картки апарату до стандарту"},
    {"name": "geo", "title": "Гео", "about": "Координати й місця для Мапи"},
    {"name": "inbox", "title": "Вхідні", "about": "Варта вхідних: розбір нових текстів"},
    {"name": "opponent", "title": "Опонент", "about": "Контраргументи з власного масиву"},
    {"name": "sensy", "title": "Сенси", "about": "Ланцюги повторень наскрізних мотивів"},
]
# apparat живе в іншій теці й на іншій гілці — так склалось історично.
WORKTREE = {"apparat": (".apparat-work", "apparat-wave2")}


def _worktree(task: str) -> tuple[Path, str]:
    folder, branch = WORKTREE.get(task, (f".wl-{task}", f"wl-{task}"))
    return WORK / folder, branch


def _tail(path: Path, lines: int = 400) -> list[str]:
    """Останні рядки логу. Логи ростуть до сотень кілобайт — читаємо хвіст."""
    try:
        with path.open("rb") as fh:
            fh.seek(0, 2)
            size = fh.tell()
            fh.seek(max(0, size - 64_000))
            return fh.read().decode("utf-8", "replace").splitlines()[-lines:]
    except OSError:
        return []


def _alive(pid_file: Path) -> bool:
    try:
        pid = int(pid_file.read_text().strip())
    except (OSError, ValueError):
        return False
    try:
        import os
        os.kill(pid, 0)
        return True
    except (OSError, ProcessLookupError):
        return False


def _mtime(path: Path) -> str | None:
    try:
        return datetime.fromtimestamp(path.stat().st_mtime).strftime("%Y-%m-%d %H:%M")
    except OSError:
        return None


def _last_commit(repo: Path, branch: str) -> dict[str, Any] | None:
    """Коли конвеєр востаннє щось закомітив у свою гілку — і що саме."""
    if not repo.is_dir():
        return None
    try:
        out = subprocess.run(
            ["git", "log", "-1", "--format=%ct%x09%s", branch],
            cwd=repo, capture_output=True, text=True, timeout=10).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None
    if not out or "\t" not in out:
        return None
    stamp, _, subject = out.partition("\t")
    try:
        when = int(stamp)
    except ValueError:
        return None
    return {"ago_min": max(0, int((time.time() - when) / 60)),
            "at": datetime.fromtimestamp(when).strftime("%Y-%m-%d %H:%M"),
            "subject": subject[:160]}


def _ahead(repo: Path, branch: str) -> int | None:
    """Скільки комітів гілки ще не злито в main — це і є незібрана хвиля."""
    if not repo.is_dir():
        return None
    try:
        out = subprocess.run(["git", "rev-list", "--count", f"main..{branch}"],
                             cwd=repo, capture_output=True, text=True, timeout=10).stdout.strip()
        return int(out)
    except (OSError, subprocess.SubprocessError, ValueError):
        return None


def _budget(root: Path, task: str) -> int:
    """Денний бюджет прогонів — з config.yaml бібліотеки, як у wl-loop.sh."""
    try:
        import yaml
        cfg = yaml.safe_load(open(root / "90-Meta/config.yaml", encoding="utf-8"))
        table = (cfg or {}).get("loop_budget") or {}
        return int(table.get(task, table.get("default", 60)))
    except Exception:
        return 60


def _state(task: str, log: list[str]) -> dict[str, Any]:
    """Стан задачі. Живий процес ще не означає «меле» — він може спати.

    Порядок перевірок важливий: сентинел і стоп-прапорець лишаються на диску
    після зупинки, тож питати про них можна лише тоді, коли процесу вже немає.
    """
    if _alive(STATE / f"{task}-loop.pid"):
        # Дивимось, чи після останнього «прогін #» цикл не ліг спати.
        for line in reversed(log):
            if line.startswith("─────────"):
                break
            if "денний бюджет вичерпано" in line:
                return {"code": "budget", "label": "бюджет вичерпано", "note": line.strip(" -")}
            if "ліміт, сплю до" in line:
                return {"code": "sleeping", "label": "спить до ліміту", "note": line.strip(" -")}
        return {"code": "running", "label": "працює", "note": None}
    if (STATE / f"{task}.done").is_file():
        return {"code": "done", "label": "добіг",
                "note": f"сентинел {_mtime(STATE / f'{task}.done')}"}
    if (STATE / f"{task}-loop.stop").is_file():
        return {"code": "stopped", "label": "стоп",
                "note": f"прапорець {_mtime(STATE / f'{task}-loop.stop')}"}
    return {"code": "idle", "label": "не працює", "note": None}


def _stage(task: str) -> str | None:
    """Етап усередині прогону — рядок, який агент пише сам, Bash-ом, за НАКАЗом.

    Порожній файл означає «цей прогін ще не доповів»: `wl-loop.sh` скидає його
    перед кожним прогоном. Прогони, запущені до оновлення НАКАЗів, етапу не
    пишуть узагалі — і тоді картка показує лише час, без вигаданої стадії.
    """
    try:
        text = (STATE / f"{task}-stage").read_text(encoding="utf-8").strip()
    except OSError:
        return None
    return text[:120] or None


def _timing(log: list[str], state_code: str) -> dict[str, Any] | None:
    """Скільки триває поточний прогін проти звичайного для цієї задачі.

    Тривалості беремо з рядків «завершено за Nс», які пише сам цикл, а НЕ як
    різницю між заголовками прогонів: між заголовками лягають сни на ліміті
    й на денному бюджеті, і «медіана» показувала б години там, де робота
    йшла хвилини.

    «Зазвичай» — це смуга p25–p75 останніх десяти, а не min–max: один
    п'ятихвилинний викид розтягнув би діапазон так, що в нього влізло б усе
    й він перестав би щось означати.
    """
    done: list[int] = []
    last_header: datetime | None = None
    header_is_open = False
    for line in log:
        m = re.search(r"прогін #\d+\s+(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)", line)
        if m:
            try:
                last_header = datetime.strptime(m.group(1), "%Y-%m-%d %H:%M:%S")
                header_is_open = True
            except ValueError:
                pass
            continue
        m = re.search(r"завершено за (\d+)с", line)
        if m:
            done.append(int(m.group(1)))
            header_is_open = False

    recent = done[-10:]
    band = median = None
    if recent:
        s = sorted(recent)
        median = s[len(s) // 2]
        band = [s[len(s) // 4], s[(len(s) * 3) // 4]]

    running_s = None
    if state_code == "running" and header_is_open and last_header:
        running_s = max(0, int((datetime.now() - last_header).total_seconds()))

    if running_s is None and median is None:
        return None
    return {
        "running_s": running_s,
        "median_s": median,
        "band_s": band,
        "samples": len(recent),
        # Детектор зависань. Поріг навмисно грубий: утричі довше за звичайне —
        # це вже не «складніша картка», це щось не так. Менший поріг ловив би
        # нормальний розкид (одній картці бракує хоста, іншій — усіх трьох).
        "suspicious": bool(running_s and median and running_s > 3 * median),
    }


def _run_number(log: list[str]) -> int | None:
    for line in reversed(log):
        m = re.search(r"прогін #(\d+)", line)
        if m:
            return int(m.group(1))
    return None


def _last_meaningful(log: list[str]) -> str | None:
    """Останній рядок, що щось каже. «Already up to date.» — не каже нічого:
    це шум від merge, який wl-loop робить перед КОЖНИМ прогоном."""
    noise = ("Already up to date.", "")
    for line in reversed(log):
        text = line.strip()
        if text and text not in noise and not text.startswith(("─────────", "===")):
            return text[:300]
    return None


def _queue_sources() -> dict[str, Any] | None:
    """Черга тез: seed мінус done. Точнісінько те, що робить сам конвеєр.

    Одиниця роботи тут — теза, тобто ціле речення. Воно і є описом завдання:
    «зараз добираємо опору під ось це твердження».
    """
    seed, done = STATE / "sources-seed.txt", STATE / "sources-done.txt"
    if not seed.is_file():
        return None
    try:
        rows = [l.split("\t")[0].strip()
                for l in seed.read_text(encoding="utf-8").splitlines() if l.strip()]
        # `sources-done.txt` пише ПОВНИЙ рядок черги — «теза<TAB>розділ», —
        # а `sources_queue_check.py --fix` дописує лише зрізану norm-форму.
        # Тому ріжемо по табу з обох боків: інакше жодна теза не збігається
        # й сторінка показує «зроблено 0», поки конвеєр закрив сімдесят.
        marked = {l.split("\t")[0].strip().casefold()
                  for l in done.read_text(encoding="utf-8").splitlines()
                  if l.strip()} if done.is_file() else set()
    except OSError:
        return None
    left = [r for r in rows if r.casefold() not in marked]
    current = None
    if left:
        # Позиція в черзі, а не порядковий номер прогону: прогін може впасти,
        # а черга — ні. Індекс рахуємо по вихідному списку, щоб число не
        # стрибало, коли теза закривається десь усередині.
        current = {"name": left[0][:220], "kind": "теза",
                   "index": rows.index(left[0]) + 1, "of": len(rows)}
    return {"total": len(rows), "closed": len(rows) - len(left),
            "unit": "тез", "how": "черга мінус позначені зробленими",
            "current": current}


def _queue_karty(repo: Path) -> dict[str, Any] | None:
    """Черга карток — ворота card_order.py по шляхах із karty-seed.txt.

    Рахуємо у ГІЛЦІ конвеєра: він комітить туди, і до злиття хвилі бібліотека
    цієї роботи не бачить. Ворота — 57 мс на сорок карток, тож живий підрахунок
    дешевший за будь-який кеш і не вміє застаріти.
    """
    seed = STATE / "karty-seed.txt"
    if not seed.is_file() or not repo.is_dir():
        return None
    try:
        paths = [l.split("\t")[0].strip()
                 for l in seed.read_text(encoding="utf-8").splitlines() if l.strip()]
    except OSError:
        return None
    if not paths:
        return None
    script = repo / "90-Meta/scripts/card_order.py"
    if not script.is_file():
        return None
    try:
        out = subprocess.run([sys.executable, str(script), *paths],
                             cwd=repo, capture_output=True, text=True, timeout=60).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    m = re.search(r"перевірено (\d+).*?пройшли ворота якості: (\d+)", out, re.S)
    if not m:
        return None
    seen, passed = int(m.group(1)), int(m.group(2))
    # Ворота друкують шляхом кожну картку, що НЕ пройшла. Перша така за
    # порядком черги — це та, за яку конвеєр узявся або візьметься наступною.
    # Точніше сказати не можна чесно: `claude -p` не звітує наживо, він мовчить
    # до кінця прогону. Тому поле й зветься «найпевніше», а не «зараз».
    failed = {l.strip() for l in out.splitlines() if l.startswith("  30-Research/")}
    current = None
    for i, path in enumerate(paths, 1):
        if path in failed:
            current = {"name": Path(path).stem, "kind": "картка",
                       "index": i, "of": len(paths)}
            break
    # Розбіжність показуємо, а не ховаємо: картку могли перейменувати чи
    # перенести, і тоді ворота бачать менше рядків, ніж стоїть у черзі.
    missing = len(paths) - seen
    return {"total": len(paths), "closed": passed, "unit": "карток",
            "how": "ворота card_order.py у гілці конвеєра",
            "missing": missing or None, "current": current}


def _retriage_tail() -> list[dict[str, Any]]:
    """Що лишилось у хвості ре-тріажу — з МАНІФЕСТА, не з рядка логу.

    У лозі стоїть «[120/292]», де 292 — скільки лишалось на початок ТОГО
    прогону. Показувати це число як стан справ означає щоразу починати
    відлік з нуля й ховати вже зроблене. Маніфест каже правду: 217 із 375.
    """
    import json
    reports = WORK / "Library/90-Meta/reports/local-triage"
    src, dst = reports / "triage-archive.jsonl", reports / "triage-high-strict.jsonl"
    if not dst.is_file():
        return []
    done, errors = set(), 0
    try:
        for line in dst.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            rec = json.loads(line)
            if rec.get("error"):
                errors += 1
            else:
                done.add(rec.get("file"))
    except (OSError, ValueError):
        return []
    total = None
    try:
        # Поле зветься `relevance`, не `triage` — перший прохід ставить сюди
        # low/medium/high, а суворий перебирає саме high.
        total = sum(1 for line in src.read_text(encoding="utf-8").splitlines()
                    if line.strip() and json.loads(line).get("relevance") == "high")
    except (OSError, ValueError):
        pass
    out = [{"what": "суворий ре-тріаж", "closed": len(done), "total": total}]
    if errors:
        # Записи з помилкою в done-set не потрапляють, тож наступний прогін
        # перебере їх сам. Показуємо, щоб число «зроблено» не читалось як
        # «і все чисто».
        out.append({"what": "записів з помилкою на переробку", "closed": errors, "total": None})
    return out


def _batch() -> dict[str, Any]:
    """Батч важкої локальної роботи. Годинника в ньому немає — є вікно."""
    log = _tail(STATE / "night-batch.log", 200)
    fin = STATE / "night-batch.finished"
    last = None
    since_h = None
    try:
        raw = fin.read_text(encoding="utf-8").strip()
        if raw:
            last = raw
            since_h = int((time.time() - datetime.strptime(raw, "%Y-%m-%d %H:%M:%S").timestamp()) / 3600)
    except (OSError, ValueError):
        pass

    finished_line = any("нічний батч завершено" in l for l in log)
    return {
        "tail": _retriage_tail(),
        "window": _window(),
        "last_finish": last,
        "since_hours": since_h,
        "finished_cleanly": finished_line and bool(last),
        "last_line": _last_meaningful(log),
        "log_at": _mtime(STATE / "night-batch.log"),
    }


def _window() -> dict[str, Any] | None:
    """Межі вікна — з config.yaml бібліотеки. Єдине місце, де вони живуть."""
    script = WORK / "Library/90-Meta/scripts/batch_window.py"
    if not script.is_file():
        return None
    try:
        import yaml
        cfg = yaml.safe_load(open(WORK / "Library/90-Meta/config.yaml", encoding="utf-8"))
        w = (cfg or {}).get("batch_window") or {}
        return {"from": str(w.get("from", "02:00")), "to": str(w.get("to", "09:00")),
                "gap_hours": int(w.get("min_gap_hours", 20))}
    except Exception:
        return None


def create_conveyor_router(root: Path, *, require_session: Callable[..., Any]) -> APIRouter:
    router = APIRouter(prefix="/api/v1")

    @router.get("/conveyors")
    def conveyors(_session=Depends(require_session)) -> dict[str, Any]:
        today = date.today().isoformat()
        out: list[dict[str, Any]] = []
        for spec in TASKS:
            task = spec["name"]
            repo, branch = _worktree(task)
            log = _tail(STATE / f"{task}-loop.log")
            spent = 0
            try:
                spent = int((STATE / f"{task}-runs-{today}").read_text().strip() or 0)
            except (OSError, ValueError):
                pass
            queue = (_queue_sources() if task == "sources"
                     else _queue_karty(repo) if task == "karty" else None)
            state = _state(task, log)
            out.append({
                **spec,
                "state": state,
                "run": _run_number(log),
                "stage": _stage(task),
                "timing": _timing(log, state["code"]),
                "queue": queue,
                "budget": {"spent": spent, "max": _budget(root, task)},
                "last_line": _last_meaningful(log),
                "log_at": _mtime(STATE / f"{task}-loop.log"),
                "commit": _last_commit(repo, branch),
                "unmerged": _ahead(repo, branch),
                "command": f"./wl-loop.sh {task}",
            })
        return {"tasks": out, "batch": _batch(), "at": datetime.now().strftime("%H:%M")}

    return router
