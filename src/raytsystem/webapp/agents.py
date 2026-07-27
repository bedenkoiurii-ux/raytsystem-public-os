"""Внутрішні агенти Writer-Lab — фонові задачі, що живуть у самій системі.

РІШЕННЯ ЮРІЯ (2026-07-27): агенти мають бути **всередині Writer-Lab**, а не
системними службами macOS. Winter-Lab — агентна система; виносити її агента в
launchd означає, що частина системи живе поза системою: засмічує ОС, керується
з термінала й не бачить власного стану.

Наслідок, який приймаємо свідомо: стеження працює, **поки працює застосунок**.
Це чесно й передбачувано — прихована служба, що сканує диск за спиною автора,
гірша за агента, який видимо живе у вікні.

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

STORE = Path.home() / ".writer-lab"
WATCH_LIST = STORE / "inbox-watch.txt"
FINGERPRINT = STORE / "inbox-fingerprint"
LOOP = Path.home() / "Writer-Lab/raytsystem/wl-loop.sh"
LIBRARY = Path.home() / "Writer-Lab/Library"
SCAN = LIBRARY / "90-Meta/scripts/inbox_scan.py"
PROPOSALS = LIBRARY / "00-Inbox/Пропозиції"

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
            "queued": self._count("queued"),
            "in_work": self._count("in_work"),
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

    @staticmethod
    def _count(status: str) -> int:
        """Скільки карток черги в цій фазі. Читання файлів, не модель."""
        if not PROPOSALS.is_dir():
            return 0
        needle = f"status: {status}"
        return sum(1 for p in PROPOSALS.glob("*.md")
                   if needle in p.read_text(encoding="utf-8", errors="ignore")[:600])

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

        # Фаза 2 — опрацювати. Будимо Claude ЛИШЕ на те, що автор пустив у роботу.
        if self._count("in_work") and not self._varta_running() and LOOP.is_file():
            (STORE / "inbox.done").unlink(missing_ok=True)
            await asyncio.to_thread(
                subprocess.run, ["/bin/bash", str(LOOP), "inbox", "старт"],
                capture_output=True, text=True, timeout=60,
            )
            self.last_event = f"{self.last_check} — є «у роботу», варту розбуджено"

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


watcher = InboxWatcher()
