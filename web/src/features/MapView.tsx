import type React from "react";
import { ChevronRight, Maximize2 } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, ErrorState, LoadingState } from "../components/StatePanel";
import { getJson } from "../api";

/** Мапа сюжетів — географія розповіді.
 *
 *  ЗАДУМ ЮРІЯ (2026-07-27): «Тема розгортається в кількох вимірах: бере початок
 *  в одній географічній точці, набуває розвитку в іншій, закінчується в третій.
 *  Ліворуч мапа, праворуч перелік подій, згорнутих у назву або часовий проміжок;
 *  під назвою — реперні точки: рік, місце, що сталося. І пунктирні лінії, які
 *  зв'язують, а також стрілки — вектори розвитку в часі й просторі.»
 *
 *  Сюжет = документ (розділ книги, епізод, MOC), до якого прив'язані події.
 *  Збирає `map_routes.py`; тут лише показ.
 *
 *  Областей не малюємо — рішення Юрія: контурів історичних територій у
 *  бібліотеці немає, а домальовувати кордони на око означає видати вигадку
 *  за факт. Територія лишається точкою з підписом. */
const BOX = { lonMin: -8, latMin: 34, lonMax: 52, latMax: 60 };
const W = 1000;
const H = 620;

interface Place { title: string; lat: number; lon: number; path: string }
interface StoryEvent { title: string; year: number; year_end: number | null; place_raw: string; route: string[]; path: string }
interface Story { title: string; from: number; to: number; events: StoryEvent[]; mapped: number }
interface Period { title: string; from: number; to: number; path: string }
interface MapData { places: Place[]; periods: Period[]; stories: Story[]; loose: StoryEvent[] }
interface EventCard {
  title: string; year: string; year_end: string; place: string;
  what: string; consequences: string; related: string[]; sides: string; path: string;
}

const projectY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const yTop = projectY(BOX.latMax);
const yBottom = projectY(BOX.latMin);
const toScreen = (lat: number, lon: number): [number, number] => [
  ((lon - BOX.lonMin) / (BOX.lonMax - BOX.lonMin)) * W,
  ((yTop - projectY(lat)) / (yTop - yBottom)) * H
];

function useMapData() {
  return useQuery({
    queryKey: ["map", "data"],
    queryFn: () => getJson<MapData>("/api/v1/map"),
    staleTime: 30_000
  });
}

function useEventCard(path: string | null) {
  return useQuery({
    queryKey: ["map", "event", path],
    enabled: Boolean(path),
    staleTime: 60_000,
    queryFn: () => getJson<EventCard>(`/api/v1/map/event?path=${encodeURIComponent(path ?? "")}`)
  });
}

