import { CircleDot, Circle, CircleSlash, Moon, Terminal, GitBranch, AlertTriangle, Columns3, Play, Pause, Square, FastForward, RotateCcw } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ErrorState, LoadingState } from "../components/StatePanel";
import { getJson, postJson } from "../api";

/** Конвеєри — що зараз меле система і скільки лишилось.
 *
 *  Читання файлів і `git log` лишається нулем моделі. Керування (2026-09-08,
 *  рішення Юрія) — виняток, не порушення: чотири кнопки просто передають
 *  слово `wl-loop.sh`, самі нічого не вирішують. Дві різної ваги: «пауза»
 *  дочекається кінця поточного прогону й ніколи не рве запис картки —
 *  безпечна, тому щоденна; «стоп» — той самий миттєвий kill, що й у
 *  терміналі, може обірвати прогін, тому питає підтвердження щоразу.
 *
 *  «Найпевніше зараз» — саме найпевніше, а не «зараз»: `claude -p` мовчить
 *  до кінця прогону, тож наживо ніхто не звітує. Ми показуємо першу незакриту
 *  одиницю черги — те, за що конвеєр узявся або візьметься наступним, — і
 *  підписуємо це чесно, замість малювати впевненість, якої немає.
 *
 *  Смужка поступу навмисно НЕ обіцяє рівномірного руху: одній картці бракує
 *  третього хоста, іншій — усіх трьох, і друга піде вдесятеро довше. Тому
 *  поряд зі смужкою завжди стоїть число, а не сама смужка. */
interface Current { name: string; kind: string; index: number; of: number }
interface Queue {
  total: number; closed: number; unit: string; how: string;
  missing?: number | null; current?: Current | null;
  /** Сутності, замовлені з читання документа й ще без картки. */
  orders?: number | null;
}
interface Commit { ago_min: number; at: string; subject: string }
interface Timing {
  running_s: number | null; median_s: number | null;
  band_s: [number, number] | null; samples: number; suspicious: boolean;
}
interface Task {
  name: string; title: string; about: string;
  state: { code: string; label: string; note: string | null };
  run: number | null; stage: string | null; leak: string[] | null;
  merge_conflict: string | null; timing: Timing | null; queue: Queue | null;
  budget: { spent: number; max: number; recommended: number };
  last_line: string | null; log_at: string | null;
  commit: Commit | null; unmerged: number | null; command: string;
}
interface TailItem { what: string; closed: number; total: number | null }
interface Batch {
  window: { from: string; to: string; gap_hours: number } | null;
  last_finish: string | null; since_hours: number | null;
  finished_cleanly: boolean; tail: TailItem[];
  last_line: string | null; log_at: string | null;
}

function useConveyors() {
  return useQuery({
    queryKey: ["conveyors"],
    queryFn: () => getJson<{ tasks: Task[]; batch: Batch; at: string }>("/api/v1/conveyors"),
    refetchInterval: 30_000,
    staleTime: 25_000
  });
}

type ControlAction = "play" | "pause" | "stop" | "ff";

/** Ті самі межі, що сервер валідує в POST /conveyors/{task}/budget —
 *  дублюються тут лише для атрибутів `<input min max>` (підказка браузеру,
 *  не заміна серверної перевірки). */
const _BUDGET_MIN = 1, _BUDGET_MAX = 500;

/** Одна мутація на всі чотири дії: сервер сам ставить у відповідність
 *  action → слово wl-loop.sh, тут лише POST і перечитати картки. Затримка
 *  перед інвалідацією — файлові прапорці пише скрипт, а не відповідь; без
 *  паузи перший рефетч (за 30с все одно прийшов би) бачив би ще старий стан. */
function useConveyorControl() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ task, action }: { task: string; action: ControlAction }) =>
      postJson(`/api/v1/conveyors/${task}/${action}`, {}),
    onSuccess: () => { window.setTimeout(() => void client.invalidateQueries({ queryKey: ["conveyors"] }), 400); }
  });
}

