"""Внутрішні агенти Writer-Lab — фонові задачі, що живуть у самій системі.

РІШЕННЯ ЮРІЯ (2026-07-27): агенти мають бути **всередині Writer-Lab**, а не
системними службами macOS. Winter-Lab — агентна система; виносити її агента в
launchd означає, що частина системи живе поза системою: засмічує ОС, керується
з термінала й не бачить власного стану.

Наслідок, який приймаємо свідомо: стеження працює, **поки працює застосунок**.
Це чесно й передбачувано — прихована служба, що сканує диск за спиною автора,
гірша за агента, який видимо живе у вікні.

Правило поширюється на ВСІ фонові процеси системи без винятку (Юрій 2026-07-31,
про голосовий пульт: «Пульт — частина системи… включаємо його в систему і нехай
працює всередині»). Тому пульт, який досі не піднімався сам після перезавантаження,
теж стає агентом цього модуля, а не службою macOS — робота йде паралельною сесією.

ДВІ ФАЗИ (рішення Юрія 2026-07-27). Модель не працює над матеріалом, поки
автор не сказав «у роботу»:

  зміна в теці → inbox_scan.py (БЕЗ МОДЕЛІ) → черга зі status: queued
                                                     ↓ автор у Приймальні
                                              status: in_work
                                                     ↓
                                        варта (Claude) — лише тепер

Агент будить Claude ЛИШЕ якщо в черзі є `in_work`. Раніше він будив варту на
будь-яку зміну, і та розбирала все підряд: з 29 файлів теки 26 виявилися
дублікатами вже наявного — робота, витрачена на те, що автор відхилив би не
читаючи. Сама перевірка тек (відбиток: кількість файлів + найновіший mtime)
рахується за мілісекунди й коштує нуль.
"""
from __future__ import annotations

import asyncio
import os
import signal
import subprocess
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

STORE = Path.home() / ".writer-lab"
WATCH_LIST = STORE / "inbox-watch.txt"
FINGERPRINT = STORE / "inbox-fingerprint"
LOOP = Path.home() / "Writer-Lab/raytsystem/wl-loop.sh"
LIBRARY = Path.home() / "Writer-Lab/Library"
SCAN = LIBRARY / "90-Meta/scripts/inbox_scan.py"
PROPOSALS = LIBRARY / "00-Inbox/Пропозиції"

INTERVAL_SECONDS = 300          # перевірка дешева; частіше просто не має сенсу

# Застосунок, піднятий з Dock, успадковує куций PATH launchd — без ~/.local/bin
# (`claude`) і без /opt/homebrew/bin (`uv`, `pandoc`). Саме тому варта інбоксу
# 30–31.07 зробила 5468 холостих прогонів об «claude: command not found».
# Лагодимо один раз на модуль: усі subprocess нижче успадковують цей os.environ.
for _bin in (str(Path.home() / ".local/bin"), "/opt/homebrew/bin"):
    if _bin not in os.environ.get("PATH", "").split(":"):
        os.environ["PATH"] = f"{_bin}:{os.environ.get('PATH', '')}"


def _alive(pid_file: Path) -> bool:
    """Чи живий процес за pid-файлом — та сама формула, що `kill -0` у wl-loop.sh.

    Убитий процес лишає застарілий pid-файл (`rm -f "$PIDF"` є лише на чистому
    виході), тож наявності файла замало — питаємо ядро.
    """
    try:
        os.kill(int(pid_file.read_text().strip()), 0)
        return True
    except (OSError, ValueError):
        return False


