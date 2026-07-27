import { GitCommitVertical, Link2 } from "lucide-react";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, ErrorState, LoadingState } from "../components/StatePanel";
import { getJson } from "../api";

/** Стрічка сенсів — як наскрізний мотив повертається крізь століття.
 *
 *  П'ята проєкція над тими самими даними. Мотиви — авторські формулювання
 *  Юрія (`throughline: true` у 70-Synthesis); машина їх не вигадує й не чіпає.
 *
 *  Ланка з датою стає точкою на спільній шкалі. Ланка без дати не зникає —
 *  вона стоїть у послідовності перед шкалою, бо «Архетип — Каїн» дати не має
 *  і не потребує. Це видно, а не приховано.
 *
 *  Вузол — ланка, спільна двом мотивам (Катинь належить і «Непокараному злу»,
 *  і «Межі реалполітики»). Саме вузли показують, де осі розповіді сходяться. */
interface Link { text: string; year: number | null; anchor: string | null; targets: string[]; shared: string[] }
interface Motif { title: string; question: string; status: string; path: string; links: Link[]; dated: number }
interface Draft { title: string; variant_of: string; path: string }

function useSenses() {
  return useQuery({
    queryKey: ["senses"],
    queryFn: () => getJson<{ motifs: Motif[]; drafts: Draft[] }>("/api/v1/senses"),
    staleTime: 30_000
  });
}

const shortTitle = (t: string) => t.replace(/^Наскрізне — /, "");

export function SensesView({ onOpenDocument }: { onOpenDocument?: (id: string) => void }) {
  const data = useSenses();
  const motifs = data.data?.motifs ?? [];
  const drafts = data.data?.drafts ?? [];

  // Спільна шкала: логарифмічна за століттями була б чеснішою, але нечитною —
  // беремо рівномірну від найранішої датованої ланки до найпізнішої.
  const [from, to] = useMemo(() => {
    const years = motifs.flatMap((m) => m.links.map((l) => l.year).filter((y): y is number => y !== null));
    return years.length ? [Math.min(...years), Math.max(...years)] : [0, 0];
  }, [motifs]);
  const at = (year: number) => ((year - from) / Math.max(1, to - from)) * 100;

  if (data.isError) return <ErrorState error={data.error as Error} onRetry={() => void data.refetch()} />;
  if (data.isLoading) return <LoadingState label="Читаємо наскрізні мотиви…" />;
  if (!motifs.length)
    return <EmptyState title="Наскрізних мотивів немає">Мотив — документ у 70-Synthesis із полем throughline: true. Формулювання авторські; система їх не вигадує.</EmptyState>;

  return (
    <div className="route route-senses">
      <header className="senses-head">
        <span className="eyebrow">СТРІЧКА СЕНСІВ</span>
        <h1>Наскрізні мотиви <span className="sub">{motifs.length}</span></h1>
        <p>Як питання повертається крізь століття. Ланка з датою стоїть на шкалі, ланка без дати — у послідовності перед нею.</p>
      </header>

      {to > from ? (
        <div className="senses-axis">
          {[from, Math.round((from + to) / 2), to].map((y) => (
            <span key={y} style={{ left: `${at(y)}%` }}>{y}</span>
          ))}
        </div>
      ) : null}

      <div className="senses-lanes">
        {motifs.map((motif) => {
          const undated = motif.links.filter((l) => l.year === null);
          const dated = motif.links.filter((l) => l.year !== null);
          return (
            <section key={motif.path} className={`senses-lane${motif.links.length ? "" : " empty"}`}>
              <button type="button" className="senses-name" onClick={() => onOpenDocument?.(motif.path)}>
                <strong>{shortTitle(motif.title)}</strong>
                <span>{motif.links.length ? `${motif.links.length} ланок · ${motif.dated} на шкалі` : "ланцюга ще немає"}</span>
              </button>

              {motif.links.length ? (
                <div className="senses-strip">
                  <div className="senses-undated">
                    {undated.map((l) => (
                      <span key={l.text} className="senses-chip" title={l.text}>
                        {l.text.split(/[.—]/)[0].slice(0, 26)}
                        {l.shared.length ? <Link2 size={11} /> : null}
                      </span>
                    ))}
                  </div>
                  <div className="senses-track">
                    <div className="senses-rule" />
                    {dated.map((l) => (
                      <div key={l.text} className={`senses-beat${l.shared.length ? " node" : ""}`} style={{ left: `${at(l.year!)}%` }}>
                        {l.shared.length ? <GitCommitVertical size={13} /> : <i />}
                        <div className="senses-card">
                          <b>{l.year}</b>
                          <span>{l.text}</span>
                          {l.shared.length ? <em>сходиться з: {l.shared.map(shortTitle).join(", ")}</em> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="senses-hint">{motif.question ? `«${motif.question.slice(0, 150)}…»` : "Питання сформульоване, ланцюг повторень — ні."}</p>
              )}
            </section>
          );
        })}
      </div>

      {drafts.length ? (
        <div className="senses-drafts">
          <span className="eyebrow">ЧЕРНЕТКИ ЛАНЦЮГІВ <b>{drafts.length}</b></span>
          <p>Конвеєр склав, чекають вашого рішення — ланцюг це теза, не вибірка з бази.</p>
          <ul>
            {drafts.map((d) => (
              <li key={d.path}><button type="button" onClick={() => onOpenDocument?.(d.path)}>{d.title}</button></li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
