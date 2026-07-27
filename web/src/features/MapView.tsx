import { MapPin, Pause, Play } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, ErrorState, LoadingState } from "../components/StatePanel";
import { getJson } from "../api";
import type { DocumentListEnvelope, DocumentSummary } from "../features/documents/documentTypes";

/** Мапа подій — четверта проєкція над тими самими даними (після Дерева, Всесвіту й Таймлайну).
 *
 *  Рішення Юрія (2026-07-27): контурна, не «точки в порожнечі» — берегова лінія
 *  потрібна як орієнтир. Підкладка вбудована (`land.json`, Natural Earth
 *  110m, обрізаний до вікна Європи): CSP застосунку має `img-src 'self'` і
 *  `connect-src 'self'`, тож жодні зовнішні тайли неможливі — і це правильно,
 *  бібліотека не мусить ходити в мережу, щоб показати власні дані.
 *
 *  Даних свого API мапа не потребує: `coordinates` і `time_start` уже приходять
 *  у properties списку документів — так само працює Таймлайн. */
const PLACES = "30-Research/Places";
const EVENTS = "30-Research/Events";
// Вікно від Толедо до Золотої Орди й від Гіппона до Новгорода: точка поза
// межами не зникає, а липне до краю й бреше — тому вікно ширше за поточні дані.
const BOX = { lonMin: -8, latMin: 34, lonMax: 52, latMax: 60 };
const W = 1000;
const H = 620;

interface Point {
  id: string;
  title: string;
  lat: number;
  lon: number;
  year: number | null;      // рік самого місця (заснування) — є в одиниць
  x: number;
  y: number;
  events: { title: string; year: number }[];   // події, що тут відбулися
}

/** Меркатор: для широт 38–60° він природніший за рівнокутну — Північ не сплющена. */
function projectY(lat: number): number {
  const rad = (lat * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + rad / 2));
}

const yTop = projectY(BOX.latMax);
const yBottom = projectY(BOX.latMin);

function toScreen(lat: number, lon: number): [number, number] {
  const x = ((lon - BOX.lonMin) / (BOX.lonMax - BOX.lonMin)) * W;
  const y = ((yTop - projectY(lat)) / (yTop - yBottom)) * H;
  return [x, y];
}

/** Сторінками по 50: limit понад 50 віддає 409, а не «скільки є». */
async function listAll(folder: string): Promise<DocumentSummary[]> {
  const docs: DocumentSummary[] = [];
  let cursor: string | null = null;
  do {
    const env: DocumentListEnvelope = await getJson<DocumentListEnvelope>(
      `/api/v1/documents?folder=${encodeURIComponent(folder)}&limit=50&sort=name_asc`
      + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "")
    );
    docs.push(...((env.items ?? []) as DocumentSummary[]));
    cursor = (env as { next_cursor?: string | null }).next_cursor ?? null;
  } while (cursor && docs.length < 500);
  return docs;
}