class InboxWatcher:
    """Сторож вхідних тек. Дивиться сам, будить варту лише на зміни."""

    def __init__(self) -> None:
        self.enabled = True
        self.last_check: str | None = None
        self.last_event: str | None = None
        self._task: asyncio.Task[None] | None = None

    # — стан для вікна (без моделі, як екран стану пульта) —
    def state(self) -> dict[str, object]:
        return {
            "enabled": self.enabled,
            "alive": bool(self._task and not self._task.done()),
            "interval_seconds": INTERVAL_SECONDS,
            "last_check": self.last_check,
            "last_event": self.last_event,
            "watching": self._folders(),
            "varta_running": self._varta_running(),
            "queued": self._count("queued"),
            "in_work": self._count("in_work"),
            "pending": self._pending(),      # резолюції, які варта ще не виконала
        }

    @staticmethod
    def _folders() -> list[str]:
        if not WATCH_LIST.is_file():
            return []
        return [l.strip() for l in WATCH_LIST.read_text(encoding="utf-8").splitlines()
                if l.strip() and not l.startswith("#")]

    @staticmethod
    def _varta_running() -> bool:
        return _alive(STORE / "inbox-loop.pid")

    @staticmethod
    def _count(status: str) -> int:
        """Скільки карток черги в цій фазі. Читання файлів, не модель."""
        if not PROPOSALS.is_dir():
            return 0
        needle = f"status: {status}"
        return sum(1 for p in PROPOSALS.glob("*.md")
                   if needle in p.read_text(encoding="utf-8", errors="ignore")[:600])

    def _pending(self) -> int:
        """Скільки карток чекають дії варти: розбору або виконання резолюції."""
        return sum(self._count(s) for s in ("in_work", "accepted", "revise"))

    def _fingerprint(self) -> str:
        """Скільки файлів і коли останній змінювався. Недоступні теки (macOS може
        не дати прав) пропускаємо мовчки — це не помилка, а обмеження системи."""
        parts = []
        for folder in self._folders():
            path = Path(folder)
            if not path.is_dir():
                continue
            newest = 0.0
            count = 0
            try:
                for item in path.rglob("*"):
                    if item.is_file() and not item.name.startswith("."):
                        count += 1
                        newest = max(newest, item.stat().st_mtime)
            except OSError:
                continue
            parts.append(f"{folder}:{count}:{int(newest)}")
        return ";".join(parts)

    async def _tick(self) -> None:
        self.last_check = datetime.now(UTC).isoformat(timespec="seconds")

        # Фаза 1 — упізнати. Тільки якщо теки справді змінились.
        current = await asyncio.to_thread(self._fingerprint)
        previous = FINGERPRINT.read_text(encoding="utf-8").strip() if FINGERPRINT.is_file() else ""
        if current != previous:
            STORE.mkdir(parents=True, exist_ok=True)
            FINGERPRINT.write_text(current, encoding="utf-8")
            found = await asyncio.to_thread(self._scan)
            self.last_event = (f"{self.last_check} — {found}" if found
                               else f"{self.last_check} — зміни в теках, нового не знайшлось")

        # Фаза 2 — опрацювати. Будимо Claude лише на те, де вже є слово автора:
        # «у роботу» (розібрати), «прийнято» (перенести в бібліотеку), «доопрацювати».
        # Без accepted/revise у списку прийнятий матеріал завис би в черзі назавжди.
        if self._pending() and not self._varta_running() and LOOP.is_file():
            (STORE / "inbox.done").unlink(missing_ok=True)
            await asyncio.to_thread(
                subprocess.run, ["/bin/bash", str(LOOP), "inbox", "старт"],
                capture_output=True, text=True, timeout=60,
            )
            self.last_event = f"{self.last_check} — {self._pending()} на виконанні, варту розбуджено"

    @staticmethod
    def _scan() -> str:
        """inbox_scan.py — конвертація, sha256, звірка з бібліотекою. Нуль токенів."""
        if not SCAN.is_file():
            return ""
        done = subprocess.run(
            ["uv", "run", "--with", "pyyaml", "--with", "python-docx", "python3", str(SCAN)],
            capture_output=True, text=True, timeout=900, cwd=str(LIBRARY),
        )
        tail = [l for l in done.stdout.strip().splitlines() if l.startswith("нового:")]
        return tail[-1] if tail else ""

    async def _loop(self) -> None:
        while True:
            try:
                if self.enabled:
                    await self._tick()
            except asyncio.CancelledError:
                raise
            except Exception as error:              # агент не має падати через одну теку
                self.last_event = f"помилка перевірки: {error}"
            await asyncio.sleep(INTERVAL_SECONDS)

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass


SYNC = LIBRARY / "90-Meta/scripts/sync_originals.py"
ORIGINALS_INTERVAL_SECONDS = 120     # автор зберігає docx і чекає побачити це в бібліотеці