/** Правка бюджету пише в `config.yaml` синхронно (на відміну від play/pause,
 *  які лише торкаються прапорцевих файлів для фонового циклу) — відповідь
 *  уже несе нове `max`/`recommended`, тож патчимо кеш одразу, без 400мс
 *  затримки під play/pause/stop/ff. */
function useBudgetEdit() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ task, max }: { task: string; max: number | null }) =>
      postJson<{ max: number; recommended: number }>(`/api/v1/conveyors/${task}/budget`, { max }),
    onSuccess: (data, { task }) => {
      client.setQueryData<{ tasks: Task[]; batch: Batch; at: string } | undefined>(
        ["conveyors"],
        (prev) => prev && {
          ...prev,
          tasks: prev.tasks.map((t) => t.name === task ? { ...t, budget: { ...t.budget, ...data } } : t)
        }
      );
    }
  });
}

const ago = (min: number) =>
  min < 1 ? "щойно" : min < 60 ? `${min} хв тому` : min < 1440 ? `${Math.floor(min / 60)} год тому` : `${Math.floor(min / 1440)} дн тому`;

function StateMark({ code }: { code: string }) {
  const size = 13;
  if (code === "running") return <CircleDot size={size} aria-hidden="true" />;
  if (code === "paused") return <Pause size={size} aria-hidden="true" />;
  if (code === "sleeping" || code === "budget") return <Moon size={size} aria-hidden="true" />;
  if (code === "stopped") return <CircleSlash size={size} aria-hidden="true" />;
  return <Circle size={size} aria-hidden="true" />;
}

function Bar({ closed, total, muted }: { closed: number; total: number; muted?: boolean }) {
  const pct = total > 0 ? Math.min(100, Math.round((closed / total) * 100)) : 0;
  return (
    <span className={`cv-bar${muted ? " cv-bar-muted" : ""}`} role="img" aria-label={`${closed} з ${total}`}>
      <span className="cv-bar-fill" style={{ width: `${pct}%` }} />
    </span>
  );
}

/** Денний ліміт — клікабельне число, не окрема форма: клік → інпут, Enter
 *  зберігає, Esc чи blur без зміни скасовує. «Рекомендовано: N» і кнопка
 *  скидання стоять поруч у виклику (TaskCard), не тут — так порядок слів
 *  у рядку лишається природним («N з M прогонів сьогодні · рекомендовано:
 *  D»), а не «M рекомендовано: D прогонів сьогодні». */
function BudgetEdit({ task, budget }: { task: string; budget: Task["budget"] }) {
  const edit = useBudgetEdit();
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    const n = Number(draft);
    setDraft(null);
    if (draft === null || draft === "" || !Number.isInteger(n) || n === budget.max) return;
    edit.mutate({ task, max: n });
  };

  if (draft !== null) {
    return (
      <input
        type="number" min={_BUDGET_MIN} max={_BUDGET_MAX} autoFocus
        className="cv-budget-input" value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setDraft(null);
        }}
      />
    );
  }
  return (
    <b className="cv-budget-value" role="button" tabIndex={0}
       title="Клікни, щоб змінити денний ліміт"
       onClick={() => setDraft(String(budget.max))}
       onKeyDown={(e) => { if (e.key === "Enter") setDraft(String(budget.max)); }}>
      {budget.max}
    </b>
  );
}

/** Хвилини з секунд, але не «0 хв»: прогін коротший за хвилину чесніше
 *  показати в секундах, ніж округлити в нуль і вдати, що нічого не йде. */
const dur = (s: number) => (s < 90 ? `${s} с` : `${Math.round(s / 60)} хв`);

/** Порожній слот. Прочерк, а не зникнення: коли рядок просто щезає, сусідні
 *  з'їжджають угору, і око вже не може порівняти дві картки поглядом упоперек —
 *  доводиться щоразу перечитувати підписи. Прочерк тримає рядок на місці й
 *  чесно каже «тут нічого», а не «тут щось інше». */
const DASH = <span className="cv-dash">—</span>;

