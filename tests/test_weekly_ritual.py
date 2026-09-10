"""Тижневий звіт обсерваторії (Фаза 7): вартовий будить `claude -p` раз на 7 днів.

На відміну від бекапу цей прогін коштує реальних токенів, тому головне тут —
що він НЕ спрацьовує зайвий раз (звіт молодший за тиждень) і що заборона
`git push` реально йде командою, а не лише текстом промпту (перевіряємо
--disallowedTools, а не віримо словам).
"""
from __future__ import annotations

import asyncio
import os
import stat

import pytest

from raytsystem.webapp import agents


@pytest.fixture
def stand(tmp_path, monkeypatch):
    weekly_dir = tmp_path / "weekly"
    weekly_dir.mkdir()
    command = tmp_path / "щотижневик.md"
    command.write_text("---\ndescription: тест\n---\nСтвори звіт.\n", encoding="utf-8")
    health = tmp_path / "health-check.py"
    health.write_text("print('ok')\n", encoding="utf-8")
    library = tmp_path / "Library"
    library.mkdir()

    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    call_log = tmp_path / "claude-call.txt"
    fake_claude = bin_dir / "claude"
    fake_claude.write_text(
        "#!/bin/bash\n"
        f'printf "%s\\n" "$@" > "{call_log}"\n',
        encoding="utf-8",
    )
    fake_claude.chmod(fake_claude.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setenv("PATH", f"{bin_dir}:{os.environ['PATH']}")

    monkeypatch.setattr(agents, "WEEKLY_DIR", weekly_dir)
    monkeypatch.setattr(agents, "WEEKLY_COMMAND", command)
    monkeypatch.setattr(agents, "HEALTH_SCRIPT", health)
    monkeypatch.setattr(agents, "LIBRARY", library)
    monkeypatch.setattr(agents, "_claude_token", lambda: "фальшивий-токен")

    return type("Stand", (), {"weekly_dir": weekly_dir, "call_log": call_log})()


def _tick() -> agents.WeeklyRitual:
    agent = agents.WeeklyRitual()
    asyncio.run(agent._tick())
    return agent


def test_needs_weekly_pure() -> None:
    now = agents.datetime(2026, 9, 6)
    assert agents._needs_weekly(None, now) is True
    assert agents._needs_weekly(now - agents.timedelta(days=3), now) is False
    assert agents._needs_weekly(now - agents.timedelta(days=7), now) is True


def test_calls_claude_when_no_report_yet(stand):
    agent = _tick()
    assert stand.call_log.exists()
    assert "звіт" in agent.last_event


def test_prompt_forbids_push(stand):
    _tick()
    args = stand.call_log.read_text(encoding="utf-8").splitlines()
    idx = args.index("--disallowedTools")
    assert "Bash(git push:*)" in args[idx + 1:]


def test_skips_when_report_is_recent(stand):
    (stand.weekly_dir / "2026-W36.md").write_text("звіт", encoding="utf-8")
    _tick()
    assert not stand.call_log.exists()


def test_claude_failure_does_not_crash_watcher(stand, monkeypatch):
    bin_dir = stand.call_log.parent / "bin"
    failing = bin_dir / "claude"
    failing.write_text("#!/bin/bash\nexit 1\n", encoding="utf-8")
    failing.chmod(failing.stat().st_mode | stat.S_IEXEC)
    agent = _tick()
    assert "помилка" in agent.last_event
