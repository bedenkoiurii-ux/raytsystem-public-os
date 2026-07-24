#!/usr/bin/env bash
# apparat-loop.sh — безголовий конвеєр карток АПАРАТУ «Крові».
#
# Сестра karty-loop.sh: та сама механіка (свіжий контекст на прогін, дворівневість,
# токен із Keychain, ті самі межі), але одиниця — не розділ, а СУТНІСНА КАРТКА
# апарату (тонка або вісяча). Порядок — з worklist (apparatus_worklist.py):
# спершу другий рівень фільму «Катинь», тоді решта.
#
# ВЖИВАННЯ:
#   ./apparat-loop.sh старт | стоп | стан | лог | раз
#
# МЕЖІ ті самі: acceptEdits, Bash/фетч/Agent дозволені, push/rm/rmdir/sudo/
# security/launchctl заборонені. Коміти локальні; назовні — ніколи.

set -euo pipefail
cd "$(dirname "$0")"

VAULT="$HOME/Writer-Lab/Library"
WORKLIST="$HOME/.writer-lab/apparat-worklist.txt"
PROMPT='працюй за НАКАЗ-апарату.md. Безголовий прогін: доведи ОДНУ картку апарату з ~/.writer-lab/apparat-worklist.txt (перша, що ще не enriched) до стандарту — card_prep → haiku збирає факти → ти пишеш за kartky → ворота card_order → локальний коміт — і заверши відповідь. Стан бери з git і статусів карток, не з памʼяті. Коли всі картки worklist стали enriched — `touch "$HOME/.writer-lab/apparat.done"` і напиши, що готово.'

LOG="$HOME/.writer-lab/apparat-loop.log"
STOP="$HOME/.writer-lab/apparat-loop.stop"
DONE="$HOME/.writer-lab/apparat.done"
PIDF="$HOME/.writer-lab/apparat-loop.pid"
GAP=8
KEYCHAIN_SERVICE="writer-lab-claude"

FORBIDDEN=(
  "Bash(git push:*)"
  "Bash(rm:*)" "Bash(rmdir:*)"
  "Bash(sudo:*)" "Bash(security:*)" "Bash(launchctl:*)"
)
ALLOWED=(Bash WebFetch WebSearch Agent)

token() { security find-generic-password -a "$USER" -s "$KEYCHAIN_SERVICE" -w 2>/dev/null || true; }

regen_worklist() {   # перегенерувати список (свіжий стан статусів)
  ( cd "$VAULT" && uv run python3 90-Meta/scripts/apparatus_worklist.py >>"$LOG" 2>&1 ) || true
}

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
  echo "=== apparat-loop піднято $(date '+%F %T') ===" >>"$LOG"
  local n=0
  while :; do
    [ -f "$STOP" ] && { echo "--- стоп-прапорець, виходжу $(date '+%T') ---" >>"$LOG"; break; }
    [ -f "$DONE" ] && { echo "--- сентинел готовності, апарат доведено, виходжу $(date '+%T') ---" >>"$LOG"; break; }
    n=$((n+1))
    regen_worklist                                  # свіжий worklist перед кожним прогоном
    echo "───────── апарат прогін #$n  $(date '+%F %T') ─────────" >>"$LOG"
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
    regen_worklist
    nohup "$0" _run >>"$LOG" 2>&1 &
    echo $! >"$PIDF"
    sleep 1
    if kill -0 "$(cat "$PIDF")" 2>/dev/null; then echo "піднято (pid $(cat "$PIDF")) · лог: $LOG"
    else echo "не піднявся — дивись $LOG"; tail -5 "$LOG"; exit 1; fi ;;
  _run) loop ;;
  раз|once) cd "$VAULT"; regen_worklist; one_run ;;
  стоп|stop)
    touch "$STOP"
    [ -f "$PIDF" ] && kill "$(cat "$PIDF")" 2>/dev/null || true
    echo "спиняю (поточний прогін дороблю, далі стоп)" ;;
  стан|status)
    if [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null; then echo "живий (pid $(cat "$PIDF"))"
    else echo "не працює"; fi
    [ -f "$DONE" ] && echo "сентинел: АПАРАТ ДОВЕДЕНО ($DONE)"
    [ -f "$WORKLIST" ] && echo "у worklist: $(wc -l <"$WORKLIST" | tr -d ' ') карток"
    [ -f "$LOG" ] && { echo "--- останнє з логу ---"; tail -6 "$LOG"; } ;;
  лог|log) tail -f "$LOG" ;;
  *) echo "вживання: $0 {старт|стоп|стан|лог|раз}"; exit 1 ;;
esac