function useLand() {
  return useQuery({
    queryKey: ["map", "land"],
    staleTime: Infinity,
    queryFn: async () => {
      // Контур у бандлі окремим чанком: CSP має connect-src 'self', зовнішні
      // тайли неможливі — і не потрібні, бібліотека не ходить у мережу.
      const data = (await import("./land.json")).default as unknown as {
        features: { geometry: { coordinates: number[][][][] } }[];
      };
      const paths: string[] = [];
      for (const feature of data.features ?? []) {
        for (const poly of feature.geometry?.coordinates ?? []) {
          const ring = poly[0];
          if (!ring?.length) continue;
          let d = "";
          ring.forEach(([lon, lat], i) => {
            const [x, y] = toScreen(lat, lon);
            d += `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
          });
          paths.push(`${d}Z`);
        }
      }
      return paths;
    }
  });
}

export function MapView({ onOpenDocument }: { onOpenDocument?: (id: string) => void }) {
  const data = useMapData();
  const land = useLand();
  const [tab, setTab] = useState<"stories" | "periods">("stories");
  const [openStory, setOpenStory] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);       // підсвічений сюжет
  const [span, setSpan] = useState<[number, number] | null>(null);  // обраний період
  // Період, виставлений вибором сюжету, НЕ ховає інші сюжети зі списку —
  // Юрій: «при виборі одного решта не зникають». Фільтрує лише період,
  // заданий руками (поля або повзунок).
  const [spanByStory, setSpanByStory] = useState(false);
  const [openEvent, setOpenEvent] = useState<string | null>(null);
  const card = useEventCard(openEvent);
  const [hover, setHover] = useState<Place | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const stage = useRef<HTMLDivElement | null>(null);

  const places = useMemo(() => {
    const map = new Map<string, Place & { x: number; y: number }>();
    for (const p of data.data?.places ?? []) {
      const [x, y] = toScreen(p.lat, p.lon);
      map.set(p.title, { ...p, x, y });
    }
    return map;
  }, [data.data]);

  const stories = data.data?.stories ?? [];
  const bounds = useMemo(() => {
    const years = stories.flatMap((s) => [s.from, s.to]);
    return years.length ? ([Math.min(...years), Math.max(...years)] as const) : ([0, 0] as const);
  }, [stories]);

  // Сюжет входить у зріз, якщо його роки перетинаються з обраним періодом.
  const [lo, hi] = span ?? bounds;

  // Точки обраного сюжету. Решта лишається на мапі, але тьмяною й без підпису —
  // саме нагромадження підписів робило мапу нечитною.
  const focused = useMemo(() => {
    const story = stories.find((s) => s.title === active);
    if (!story) return null;
    return new Set(story.events.flatMap((e) => e.route));
  }, [active, stories]);
  // Кого підписуємо. У режимі сюжету — тільки його точки (решта тьмяна, без
  // назв). Без сюжету — груба сітка антиколізії; при зумі комірка дрібнішає,
  // тож чим ближче, тим більше назв проступає.
  const named = useMemo(() => {
    const all = [...places.values()];
    if (focused) return new Set(all.filter((p) => focused.has(p.title)).map((p) => p.title));
    const taken = new Set<string>();
    const out = new Set<string>();
    for (const p of all.slice().sort((a, b) => a.title.length - b.title.length)) {
      const cell = `${Math.round((p.x * view.k) / 120)}:${Math.round((p.y * view.k) / 20)}`;
      if (taken.has(cell)) continue;
      taken.add(cell);
      out.add(p.title);
    }
    return out;
  }, [places, focused, view.k]);

  const shown = stories.filter((s) => !span || spanByStory || (s.to >= span[0] && s.from <= span[1]));
  const periods = data.data?.periods ?? [];
  const drawn = active ? shown.filter((s) => s.title === active) : shown;

  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    const box = stage.current?.getBoundingClientRect();
    if (!box) return;
    const cx = ((e.clientX - box.left) / box.width) * W;
    const cy = ((e.clientY - box.top) / box.height) * H;
    setView((v) => {
      const k = Math.min(14, Math.max(1, v.k * (e.deltaY < 0 ? 1.18 : 1 / 1.18)));
      return {
        k,
        x: Math.min(Math.max(0, cx - ((cx - v.x) * v.k) / k), W - W / k),
        y: Math.min(Math.max(0, cy - ((cy - v.y) * v.k) / k), H - H / k)
      };
    });
  };
  const onMove = (e: React.MouseEvent) => {
    if (!drag.current) return;
    const box = stage.current?.getBoundingClientRect();
    if (!box) return;
    const dx = ((e.clientX - drag.current.px) / box.width) * (W / view.k);
    const dy = ((e.clientY - drag.current.py) / box.height) * (H / view.k);
    setView((v) => ({
      ...v,
      x: Math.min(Math.max(0, drag.current!.x - dx), W - W / v.k),
      y: Math.min(Math.max(0, drag.current!.y - dy), H - H / v.k)
    }));
  };

  /** Показати сюжет цілком: період по його роках, вигляд — по його точках.
   *  Юрій: «вибираю сюжет, а мапа лишається в рамках усього часового простору».
   *  Вибір сюжету звужує все одразу — час, зум і підписи. */
  const showStory = useCallback((story: Story) => {
    setSpan([story.from, story.to]);
    setSpanByStory(true);
    const pts = story.events.flatMap((e) => e.route).map((n) => places.get(n)).filter(Boolean) as (Place & { x: number; y: number })[];
    if (!pts.length) { setView({ x: 0, y: 0, k: 1 }); return; }
    const pad = 90;
    const minX = Math.min(...pts.map((p) => p.x)) - pad;
    const maxX = Math.max(...pts.map((p) => p.x)) + pad;
    const minY = Math.min(...pts.map((p) => p.y)) - pad;
    const maxY = Math.max(...pts.map((p) => p.y)) + pad;
    const k = Math.min(8, Math.max(1, Math.min(W / Math.max(1, maxX - minX), H / Math.max(1, maxY - minY))));
    setView({
      k,
      x: Math.min(Math.max(0, (minX + maxX) / 2 - W / k / 2), W - W / k),
      y: Math.min(Math.max(0, (minY + maxY) / 2 - H / k / 2), H - H / k)
    });
  }, [places]);

  /** Наблизити до точки — коли клікаєш реперну точку в правій колонці. */
  const focus = useCallback((name: string) => {
    const p = places.get(name);
    if (!p) return;
    const k = 5;
    setView({
      k,
      x: Math.min(Math.max(0, p.x - W / k / 2), W - W / k),
      y: Math.min(Math.max(0, p.y - H / k / 2), H - H / k)
    });
  }, [places]);

  if (data.isError) return <ErrorState error={data.error as Error} onRetry={() => void data.refetch()} />;
  if (data.isLoading) return <LoadingState label="Збираємо сюжети й місця…" />;
  if (!places.size) return <EmptyState title="Місць із координатами немає">Картки в 30-Research/Places ще не мають координат — їх ставить фонова задача «гео».</EmptyState>;

  return (
    <div className="route route-map">
      <div className={`map-split${openEvent && card.data ? " with-card" : ""}`}>
        <div className="map-stage" ref={stage}>
          <svg viewBox={`${view.x} ${view.y} ${W / view.k} ${H / view.k}`} className="map-svg"
               role="img" aria-label="Мапа сюжетів"
               onWheel={onWheel} onMouseMove={onMove}
               onMouseDown={(e) => { drag.current = { px: e.clientX, py: e.clientY, x: view.x, y: view.y }; }}
               onMouseUp={() => { drag.current = null; }} onMouseLeave={() => { drag.current = null; }}>
            <defs>
              <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4"
                      markerWidth={5 / view.k} markerHeight={5 / view.k} orient="auto">
                <path d="M0 0 L8 4 L0 8 z" className="map-arrow" />
              </marker>
            </defs>

            <g className="map-land">
              {(land.data ?? []).map((d, i) => <path key={i} d={d} style={{ strokeWidth: 0.6 / view.k }} />)}
            </g>

            {/* Пунктир — послідовність подій сюжету в часі. Суцільна зі стрілкою —
                рух усередині однієї події (place: «Київ → Володимир → Москва»). */}
            <g className="map-chains">
              {drawn.map((story) => {
                const stops: { name: string; solid: boolean }[] = [];
                for (const ev of story.events) {
                  if (span && ((ev.year_end ?? ev.year) < span[0] || ev.year > span[1])) continue;
                  ev.route.forEach((name, i) => stops.push({ name, solid: i > 0 }));
                }
                const segments = [];
                for (let i = 1; i < stops.length; i += 1) {
                  const a = places.get(stops[i - 1].name);
                  const b = places.get(stops[i].name);
                  if (!a || !b || (a.x === b.x && a.y === b.y)) continue;
                  segments.push(
                    <line key={`${story.title}-${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                          className={stops[i].solid ? "vector" : "chain"}
                          markerEnd={stops[i].solid ? "url(#arrow)" : undefined}
                          style={{
                            strokeWidth: (stops[i].solid ? 1.6 : 1.1) / view.k,
                            strokeDasharray: stops[i].solid ? undefined : `${5 / view.k} ${4 / view.k}`
                          }} />
                  );
                }
                return <g key={story.title} className={active === story.title ? "on" : ""}>{segments}</g>;
              })}
            </g>

            <g className="map-points">
              {[...places.values()].map((p) => (
                <g key={p.title} className={`map-point${hover?.title === p.title ? " on" : ""}${focused && !focused.has(p.title) ? " dim" : ""}`}
                   onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)}
                   onClick={() => onOpenDocument?.(p.path)} role="button" tabIndex={0}>
                  <circle cx={p.x} cy={p.y} r={(hover?.title === p.title ? 6 : 4) / view.k} />
                  {named.has(p.title) ? (
                    <text x={p.x + 9 / view.k} y={p.y + 4 / view.k} style={{ fontSize: `${10.5 / view.k}px` }}>{p.title}</text>
                  ) : null}
                </g>
              ))}
            </g>
          </svg>

          {view.k > 1 ? (
            <button type="button" className="map-fit" onClick={() => setView({ x: 0, y: 0, k: 1 })}>
              <Maximize2 size={13} /> ×{view.k.toFixed(1)} · вся мапа
            </button>
          ) : null}

          {/* Дві ручки на одній шкалі: «від» і «до». Той самий стан, що й поля
              років праворуч, — рухаєш тут, змінюється там, і навпаки. */}
          <div className="map-range">
            <div className="map-range-track">
              <div className="map-range-fill"
                   style={{
                     left: `${((lo - bounds[0]) / Math.max(1, bounds[1] - bounds[0])) * 100}%`,
                     right: `${100 - ((hi - bounds[0]) / Math.max(1, bounds[1] - bounds[0])) * 100}%`
                   }} />
            </div>
            <input type="range" min={bounds[0]} max={bounds[1]} value={lo} aria-label="Від року"
                   onChange={(e) => { setSpanByStory(false); setSpan([Math.min(Number(e.target.value), hi), hi]); }} />
            <input type="range" min={bounds[0]} max={bounds[1]} value={hi} aria-label="До року"
                   onChange={(e) => { setSpanByStory(false); setSpan([lo, Math.max(Number(e.target.value), lo)]); }} />
            <span className="map-range-lo">{lo}</span>
            <span className="map-range-hi">{hi}</span>
          </div>
        </div>

        <aside className="map-side">
          <div className="map-period">
            <div className="map-period-row">
              <input type="number" value={lo} min={bounds[0]} max={bounds[1]}
                     onChange={(e) => { setSpanByStory(false); setSpan([Number(e.target.value), hi]); }} aria-label="Від року" />
              <span className="dash">—</span>
              <input type="number" value={hi} min={bounds[0]} max={bounds[1]}
                     onChange={(e) => { setSpanByStory(false); setSpan([lo, Number(e.target.value)]); }} aria-label="До року" />
              {span ? <button type="button" className="map-clear" onClick={() => { setSpan(null); setSpanByStory(false); }}>увесь час</button> : null}
            </div>
          </div>

          <div className="map-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "stories"}
                    className={tab === "stories" ? "on" : ""} onClick={() => setTab("stories")}>
              Сюжети <b>{shown.length}</b>
            </button>
            <button type="button" role="tab" aria-selected={tab === "periods"}
                    className={tab === "periods" ? "on" : ""} onClick={() => setTab("periods")}>
              Періоди <b>{periods.length}</b>
            </button>
          </div>

          {tab === "periods" ? (
            <div className="map-stories">
              <ul className="map-periods">
                {periods.map((p) => (
                  <li key={p.path} className={span && span[0] === p.from && span[1] === p.to ? "on" : ""}>
                    <button type="button" onClick={() => { setSpan([p.from, p.to]); setTab("stories"); setActive(null); }}>
                      <b>{p.from}–{p.to}</b>
                      <span>{p.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="map-note">Періоди взято з бібліотеки, не вигадано: хроніки й дослідження за десятиліттями. Для давнішої історії періодів у матеріалі ще немає — там одиницею лишається розділ.</p>
            </div>
          ) : (
          <div className="map-stories">
            <ul>
              {shown.map((story) => {
                const open = openStory === story.title;
                return (
                  <li key={story.title} className={`${open ? "open " : ""}${active === story.title ? "active" : ""}`}>
                    <button type="button" className="map-story-head"
                            onClick={() => {
                              if (open) { setOpenStory(null); setActive(null); setSpan(null); setSpanByStory(false); setOpenEvent(null); setView({ x: 0, y: 0, k: 1 }); }
                              else { setOpenStory(story.title); setActive(story.title); showStory(story); }
                            }}>
                      <ChevronRight size={14} className="chev" />
                      <span className="name">{story.title}</span>
                      <span className="span">{story.from}–{story.to}</span>
                      <span className={`cnt${story.mapped ? "" : " empty"}`}>{story.mapped}/{story.events.length}</span>
                    </button>
                    {open ? (
                      <ul className="map-beats">
                        {story.events.map((ev) => (
                          <li key={ev.path} className={ev.route.length ? "" : "unmapped"}>
                            <button type="button" className={openEvent === ev.path ? "on" : ""}
                                    onClick={() => { if (ev.route[0]) focus(ev.route[0]); setOpenEvent(openEvent === ev.path ? null : ev.path); }}>
                              <b>{ev.year}{ev.year_end && ev.year_end !== ev.year ? `–${ev.year_end}` : ""}</b>
                              <span className="what">{ev.title}</span>
                              <span className="where">
                                {ev.route.length ? ev.route.join(" → ") : (ev.place_raw ? "місця нема в бібліотеці" : "без місця")}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
          )}
        </aside>
      {openEvent && card.data ? (
        <aside className="map-card">
          <header>
            <span className="eyebrow">ПОДІЯ</span>
            <h2>{card.data.title}</h2>
            <p className="when">
              {card.data.year}{card.data.year_end && card.data.year_end !== card.data.year ? `–${card.data.year_end}` : ""}
              {card.data.place ? ` · ${card.data.place.slice(0, 90)}` : ""}
            </p>
            <button type="button" className="map-card-open" onClick={() => onOpenDocument?.(card.data!.path)}>відкрити картку</button>
          </header>

          {/* Передумови чесно складені з двох частин: попереднє в цьому сюжеті
              (структурно) і авторські звʼязки з секції «Повʼязане». Окремої
              секції «Передумови» в картках немає, і вигадувати її не будемо. */}
          {(() => {
            const story = stories.find((s) => s.title === active);
            const idx = story?.events.findIndex((e) => e.path === openEvent) ?? -1;
            const before = idx > 0 ? story!.events[idx - 1] : null;
            return (before || card.data!.related.length) ? (
              <section className="map-card-block before">
                <span className="eyebrow">ПЕРЕДУМОВИ</span>
                {before ? (
                  <button type="button" className="prev" onClick={() => setOpenEvent(before.path)}>
                    <b>{before.year}</b> {before.title}
                    <em>попереднє в цьому сюжеті</em>
                  </button>
                ) : null}
                {card.data!.related.length ? (
                  <p className="related">{card.data!.related.join(" · ")}</p>
                ) : null}
              </section>
            ) : null;
          })()}

          {card.data.what ? (
            <section className="map-card-block">
              <span className="eyebrow">ЩО СТАЛОСЯ</span>
              <pre>{card.data.what}</pre>
            </section>
          ) : null}

          {card.data.consequences ? (
            <section className="map-card-block after">
              <span className="eyebrow">НАСЛІДКИ</span>
              <pre>{card.data.consequences}</pre>
            </section>
          ) : null}
        </aside>
      ) : null}
      </div>

      {hover ? (
        <div className="map-tip-fixed"><strong>{hover.title}</strong><span>{hover.lat.toFixed(2)}, {hover.lon.toFixed(2)}</span></div>
      ) : null}
    </div>
  );
}
