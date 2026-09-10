"""Щоденний бекап (Фаза 7): вартовий будить backup.py рівно один раз на день.

Знайдено 06.08: формула вимагає щоденного бекапу, а реальний розрив був
35 днів — ніхто не будив скрипт. Головне тут — не сам факт запуску, а що
вартовий не дублює роботу в межах одного дня (backup.py сам не має захисту
від подвійного запуску) і переживає збій скрипта, не падаючи назавжди.
"""
from __future__ import annotations

import asyncio

import pytest

from raytsystem.webapp import agents


@pytest.fixture
def stand(tmp_path, monkeypatch):
    log = tmp_path / "backup-log.md"
    script = tmp_path / "backup.py"
    calls = tmp_path / "calls.txt"
    script.write_text(
        "from pathlib import Path\n"
        f"Path(r'{calls}').write_text('ran')\n"
        "print('Бекап: vault-daily-fake.tar.gz (1.0 МБ)')\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(agents, "BACKUP_LOG", log)
    monkeypatch.setattr(agents, "BACKUP_SCRIPT", script)
    return type("Stand", (), {"log": log, "calls": calls})()


def _tick() -> agents.BackupWatcher:
    agent = agents.BackupWatcher()
    asyncio.run(agent._tick())
    return agent


def test_needs_backup_pure() -> None:
    assert agents._needs_backup(None, "2026-09-06") is True
    assert agents._needs_backup("2026-09-05", "2026-09-06") is True
    assert agents._needs_backup("2026-09-06", "2026-09-06") is False


def test_runs_when_no_log_yet(stand):
    agent = _tick()
    assert stand.calls.exists()
    assert "Бекап: vault-daily-fake.tar.gz" in agent.last_event


def test_skips_when_already_backed_up_today(stand):
    today = agents.datetime.now().strftime("%Y-%m-%d")
    stand.log.write_text(f"- {today} 03:00 — створено vault-daily-old.tar.gz (1.0 МБ)\n",
                          encoding="utf-8")
    _tick()
    assert not stand.calls.exists()


def test_runs_when_last_backup_was_yesterday(stand):
    stand.log.write_text("- 2020-01-01 03:00 — створено vault-daily-old.tar.gz (1.0 МБ)\n",
                          encoding="utf-8")
    _tick()
    assert stand.calls.exists()


def test_script_failure_does_not_crash_watcher(stand, monkeypatch):
    monkeypatch.setattr(agents, "BACKUP_SCRIPT", stand.calls.parent / "no-such-script.py")
    agent = _tick()
    assert agent.last_event is None      # мовчазний вихід: скрипта немає, звіту немає
