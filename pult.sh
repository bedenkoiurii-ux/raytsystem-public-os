#!/usr/bin/env bash
# Голосовий пульт — запуск, зупинка, стан.
#
# Навіщо цей файл. Пульт, запущений просто в терміналі, помирає разом із вікном —
# саме так він і зник сьогодні. Тут він відв'язується від термінала (nohup), пише лог
# у файл і лишається живим, доки його не спинити.
#
#   ./pult.sh старт    — підняти (або перепідняти) у фоні
#   ./pult.sh стоп     — спинити
#   ./pult.sh стан     — чи живий, останні рядки логу
#   ./pult.sh лог      — стежити за логом
#
# Повного автозапуску після перезавантаження Mac це не дає — для цього потрібен
# launchd-агент (KI-02). Але вікно термінала більше нічого не вирішує.
set -euo pipefail
cd "$(dirname "$0")"

PORT=8792
LOG="$HOME/.writer-lab/pult.log"
RUN="uv run --with fastapi --with uvicorn --with python-multipart python voice_console.py"

pid() { lsof -nP -iTCP:$PORT -sTCP:LISTEN -t 2>/dev/null || true; }

case "${1:-стан}" in
  старт|start)
    P=$(pid); [ -n "$P" ] && { echo "спиняю попередній ($P)"; kill "$P"; sleep 2; }
    mkdir -p "$(dirname "$LOG")"
    nohup $RUN >>"$LOG" 2>&1 &
    for _ in $(seq 1 20); do
      [ -n "$(pid)" ] && { echo "пульт піднято: https://nemo.tail01f381.ts.net:$PORT"; exit 0; }
      sleep 1
    done
    echo "не піднявся — дивись $LOG"; tail -5 "$LOG"; exit 1 ;;
  стоп|stop)
    P=$(pid); [ -z "$P" ] && { echo "не працює"; exit 0; }
    kill "$P"; echo "спинено ($P)" ;;
  стан|status)
    P=$(pid)
    if [ -n "$P" ]; then echo "працює (pid $P) · https://nemo.tail01f381.ts.net:$PORT"
    else echo "не працює"; fi
    [ -f "$LOG" ] && { echo "--- останнє з логу ---"; tail -5 "$LOG"; } ;;
  лог|log)
    tail -f "$LOG" ;;
  *)
    echo "вживання: $0 {старт|стоп|стан|лог}"; exit 1 ;;
esac
