#!/usr/bin/env bash
# wl-loop.sh — універсальний безголовий конвеєр Writer-Lab.
#
# Одна механіка на всі фонові задачі: свіжий контекст на прогін (claude -p),
# дворівневість (haiku збирає — топ-модель судить), ізольований git-worktree,
# токен із Keychain, ті самі межі. Задача задається першим аргументом.
#
#   ./wl-loop.sh <задача> {старт|стоп|стан|лог|раз|злити}
#
# Задачі:
#   apparat   — картки апарату до стандарту        (НАКАЗ-апарату.md)
#   geo       — координати й місця для Мапи подій  (НАКАЗ-гео.md)
#   opponent  — контраргументи з власного масиву   (НАКАЗ-опонента.md)
#   inbox     — варта вхідних: розбір нових текстів (НАКАЗ-інбоксу.md)
#
# МЕЖІ спільні: acceptEdits, Bash/фетч/Agent дозволені; push/rm/rmdir/sudo/
# security/launchctl заборонені. Коміти локальні; назовні — ніколи.

set -euo pipefail
cd "$(dirname "$0")"

TASK="${1:-}"; shift || true
case "$TASK" in
  apparat|geo|opponent|inbox) ;;
  *) echo "вживання: $0 {apparat|geo|opponent|inbox} {старт|стоп|стан|лог|раз|злити}"; exit 1 ;;
esac

# Кожна задача — свій worktree й гілка, щоб задачі не заважали одна одній
# і не смикали каталог, який читає застосунок.
VAULT="$HOME/Writer-Lab/.wl-$TASK"
MAIN="$HOME/Writer-Lab/Library"
BRANCH="wl-$TASK"
[ "$TASK" = "apparat" ] && { VAULT="$HOME/Writer-Lab/.apparat-work"; BRANCH="apparat-wave2"; }

S="$HOME/.writer-lab"
LOG="$S/$TASK-loop.log"; STOP="$S/$TASK-loop.stop"
DONE="$S/$TASK.done";    PIDF="$S/$TASK-loop.pid"
GAP=8
KEYCHAIN_SERVICE="writer-lab-claude"

case "$TASK" in
  apparat)  NAKAZ="НАКАЗ-апарату.md";  UNIT="картку апарату" ;;
  geo)      NAKAZ="НАКАЗ-гео.md";      UNIT="порцію координат" ;;
  opponent) NAKAZ="НАКАЗ-опонента.md"; UNIT="одну тезу на перевірку" ;;
  inbox)    NAKAZ="НАКАЗ-інбоксу.md";  UNIT="партію вхідних файлів" ;;
esac
PROMPT="працюй за $NAKAZ. Безголовий прогін: зроби $UNIT, закомить локально й заверши відповідь — шелл-цикл стартує наступний прогін начисто. Стан бери з git і файлів, не з памʼяті. Коли робота вичерпана — \`touch \"$DONE\"\` і напиши, що готово."

FORBIDDEN=("Bash(git push:*)" "Bash(rm:*)" "Bash(rmdir:*)" "Bash(sudo:*)" "Bash(security:*)" "Bash(launchctl:*)")
ALLOWED=(Bash WebFetch WebSearch Agent)

token() { security find-generic-password -a "$USER" -s "$KEYCHAIN_SERVICE" -w 2>/dev/null || true; }

ensure_worktree() {
  if [ ! -d "$VAULT" ]; then
    ( cd "$MAIN" && git worktree add -b "$BRANCH" "$VAULT" HEAD ) >>"$LOG" 2>&1 \
      || ( cd "$MAIN" && git worktree add "$VAULT" "$BRANCH" ) >>"$LOG" 2>&1
  fi
  sync_from_main
}

