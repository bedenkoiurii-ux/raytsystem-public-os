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
import subprocess
from datetime import UTC, datetime
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


watcher = InboxWatcher()
originals = OriginalsWatcher()
resume = ConveyorResume()
