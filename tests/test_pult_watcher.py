"""Голосовий пульт (KI-02): пульт не піднімався сам після перезавантаження Mac,
бо жив поза системою — окремим `uv run` у терміналі, який ніхто не тримав.

Тут не піднімаємо справжній voice_console.py (порт 8792, сертифікати,
Tailscale, whisper — нема сенсу в CI): `_start_process` замокано, головне —
що вартовий правильно читає pid-файл і виставляє `checked` за результатом.
"""
from __future__ import annotations

import asyncio
from unittest.mock import patch

from raytsystem.webapp import agents


def _tick(agent: agents.PultWatcher) -> agents.PultWatcher:
    asyncio.run(agent._tick())
    return agent


def test_state_before_start(tmp_path, monkeypatch):
    monkeypatch.setattr(agents, "PULT_PID_FILE", tmp_path / "pult.pid")
    agent = agents.PultWatcher()
    state = agent.state()
    assert state["alive"] is False
    assert state["enabled"] is True
    assert state["last_check"] is None


def test_tick_starts_process_when_not_alive(tmp_path, monkeypatch):
    monkeypatch.setattr(agents, "PULT_PID_FILE", tmp_path / "pult.pid")
    agent = agents.PultWatcher()
    with patch.object(agents.PultWatcher, "_start_process", return_value=True) as mocked:
        _tick(agent)
    mocked.assert_called_once()
    assert agent.checked == "піднято"
    assert "піднято" in agent.last_event


def test_tick_records_failure(tmp_path, monkeypatch):
    monkeypatch.setattr(agents, "PULT_PID_FILE", tmp_path / "pult.pid")
    agent = agents.PultWatcher()
    with patch.object(agents.PultWatcher, "_start_process", return_value=False):
        _tick(agent)
    assert agent.checked == "підняти не вдалося"


def test_tick_skips_when_already_alive(tmp_path, monkeypatch):
    pid_file = tmp_path / "pult.pid"
    pid_file.write_text(str(__import__("os").getpid()), encoding="utf-8")
    monkeypatch.setattr(agents, "PULT_PID_FILE", pid_file)
    agent = agents.PultWatcher()
    with patch.object(agents.PultWatcher, "_start_process") as mocked:
        _tick(agent)
    mocked.assert_not_called()
    assert agent.checked == "живий"