/** Play/Pause/Stop/FF — самі нічого не вирішують, лише передають слово
 *  wl-loop.sh (сервер зіставляє дію з командою). Play вмикається і як
 *  «старт» (нічого не працює), і як «зняти з паузи» — скрипт сам розрізняє
 *  за pid. FF має сенс лише під час сну (бюджет/ліміт): у решті станів
 *  нема чого пропускати, тому вимкнена. Stop питає підтвердження щоразу —
 *  той самий миттєвий kill, що й у терміналі, здатен обірвати запис картки
 *  на середині (рішення Юрія 2026-09-08: пауза щоденна, стоп — різка дія). */
function TaskControls({ task }: { task: Task }) {
  const control = useConveyorControl();
  const code = task.state.code;
  const alive = code === "running" || code === "sleeping" || code === "budget" || code === "paused";
  const busy = control.isPending;
  const run = (action: ControlAction) => control.mutate({ task: task.name, action });
  const stop = () => {
    if (window.confirm(`Спинити «${task.title}» негайно? Може обірвати прогін на середині запису — так само, як «стоп» у терміналі.`)) run("stop");
  };
  return (
    <div className="cv-slot cv-controls" role="group" aria-label={`Керування: ${task.title}`}>
      <button type="button" className="icon-button" disabled={(alive && code !== "paused") || busy}
              onClick={() => run("play")} title="Грати — стартувати або зняти з паузи">
        <Play size={13} aria-hidden="true" />
      </button>
      <button type="button" className="icon-button" disabled={!alive || code === "paused" || busy}
              onClick={() => run("pause")} title="Пауза — безпечно, дочекається кінця поточного прогону">
        <Pause size={13} aria-hidden="true" />
      </button>
      <button type="button" className="icon-button" disabled={!alive || busy}
              onClick={stop} title="Стоп — миттєво, може обірвати прогін">
        <Square size={13} aria-hidden="true" />
      </button>
      <button type="button" className="icon-button" disabled={(code !== "sleeping" && code !== "budget") || busy}
              onClick={() => run("ff")} title="Вперед — пропустити поточний сон (бюджет/ліміт)">
        <FastForward size={13} aria-hidden="true" />
      </button>
    </div>
  );
}

/** Десять слотів у сталому порядку, однакові для БУДЬ-ЯКОГО стану задачі.
 *  Висоти рядків задає CSS (`grid-template-rows`), а не вміст, тож картки
 *  вирівнюються по горизонталі незалежно від того, що в них потрапило. */
