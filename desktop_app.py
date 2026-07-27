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
import ipaddress
import json
import socket
import subprocess
import threading
import time
import urllib.request
from pathlib import Path

HOST = "127.0.0.1"
# Приватна мережа Tailscale (CGNAT-діапазон). Доступ ззовні дозволено ЛИШЕ звідси.
TAILNET = ipaddress.ip_network("100.64.0.0/10")
TAILSCALE_BIN = Path("/Applications/Tailscale.app/Contents/MacOS/Tailscale")


def tailnet_identity() -> tuple[str | None, str | None]:
    """(IPv4, MagicDNS-ім'я) цього Mac у мережі Tailscale. Обидва треба внести в дозволені
    хости: з телефона заходять і за адресою, і за іменем — інакше host_rejected."""
    command = [str(TAILSCALE_BIN)] if TAILSCALE_BIN.is_file() else ["tailscale"]
    try:
        result = subprocess.run([*command, "status", "--json"], capture_output=True, text=True, timeout=5)
        node = json.loads(result.stdout).get("Self") or {}
        addresses = node.get("TailscaleIPs") or []
        address = next((a for a in addresses if ipaddress.ip_address(a) in TAILNET), None)
        name = (node.get("DNSName") or "").rstrip(".") or None
        return address, name
    except Exception:
        return None, None
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

    # Якщо Tailscale піднятий — слухаємо всі інтерфейси, щоб застосунок було видно з телефона.
    # Безпеку тримає не прив'язка, а фільтр нижче: чужа мережа (кав'ярня, готель) не пройде.
    remote_ip, remote_name = tailnet_identity()
    bind_host = "0.0.0.0" if remote_ip else HOST
    hosts = {HOST, f"{HOST}:{port}", "localhost", f"localhost:{port}"}
    origins = {url, f"http://localhost:{port}"}
    for peer in (remote_ip, remote_name):
        if peer:
            hosts |= {peer, f"{peer}:{port}"}
            origins |= {f"http://{peer}:{port}"}

    app = create_app(
        ROOT,
        allowed_hosts=frozenset(hosts),
        allowed_origins=frozenset(origins),
        static_dir=static_dir,
    )

    from starlette.responses import JSONResponse

    @app.middleware("http")
    async def only_local_or_tailnet(request, call_next):
        """Впускаємо лише loopback і приватну мережу Tailscale — більше нікого."""
        client = request.client.host if request.client else ""
        try:
            address = ipaddress.ip_address(client)
            allowed = address.is_loopback or address in TAILNET
        except ValueError:
            allowed = False
        if not allowed:
            return JSONResponse(
                status_code=403,
                content={"error": {"code": "forbidden_network", "message": "Доступ лише з локальної машини або приватної мережі."}},
            )
        return await call_next(request)

    import uvicorn

    server = uvicorn.Server(
        uvicorn.Config(app, host=bind_host, port=port, access_log=False, log_level="warning")
    )
    if remote_ip:
        print(f"З телефона (у мережі Tailscale): http://{remote_ip}:{port}", flush=True)
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

    class DesktopApi:
        """Місток до нативних можливостей macOS, яких немає у вебі.

        Вибір теки: WKWebView (як і будь-який браузер) з міркувань безпеки не
        віддає шлях до папки — лише вміст окремих файлів. Тому «вибрати теку»
        неможливо зробити самим фронтом, і замість цього доводилося вводити
        повний шлях руками через термінал. pywebview має нативний діалог —
        прокидаємо його у вікно як window.pywebview.api.pick_folder().
        """

        def pick_folder(self) -> str | None:
            windows = webview.windows
            if not windows:
                return None
            result = windows[0].create_file_dialog(webview.FOLDER_DIALOG)
            if not result:
                return None
            return result[0] if isinstance(result, (list, tuple)) else str(result)

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

    webview.create_window("Система Райта — Writer-Lab", url, js_api=DesktopApi(), **kwargs)
    webview.start()  # блокує, поки вікно відкрите (головний потік, Cocoa)

    server.should_exit = True
    time.sleep(0.3)


if __name__ == "__main__":
    main()
