"""Автопідйом конвеєрів: піднімається лише коли зійшлися всі п'ять умов.

Головне, що тут перевіряється, — НЕ факт підйому, а те, що сентинел і
стоп-прапорець його спиняють. Ціна помилки асиметрична: не піднятий конвеєр
чекає до наступної перевірки, а піднятий проти волі автора палить токени й
переробляє доведену роботу.
"""
from __future__ import annotations

import asyncio
import os

import pytest

from raytsystem.webapp import agents


@pytest.fixture
def stand(tmp_path, monkeypatch):
    """Підставний ~/.writer-lab, бібліотека з config.yaml і фальшивий wl-loop.sh."""
    store = tmp_path / "store"
    store.mkdir()
    library = tmp_path / "Library"
    (library / "90-Meta").mkdir(parents=True)
    (library / "90-Meta" / "config.yaml").write_text(
        "loop_budget:\n  default: 60\n  sources: 40\n"
        "conveyors:\n  auto_resume:\n    - sources\n",
        encoding="utf-8",
    )

    loop = tmp_path / "wl-loop.sh"
    lifted = tmp_path / "lifted.txt"
    loop.write_text(f'#!/bin/bash\necho "$1 $2" >> "{lifted}"\n', encoding="utf-8")
    loop.chmod(0o755)

    monkeypatch.setattr(agents, "STORE", store)
    monkeypatch.setattr(agents, "LIBRARY", library)
    monkeypatch.setattr(agents, "LOOP", loop)

    # Черга: три тези в seed, одна зроблена — лишається дві.
    (store / "sources-seed.txt").write_text("а\nб\nв\n", encoding="utf-8")
    (store / "sources-done.txt").write_text("б\n", encoding="utf-8")

    return type("Stand", (), {"store": store, "lifted": lifted})()


def _tick() -> agents.ConveyorResume:
    agent = agents.ConveyorResume()
    asyncio.run(agent._tick())
    return agent


def test_lifts_when_all_conditions_met(stand):
    agent = _tick()
    assert stand.lifted.read_text().strip() == "sources старт"
    assert agent.checked["sources"] == "піднято"
    log = (stand.store / "sources-loop.log").read_text(encoding="utf-8")
    assert "піднято автоматично застосунком" in log


@pytest.mark.parametrize("name", ["sources.done", "sources-loop.stop"])
def test_sentinel_and_stop_flag_are_sacred(stand, name):
    flag = stand.store / name
    flag.touch()
    agent = _tick()
    assert not stand.lifted.exists()
    assert flag.exists(), "агент не має чіпати сентинели й стоп-прапорці"
    assert agent.checked["sources"] in ("сентинел: робота вичерпана", "стоп-прапорець")


def test_empty_queue_is_not_lifted(stand):
    (stand.store / "sources-done.txt").write_text("а\nб\nв\n", encoding="utf-8")
    assert _tick().checked["sources"] == "черга порожня"
    assert not stand.lifted.exists()


def test_no_queue_file_is_not_lifted(stand):
    (stand.store / "sources-seed.txt").unlink()
    assert _tick().checked["sources"] == "черги не видно"
    assert not stand.lifted.exists()


def test_daily_budget_stops_lift(stand):
    stamp = agents.datetime.now().strftime("%Y-%m-%d")
    (stand.store / f"sources-runs-{stamp}").write_text("40\n", encoding="utf-8")
    assert _tick().checked["sources"] == "денний бюджет вичерпано (40 із 40)"
    assert not stand.lifted.exists()


def test_live_process_is_not_lifted_twice(stand):
    (stand.store / "sources-loop.pid").write_text(f"{os.getpid()}\n", encoding="utf-8")
    assert _tick().checked["sources"] == "уже працює"
    assert not stand.lifted.exists()


def test_stale_pid_file_does_not_block(stand):
    """Убитий процес лишає pid-файл — саме цей випадок і треба ловити."""
    (stand.store / "sources-loop.pid").write_text("999999\n", encoding="utf-8")
    assert _tick().checked["sources"] == "піднято"


def test_task_outside_list_is_never_lifted(stand):
    (stand.store / "karty-seed.txt").write_text("картка\n", encoding="utf-8")
    agent = _tick()
    assert "karty" not in agent.checked
    assert stand.lifted.read_text().strip() == "sources старт"


def test_missing_config_lifts_nothing(stand, tmp_path, monkeypatch):
    monkeypatch.setattr(agents, "LIBRARY", tmp_path / "немає")
    assert _tick().checked == {}
    assert not stand.lifted.exists()
