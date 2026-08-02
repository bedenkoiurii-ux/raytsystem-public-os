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
#   sensy     — ланцюги повторень наскрізних мотивів (НАКАЗ-сенсів.md)
#   sources   — джерельна опора під тези без опори   (НАКАЗ-джерел.md)
#   karty     — картки сутностей до стандарту        (НАКАЗ-картки.md)
#
# МЕЖІ спільні: acceptEdits, Bash/фетч/Agent дозволені; push/rm/rmdir/sudo/
# security/launchctl заборонені. Коміти локальні; назовні — ніколи.

set -euo pipefail
cd "$(dirname "$0")"
# Абсолютний шлях до себе: старт робить cd у worktree, і відносний "$0"
# після цього вже нікуди не веде («No such file or directory»).
SELF="$PWD/$(basename "$0")"

TASK="${1:-}"; shift || true
case "$TASK" in
  apparat|geo|opponent|inbox|sensy|sources|karty) ;;
  *) echo "вживання: $0 {apparat|geo|opponent|inbox|sensy|sources|karty} {старт|стоп|стан|лог|раз|злити}"; exit 1 ;;
esac

# Кожна задача — свій worktree й гілка, щоб задачі не заважали одна одній
# і не смикали каталог, який читає застосунок.
VAULT="$HOME/Writer-Lab/.wl-$TASK"
MAIN="$HOME/Writer-Lab/Library"
BRANCH="wl-$TASK"
[ "$TASK" = "apparat" ] && { VAULT="$HOME/Writer-Lab/.apparat-work"; BRANCH="apparat-wave2"; }

# Автозапущені процеси (GUI-застосунок, launchd) не успадковують користувацький
# PATH: 30–31.07 цикл інбоксу зробив 5468 холостих прогонів об «claude: command
# not found», кожні 8 с. Резолвимо бінарник один раз, з абсолютним запасним
# шляхом саме на випадок порожнього PATH.
CLAUDE_BIN="$(command -v claude || echo "$HOME/.local/bin/claude")"

S="$HOME/.writer-lab"
LOG="$S/$TASK-loop.log"; STOP="$S/$TASK-loop.stop"
DONE="$S/$TASK.done";    PIDF="$S/$TASK-loop.pid"
GAP=8
KEYCHAIN_SERVICE="writer-lab-claude"
RUN_OUT="$S/$TASK-last-run.txt"   # вивід останнього прогону — щоб розібрати причину збою
LEAK="$S/$TASK-leak.txt"          # витік у головне дерево — див. check_leak() нижче
CONFLICT="$S/$TASK-merge-conflict.txt"   # автозлиття спинилось — див. auto_merge()
# Етап усередині прогону. Пише його САМ агент Bash-викликом за НАКАЗом, бо
# `claude -p` мовчить до кінця прогону: рядок, надрукований у відповідь, лежав
# би в контексті моделі до фінішу й на сторінці з'явився б, коли вже не треба.
STAGE="$S/$TASK-stage"
MAX_FAILS=5                       # стільки невдач поспіль — і цикл зупиняється сам
LIMIT_WAIT_MAX=43200              # не спати довше 12 год за раз: прокинувся — перевірив сам
LIMIT_WAIT_FALLBACK=1800          # час reset не розібрався — пробуємо за півгодини

# Денний бюджет прогонів — з config.yaml бібліотеки (наказ-2, 2026-07-31).
# Проти класу «прогони йдуть, а роботи немає»: у липні sources зробив за день
# 102 реальні прогони й закрив ними 0.59 тези на прогін. Запобіжники фази 3
# ловлять помилки й ліміти; цей ловить успішні прогони, що нічого не дають.
MAX_RUNS_PER_DAY="$(uv run --quiet --with pyyaml python3 \
  "$MAIN/90-Meta/scripts/loop_budget.py" "$TASK" 2>/dev/null || echo 60)"
case "$MAX_RUNS_PER_DAY" in ''|*[!0-9]*) MAX_RUNS_PER_DAY=60 ;; esac

