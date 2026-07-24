#!/usr/bin/env bash
# karty-loop.sh — безголовий конвеєр карток «Крові».
#
# НАВІЩО. `/loop` у сесії тягне весь транскрипт наново щотурну, тож кожен цикл
# дорожчає. А кожен окремий виклик `claude -p` — СВІЖИЙ контекст: читає стан із
# git, робить розділ, комітить, виходить. Наступний виклик стартує начисто.
# Виходить безперервно й дешево, без ручного перезапуску щорозділу.
#
# ВЖИВАННЯ:
#   ./karty-loop.sh старт   — підняти (відв'язується від термінала, пише лог)
#   ./karty-loop.sh стоп    — спинити (ставить прапорець, гасить процес)
#   ./karty-loop.sh стан    — чи живий + останнє з логу
#   ./karty-loop.sh лог     — стежити за логом наживо
#   ./karty-loop.sh раз     — один прогін на передньому плані (для перевірки)
#
# МЕЖІ. Ті самі, що в пульта: acceptEdits (авто лише правки файлів), Bash/фетч
# дозволені явно, заборонено push / rm / rmdir / sudo / security / launchctl.
# Коміти локальні — так; назовні — ніколи. Помилку нема кому зупинити наживо,
# тому заборони незворотного мають перевагу над усім.

set -euo pipefail
cd "$(dirname "$0")"

VAULT="$HOME/Writer-Lab/Library"
PROMPT='працюй за НАКАЗ-картки.md. Це безголовий прогін: зроби один розділ (або скільки встигнеш), закомить локально й заверши відповідь — шелл-цикл стартує наступний прогін начисто. Стан бери з git і зведень, не з памʼяті. Коли ВСІ розділи закрито й роботи більше немає — створи файл-сентинел командою `touch "$HOME/.writer-lab/karty.done"` і напиши, що готово.'

LOG="$HOME/.writer-lab/karty-loop.log"
STOP="$HOME/.writer-lab/karty-loop.stop"
DONE="$HOME/.writer-lab/karty.done"
PIDF="$HOME/.writer-lab/karty-loop.pid"
GAP=8                       # пауза між прогонами, сек
KEYCHAIN_SERVICE="writer-lab-claude"

FORBIDDEN=(
  "Bash(git push:*)"        # назовні — тільки за столом
  "Bash(rm:*)" "Bash(rmdir:*)"
  "Bash(sudo:*)" "Bash(security:*)" "Bash(launchctl:*)"
)
# Дворівневість (рішення Юрія 2026-07-24): збір фактів — дешевими субагентами
# (haiku), аналіз і письмо — топ-модель. Тому `Agent` у дозволених: диригент
# спавнить збирачів фактів, і фетч-важка рутина йде в їхній дешевий контекст,
# а не в контекст Opus. WebFetch/WebSearch/Bash лишаються — ними користуються
# й субагенти. Правки файлів ідуть авто через acceptEdits.
ALLOWED=(Bash WebFetch WebSearch Agent)

token() { security find-generic-password -a "$USER" -s "$KEYCHAIN_SERVICE" -w 2>/dev/null || true; }

one_run() {
  CLAUDE_CODE_OAUTH_TOKEN="$(token)" \
  claude -p "$PROMPT" \
    --permission-mode acceptEdits \
    --allowedTools "${ALLOWED[@]}" \
    --disallowedTools "${FORBIDDEN[@]}"
}

loop() {
  mkdir -p "$(dirname "$LOG")"
  rm -f "$STOP"
  cd "$VAULT"
  echo "=== karty-loop піднято $(date '+%F %T') ===" >>"$LOG"
  local n=0
  while :; do
    [ -f "$STOP" ] && { echo "--- стоп-прапорець, виходжу $(date '+%T') ---" >>"$LOG"; break; }
    [ -f "$DONE" ] && { echo "--- сентинел готовності, усе закрито, виходжу $(date '+%T') ---" >>"$LOG"; break; }
    n=$((n+1))
    echo "───────── прогін #$n  $(date '+%F %T') ─────────" >>"$LOG"
    one_run >>"$LOG" 2>&1 || echo "!! прогін #$n завершився з помилкою (код $?), продовжую" >>"$LOG"
    sleep "$GAP"
  done
  rm -f "$PIDF"
}

case "${1:-}" in
  старт|start)
    if [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null; then
      echo "вже працює (pid $(cat "$PIDF"))"; exit 0
    fi
    mkdir -p "$(dirname "$LOG")"; rm -f "$DONE"
    nohup "$0" _run >>"$LOG" 2>&1 &
    echo $! >"$PIDF"
    sleep 1
    if kill -0 "$(cat "$PIDF")" 2>/dev/null; then echo "піднято (pid $(cat "$PIDF")) · лог: $LOG"
    else echo "не піднявся — дивись $LOG"; tail -5 "$LOG"; exit 1; fi ;;
  _run) loop ;;                              # внутрішнє: тіло циклу під nohup
  раз|once) cd "$VAULT"; one_run ;;          # один прогін на передньому плані
  стоп|stop)
    touch "$STOP"
    [ -f "$PIDF" ] && kill "$(cat "$PIDF")" 2>/dev/null || true
    echo "спиняю (поточний прогін дороблю, далі стоп)" ;;
  стан|status)
    if [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null; then echo "живий (pid $(cat "$PIDF"))"
    else echo "не працює"; fi
    [ -f "$DONE" ] && echo "сентинел: УСЕ ЗАКРИТО ($DONE)"
    [ -f "$LOG" ] && { echo "--- останнє з логу ---"; tail -6 "$LOG"; } ;;
  лог|log) tail -f "$LOG" ;;
  *) echo "вживання: $0 {старт|стоп|стан|лог|раз}"; exit 1 ;;
esac
