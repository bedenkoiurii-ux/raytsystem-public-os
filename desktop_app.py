#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Нативний застосунок Writer-Lab (Система Райта).
Піднімає raytsystem-сервер УСЕРЕДИНІ процесу на loopback і відкриває рідне вікно macOS
(WKWebView через pywebview) — без Chrome, без вкладок, без ручного сервера й протухлих сесій.
Закриття вікна гасить сервер і завершує застосунок.

Запуск напряму:  uv run --with pywebview python desktop_app.py
(зазвичай запускається через Writer-Lab.app)
"""
from __future__ import annotations

import os
import socket
import threading
import time
import urllib.request
from pathlib import Path

HOST = "127.0.0.1"
# Корінь простору: env RAYTSYSTEM_ROOT або типовий vault Writer-Lab.
ROOT = Path(os.environ.get("RAYTSYSTEM_ROOT", "/Users/Nemo/Writer-Lab/Library")).resolve()
# Стабільний виділений порт: origin (host:port) не змінюється між запусками,
# тож localStorage (тема, тон паперу, формат, шрифт, відкриті вкладки) зберігається.
PREFERRED_PORT = 8791


def pick_port(preferred: int) -> int:
    """Взяти бажаний (стабільний) порт; якщо реально зайнятий іншим процесом — будь-який вільний.
    SO_REUSEADDR дозволяє переприв'язатись одразу після рестарту (порт у TIME_WAIT), не збиваючись
    на випадковий — інакше origin змінюється і localStorage «забувається»."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind((HOST, preferred))
            return preferred
        except OSError:
            s.bind((HOST, 0))
            return s.getsockname()[1]


def main() -> None:
    import raytsystem.webapp as webapp_pkg
    from raytsystem.webapp import create_app

    static_dir = Path(webapp_pkg.__file__).resolve().parent / "static"
    if not (static_dir / "index.html").is_file():
        raise SystemExit("Веб-бандл відсутній. Спершу збери фронт: cd web && npm run build")

    port = pick_port(PREFERRED_PORT)
    url = f"http://{HOST}:{port}"
    app = create_app(
        ROOT,
        allowed_hosts=frozenset({HOST, f"{HOST}:{port}", "localhost", f"localhost:{port}"}),
        allowed_origins=frozenset({url, f"http://localhost:{port}"}),
        static_dir=static_dir,
    )

    import uvicorn

    server = uvicorn.Server(
        uvicorn.Config(app, host=HOST, port=port, access_log=False, log_level="warning")
    )
    threading.Thread(target=server.run, daemon=True).start()

    # чекаємо, поки сервер відповість (мінтить сесію при першому GET /)
    ready = False
    for _ in range(200):
        try:
            urllib.request.urlopen(url, timeout=1)
            ready = True
            break
        except Exception:
            time.sleep(0.1)
    if not ready:
        raise SystemExit("Сервер не піднявся вчасно.")

    import webview

    # Відкривати на НАЙБІЛЬШОМУ екрані, максимізовано (зручно працювати).
    kwargs = dict(min_size=(1024, 680))
    try:
        screens = list(webview.screens or [])
    except Exception:
        screens = []
    if screens:
        largest = max(screens, key=lambda s: s.width * s.height)
        kwargs["screen"] = largest
        kwargs["maximized"] = True
    else:
        kwargs["width"], kwargs["height"] = 1600, 1000

    webview.create_window("Система Райта — Writer-Lab", url, **kwargs)
    webview.start()  # блокує, поки вікно відкрите (головний потік, Cocoa)

    server.should_exit = True
    time.sleep(0.3)


if __name__ == "__main__":
    main()
