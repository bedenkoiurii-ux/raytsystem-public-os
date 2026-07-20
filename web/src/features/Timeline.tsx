import { useMemo, useState } from "react";
import { CalendarClock } from "lucide-react";
import { useTimeline } from "../hooks";
import { ErrorState, LoadingState } from "../components/StatePanel";
import type { DocumentSummary } from "./documents/documentTypes";

interface TimelineProps {
  onOpenDocument: (documentId: string) => void;
}

type Category = "person" | "event" | "concept";

interface TimelineItem {
  documentId: string;
  title: string;
  category: Category;
  start: number;
  end: number | null;
  precision: string;
  kind: string;
  rationale: string | null;
}

const CATEGORY_LABEL: Record<Category, string> = { person: "Люди", event: "Події", concept: "Поняття" };
const KIND_LABEL: Record<string, string> = {
  life: "життя",
  reign: "урядування",
  event: "подія",
  concept: "поняття",
};

const ROMAN: Array<[number, string]> = [
  [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
  [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
];
function roman(value: number): string {
  let n = value;
  let out = "";
  for (const [num, sym] of ROMAN) while (n >= num) { out += sym; n -= num; }
  return out;
}

// Століття-ключ для сортування смуг + людський підпис. BCE — від'ємний ключ.
function centuryBand(year: number): { key: number; label: string } {
  if (year < 0) {
    const c = Math.ceil(-year / 100);
    return { key: -c, label: `${roman(c)} ст. до н.е.` };
  }
  const c = Math.ceil(year / 100);
  return { key: c, label: `${roman(c)} ст.` };
}

function fmtYear(year: number): string {
  return year < 0 ? `${-year} до н.е.` : `${year}`;
}

function whenLabel(item: TimelineItem): string {
  const fuzzy = item.precision === "approx" || item.precision === "century";
  const prefix = fuzzy ? "бл. " : "";
  if (item.end != null && item.end !== item.start) return `${prefix}${fmtYear(item.start)} — ${fmtYear(item.end)}`;
  return `${prefix}${fmtYear(item.start)}`;
}

function toItem(doc: DocumentSummary): TimelineItem | null {
  const props = doc.properties ?? {};
  const start = props.time_start;
  if (typeof start !== "number") return null;
  const rawKind = typeof props.time_kind === "string" ? props.time_kind : "";
  const category: Category =
    rawKind === "event" ? "event" : rawKind === "concept" ? "concept" : "person";
  return {
    documentId: doc.document_id,
    title: doc.title || doc.filename,
    category,
    start,
    end: typeof props.time_end === "number" ? props.time_end : null,
    precision: typeof props.time_precision === "string" ? props.time_precision : "year",
    kind: rawKind || "life",
    rationale: null,
  };
}

export function Timeline({ onOpenDocument }: TimelineProps) {
  const timeline = useTimeline();
  const [active, setActive] = useState<Record<Category, boolean>>({ person: true, event: true, concept: true });

  const all = useMemo<TimelineItem[]>(
    () => (timeline.data?.items ?? []).map(toItem).filter((item): item is TimelineItem => item !== null),
    [timeline.data]
  );

  const counts = useMemo(() => {
    const base: Record<Category, number> = { person: 0, event: 0, concept: 0 };
    for (const item of all) base[item.category] += 1;
    return base;
  }, [all]);

  const bands = useMemo(() => {
    const visible = all.filter((item) => active[item.category]).sort((a, b) => a.start - b.start);
    const map = new Map<number, { key: number; label: string; items: TimelineItem[] }>();
    for (const item of visible) {
      const band = centuryBand(item.start);
      const bucket = map.get(band.key) ?? { key: band.key, label: band.label, items: [] };
      bucket.items.push(item);
      map.set(band.key, bucket);
    }
    return [...map.values()].sort((a, b) => a.key - b.key);
  }, [all, active]);

  if (timeline.isLoading) return <LoadingState label="Збираємо часову вісь…" />;
  if (timeline.isError) return <ErrorState error={timeline.error} onRetry={() => void timeline.refetch()} />;

  const shownCount = bands.reduce((sum, band) => sum + band.items.length, 0);

  return (
    <div className="route route-timeline">
      <header className="tl-head">
        <div className="tl-head-title">
          <CalendarClock size={22} aria-hidden="true" />
          <div>
            <span className="eyebrow">Часова вісь бібліотеки</span>
            <h2>{shownCount} на осі · від Геродота до сьогодні</h2>
          </div>
        </div>
        <div className="tl-filters" role="group" aria-label="Фільтр за типом">
          {(Object.keys(CATEGORY_LABEL) as Category[]).map((category) => (
            <button
              key={category}
              type="button"
              className={`tl-chip tl-${category} ${active[category] ? "on" : ""}`}
              aria-pressed={active[category]}
              onClick={() => setActive((prev) => ({ ...prev, [category]: !prev[category] }))}
            >
              <span className="tl-dot" /> {CATEGORY_LABEL[category]}
              <b>{counts[category]}</b>
            </button>
          ))}
        </div>
      </header>

      {bands.length === 0 ? (
        <p className="muted-copy tl-empty">Немає датованих карток для показу. Увімкни хоча б один тип.</p>
      ) : (
        <div className="tl-scroll">
          {bands.map((band) => (
            <section className="tl-band" key={band.key}>
              <div className="tl-band-mark">
                <span className="tl-era">{band.label}</span>
                <span className="tl-era-count">{band.items.length}</span>
              </div>
              <ol className="tl-items">
                {band.items.map((item) => (
                  <li key={item.documentId}>
                    <button
                      type="button"
                      className={`tl-item tl-${item.category}`}
                      onClick={() => onOpenDocument(item.documentId)}
                      title={item.title}
                    >
                      <span className="tl-dot" />
                      <span className="tl-when">{whenLabel(item)}</span>
                      <span className="tl-title">{item.title}</span>
                      <span className="tl-kind">{KIND_LABEL[item.kind] ?? item.kind}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