function TaskCard({ task }: { task: Task }) {
  const { queue, budget, state, timing } = task;
  const current = queue?.current;
  const isDone = state.code === "done";
  const resetBudget = useBudgetEdit();

  return (
    <article className={`cv-card cv-slots cv-${state.code}`}>
      {/* 1 — заголовок і стан */}
      <div className="cv-slot cv-slot-head">
        <StateMark code={state.code} />
        <b>{task.title}</b>
        <code>{task.name}</code>
        <span className={`cv-pill cv-pill-${state.code}`}>{state.label}</span>
      </div>

      {/* 2 — прогін і етап усередині нього */}
      <div className="cv-slot cv-slot-stage">
        {task.run !== null ? <span className="cv-run">прогін #{task.run}</span> : DASH}
        {task.stage ? <span className="cv-stage">{task.stage}</span> : <span className="cv-dash">· ЕТАП —</span>}
      </div>

      {/* 3 — тривалість проти звичайної */}
      <div className={`cv-slot cv-slot-timing${timing?.suspicious ? " cv-timing-long" : ""}`}>
        {timing?.running_s != null ? (
          <>
            {timing.suspicious ? <AlertTriangle size={12} aria-hidden="true" /> : null}
            <span>триває {dur(timing.running_s)}</span>
            {timing.band_s
              ? <i>· зазвичай {dur(timing.band_s[0])}–{dur(timing.band_s[1])}</i>
              : <i>· медіани ще немає ({timing.samples} замірів)</i>}
            {timing.suspicious ? <b>підозріло довго</b> : null}
          </>
        ) : !isDone && state.note ? (
          // Задача не меле — але «спить до 15:30» чи «бюджет вичерпано» це теж
          // факт про час, і слот часу для нього рідний. Без цього пояснення
          // зникало зовсім: у десяти слотах окремого рядка для нього немає.
          <span className="cv-muted">{state.note}</span>
        ) : DASH}
      </div>

      {/* 4 — що саме в роботі */}
      <div className="cv-slot cv-slot-current">
        <span className="cv-current-label">найпевніше зараз</span>
        {current ? (
          <>
            <span className="cv-current-idx">{current.kind} {current.index} з {current.of}</span>
            <span className="cv-current-name">{current.name}</span>
          </>
        ) : isDone ? (
          <span className="cv-current-name cv-muted">{state.note ?? "робота вичерпана"}</span>
        ) : (
          <span className="cv-current-name">{DASH}</span>
        )}
      </div>

      {/* 5 — черга. У добіглої задачі бар повний і приглушений: робота
              вичерпана, і порожній бар брехав би про «нічого не зроблено». */}
      <div className="cv-slot cv-metric">
        <span>черга</span>
        {queue ? (
          <><Bar closed={queue.closed} total={queue.total} />
            <b>{queue.closed} з {queue.total}</b> <i>{queue.unit}</i>
            {queue.missing ? (
              <em className="cv-miss" title={`у черзі на ${queue.missing} рядок більше, ніж бачать ворота — картку перейменували або перенесли`}>
                −{queue.missing}
              </em>
            ) : null}
            {/* Замовлення з читання — окрема черга того самого конвеєра: не
                картки з недобором джерел, а сутності, яких у бібліотеці ще
                немає зовсім. Показуємо поруч, а не в сумі: це різна робота. */}
            {queue.orders ? (
              <em className="cv-orders" title="сутності, замовлені з читання документа — чекають картки">
                замовлень сутностей: {queue.orders} у черзі
              </em>
            ) : null}</>
        ) : isDone ? (
          <><Bar closed={1} total={1} muted /><b className="cv-muted">вичерпана</b></>
        ) : (
          <><Bar closed={0} total={0} muted />{DASH}</>
        )}
      </div>

      {/* 6 — денний бюджет прогонів (клікабельний ліміт + рекомендоване) */}
      <div className="cv-slot cv-metric cv-metric-budget">
        <span>бюджет</span><Bar closed={budget.spent} total={budget.max} />
        <b>{budget.spent} з</b>
        <BudgetEdit task={task.name} budget={budget} />
        <i>сьогодні</i>
        <i className="cv-budget-recommended" title={`Рекомендовано (наказ-2): ${budget.recommended} прогонів на день`}>
          · рек. {budget.recommended}
        </i>
        {budget.max !== budget.recommended ? (
          <button type="button" className="icon-button compact" disabled={resetBudget.isPending}
                  title="Скинути на рекомендоване" aria-label="Скинути на рекомендоване"
                  onClick={() => resetBudget.mutate({ task: task.name, max: null })}>
            <RotateCcw size={12} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {/* 7 — останній коміт гілки */}
      <div className="cv-slot cv-slot-commit">
        {task.commit ? (
          <span title={task.commit.at}>
            <span className="cv-commit-when">коміт {ago(task.commit.ago_min)}</span>
            {task.commit.subject}
          </span>
        ) : DASH}
      </div>

      {/* 8 — незібрана хвиля */}
      <div className="cv-slot cv-slot-unmerged">
        {task.merge_conflict
          // Конфлікт важливіший за лічильник: доки він стоїть, число не
          // зменшиться саме, і «28 чекають» без причини вводило б в оману.
          ? <span className="cv-conflict"><GitBranch size={12} aria-hidden="true" /> злиття спинилось: {task.merge_conflict}</span>
          : task.unmerged
            ? <><GitBranch size={12} aria-hidden="true" /> {task.unmerged} комітів чекають злиття в main</>
            : DASH}
      </div>

      {/* 8б — витік у головне дерево. Мовчазна пастка worktree ловилась
          тринадцять разів постфактум; тепер вона видима, поки не розібрана. */}
      {task.leak ? (
        <div className="cv-slot cv-leak" role="alert">
          <AlertTriangle size={12} aria-hidden="true" />
          <span>
            прогін написав у main повз гілку: {task.leak.join(", ")}
          </span>
        </div>
      ) : null}

      {/* 9 — сирий хвіст логу */}
      <div className="cv-slot cv-log">{task.last_line ?? DASH}</div>

      {/* 10 — команда для термінала */}
      <div className="cv-slot cv-cmd">
        <Terminal size={12} aria-hidden="true" /> <code>{task.command} стан</code>
      </div>

      {/* 11 — керування: play/pause/stop/ff */}
      <TaskControls task={task} />
    </article>
  );
}

/** Скільки колонок. Вибір Юрія переживає перезапуск — сторінку відкривають
 *  щодня, і щоразу перекладати її під свій монітор було б знущанням.
 *  localStorage, а не sessionStorage: те саме рішення, що й для відновлення
 *  сесії застосунку. */
const COLS_KEY = "wl.conveyors.cols";
const COLS = [2, 3, 4] as const;

function useColumns(): [number, (n: number) => void] {
  const [cols, set] = useState<number>(() => {
    const saved = Number(localStorage.getItem(COLS_KEY));
    return COLS.includes(saved as (typeof COLS)[number]) ? saved : 3;
  });
  return [cols, (n) => { localStorage.setItem(COLS_KEY, String(n)); set(n); }];
}

export function ConveyorsView() {
  const [cols, setCols] = useColumns();
  const data = useConveyors();
  if (data.isError) return <ErrorState error={data.error as Error} onRetry={() => void data.refetch()} />;
  if (data.isLoading) return <LoadingState label="Читаємо стан конвеєрів…" />;

  const tasks = data.data?.tasks ?? [];
  const batch = data.data?.batch;
  const working = tasks.filter((t) => t.state.code === "running").length;

  return (
    <div className="route route-conveyors">
      <header className="cv-head">
        <span className="eyebrow">КОНВЕЄРИ</span>
        <h1>Що меле система <span className="sub">{working} з {tasks.length}</span></h1>
        <p>
          Читання файлів і <code>git log</code> — нуль моделі. Оновлення кожні 30 с, зріз о {data.data?.at}.
          Пауза безпечна — дочекається кінця поточного прогону; стоп миттєвий, як у терміналі, і питає підтвердження.
        </p>
        <div className="cv-cols" role="toolbar" aria-label="Кількість колонок">
          <span>колонок</span>
          {COLS.map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={cols === n}
              onClick={() => setCols(n)}
              title={`${n} колонки на екран`}
            >
              <Columns3 size={13} aria-hidden="true" />{n}
            </button>
          ))}
        </div>
      </header>

      <div className="cv-grid" style={{ "--cv-cols": cols } as React.CSSProperties}>
        {tasks.map((task) => <TaskCard key={task.name} task={task} />)}
      </div>

      {batch ? (
        <section className="cv-batch">
          <span className="eyebrow">БАТЧ · ЛОКАЛЬНА МОДЕЛЬ, НУЛЬ ТОКЕНІВ</span>
          <article className="cv-card">
            <header>
              <Moon size={13} aria-hidden="true" />
              <b>Важка локальна робота</b>
              {batch.window ? (
                <span className="cv-pill cv-pill-window">вікно {batch.window.from}–{batch.window.to}</span>
              ) : null}
            </header>
            <p className="cv-note">
              {batch.last_finish
                ? `останній чистий фініш ${batch.last_finish}${batch.since_hours !== null ? ` · ${batch.since_hours} год тому` : ""}`
                : "чистого фінішу не було жодного разу"}
            </p>
            {batch.tail.map((item) => (
              <p className="cv-metric" key={item.what}>
                <span>{item.what}</span>
                {item.total ? <Bar closed={item.closed} total={item.total} /> : null}
                <b>{item.closed}{item.total ? ` з ${item.total}` : ""}</b>
              </p>
            ))}
            {batch.last_line ? <p className="cv-log">{batch.last_line}</p> : null}
            <p className="cv-cmd">
              <Terminal size={12} aria-hidden="true" />
              <code>tail -f ~/.writer-lab/night-batch.log</code>
            </p>
          </article>
        </section>
      ) : null}
    </div>
  );
}