# Резолюції автора пишуться в бібліотеку (main) з вікна застосунку, а конвеєр
# живе на своїй гілці. Без цього підтягування варта бачить старий `status:
# proposed` там, де автор уже натиснув «Прийняти», — і прийняте зависає
# в черзі назавжди. Оплачено есеєм №5.
sync_from_main() {
  cd "$VAULT" || return 0
  git stash --include-untracked --quiet 2>/dev/null || true
  if git merge --no-edit main >>"$LOG" 2>&1; then
    git stash pop --quiet 2>/dev/null || true
    return 0
  fi
  # У картках черги авторитетна бібліотека: там слово автора, а тіло тексту
  # в обох гілках однакове. Конфлікт поза чергою — не наша справа, відкат.
  local left
  git checkout --theirs -- "00-Inbox/" 2>/dev/null || true
  git add "00-Inbox/" 2>/dev/null || true
  left=$(git diff --name-only --diff-filter=U | wc -l | tr -d ' ')
  if [ "$left" = "0" ]; then
    git commit --no-edit -q >>"$LOG" 2>&1 || true
    echo "   резолюції автора підтягнуто з main" >>"$LOG"
  else
    echo "!! конфлікт поза чергою ($left файлів) — розбирати руками" >>"$LOG"
    git merge --abort 2>/dev/null || true
  fi
  git stash pop --quiet 2>/dev/null || true
  return 0
}

one_run() {
  CLAUDE_CODE_OAUTH_TOKEN="$(token)" \
  claude -p "$PROMPT" --permission-mode acceptEdits \
    --allowedTools "${ALLOWED[@]}" --disallowedTools "${FORBIDDEN[@]}"
}

loop() {
  mkdir -p "$S"; rm -f "$STOP"; ensure_worktree; cd "$VAULT"
  echo "=== wl-loop [$TASK] піднято $(date '+%F %T') ===" >>"$LOG"
  local n=0
  while :; do
    [ -f "$STOP" ] && { echo "--- стоп $(date '+%T') ---" >>"$LOG"; break; }
    [ -f "$DONE" ] && { echo "--- сентинел, робота вичерпана $(date '+%T') ---" >>"$LOG"; break; }
    n=$((n+1))
    echo "───────── [$TASK] прогін #$n  $(date '+%F %T') ─────────" >>"$LOG"
    one_run >>"$LOG" 2>&1 || echo "!! прогін #$n з помилкою, продовжую" >>"$LOG"
    sleep "$GAP"
  done
  rm -f "$PIDF"
}

case "${1:-}" in
  старт|start)
    if [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null; then echo "[$TASK] вже працює (pid $(cat "$PIDF"))"; exit 0; fi
    mkdir -p "$S"; rm -f "$DONE"; ensure_worktree
    nohup "$0" "$TASK" _run >>"$LOG" 2>&1 &
    echo $! >"$PIDF"; sleep 1
    kill -0 "$(cat "$PIDF")" 2>/dev/null && echo "[$TASK] піднято (pid $(cat "$PIDF")) · лог: $LOG" || { echo "не піднявся"; tail -5 "$LOG"; exit 1; } ;;
  _run) loop ;;
  раз|once) ensure_worktree; cd "$VAULT"; one_run ;;
  стоп|stop) touch "$STOP"; [ -f "$PIDF" ] && kill "$(cat "$PIDF")" 2>/dev/null || true; echo "[$TASK] спиняю" ;;
  стан|status)
    if [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null; then echo "[$TASK] живий (pid $(cat "$PIDF"))"; else echo "[$TASK] не працює"; fi
    [ -f "$DONE" ] && echo "  сентинел: РОБОТА ВИЧЕРПАНА"
    [ -d "$VAULT" ] && echo "  у гілці $BRANCH: $(cd "$VAULT" && git rev-list --count "main..$BRANCH" 2>/dev/null || echo 0) комітів"
    [ -f "$LOG" ] && { echo "  --- лог ---"; tail -5 "$LOG"; } ;;
  лог|log) tail -f "$LOG" ;;
  злити|merge)
    n=$(cd "$VAULT" && git rev-list --count "main..$BRANCH" 2>/dev/null || echo 0)
    [ "$n" = "0" ] && { echo "[$TASK] нема чого зливати"; exit 0; }
    echo "[$TASK] зливаю $n комітів…"
    ( cd "$MAIN" && git merge --no-edit "$BRANCH" ) && echo "злито." ;;
  *) echo "вживання: $0 $TASK {старт|стоп|стан|лог|раз|злити}"; exit 1 ;;
esac