# Чи вільно цій задачі зливати свою хвилю самій. Читаємо один раз на запуск,
# як і бюджет. Будь-яка невдача (нема pyyaml, зіпсовано конфіг, порожній PATH)
# дає «ні» — мовчазна відмова безпечніша за мовчазне злиття.
AUTO_MERGE="$(uv run --quiet --with pyyaml python3 \
  "$MAIN/90-Meta/scripts/conveyor_flag.py" auto_merge "$TASK" 2>/dev/null || echo "ні")"
[ "$AUTO_MERGE" = "так" ] || AUTO_MERGE="ні"

case "$TASK" in
  apparat)  NAKAZ="НАКАЗ-апарату.md";  UNIT="картку апарату" ;;
  geo)      NAKAZ="НАКАЗ-гео.md";      UNIT="порцію координат" ;;
  opponent) NAKAZ="НАКАЗ-опонента.md"; UNIT="одну тезу на перевірку" ;;
  sensy)    NAKAZ="НАКАЗ-сенсів.md";    UNIT="ланцюг повторень" ;;
  inbox)    NAKAZ="НАКАЗ-інбоксу.md";  UNIT="партію вхідних файлів" ;;
  sources)  NAKAZ="НАКАЗ-джерел.md";   UNIT="одну тезу без опори" ;;
  karty)    NAKAZ="НАКАЗ-картки.md";   UNIT="одну картку з черги недобору" ;;
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

# Пастка worktree: агент працює у своїй гілці, але пише в головне дерево —
# тринадцять випадків із 25.07 по 02.08, від мовчазного «0 diff» до двох
# карток джерел, що лягли в main повз гілку. Корінь закрито 02.08 (шлях до
# vault більше не абсолютний ні в config.yaml, ні в CLAUDE.md), але корінь
# лікує причину, а не спостереження: агент може вжити абсолютний шлях і сам.
# Тому після кожного прогону дивимось, чи не побільшало нетрекованого в main.
# Знімок робиться ПЕРЕД прогоном — інакше ми б рахували чуже, що лежало там
# зранку. Порівнюємо імена, не кількість: підрахунок мовчить, коли один файл
# з'явився, а інший зник.
# core.quotepath=false — інакше git віддає кириличні імена як "\320\275\320\276…",
# і рядок про витік у бібліотеці, де все українською, стає нечитабельним.
leak_snapshot() { ( cd "$MAIN" && git -c core.quotepath=false status --porcelain --untracked-files=all 2>/dev/null | sed -n 's/^?? //p' | sed 's/^"\(.*\)"$/\1/' | sort ); }

check_leak() {
  local before="$1" now added
  now="$(leak_snapshot)"
  added="$(comm -13 <(printf '%s\n' "$before") <(printf '%s\n' "$now"))"
  [ -z "$added" ] && { : >"$LEAK"; return 0; }
  printf '%s\n' "$added" >"$LEAK"
  {
    echo "!!!! ПАСТКА WORKTREE: прогін #$n написав у головне дерево повз гілку $BRANCH"
    printf '%s\n' "$added" | sed 's/^/     /'
    echo "     Розбирати руками: файли в $MAIN, а робота мала лягти в $VAULT."
  } >>"$LOG"
}

