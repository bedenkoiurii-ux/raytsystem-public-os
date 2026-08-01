import { CircleDot, Circle, CircleSlash, Moon, Terminal, GitBranch, AlertTriangle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { ErrorState, LoadingState } from "../components/StatePanel";
import { getJson } from "../api";

/** Конвеєри — що зараз меле система і скільки лишилось.
 *
 *  Сторінка нічого не запускає й не спиняє: жодного POST, лише читання
 *  файлів. Керування лишається в терміналі — кнопка «спинити» у вікні
 *  обірвала б прогін посеред запису картки, і ніхто б цього не побачив.
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
}
interface Commit { ago_min: number; at: string; subject: string }
interface Timing {
  running_s: number | null; median_s: number | null;
  band_s: [number, number] | null; samples: number; suspicious: boolean;
}
interface Task {
  name: string; title: string; about: string;
  state: { code: string; label: string; note: string | null };
  run: number | null; stage: string | null; timing: Timing | null; queue: Queue | null;
  budget: { spent: number; max: number };
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

const ago = (min: number) =>
  min < 1 ? "щойно" : min < 60 ? `${min} хв тому` : min < 1440 ? `${Math.floor(min / 60)} год тому` : `${Math.floor(min / 1440)} дн тому`;

function StateMark({ code }: { code: string }) {
  const size = 13;
  if (code === "running") return <CircleDot size={size} aria-hidden="true" />;
  if (code === "sleeping" || code === "budget") return <Moon size={size} aria-hidden="true" />;
  if (code === "stopped") return <CircleSlash size={size} aria-hidden="true" />;
  return <Circle size={size} aria-hidden="true" />;
}

function Bar({ closed, total }: { closed: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((closed / total) * 100)) : 0;
  return (
    <span className="cv-bar" role="img" aria-label={`${closed} з ${total}`}>
      <span className="cv-bar-fill" style={{ width: `${pct}%` }} />
    </span>
  );
}

/** Хвилини з секунд, але не «0 хв»: прогін коротший за хвилину чесніше
 *  показати в секундах, ніж округлити в нуль і вдати, що нічого не йде. */
const dur = (s: number) => (s < 90 ? `${s} с` : `${Math.round(s / 60)} хв`);

function Timing({ timing, hasStage }: { timing: Timing | null; hasStage: boolean }) {
  if (!timing || timing.running_s === null) return null;
  const { running_s, band_s, samples, suspicious } = timing;
  return (
    <p className={`cv-timing${suspicious ? " cv-timing-long" : ""}`}>
      {suspicious ? <AlertTriangle size={12} aria-hidden="true" /> : null}
      <span>триває {dur(running_s)}</span>
      {band_s ? (
        <i>· зазвичай {dur(band_s[0])}–{dur(band_s[1])}</i>
      ) : (
        // Медіана з'явиться, коли цикл перезапустять на новому wl-loop.sh:
        // тривалості пише він сам. Вдавати «зазвичай» з нуля замірів не можна.
        <i>· медіани ще немає ({samples} замірів)</i>
      )}
      {suspicious ? <b>підозріло довго</b> : null}
      {!hasStage && !suspicious ? <i className="cv-timing-hint">етап буде з наступного прогону</i> : null}
    </p>
  );
}

function TaskCard({ task }: { task: Task }) {
  const { queue, budget, state } = task;
  const current = queue?.current;
  return (
    <article className={`cv-card cv-${state.code}`}>
      <header>
        <StateMark code={state.code} />
        <b>{task.title}</b>
        <code>{task.name}</code>
        <span className={`cv-pill cv-pill-${state.code}`}>{state.label}</span>
      </header>

      {task.run !== null && state.code === "running" ? <p className="cv-run">прогін #{task.run}</p> : null}
      {state.note ? <p className="cv-note">{state.note}</p> : null}
      {task.stage ? <p className="cv-stage">{task.stage}</p> : null}
      <Timing timing={task.timing} hasStage={Boolean(task.stage)} />



      {current ? (
        <p className="cv-current">
          <span className="cv-current-label">найпевніше зараз</span>
          <span className="cv-current-idx">{current.kind} {current.index} з {current.of}</span>
          <span className="cv-current-name">{current.name}</span>
        </p>
      ) : null}

      {queue ? (
        <p className="cv-metric">
          <span>черга</span><Bar closed={queue.closed} total={queue.total} />
          <b>{queue.closed} з {queue.total}</b> <i>{queue.unit}</i>
        </p>
      ) : null}
      <p className="cv-metric">
        <span>бюджет</span><Bar closed={budget.spent} total={budget.max} />
        <b>{budget.spent} з {budget.max}</b> <i>прогонів сьогодні</i>
      </p>

      {queue?.missing ? (
        <p className="cv-warn">у черзі на {queue.missing} рядок більше, ніж бачать ворота — картку перейменували або перенесли</p>
      ) : null}

      {task.commit ? (
        <p className="cv-commit" title={task.commit.at}>
          <span>коміт {ago(task.commit.ago_min)}</span> {task.commit.subject}
        </p>
      ) : null}
      {task.unmerged ? (
        <p className="cv-unmerged"><GitBranch size={12} aria-hidden="true" /> {task.unmerged} комітів чекають злиття в main</p>
      ) : null}

      {task.last_line ? <p className="cv-log">{task.last_line}</p> : null}
      <p className="cv-cmd"><Terminal size={12} aria-hidden="true" /> <code>{task.command} стан</code></p>
    </article>
  );
}

export function ConveyorsView() {
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
          Керування лишається в терміналі: кнопка у вікні обірвала б прогін посеред запису.
        </p>
      </header>

      <div className="cv-grid">
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