class OriginalsWatcher:
    """Сторож оригіналів. Автор править docx у Word — бібліотека доганяє сама.

    РІШЕННЯ ЮРІЯ (2026-07-31): «Це повинно бути частиною системи LW. Піднявся
    застосунок — піднялись всі процеси, без зовнішніх хуків.» Тому агент, а не
    launchd і не забутий `nohup` у терміналі — на тій самій підставі, що й
    [[InboxWatcher]] вище.

    Робота сама лежить у `sync_originals.py`: він тримає відбиток кожного
    оригіналу, чекає, поки файл устоїться, і після переносу перезбирає апарат.
    Агент його лише будить — щоб логіка синхронізації жила в одному місці
    й однаково працювала з рук і з вікна.
    """

    def __init__(self) -> None:
        self.enabled = True
        self.last_check: str | None = None
        self.last_event: str | None = None
        self._task: asyncio.Task[None] | None = None

    def state(self) -> dict[str, object]:
        return {
            "enabled": self.enabled,
            "alive": bool(self._task and not self._task.done()),
            "interval_seconds": ORIGINALS_INTERVAL_SECONDS,
            "last_check": self.last_check,
            "last_event": self.last_event,
            "tracked": self._tracked(),
        }

    @staticmethod
    def _tracked() -> int:
        """Скільки документів під наглядом — за станом, який веде сам скрипт."""
        state_file = STORE / "originals-state.json"
        if not state_file.is_file():
            return 0
        try:
            import json
            return len(json.loads(state_file.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            return 0

    async def _tick(self) -> None:
        self.last_check = datetime.now(UTC).isoformat(timespec="seconds")
        if not SYNC.is_file():
            return
        done = await asyncio.to_thread(
            subprocess.run,
            ["uv", "run", "--with", "pyyaml", "python3", str(SYNC)],
            capture_output=True, text=True, timeout=1800, cwd=str(SYNC.parent),
        )
        moved = [l.strip() for l in done.stdout.splitlines() if l.strip().startswith("→")]
        if moved:
            self.last_event = f"{self.last_check} — оновлено: " + "; ".join(
                l.lstrip("→ ").split(" ←")[0] for l in moved)

    async def _loop(self) -> None:
        while True:
            try:
                if self.enabled:
                    await self._tick()
            except asyncio.CancelledError:
                raise
            except Exception as error:          # один недоступний оригінал не валить агента
                self.last_event = f"помилка синхронізації: {error}"
            await asyncio.sleep(ORIGINALS_INTERVAL_SECONDS)

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass


RESUME_INTERVAL_SECONDS = 300    # перевірка — самі стати файлів, коштує нуль


class ConveyorResume:
    """Підіймач конвеєрів. Машину вимкнули посеред роботи — застосунок веде далі.

    Клас збоїв, проти якого це зроблено: `wl-loop` спить до півночі на вичерпаному
    бюджеті або чекає скидання ліміту, машину вимикають — і процес зникає разом зі
    сном. Ніхто його не підніме: варта інбоксу будиться на нові файли в теках, а не
    на впалий цикл. Так `sources` пролежав із живою чергою на 141 тезу, застарілим
    pid-файлом і без сентинела.

    П'ять умов разом, і жодна з них не вгадується:
      черга не порожня · немає сентинела `.done` · немає `-loop.stop` ·
      денний бюджет не вичерпано · процес не живий.

    **Сентинели й стоп-прапорці — священні.** Агент їх лише читає. Це різниця з
    `wl-watchdog.sh`, який безумовно стирав `inbox.done`: доведена до кінця задача
    не має воскресати сама, а ручний «стоп» означає «не чіпай», а не «поки що».

    Список задач для автопідйому веде Юрій — `conveyors.auto_resume` у
    `90-Meta/config.yaml`. Немає секції — не піднімається ніщо: мовчазна відмова
    безпечніша за мовчазний запуск.
    """

    def __init__(self) -> None:
        self.enabled = True
        self.last_check: str | None = None
        self.last_event: str | None = None
        self.checked: dict[str, str] = {}     # задача → чому не піднято (або «піднято»)
        self._task: asyncio.Task[None] | None = None

    def state(self) -> dict[str, object]:
        return {
            "enabled": self.enabled,
            "alive": bool(self._task and not self._task.done()),
            "interval_seconds": RESUME_INTERVAL_SECONDS,
            "last_check": self.last_check,
            "last_event": self.last_event,
            "tasks": self.checked,
        }

    @staticmethod
    def _config() -> dict[str, Any]:
        """config.yaml бібліотеки. Зіпсовано чи недоступний — порожньо, тобто нічого
        не піднімаємо: це та сама fail-soft логіка, що в loop_budget.py."""
        try:
            import yaml
            data = yaml.safe_load((LIBRARY / "90-Meta/config.yaml").read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    @staticmethod
    def _lines(path: Path) -> set[str]:
        if not path.is_file():
            return set()
        return {l.strip() for l in path.read_text(encoding="utf-8", errors="ignore").splitlines()
                if l.strip() and not l.startswith("#")}

    @classmethod
    def _queue_left(cls, task: str) -> int | None:
        """Скільки одиниць лишилось у черзі задачі.

        Черги влаштовані однаково: список у `<задача>-seed.txt` (чи `-worklist.txt`)
        мінус зроблене в `<задача>-done.txt`, якщо такий файл ведеться. Немає жодного
        списку — повертаємо None: черги не видно, а вгадувати роботу за нас не можна.
        """
        for name in (f"{task}-seed.txt", f"{task}-worklist.txt"):
            seed = STORE / name
            if seed.is_file():
                return len(cls._lines(seed) - cls._lines(STORE / f"{task}-done.txt"))
        return None

    def _blocked(self, task: str, config: dict[str, Any]) -> str | None:
        """Чому цю задачу не піднімаємо. None — можна піднімати."""
        if (STORE / f"{task}.done").exists():
            return "сентинел: робота вичерпана"
        if (STORE / f"{task}-loop.stop").exists():
            return "стоп-прапорець"
        if _alive(STORE / f"{task}-loop.pid"):
            return "уже працює"

        left = self._queue_left(task)
        if left is None:
            return "черги не видно"
        if left == 0:
            return "черга порожня"

        budget = config.get("loop_budget") or {}
        try:
            limit = int(budget.get(task, budget.get("default", 60)))
        except (TypeError, ValueError):
            limit = 60
        # Доба тут місцева, як `date '+%F'` у wl-loop.sh — інакше під ранок ми
        # рахували б бюджет із чужого дня.
        stamp = datetime.now().strftime("%Y-%m-%d")
        try:
            spent = int((STORE / f"{task}-runs-{stamp}").read_text(encoding="utf-8").strip())
        except (OSError, ValueError):
            spent = 0
        if spent >= limit:
            return f"денний бюджет вичерпано ({spent} із {limit})"
        return None

    @staticmethod
    def _lift(task: str) -> bool:
        """Підняти конвеєр і залишити слід у його ж лозі — щоб автор бачив, що це не він."""
        STORE.mkdir(parents=True, exist_ok=True)
        log = STORE / f"{task}-loop.log"
        with log.open("a", encoding="utf-8") as out:
            out.write(f"=== [{task}] піднято автоматично застосунком "
                      f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')} ===\n")
        done = subprocess.run(["/bin/bash", str(LOOP), task, "старт"],
                              capture_output=True, text=True, timeout=120)
        if done.returncode != 0:
            with log.open("a", encoding="utf-8") as out:
                out.write(f"!! автопідйом не вдався: "
                          f"{(done.stderr or done.stdout).strip()[:200]}\n")
            return False
        return True

    async def _tick(self) -> None:
        self.last_check = datetime.now(UTC).isoformat(timespec="seconds")
        config = self._config()
        tasks = (config.get("conveyors") or {}).get("auto_resume") or []
        checked: dict[str, str] = {}
        lifted: list[str] = []
        for task in tasks:
            why = self._blocked(task, config)
            if why:
                checked[task] = why
                continue
            if not LOOP.is_file():
                checked[task] = "wl-loop.sh не знайдено"
                continue
            ok = await asyncio.to_thread(self._lift, task)
            checked[task] = "піднято" if ok else "підняти не вдалося"
            if ok:
                lifted.append(task)
        self.checked = checked
        if lifted:
            self.last_event = f"{self.last_check} — піднято: {', '.join(lifted)}"

    async def _loop(self) -> None:
        while True:
            try:
                if self.enabled:
                    await self._tick()
            except asyncio.CancelledError:
                raise
            except Exception as error:          # одна задача не валить підіймач
                self.last_event = f"помилка автопідйому: {error}"
            await asyncio.sleep(RESUME_INTERVAL_SECONDS)

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass


BACKUP_SCRIPT = LIBRARY / "90-Meta/scripts/backup.py"
BACKUP_LOG = LIBRARY / "90-Meta/reports/backup-log.md"
BACKUP_INTERVAL_SECONDS = 3600     # раз на годину звірити дату — читання одного рядка, нуль моделі


def _last_backup_date() -> str | None:
    """Дата останнього рядка backup-log.md. Формат пише сам backup.py: `- YYYY-MM-DD HH:MM — …`."""
    try:
        lines = [l for l in BACKUP_LOG.read_text(encoding="utf-8").splitlines() if l.strip()]
    except OSError:
        return None
    return lines[-1][2:12] if lines else None


def _needs_backup(last_backup_date: str | None, today: str) -> bool:
    return last_backup_date != today


class BackupWatcher:
    """Щоденний бекап (Фаза 7). Формула ротації — CLAUDE.md, розділ «Бекапи»,
    змінює лише Юрій; тут лише розклад.

    РІШЕННЯ ЮРІЯ (2026-07-27/31): ритуали — фонові процеси системи так само,
    як варта інбоксу й синхрон оригіналів, тому живуть тут, а не в launchd чи
    ручному запуску. Знайдено 06.08: останній бекап лежав за 35 днів до
    цього — формула вимагає щоденного, а `backup.py` як скрипт ніхто не будив.
    Сам скрипт моделі не коштує (tar.gz і ротація), тож вартовий лише звіряє
    дату останнього рядка логу й будить його, коли день змінився.
    """

    def __init__(self) -> None:
        self.enabled = True
        self.last_check: str | None = None
        self.last_event: str | None = None
        self._task: asyncio.Task[None] | None = None

    def state(self) -> dict[str, object]:
        return {
            "enabled": self.enabled,
            "alive": bool(self._task and not self._task.done()),
            "interval_seconds": BACKUP_INTERVAL_SECONDS,
            "last_check": self.last_check,
            "last_event": self.last_event,
            "last_backup": _last_backup_date(),
        }

    async def _tick(self) -> None:
        self.last_check = datetime.now(UTC).isoformat(timespec="seconds")
        today = datetime.now().strftime("%Y-%m-%d")
        if not _needs_backup(_last_backup_date(), today) or not BACKUP_SCRIPT.is_file():
            return
        done = await asyncio.to_thread(
            subprocess.run,
            ["uv", "run", "--with", "pyyaml", "python3", str(BACKUP_SCRIPT)],
            capture_output=True, text=True, timeout=1800, cwd=str(BACKUP_SCRIPT.parent),
        )
        tail = [l for l in done.stdout.strip().splitlines() if l.startswith("Бекап:")]
        self.last_event = f"{self.last_check} — " + (
            tail[-1] if tail else "готово" if done.returncode == 0
            else f"помилка: {(done.stderr or done.stdout)[-200:]}")

    async def _loop(self) -> None:
        while True:
            try:
                if self.enabled:
                    await self._tick()
            except asyncio.CancelledError:
                raise
            except Exception as error:           # один невдалий бекап не валить вартового
                self.last_event = f"помилка бекапу: {error}"
            await asyncio.sleep(BACKUP_INTERVAL_SECONDS)

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass


KEYCHAIN_SERVICE = "writer-lab-claude"
HEALTH_SCRIPT = LIBRARY / "90-Meta/scripts/health-check.py"
WEEKLY_DIR = LIBRARY / "90-Meta/reports/weekly"
WEEKLY_COMMAND = LIBRARY / ".claude/commands/щотижневик.md"
WEEKLY_INTERVAL_SECONDS = 6 * 3600     # тиждень — не секунди; кілька перевірок на день досить
WEEKLY_ALLOWED = ["Bash", "WebFetch", "WebSearch", "Agent"]
# Та сама межа, що в конвеєрів і голосового пульта: назовні (push) і незворотне —
# тільки за словом Юрія, ніколи з безголового прогону.
WEEKLY_FORBIDDEN = ["Bash(git push:*)", "Bash(rm:*)", "Bash(rmdir:*)",
                    "Bash(sudo:*)", "Bash(security:*)", "Bash(launchctl:*)"]


def _claude_token() -> str:
    """Той самий токен, що й голосовий пульт і wl-loop.sh — зі сховища ключів,
    не з інтерактивної сесії, якої тут немає."""
    result = subprocess.run(
        ["security", "find-generic-password", "-a", str(Path.home().name), "-s", KEYCHAIN_SERVICE, "-w"],
        capture_output=True, text=True, timeout=10,
    )
    return result.stdout.strip()


def _latest_weekly() -> datetime | None:
    """Час найновішого тижневого звіту — за mtime файлу, не за іменем (ISO-тиждень
    плутає межу року, mtime — ні)."""
    try:
        files = sorted(WEEKLY_DIR.glob("*.md"), key=lambda p: p.stat().st_mtime)
    except OSError:
        return None
    return datetime.fromtimestamp(files[-1].stat().st_mtime) if files else None


def _needs_weekly(latest: datetime | None, now: datetime) -> bool:
    return latest is None or now - latest >= timedelta(days=7)


class WeeklyRitual:
    """Тижневий звіт обсерваторії (Фаза 7). На відміну від бекапу, звіт — не
    механіка: «нові несподівані зв'язки», «найгарячіша напруга» — це судження,
    не підрахунок, тому мовчазний скрипт тут не підходить.

    Вартовий лише пильнує розклад (раз на 7 днів від mtime останнього файлу)
    і будить `claude -p` з тим самим текстом, що й ручна команда `/щотижневик`
    (`.claude/commands/щотижневик.md`) — щоб інструкція жила в одному місці.
    Пише файл і комітить ЛОКАЛЬНО; `git push` заборонено explicit-списком і
    прибрано з промпту — та сама межа «агент пропонує, Юрій вирішує», що
    в конвеєрів: Юрій переглядає перед тим, як звіт піде назовні.
    """

    def __init__(self) -> None:
        self.enabled = True
        self.last_check: str | None = None
        self.last_event: str | None = None
        self._task: asyncio.Task[None] | None = None

    def state(self) -> dict[str, object]:
        latest = _latest_weekly()
        return {
            "enabled": self.enabled,
            "alive": bool(self._task and not self._task.done()),
            "interval_seconds": WEEKLY_INTERVAL_SECONDS,
            "last_check": self.last_check,
            "last_event": self.last_event,
            "last_report": latest.strftime("%Y-%m-%d") if latest else None,
        }

    async def _tick(self) -> None:
        self.last_check = datetime.now(UTC).isoformat(timespec="seconds")
        now = datetime.now()
        if not _needs_weekly(_latest_weekly(), now) or not WEEKLY_COMMAND.is_file():
            return
        await asyncio.to_thread(
            subprocess.run,
            ["uv", "run", "--with", "pyyaml", "python3", str(HEALTH_SCRIPT)],
            capture_output=True, text=True, timeout=300, cwd=str(HEALTH_SCRIPT.parent),
        )
        year, week, _ = now.isocalendar()
        body = WEEKLY_COMMAND.read_text(encoding="utf-8").split("---", 2)[-1].strip()
        prompt = (
            f"{body}\n\nФайл: 90-Meta/reports/weekly/{year}-W{week:02d}.md (ISO-тиждень, "
            "обчислено автоматично). Це безголовий автопрогін: git push НЕ роби — лише "
            "закомить локально, Юрій перегляне і зробить push сам."
        )
        done = await asyncio.to_thread(
            subprocess.run,
            ["claude", "-p", prompt, "--permission-mode", "acceptEdits",
             "--allowedTools", *WEEKLY_ALLOWED, "--disallowedTools", *WEEKLY_FORBIDDEN],
            capture_output=True, text=True, timeout=1800, cwd=str(LIBRARY),
            env={**os.environ, "CLAUDE_CODE_OAUTH_TOKEN": _claude_token()},
        )
        self.last_event = (f"{self.last_check} — звіт {year}-W{week:02d} написано" if done.returncode == 0
                           else f"{self.last_check} — помилка: {(done.stderr or done.stdout)[-200:]}")

    async def _loop(self) -> None:
        while True:
            try:
                if self.enabled:
                    await self._tick()
            except asyncio.CancelledError:
                raise
            except Exception as error:            # один невдалий тиждень не валить вартового
                self.last_event = f"помилка тижневика: {error}"
            await asyncio.sleep(WEEKLY_INTERVAL_SECONDS)

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass


PULT_ROOT = Path.home() / "Writer-Lab/raytsystem"          # корінь цього репо
PULT_SCRIPT = PULT_ROOT / "voice_console.py"
PULT_PID_FILE = STORE / "pult.pid"
PULT_LOG_FILE = STORE / "pult.log"
PULT_INTERVAL_SECONDS = 300              # той самий ритм, що й ConveyorResume


class PultWatcher:
    """Підіймач голосового пульта. Закриває KI-02: пульт не піднімався сам
    після перезавантаження Mac, бо жив поза системою — окремим `uv run` у
    терміналі, який ніхто не тримав.

    РІШЕННЯ ЮРІЯ (2026-07-31): «Пульт — частина системи… включаємо його в
    систему і нехай працює всередині» — та сама межа, що в [[ConveyorResume]]
    вище, тільки тут агент сам піднімає довгоживучий процес (`Popen`, не
    `run`), а не лише будить уже-даемонізований `wl-loop.sh`. `start_new_session`
    відв'язує пульт від сесії застосунку, щоб `stop()` міг завершити саме його,
    не заваливши й самого себе.
    """

    def __init__(self) -> None:
        self.enabled = True
        self.last_check: str | None = None
        self.last_event: str | None = None
        self.checked: str = "ще не перевірявся"
        self._task: asyncio.Task[None] | None = None

    def state(self) -> dict[str, object]:
        return {
            "enabled": self.enabled,
            "alive": _alive(PULT_PID_FILE),
            "interval_seconds": PULT_INTERVAL_SECONDS,
            "last_check": self.last_check,
            "last_event": self.last_event,
            "pid_file": str(PULT_PID_FILE),
        }

    def _start_process(self) -> bool:
        """Підняти voice_console.py. Синхронний і блокуючий — кличемо через
        asyncio.to_thread, як `_lift` у ConveyorResume."""
        if not PULT_SCRIPT.is_file():
            self.last_event = f"voice_console.py не знайдено: {PULT_SCRIPT}"
            return False
        try:
            STORE.mkdir(parents=True, exist_ok=True)
            with PULT_LOG_FILE.open("a", encoding="utf-8") as log_fh:
                log_fh.write(f"=== [pult] піднято автоматично застосунком "
                             f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')} ===\n")
                process = subprocess.Popen(
                    ["uv", "run", "--with", "fastapi", "--with", "uvicorn",
                     "--with", "python-multipart", "python", str(PULT_SCRIPT)],
                    cwd=PULT_ROOT, stdout=log_fh, stderr=subprocess.STDOUT,
                    start_new_session=True,
                )
            PULT_PID_FILE.write_text(str(process.pid), encoding="utf-8")
            return True
        except Exception as error:           # старт не має валити застосунок
            self.last_event = f"пульт не піднявся: {error}"
            return False

    async def _tick(self) -> None:
        self.last_check = datetime.now(UTC).isoformat(timespec="seconds")
        if _alive(PULT_PID_FILE):
            self.checked = "живий"
            return
        ok = await asyncio.to_thread(self._start_process)
        if ok:
            self.checked = "піднято"
            self.last_event = f"{self.last_check} — пульт піднято"
        else:
            self.checked = "підняти не вдалося"

    async def _loop(self) -> None:
        while True:
            try:
                if self.enabled:
                    await self._tick()
            except asyncio.CancelledError:
                raise
            except Exception as error:           # один невдалий цикл не валить вартового
                self.last_event = f"помилка пульта: {error}"
            await asyncio.sleep(PULT_INTERVAL_SECONDS)

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        # Осиротілий пульт-процес лишається висіти на порту 8792, якщо його
        # не зупинити тут — наступний старт застосунку не зможе підняти новий.
        if _alive(PULT_PID_FILE):
            try:
                os.kill(int(PULT_PID_FILE.read_text().strip()), signal.SIGTERM)
            except (OSError, ValueError):
                pass
            PULT_PID_FILE.unlink(missing_ok=True)


watcher = InboxWatcher()
originals = OriginalsWatcher()
resume = ConveyorResume()
backup = BackupWatcher()
weekly = WeeklyRitual()
pult = PultWatcher()