# Автозлиття хвилі (рішення Юрія 2026-08-02). Привід: 02.08 у гілці wl-sources
# лежав 31 чистий коміт, і всі чекали команди «злити», якої ніхто не подав.
# Це не косметика лічильника: конвеєри читають ЛИШЕ закомічене в main, тож
# нерозлита хвиля означає, що наступний прогін працює зі вчорашнім текстом.
#
# Дозвіл — поіменний, у config.yaml (conveyors.auto_merge), і його веде Юрій.
# Задача поза списком не зливається сама НІКОЛИ.
#
# Машина робить лише чисте злиття. Конфлікт не розв'язується сам: --abort,
# гілка лишається як була, причина лягає у файл і світиться на картці. Та сама
# асиметрія, що всюди: не злита хвиля чекає й видима, злита проти волі автора
# вже в бібліотеці.
auto_merge() {
  [ "$AUTO_MERGE" = "так" ] || return 0
  local ahead
  ahead=$(cd "$MAIN" && git rev-list --count "main..$BRANCH" 2>/dev/null || echo 0)
  [ "$ahead" = "0" ] && return 0

  # Брудне головне дерево НЕ блокує злиття, і це навмисно: gdoc-sync.log
  # переписує поллер кожні чверть години, тож умова «дерево чисте» не
  # виконалась би ніколи, і автозлиття було б мертвим з першого дня.
  # Незакомічену правку захищає сам git: якщо merge мав би її затерти, він
  # відмовляється ДО того, як щось змінить. Нижче ця відмова обробляється
  # так само, як конфлікт, — гілку не чіпаємо, чекаємо рук.
  if ( cd "$MAIN" && git merge --no-edit "$BRANCH" ) >>"$LOG" 2>&1; then
    : >"$CONFLICT"
    echo "──── автозлиття: $ahead комітів у main" >>"$LOG"
    if ( cd "$MAIN" && git push --quiet origin main ) >>"$LOG" 2>&1; then
      echo "──── push: віддано" >>"$LOG"
    else
      # Мережа впала — не біда й не привід спиняти цикл: наступне злиття
      # віддасть і ці коміти разом зі своїми.
      echo "!! push не пройшов — коміти в main, віддам наступного разу" >>"$LOG"
    fi
  else
    ( cd "$MAIN" && git merge --abort ) >/dev/null 2>&1 || true
    printf 'злиття %s комітів гілки %s не пройшло — розбирати руками\n' "$ahead" "$BRANCH" >"$CONFLICT"
    {
      echo "!!!! АВТОЗЛИТТЯ СПИНИЛОСЬ на $ahead комітах гілки $BRANCH (причина вище)"
      echo "     Гілку не чіпано, merge відкочено. Розбирати руками:"
      echo "     cd $MAIN && git merge $BRANCH"
    } >>"$LOG"
  fi
}

one_run() {
  CLAUDE_CODE_OAUTH_TOKEN="$(token)" \
  "$CLAUDE_BIN" -p "$PROMPT" --permission-mode acceptEdits \
    --allowedTools "${ALLOWED[@]}" --disallowedTools "${FORBIDDEN[@]}"
}

# Скільки секунд до скидання ліміту. Два реальні формати з логів 29.07:
#   «You've hit your weekly limit · resets Jul 31 at 1am (Europe/Kiev)»
#   «You've hit your session limit · resets 4:30pm (Europe/Kiev)»
# Не розібралось — не вгадуємо: викликач бере запасні півгодини.
reset_in() {
  local when now target fmt
  when=$(sed -nE "s/.*resets ([^(]+).*/\1/p" "$1" | head -1 | sed 's/[[:space:]]*$//')
  [ -z "$when" ] && return 1
  now=$(date +%s)
  for fmt in "%b %d at %I:%M%p" "%b %d at %I%p" "%I:%M%p" "%I%p"; do
    target=$(date -j -f "$fmt" "$when" +%s 2>/dev/null) || continue
    [ "$target" -le "$now" ] && target=$((target + 86400))   # час без дати — уже завтра
    echo $((target - now)); return 0
  done
  return 1
}