function usePlaces() {
  return useQuery({
    queryKey: ["map", "places"],
    queryFn: async () => {
      const [docs, eventDocs] = await Promise.all([listAll(PLACES), listAll(EVENTS)]);

      // Час у бібліотеці живе в подіях, не в місцях: у картці місця `time_start`
      // означає заснування й стоїть в одиниць (діапазон вийшов 1589–1616 на всю
      // мапу). Тому подію прив'язуємо до місця через зворотні посилання: подія
      // згадала [[Крим]] — отже вона сталася там. Це той самий механізм, яким
      // build_apparatus.py збирає апарат документа.
      const eventYear = new Map<string, number>();
      for (const ev of eventDocs) {
        const year = Number((ev.properties as Record<string, unknown> | undefined)?.time_start);
        if (Number.isFinite(year)) eventYear.set(ev.title || ev.filename, year);
      }

      const points: Point[] = [];
      for (const doc of docs) {
        const coords = (doc.properties as Record<string, unknown> | undefined)?.coordinates;
        if (!Array.isArray(coords) || coords.length < 2) continue;
        const lat = Number(coords[0]);
        const lon = Number(coords[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        if (lon < BOX.lonMin || lon > BOX.lonMax || lat < BOX.latMin || lat > BOX.latMax) continue;
        const rawYear = (doc.properties as Record<string, unknown> | undefined)?.time_start;
        const year = Number.isFinite(Number(rawYear)) ? Number(rawYear) : null;
        const [x, y] = toScreen(lat, lon);
        const title = doc.title || doc.filename;
        points.push({ id: doc.document_id, title, lat, lon, year, x, y, events: [] });
      }
      // Зворотні посилання — по одному запиту на точку, паралельно. Дешевше за
      // читання тіл усіх подій і не потребує власного ендпойнта.
      const snapshot = (await getJson<{ snapshot_id: string }>("/api/v1/documents/index")).snapshot_id;
      await Promise.all(points.map(async (point) => {
        try {
          const back = await getJson<{ items?: { source_title?: string; target?: string; label?: string }[] }>(
            `/api/v1/documents/${encodeURIComponent(point.id)}/backlinks?expected_snapshot_id=${encodeURIComponent(snapshot)}`
          );
          for (const item of back.items ?? []) {
            const name = item.source_title ?? item.label ?? item.target ?? "";
            const year = eventYear.get(name);
            if (year !== undefined) point.events.push({ title: name, year });
          }
          point.events.sort((a, b) => a.year - b.year);
        } catch {
          // Точка без зворотних посилань — не помилка, просто місце без подій.
        }
      }));
      return points;
    },
    staleTime: 30_000
  });
}

function useLand() {
  return useQuery({
    queryKey: ["map", "land"],
    // Підкладка статична й лежить у бандлі — рахуємо один раз на сеанс.
    staleTime: Infinity,
    queryFn: async () => {
      // Динамічний import: Vite кладе контур окремим чанком у /assets і вантажить
      // його лише коли відкрито Мапу. Мережі не треба — CSP тут ні до чого.
      const data = (await import("./land.json")).default as unknown as {
        features: { geometry: { coordinates: number[][][][] } }[];
      };
      const paths: string[] = [];
      for (const feature of data.features ?? []) {
        for (const poly of feature.geometry?.coordinates ?? []) {
          const ring = poly[0];
          if (!ring?.length) continue;
          let d = "";
          for (let i = 0; i < ring.length; i += 1) {
            const [lon, lat] = ring[i];
            const [x, y] = toScreen(lat, lon);
            d += `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
          }
          paths.push(`${d}Z`);
        }
      }
      return paths;
    }
  });
}

export function MapView({ onOpenDocument }: { onOpenDocument?: (id: string) => void }) {
  const places = usePlaces();
  const land = useLand();
  const [year, setYear] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [hover, setHover] = useState<Point | null>(null);
  const timer = useRef<number | null>(null);

  const points = places.data ?? [];
  const years = useMemo(
    () => points.flatMap((p) => p.events.map((e) => e.year)).sort((a, b) => a - b),
    [points]
  );
  const first = years[0] ?? 0;
  const last = years[years.length - 1] ?? 0;

  const step = useCallback(() => {
    setYear((prev) => {
      const next = (prev ?? first) + 25;
      if (next > last) { setPlaying(false); return last; }
      return next;
    });
  }, [first, last]);

  useEffect(() => {
    if (!playing) return;
    timer.current = window.setInterval(step, 220);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [playing, step]);

  if (places.isError) return <ErrorState error={places.error as Error} onRetry={() => void places.refetch()} />;
  if (places.isLoading) return <LoadingState label="Читаємо місця з координатами…" />;
  if (!points.length)
    return <EmptyState title="Місць із координатами немає">Картки в 30-Research/Places ще не мають поля coordinates — їх проставляє фонова задача «гео».</EmptyState>;

  // Без часового фільтра показуємо все; з фільтром — те, що вже існувало на цей рік.
  const visible = year === null ? points : points.filter((p) => p.events.some((e) => e.year <= year));

  // Антиколізія підписів. Київські святині лежать в одній точці з точністю до
  // кілометра, і без цього «Києво-Печерська лавра» накриває «Софійський собор».
  // Груба сітка замість справжнього розкладання міток: підпис дістає перша
  // точка в комірці, решта лишається кружечками — назву видно на наведення.
  // ponytail: сітка 96×18, справжній label-placement — якщо стане тісно.
  const labelled = new Set<string>();
  {
    const taken = new Set<string>();
    for (const p of [...visible].sort((a, b) => a.title.length - b.title.length)) {
      const cell = `${Math.round(p.x / 96)}:${Math.round(p.y / 18)}`;
      if (taken.has(cell)) continue;
      taken.add(cell);
      labelled.add(p.id);
    }
  }

  return (
    <div className="route route-map">
      <header className="map-head">
        <span className="eyebrow">МАПА</span>
        <h1>Місця <span className="sub">{visible.length}<span className="of">/{points.length}</span></span></h1>
        <p>Місця бібліотеки з подіями, що там сталися. Повзунок веде по роках, клік по точці відкриває картку.</p>
      </header>

      <div className="map-stage">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Мапа місць бібліотеки" className="map-svg">
          <g className="map-land">
            {(land.data ?? []).map((d, i) => <path key={i} d={d} />)}
          </g>
          <g className="map-points">
            {visible.map((p) => (
              <g key={p.id} className={`map-point${hover?.id === p.id ? " on" : ""}`}
                 onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)}
                 onClick={() => onOpenDocument?.(p.id)} role="button" tabIndex={0}
                 onKeyDown={(e) => { if (e.key === "Enter") onOpenDocument?.(p.id); }}>
                <circle cx={p.x} cy={p.y} r={hover?.id === p.id ? 6 : 4} />
                {labelled.has(p.id) || hover?.id === p.id ? <text x={p.x + 9} y={p.y + 4}>{p.title}</text> : null}
              </g>
            ))}
          </g>
        </svg>
        {hover ? (
          <div className="map-tip" style={{ left: `${(hover.x / W) * 100}%`, top: `${(hover.y / H) * 100}%` }}>
            <strong>{hover.title}</strong>
            <span>{hover.lat.toFixed(2)}, {hover.lon.toFixed(2)}</span>
            {hover.events.length ? (
              <ul className="map-tip-events">
                {hover.events.slice(0, 4).map((e) => <li key={e.title}><b>{e.year}</b> {e.title}</li>)}
                {hover.events.length > 4 ? <li className="more">…ще {hover.events.length - 4}</li> : null}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      {years.length ? (
        <div className="map-scrub">
          <button type="button" onClick={() => { setPlaying((v) => !v); if (year === null) setYear(first); }}
                  aria-label={playing ? "Спинити" : "Прогнати роками"}>
            {playing ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <input type="range" min={first} max={last} value={year ?? last}
                 onChange={(e) => { setPlaying(false); setYear(Number(e.target.value)); }}
                 aria-label="Рік" />
          <span className="map-year">{year ?? "усі роки"}</span>
          {year !== null ? (
            <button type="button" className="map-reset" onClick={() => { setYear(null); setPlaying(false); }}>
              <MapPin size={14} /> показати всі
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
