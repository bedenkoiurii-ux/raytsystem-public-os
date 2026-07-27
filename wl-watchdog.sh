#!/usr/bin/env bash
# wl-watchdog.sh — дешевий сторож вхідних тек.
#
# НАВІЩО. Постійний цикл варти (wl-loop.sh inbox старт) будив модель кожні кілька
# хвилин навіть тоді, коли нічого нового немає: шість прогонів поспіль закінчилися
# висновком «усі файли — дублікати», і кожен коштував токенів.
#
# Сторож бере на себе саме те, для чого модель не потрібна: подивитися, чи
# змінилися теки. Відбиток (кількість файлів + найновіший mtime) рахується за
# мілісекунди й коштує нуль. Модель прокидається ЛИШЕ коли відбиток змінився —
# тобто коли ти справді щось поклав.
#
# Той самий принцип, що в екрані стану голосового пульта: питати Claude дорого,
# читати файли — ні.
#
#   ./wl-watchdog.sh раз     — одна перевірка (для launchd або вручну)
#   ./wl-watchdog.sh стан    — що бачить сторож

set -euo pipefail
cd "$(dirname "$0")"

WATCH="$HOME/.writer-lab/inbox-watch.txt"
STAMP="$HOME/.writer-lab/inbox-fingerprint"
LOG="$HOME/.writer-lab/watchdog.log"
LOOP="$(cd "$(dirname "$0")" && pwd)/wl-loop.sh"

fingerprint() {
  # Відбиток усіх тек стеження: скільки файлів і коли останній змінювався.
  # Недоступні теки (macOS може не дати прав) мовчки пропускаємо — це не помилка.
  local out=""
  while IFS= read -r dir; do
    [ -z "$dir" ] && continue
    [ -d "$dir" ] || continue
    local n newest
    n=$(find "$dir" -maxdepth 3 -type f ! -name ".*" 2>/dev/null | wc -l | tr -d ' ')
    newest=$(find "$dir" -maxdepth 3 -type f ! -name ".*" -exec stat -f "%m" {} \; 2>/dev/null | sort -rn | head -1)
    out="$out$dir:$n:${newest:-0};"
  done < "$WATCH"
  echo "$out"
}

case "${1:-раз}" in
  раз|once)
    [ -f "$WATCH" ] || exit 0
    now="$(fingerprint)"
    was="$(cat "$STAMP" 2>/dev/null || true)"
    if [ "$now" = "$was" ]; then
      exit 0                                   # нічого не змінилось — модель не будимо
    fi
    # Варта вже може працювати після попереднього спрацювання — не плодимо другу.
    pid=$(cat "$HOME/.writer-lab/inbox-loop.pid" 2>/dev/null || true)
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      echo "$(date '+%F %T') зміни є, але варта вже працює (pid $pid)" >>"$LOG"
      exit 0
    fi
    echo "$(date '+%F %T') зміни в теках — буджу варту" >>"$LOG"
    echo "$now" >"$STAMP"
    rm -f "$HOME/.writer-lab/inbox.done"       # робота зʼявилась знову
    "$LOOP" inbox старт >>"$LOG" 2>&1 ;;
  стан|status)
    echo "теки стеження:"; sed 's/^/  /' "$WATCH" 2>/dev/null || echo "  список порожній"
    echo "поточний відбиток: $(fingerprint)"
    echo "збережений:        $(cat "$STAMP" 2>/dev/null || echo '—')"
    [ -f "$LOG" ] && { echo "--- останнє ---"; tail -5 "$LOG"; } ;;
  *) echo "вживання: $0 {раз|стан}"; exit 1 ;;
esac