loop() {
  mkdir -p "$S"; rm -f "$STOP"; ensure_worktree; cd "$VAULT"
  echo "=== wl-loop [$TASK] піднято $(date '+%F %T') ===" >>"$LOG"
  local n=0 fails=0 pause
  while :; do
    [ -f "$STOP" ] && { echo "--- стоп $(date '+%T') ---" >>"$LOG"; break; }
    [ -f "$DONE" ] && { echo "--- сентинел, робота вичерпана $(date '+%T') ---" >>"$LOG"; break; }
    # Бюджет рахуємо по днях: лічильник у файлі з датою в імені, тож нова доба
    # починається з нуля сама, без планувальника й без стану в памʼяті.
    today="$(date '+%F')"
    spent_file="$S/$TASK-runs-$today"
    spent=$(cat "$spent_file" 2>/dev/null || echo 0)
    if [ "$spent" -ge "$MAX_RUNS_PER_DAY" ]; then
      left=$(( $(date -j -f '%F %T' "$(date -v+1d '+%F') 00:00:05" +%s) - $(date +%s) ))
      [ "$left" -lt 60 ] && left=60
      echo "--- денний бюджет вичерпано ($spent із $MAX_RUNS_PER_DAY), сплю до півночі ---" >>"$LOG"
      sleep "$left"
      continue
    fi
    echo $((spent+1)) >"$spent_file"
    n=$((n+1))
    echo "───────── [$TASK] прогін #$n  $(date '+%F %T') ─────────" >>"$LOG"
    # Етап скидаємо ПЕРЕД прогоном, а не читаємо з міткою часу: порожній файл
    # означає «цей прогін ще не доповів», і сплутати його зі старим етапом
    # попереднього прогону вже неможливо.
    : >"$STAGE"
    started=$(date +%s)
    # Підтягуємо main ПЕРЕД КОЖНИМ прогоном, а не лише на старті циклу.
    # Дванадцятий випадок пастки worktree (2026-07-31): цикл інбоксу, піднятий
    # учора, о 10:20 запропонував Есей №5 як «новий матеріал» — у його гілці
    # source_origin ще вказував на _001.docx, хоча main уже мав _003. Merge на
    # старті не рятує: між стартом і прогоном минають години правок у main.
    sync_from_main
    leak_before="$(leak_snapshot)"
    # tee: у лог видно наживо, копія лишається для розбору причини збою.
    if one_run 2>&1 | tee -a "$LOG" >"$RUN_OUT"; then
      check_leak "$leak_before"
      # Зливаємо ПІСЛЯ перевірки на витік: якщо прогін написав у main повз
      # гілку, спершу треба побачити це, а не змішати з чистою хвилею.
      auto_merge
      # Тривалість пишемо явно, а не рахуємо різницю між заголовками прогонів:
      # між ними лягають сни на ліміті й на денному бюджеті, і така «медіана»
      # показувала б години там, де робота йшла хвилини.
      echo "──── [$TASK] прогін #$n завершено за $(( $(date +%s) - started ))с" >>"$LOG"
      fails=0
    elif grep -qai "hit your.*limit" "$RUN_OUT"; then
      # Ліміт — не помилка, а «зарано». 29.07 sources зробив 594 холості прогони
      # об weekly limit, opponent — 93 об session limit: цикл бив у стіну щовісім
      # секунд двоє діб. Лічильник невдач ліміт не чіпає — робота не провалилась.
      pause=$(reset_in "$RUN_OUT") || pause="$LIMIT_WAIT_FALLBACK"
      [ "$pause" -gt "$LIMIT_WAIT_MAX" ] && pause="$LIMIT_WAIT_MAX"
      echo "--- ліміт, сплю до $(date -v+"${pause}"S '+%F %T') ---" >>"$LOG"
      sleep "$pause"; continue
    else
      # І тут теж: прогін міг написати в чуже дерево й аж тоді впасти.
      check_leak "$leak_before"
      fails=$((fails + 1))
      echo "!! прогін #$n з помилкою ($fails поспіль)" >>"$LOG"
      if [ "$fails" -ge "$MAX_FAILS" ]; then
        echo "!!! $MAX_FAILS невдач поспіль — зупиняю цикл $(date '+%F %T'). Причина у $RUN_OUT" >>"$LOG"
        break
      fi
    fi
    sleep "$GAP"
  done
  rm -f "$PIDF"
}

case "${1:-}" in
  старт|start)
    if [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null; then echo "[$TASK] вже працює (pid $(cat "$PIDF"))"; exit 0; fi
    mkdir -p "$S"; rm -f "$DONE"; ensure_worktree
    nohup "$SELF" "$TASK" _run >>"$LOG" 2>&1 &
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
