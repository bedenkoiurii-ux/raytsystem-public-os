"""Внутрішні агенти Writer-Lab — фонові задачі, що живуть у самій системі.

РІШЕННЯ ЮРІЯ (2026-07-27): агенти мають бути **всередині Writer-Lab**, а не
системними службами macOS. Winter-Lab — агентна система; виносити її агента в
launchd означає, що частина системи живе поза системою: засмічує ОС, керується
з термінала й не бачить власного стану.

Наслідок, який приймаємо свідомо: стеження працює, **поки працює застосунок**.
Це чесно й передбачувано — прихована служба, що сканує диск за спиною автора,
гірша за агента, який видимо живе у вікні.

Дешевизна тут principova: відбиток тек (кількість файлів + найновіший mtime)
рахується за мілісекунди й коштує нуль токенів. Модель прокидається ЛИШЕ коли
відбиток змінився. До цього постійний цикл варти будив Claude кожні кілька
хвилин, і шість прогонів поспіль закінчувалися висновком «усі файли — дублікати».
"""
from __future__ import annotations

import asyncio
import os
import subprocess
from datetime import UTC, datetime
from pathlib import Path

STORE = Path.home() / ".writer-lab"
WATCH_LIST = STORE / "inbox-watch.txt"
FINGERPRINT = STORE / "inbox-fingerprint"
LOOP = Path.home() / "Writer-Lab/raytsystem/wl-loop.sh"

INTERVAL_SECONDS = 300          # перевірка дешева; частіше просто не має сенсу


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
        }

    @staticmethod
    def _folders() -> list[str]:
        if not WATCH_LIST.is_file():
            return []
        return [l.strip() for l in WATCH_LIST.read_text(encoding="utf-8").splitlines()
                if l.strip() and not l.startswith("#")]

    @staticmethod
    def _varta_running() -> bool:
        pid_file = STORE / "inbox-loop.pid"
        if not pid_file.is_file():
            return False
        try:
            os.kill(int(pid_file.read_text().strip()), 0)
            return True
        except (OSError, ValueError):
            return False

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
        current = await asyncio.to_thread(self._fingerprint)
        self.last_check = datetime.now(UTC).isoformat(timespec="seconds")
        previous = FINGERPRINT.read_text(encoding="utf-8").strip() if FINGERPRINT.is_file() else ""
        if current == previous:
            return                                   # нічого не змінилось — модель не будимо
        if self._varta_running():
            self.last_event = "зміни є, але варта вже працює"
            return
        STORE.mkdir(parents=True, exist_ok=True)
        FINGERPRINT.write_text(current, encoding="utf-8")
        (STORE / "inbox.done").unlink(missing_ok=True)      # робота зʼявилась знову
        if LOOP.is_file():
            await asyncio.to_thread(
                subprocess.run, ["/bin/bash", str(LOOP), "inbox", "старт"],
                capture_output=True, text=True, timeout=60,
            )
            self.last_event = f"{datetime.now(UTC).isoformat(timespec='seconds')} — знайдено нове, варту розбуджено"

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


watcher = InboxWatcher()
