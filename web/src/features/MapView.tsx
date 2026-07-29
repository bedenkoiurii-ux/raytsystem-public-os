import type React from "react";
import { ChevronRight, Maximize2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, ErrorState, LoadingState } from "../components/StatePanel";
import { getJson } from "../api";
import { SafeMarkdownView, type WikilinkTarget } from "./documents/SafeMarkdownView";
import { Prose, useNamedCard } from "./InlineEntity";
import { FOCUS_EVENT, currentFocus } from "./entityFocus";

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
 *  Території малюємо з історичного атласу (рішення Юрія 2026-07-28, що змінює
 *  попереднє): джерело дає поле precision, і штрих показує саме певність межі —
 *  приблизну малюємо пунктиром, визначену правом суцільною. */
// Вікно задаємо довготою й центром широти; висота — скільки влізе у форму
// контейнера. Раніше H була сталою (620), і на високому вузькому вікні мапа
// заповнювала простір ПОЛЯМИ, а не географією — «виглядає недолуго» (Юрій).
const BOX = { lonMin: -8, lonMax: 52, latCenter: 47 };
const W = 1000;
const DEG = 180 / Math.PI;

interface Place { title: string; lat: number; lon: number; path: string; document_id: string | null }
interface StoryEvent { title: string; year: number; year_end: number | null; place_raw: string; route: string[]; path: string; document_id: string | null }
interface Story { title: string; from: number; to: number; events: StoryEvent[]; mapped: number }
interface Period { title: string; from: number; to: number; path: string }
interface Person { title: string; year: number | null; year_end: number | null; route: string[]; when?: Record<string, string>; place_raw: string; path: string; document_id: string | null }
interface MapData { places: Place[]; periods: Period[]; stories: Story[]; loose: StoryEvent[]; people: Person[] }
interface EventCard {
  title: string; year: string; year_end: string; place: string;
  what: string; consequences: string; related: string[]; sides: string; path: string; document_id: string | null;
}

const projectY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
/** Затискач, що не пропускає NaN: будь-яке нечисло дає межу, а не зламаний viewBox. */
const clamp = (value: number, low: number, high: number) =>
  Number.isFinite(value) ? Math.min(Math.max(value, low), high) : low;

/** Вікна мапи. ЗАУВАГА ЮРІЯ (2026-07-29): «зараз я не бачу півночі і півдня,
 *  мапа зосереджена на київській оптиці». Розповідь виходить далеко за Європу —
 *  вікінги, Британія, Африка, Азія, увесь СРСР із системою ГУЛАГ. */
export const FRAMES: Record<string, { label: string; lonMin: number; lonMax: number; latCenter: number }> = {
  // Широти рахуються від центру, і це вже двічі підводило: центр 45° обрізав
  // північ на 59°, Новгород ставав краєм світу, а Скандинавії — тієї самої,
  // звідки прийшли варяги, — не було взагалі. Окреме вікно «Русь і степ»
  // прибрано: воно різало саму Русь (зовнішня межа сягає 62°), а європейське
  // вікно покриває і Русь, і степ. Юрій: «можливо, нам не потрібно плодити
  // додаткові сутності».
  europe:  { label: "Європа й Візантія", lonMin: -25, lonMax: 70,  latCenter: 55 },  // 34–69°: від Криту до Тромсе
  eurasia: { label: "Євразія",         lonMin: -25,  lonMax: 190, latCenter: 50 },
  world:   { label: "Світ",            lonMin: -180, lonMax: 180, latCenter: 20 },
};

export type Frame = keyof typeof FRAMES;
export interface Projection {
  toScreen: (lat: number, lon: number) => [number, number];
  /** Чи точка на видимій півкулі. Для плоскої карти — завжди true. */
  visible: (lat: number, lon: number) => boolean;
}

/** Меркатор зі спільним масштабом по обох осях — інакше контур спотворився б. */
function mercator(frame: Frame, height: number): Projection {
  const box = FRAMES[frame];
  const scale = W / (box.lonMax - box.lonMin);
  const yMid = projectY(box.latCenter);
  return {
    toScreen: (lat, lon) => [
      (lon - box.lonMin) * scale,
      height / 2 - (projectY(clamp(lat, -84, 84)) - yMid) * scale * DEG,
    ],
    visible: () => true,
  };
}

/** Глобус — ортографічна проєкція: як планета з орбіти, півкуля за раз.
 *  Обертається перетягуванням; зворотний бік не малюємо, бо на сфері він
 *  фізично не видимий, а не «поза кадром». */
function orthographic(lat0: number, lon0: number, height: number): Projection {
  const R = Math.min(W, height) * 0.46;
  const cx = W / 2;
  const cy = height / 2;
  const rad = Math.PI / 180;
  const sinP = Math.sin(lat0 * rad);
  const cosP = Math.cos(lat0 * rad);
  const cosC = (lat: number, lon: number) =>
    sinP * Math.sin(lat * rad) + cosP * Math.cos(lat * rad) * Math.cos((lon - lon0) * rad);
  return {
    toScreen: (lat, lon) => [
      cx + R * Math.cos(lat * rad) * Math.sin((lon - lon0) * rad),
      cy - R * (cosP * Math.sin(lat * rad) - sinP * Math.cos(lat * rad) * Math.cos((lon - lon0) * rad)),
    ],
    visible: (lat, lon) => cosC(lat, lon) >= 0,
  };
}

/** Реєстр підписів: жоден напис не лягає на інший.
 *
 *  ЗАВДАННЯ ЮРІЯ (2026-07-29): «одна назва ніколи не повинна перекривати іншу.
 *  Треба подумати, який механізм для цього треба збудувати». Механізм такий:
 *  усі шари просять місце в одного реєстру, у порядку ваги — спершу те, що
 *  читач щойно вибрав, тоді наші контури, тоді міста, і аж тоді тло. Кому
 *  місця не лишилось, той мовчить: краще без підпису, ніж нечитний клубок.
 *
 *  Прямокутник рахуємо від довжини рядка — це грубо, але дешево й не вимагає
 *  вимірювати текст у DOM на кожен рух мапи.
 */
class LabelSpace {
  private taken: { x1: number; y1: number; x2: number; y2: number }[] = [];
  constructor(private scale: number) {}
  /** Спробувати поставити підпис. Повертає false, якщо місце зайняте. */
  claim(x: number, y: number, text: string, size = 10.5): boolean {
    const w = (text.length * size * 0.56) / this.scale;
    const h = (size * 1.5) / this.scale;
    const box = { x1: x, y1: y - h, x2: x + w, y2: y };
    const clash = this.taken.some((b) =>
      box.x1 < b.x2 && box.x2 > b.x1 && box.y1 < b.y2 && box.y2 > b.y1);
    if (clash) return false;
    this.taken.push(box);
    return true;
  }
}

/** Що саме сталося в цій точці маршруту.
 *
 *  ЗАУВАГА ЮРІЯ (2026-07-29): «для розуміння перебування, народження, смерті
 *  потрібні позначки — або піктограми, або просто текстом, щоб не виникало
 *  зайвих питань». Текстом: піктограма потребує легенди, «нар.» і «пом.» —
 *  ні. Позначку виводимо лише коли рік ТОЧНО збігається з роком народження
 *  чи смерті з картки; в інших випадках мовчимо, бо перша точка маршруту не
 *  конче місце народження, і вгадувати тут гірше, ніж не сказати.
 */
/** Рік по-людськи: до нашої ери — словами, а не мінусом. */
const yearText = (y: number): string => (y < 0 ? `${-y} до н.е.` : String(y));

function whenLabel(years: string, birth: number | null, death: number | null): string {
  const clean = years.trim();
  if (/^(нар|пом|княз|митр|заснув)/i.test(clean)) return clean;   // автор сказав сам
  const numbers = (clean.match(/-?\d+/g) ?? []).map(Number);
  if (!numbers.length) return clean;
  // Тільки коли в дужках ОДНЕ число: «Київ (1149–1151, 1155–1157)» — це роки
  // княжіння, і напис «пом. 1149–1151…» був би безглуздий, хоч останній рік і
  // збігається з роком смерті.
  if (numbers.length !== 1) return clean;
  if (birth !== null && numbers[0] === birth) return `нар. ${clean}`;
  if (death !== null && numbers[0] === death) return `пом. ${clean}`;
  return clean;
}

function useMapData() {
  return useQuery({
    queryKey: ["map", "data"],
    queryFn: () => getJson<MapData>("/api/v1/map"),
    staleTime: 30_000
  });
}

/** Текст самого сюжету — розділу, епізоду, есею. Клік по назві сюжету
 *  відкриває його читання, а не лише список подій (Юрій). */
function useStoryDoc(title: string | null) {
  return useQuery({
    queryKey: ["map", "story", title],
    enabled: Boolean(title),
    staleTime: 60_000,
    queryFn: () => getJson<{ title: string; kind: string; body: string; path: string; document_id: string | null; error?: string }>(
      `/api/v1/map/story?title=${encodeURIComponent(title ?? "")}`)
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

function useLand(projection: Projection, key: string) {
  return useQuery({
    queryKey: ["map", "land", key],
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
          // На глобусі кільце може заходити за край: рвемо його там, де
          // точки йдуть на зворотний бік, інакше суша «протикає» планету.
          let d = "";
          let pen = false;
          for (const [lon, lat] of ring) {
            if (!projection.visible(lat, lon)) { pen = false; continue; }
            const [x, y] = projection.toScreen(lat, lon);
            d += `${pen ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
            pen = true;
          }
          if (d) paths.push(d);
        }
      }
      return paths;
    }
  });
}

/** Утворення атласу → наша картка. Атлас англомовний і світовий, бібліотека
 *  українська: без цього містка територія на мапі й розповідь про неї лишаються
 *  двома різними речима. Тільки те, що справді має картку, — решта чипів
 *  просто не веде нікуди, і це чесніше за посилання в порожнечу. */
const REALM_CARDS: Record<string, string> = {
  "Kyivan Rus": "Київська Русь",
  "Rus": "Київська Русь",
  "Byzantine Empire": "Візантія",
  "Khanate of the Golden Horde": "Золота Орда",
  "Golden Horde": "Золота Орда",
  "Grand Duchy of Lithuania": "Велике князівство Литовське",
  "Lithuania": "Велике князівство Литовське",
  "Polish-Lithuanian Commonwealth": "Річ Посполита",
  "Poland-Lithuania": "Річ Посполита",
  "Cossack Hetmanate": "Гетьманщина",
  "Zaporozhian Host": "Гетьманщина",
  "Khazar Khaganate": "Хозарський каганат",
  "Khazaria": "Хозарський каганат",
  "Ottoman Empire": "Османська імперія",
  "Scythia": "Скіфія",
  "Grand Duchy of Moscow": "Москва",
  "Muscovy": "Москва",
  "Tsardom of Russia": "Москва",
};

/** Зрізи історичних кордонів, що є в бандлі. Порядок — за часом. */
const SLICES = [-500, -323, -100, 100, 400, 700, 900, 1000, 1100, 1200, 1279,
  1300, 1400, 1492, 1500, 1530, 1600, 1650, 1700, 1783, 1800];

export interface Realm {
  name: string;
  partOf: string | null;
  precision: number | null;   // 1 приблизний · 2 помірно точний · 3 за правом
  paths: string[];
}

/** Найближчий доступний зріз до року — не інтерполюємо. Атлас знає стан на
 *  свої дати, і вигадувати проміжні означало б підмінювати джерело. */
export function sliceFor(year: number): number {
  return SLICES.reduce((best, y) => (Math.abs(y - year) < Math.abs(best - year) ? y : best), SLICES[0]);
}

/** Власні контури — те, що джерела описують СЛОВАМИ, а атласи не дають геометрією.
 *
 *  ЗАВДАННЯ ЮРІЯ: показати ядро Русі (2026-07-29) і Скіфію — «скіфи були, а на
 *  мапі я їх не бачу». Атлас справді мовчить: на зрізі −500, в епоху Геродота,
 *  Північне Причорномор'я в ньому порожнє, скіфи зʼявляються аж на −100 і на
 *  схід від Каспію. Тому контур наш, за словесним описом джерела, і підписаний
 *  як приблизний — річки названі джерелом, лінія між ними проведена нами.
 *
 *  Показуємо ті, чий період накриває обраний зріз: Скіфія не має стояти на
 *  мапі XVII століття лише тому, що шар увімкнений.
 */
interface OwnLayer {
  id: string; label: string; from: number; to: number; tone: string;
  note: string; source: string; line?: boolean; outer?: boolean; group?: string;
  anchors: { name: string; lat: number; lon: number }[];
  ring: number[][];
}

/** Міста з історичного атласу — 2 220 точок, ширші за нашу бібліотеку.
 *
 *  ЗАДУМ ЮРІЯ (2026-07-29): «мапа — це надкнига, це наша більш загальна база
 *  знань зі своїми картками, питаннями, есеями, проєктами». Тобто показувати
 *  варто й ті міста, про які книга ще не говорить: можливо, заговорить.
 *
 *  Дата заснування є лише в 70 точках із 2 220 — тож фільтр за часом чесно
 *  застосовується тільки до них. Решта показується завжди: «дати не знаємо»
 *  і «міста тоді не було» — різні твердження, і плутати їх не можна.
 */
function usePlaces(on: boolean, year: number | null, projection: Projection, key: string) {
  return useQuery({
    queryKey: ["map", "places", key, year],
    enabled: on,
    staleTime: Infinity,
    queryFn: async () => {
      const data = (await import("./historical/places.json")).default as unknown as {
        places: { n: string; o?: string; x: number; y: number; s?: number; u?: number }[];
      };
      return data.places
        .filter((p) => {
          if (year === null) return true;
          if (p.s !== undefined && year < p.s) return false;   // ще не існувало
          if (p.u !== undefined && year > p.u) return false;    // вже не існувало
          return true;
        })
        .filter((p) => projection.visible(p.y, p.x))
        .map((p) => {
          const [x, y] = projection.toScreen(p.y, p.x);
          return { ...p, sx: x, sy: y, dated: p.s !== undefined };
        });
    }
  });
}

/** Річки. ЗАУВАГА ЮРІЯ (2026-07-29): «потрібно мати основні річки, тому що
 *  кордони і торгові шляхи — а вони на мапі взагалі відсутні». Для Русі це не
 *  оздоба: межі земель описані саме річками, і шлях із варягів у греки — теж
 *  річка з волоками. Без них мапа показує землі, яких ніщо не тримає. */
function useRivers(projection: Projection, key: string) {
  return useQuery({
    queryKey: ["map", "rivers", key],
    staleTime: Infinity,
    queryFn: async () => {
      const data = (await import("./historical/rivers.json")).default as unknown as {
        rivers: { n: string; big: boolean; label?: boolean; l: number[][] }[];
      };
      return data.rivers.map((r) => {
        let d = "";
        let pen = false;
        for (const [lon, lat] of r.l) {
          if (!projection.visible(lat, lon)) { pen = false; continue; }
          const [x, y] = projection.toScreen(lat, lon);
          d += `${pen ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
          pen = true;
        }
        const mid = r.l[Math.floor(r.l.length / 2)];
        return { ...r, d, labelAt: projection.visible(mid[1], mid[0]) ? projection.toScreen(mid[1], mid[0]) : null };
      }).filter((r) => r.d);
    }
  });
}

function useOwnLayers(on: boolean, year: number | null, projection: Projection, key: string) {
  return useQuery({
    queryKey: ["map", "own", key, year],
    enabled: on,
    staleTime: Infinity,
    queryFn: async () => {
      const data = (await import("./historical/own-layers.json")).default as unknown as { layers: OwnLayer[] };
      const at = year;
      return data.layers
        .filter((l) => at === null || (at >= l.from && at <= l.to))
        .map((l) => {
          let d = "";
          let pen = false;
          for (const [lon, lat] of l.ring) {
            if (!projection.visible(lat, lon)) { pen = false; continue; }
            const [x, y] = projection.toScreen(lat, lon);
            d += `${pen ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
            pen = true;
          }
          return {
            ...l,
            // Шлях — лінія, не область: замикати його означало б малювати
            // Балтику й Босфор одним берегом.
            path: d ? (l.line ? d : `${d}Z`) : "",
            points: l.anchors.filter((a) => projection.visible(a.lat, a.lon))
              .map((a) => ({ ...a, xy: projection.toScreen(a.lat, a.lon) })),
          };
        })
        .filter((l) => l.path);
    }
  });
}

function useRealms(year: number | null, projection: Projection, key: string) {
  const slice = year === null ? null : sliceFor(year);
  return useQuery({
    queryKey: ["map", "realms", slice, key],
    enabled: slice !== null,
    staleTime: Infinity,
    queryFn: async () => {
      // Кожен зріз — окремий чанк (~200 КБ): вантажиться той, що дивляться.
      const file = slice! < 0 ? `bc${-slice!}` : `${slice}`;
      const data = (await import(`./historical/${file}.json`)).default as unknown as {
        year: number;
        features: {
          geometry: { type: string; coordinates: number[][][] | number[][][][] };
          properties: { name: string | null; part_of: string | null; precision: number | null };
        }[];
      };
      const realms: Realm[] = [];
      for (const feature of data.features ?? []) {
        const polys = feature.geometry.type === "Polygon"
          ? [feature.geometry.coordinates as number[][][]]
          : (feature.geometry.coordinates as number[][][][]);
        const paths: string[] = [];
        for (const poly of polys) {
          for (const ring of poly) {
            if (!ring?.length) continue;
            let d = "";
            let pen = false;
            for (const [lon, lat] of ring) {
              if (!projection.visible(lat, lon)) { pen = false; continue; }
              const [x, y] = projection.toScreen(lat, lon);
              d += `${pen ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
              pen = true;
            }
            if (d) paths.push(`${d}Z`);
          }
        }
        if (paths.length && feature.properties.name) {
          realms.push({
            name: feature.properties.name,
            partOf: feature.properties.part_of,
            precision: feature.properties.precision,
            paths,
          });
        }
      }
      return { year: data.year, realms };
    }
  });
}

/** Передумова, що розкривається на місці. Всередині — така сама, тож ланцюг
 *  розкручується вглиб, не покидаючи стовпця й нічого не перекриваючи. */
function Entity({ name, opened, setOpened, onOpenDocument, depth = 0 }: {
  name: string; opened: string[]; setOpened: (fn: (s: string[]) => string[]) => void;
  onOpenDocument?: (id: string) => void; depth?: number;
}) {
  const isOpen = opened.includes(name);
  const card = useNamedCard(isOpen ? name : null);
  const toggle = () => setOpened((s) => (s.includes(name) ? s.filter((x) => x !== name) : [...s, name]));
  // Вікілінки в тілі передумови теж живі: клік розкриває наступну сутність
  // тим самим механізмом. Без цього кліки в розкритій картці були німі.
  const follow = (link: WikilinkTarget) => {
    const next = link.target.trim();
    if (next) setOpened((s) => (s.includes(next) ? s : [...s, next]));
  };
  return (
    <div className={`entity${isOpen ? " open" : ""}`} data-depth={depth}>
      <button type="button" className="entity-name" onClick={toggle}>
        <ChevronRight size={12} className="chev" /> {name}
      </button>
      {isOpen && card.data && !card.data.error ? (
        <div className="entity-body">
          {card.data.year ? <p className="when">{card.data.year}{card.data.year_end && card.data.year_end !== card.data.year ? `–${card.data.year_end}` : ""}</p> : null}

          {card.data.consequences ? (<><span className="eyebrow">ЧИМ ВАЖИТЬ</span><Prose content={card.data.consequences} onOpenDocument={onOpenDocument} /></>) : null}
          {depth < 2 && card.data.related.length ? (
            <div className="entity-related">
              {card.data.related.map((n) => (
                <Entity key={n} name={n} opened={opened} setOpened={setOpened} onOpenDocument={onOpenDocument} depth={depth + 1} />
              ))}
            </div>
          ) : null}
          {card.data.document_id ? (
            <button type="button" className="map-card-open" onClick={() => onOpenDocument?.(card.data!.document_id!)}>відкрити картку</button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function MapView({ onOpenDocument }: { onOpenDocument?: (id: string) => void }) {
  // Аркуш — той самий, що в Документах: клас і тон читаються з того ж
  // localStorage, тож перемикач лишається в одному місці (Юрій: «стиль аркуша
  // такий самий, як у документах, він міняється тільки там»). Власних кольорів
  // мапа не тримає — інакше з'явився б другий, розсинхронізований аркуш.
  const sheet = (() => {
    try {
      return {
        on: window.localStorage.getItem("wl_sheet_light") !== "0",
        tone: window.localStorage.getItem("wl_sheet_tone") ?? "sepia"
      };
    } catch { return { on: true, tone: "sepia" }; }
  })();
  const data = useMapData();
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
  // Панель показує або текст сюжету, або картку події — що відкрив останнім.
  const [openText, setOpenText] = useState<string | null>(null);
  const story = useStoryDoc(openText);
  // Передумови розгортаються ВБУДОВАНО, у тому самому стовпці (Юрій: «щоб це
  // був один стовпчик, передумови відкривались як вбудовані»). Стек плаваючих
  // панелей прибрано: він перекривав те, з чого починався.
  const [opened, setOpened] = useState<string[]>([]);
  const [hover, setHover] = useState<Place | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  // Висота полотна в одиницях viewBox — з реальної форми контейнера, щоб
  // мапа показувала більше географії, а не порожні поля.
  const [H, setH] = useState(620);
  // Режим показу: плоска карта з вибраним вікном або глобус, який обертається.
  const [frame, setFrame] = useState<Frame>("europe");
  const [globe, setGlobe] = useState(false);
  const [spin, setSpin] = useState({ lat: 40, lon: 30 });   // центр глобуса
  const projection = useMemo(
    () => (globe ? orthographic(spin.lat, spin.lon, H) : mercator(frame, H)),
    [globe, spin.lat, spin.lon, frame, H]);
  const projKey = globe ? `globe:${spin.lat}:${spin.lon}:${H}` : `flat:${frame}:${H}`;
  const land = useLand(projection, projKey);
  // Рік, на який показуємо кордони. Типово вимкнено: territorії — окремий
  // шар, а не тло, і читач вмикає його свідомо.
  const [year, setYear] = useState<number | null>(null);
  const [realm, setRealm] = useState<Realm | null>(null);
  // Утворення, чиї картки читач розкрив просто в панелі кордонів: територія
  // на мапі й розповідь про неї стають однією річчю, а не двома.
  const [realmCards, setRealmCards] = useState<string[]>([]);
  const coreLayer = useOwnLayers(year !== null, year, projection, projKey);
  const rivers = useRivers(projection, projKey);
  // Кожен шар вимикається окремо. ЗАУВАГА ЮРІЯ (2026-07-29): «мене цікавить
  // кожного разу якийсь окремий зріз або декілька зрізів, які я можу
  // комбінувати… коли воно все разом і не можна щось відімкнути — це не
  // робочий інструмент». Тримаємо ПРИХОВАНІ, а не показані: нові контури
  // зʼявляються самі, а вимкнене лишається вимкненим.
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const toggleLayer = (id: string) => setHidden((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  // Одна людина замість усіх: 98 підписаних імен разом — «розібрати неможливо».
  const [solo, setSolo] = useState<string | null>(null);
  const [folk, setFolk] = useState(false);
  const [towns, setTowns] = useState(false);
  const townLayer = usePlaces(towns, year, projection, projKey);
  const realms = useRealms(year, projection, projKey);
  const drag = useRef<{ px: number; py: number; x: number; y: number; spinLat: number; spinLon: number } | null>(null);
  const stage = useRef<HTMLDivElement | null>(null);
  // callback-ref, а не useEffect: на момент монтування вікно ще показує
  // LoadingState, вузла немає, і спостерігач нізащо не приєднається.
  const observer = useRef<ResizeObserver | null>(null);
  const attachStage = useCallback((node: HTMLDivElement | null) => {
    stage.current = node;
    observer.current?.disconnect();
    if (!node) return;
    const measure = () => {
      const box = node.getBoundingClientRect();
      if (box.width > 0) setH(Math.round((box.height / box.width) * W));
    };
    measure();
    observer.current = new ResizeObserver(measure);
    observer.current.observe(node);
  }, []);

  const places = useMemo(() => {
    const map = new Map<string, Place & { x: number; y: number; on: boolean }>();
    for (const p of data.data?.places ?? []) {
      const [x, y] = projection.toScreen(p.lat, p.lon);
      // `on` — чи точка на видимій півкулі: на глобусі половина світу за
      // обрієм, і малювати її означало б розпластати сферу.
      map.set(p.title, { ...p, x, y, on: projection.visible(p.lat, p.lon) });
    }
    return map;
  }, [data.data, projKey]);

  const stories = data.data?.stories ?? [];
  const bounds = useMemo(() => {
    const years = stories.flatMap((s) => [s.from, s.to]);
    return years.length ? ([Math.min(...years), Math.max(...years)] as const) : ([0, 0] as const);
  }, [stories]);

  // Сюжет входить у зріз, якщо його роки перетинаються з обраним періодом.
  const [lo, hi] = span ?? bounds;

  // Мапа відгукується на розкриту картку. ЗАДУМ ЮРІЯ (2026-07-29): «зробимо
  // реакцію мапи на відкриття карточок або на відкриття врізок». Фокус
  // приходить із Документів через localStorage: вкладки живуть окремо, і стан
  // має пережити перехід між ними.
  useEffect(() => {
    const react = (name: string | null) => {
      if (!name) return;
      const people = data.data?.people ?? [];
      const person = people.find((x) => x.title === name);
      if (person) {
        setFolk(true);
        setSolo(person.title);
        if (person.year !== null) setYear(sliceFor(person.year));
        return;
      }
      // Не людина — може, місце: підсвічуємо його як активну точку.
      const place = data.data?.places.find((x) => x.title === name);
      if (place) setHover({ ...place } as Place);
    };
    react(currentFocus());
    const onFocus = (e: Event) => react((e as CustomEvent<string | null>).detail);
    window.addEventListener(FOCUS_EVENT, onFocus);
    return () => window.removeEventListener(FOCUS_EVENT, onFocus);
  }, [data.data]);

  // Мапа йде за читанням. ЗАДУМ ЮРІЯ (2026-07-29): «мапа ілюструє текст, який
  // ми зараз бачимо, буквально: що зараз відкрито, те й відображено». Відкритий
  // розділ задає не лише підсвітку точок, а й епоху: кордони стрибають на зріз,
  // найближчий до середини його часу, а не лишаються від попереднього перегляду.
  useEffect(() => {
    const story = stories.find((s) => s.title === (openStory ?? active));
    if (!story) return;
    const middle = Math.round((story.from + (story.to || story.from)) / 2);
    setYear(sliceFor(middle));
    setSpan([story.from, story.to || story.from]);
    setSpanByStory(true);
  }, [openStory, active, stories]);

  // Імена, які вже підписало ядро: інакше на Києві, Чернігові й Переяславі
  // лежало б по два однакові написи один на одному (Юрій).
  const coreNames = useMemo(
    () => new Set((coreLayer.data ?? []).flatMap((l) => l.anchors.map((a) => a.name))),
    [coreLayer.data]);

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
  // Вага місця — скільки разів про нього говорить бібліотека: події сюжетів,
  // окремі події, маршрути людей. Це і є міра того, чи варте воно підпису.
  const weight = useMemo(() => {
    const w = new Map<string, number>();
    const bump = (name: string) => w.set(name, (w.get(name) ?? 0) + 1);
    for (const s of data.data?.stories ?? []) for (const e of s.events) e.route.forEach(bump);
    for (const e of data.data?.loose ?? []) e.route.forEach(bump);
    for (const person of data.data?.people ?? []) person.route.forEach(bump);
    return w;
  }, [data.data]);

  const named = useMemo(() => {
    const all = [...places.values()];
    if (focused) return new Set(all.filter((p) => focused.has(p.title)).map((p) => p.title));
    const taken = new Set<string>();
    const out = new Set<string>();
    // Сортуємо за ВАГОЮ, а не за довжиною назви. Довільний критерій лишав
    // Київ без підпису — найважливіша точка мапи програвала Ізюму, бо назви
    // однакової довжини, а порядок був випадковий (Юрій помітив на ядрі).
    for (const p of all.slice().sort((a, b) => (weight.get(b.title) ?? 0) - (weight.get(a.title) ?? 0)
                                               || a.title.length - b.title.length)) {
      const cell = `${Math.round((p.x * view.k) / 120)}:${Math.round((p.y * view.k) / 20)}`;
      if (taken.has(cell)) continue;
      taken.add(cell);
      out.add(p.title);
    }
    return out;
  }, [places, focused, view.k, weight]);

  // Місце під підписи розподіляється ЗАЗДАЛЕГІДЬ і в порядку ваги, а не в
  // порядку малювання: у SVG річки лежать під усім, тож у JSX вони йдуть
  // першими й забрали б місце в того, що читачеві важливіше.
  const labels = useMemo(() => {
    const space = new LabelSpace(view.k);
    const ok = { folk: new Set<string>(), points: new Set<string>(), rivers: new Set<string>(),
                 names: new Set<string>(), anchors: new Set<string>() };
    // Одне імʼя — один підпис на всю мапу. Київ буває якорем і ядра, і
    // Київського князівства, і точкою бібліотеки: три шари підписували його
    // тричі, і написи лягали один на одного (скріншот Юрія).
    const said = new Set<string>();
    const say = (name: string, x: number, y: number, size: number) => {
      if (said.has(name)) return false;
      if (!space.claim(x, y, name, size)) return false;
      said.add(name);
      return true;
    };
    // 1. Те, що читач щойно вибрав: спершу імʼя, тоді міста його маршруту.
    if (folk && solo) {
      const person = (data.data?.people ?? []).find((x) => x.title === solo);
      const first = (person?.route ?? []).map((n) => places.get(n)).find((x) => x?.on);
      if (person && first) {
        const label = person.title + (person.year !== null ? ` · ${yearText(person.year)}` : "");
        if (say(label, first.x + 5 / view.k, first.y - 7 / view.k, 10.5)) ok.names.add(person.title);
      }
      for (const name of person?.route ?? []) {
        const pt = places.get(name);
        if (pt?.on && say(name, pt.x + 5 / view.k, pt.y + 3 / view.k, 10)) ok.folk.add(name);
      }
    } else if (folk) {
      for (const person of data.data?.people ?? []) {
        const first = (person.route ?? []).map((n) => places.get(n)).find((x) => x?.on);
        if (!first) continue;
        const label = person.title + (person.year !== null ? ` · ${yearText(person.year)}` : "");
        if (say(label, first.x + 5 / view.k, first.y - 7 / view.k, 10.5)) ok.names.add(person.title);
      }
    }
    // 2. Підписи наших контурів — опорні міста ядра, Скіфії, князівств.
    for (const layer of coreLayer.data ?? []) {
      if (hidden.has(layer.id)) continue;
      for (const a of layer.points) {
        if (say(a.name, a.xy[0] + 5 / view.k, a.xy[1] - 4 / view.k, 11)) ok.anchors.add(a.name);
      }
    }
    // 3. Наші місця з підписами.
    for (const pt of places.values()) {
      if (!named.has(pt.title) || coreNames.has(pt.title) || !pt.on) continue;
      if (say(pt.title, pt.x + 9 / view.k, pt.y + 4 / view.k, 10.5)) ok.points.add(pt.title);
    }
    // 4. Річки — тло: беруть те, що лишилось.
    for (const r of rivers.data ?? []) {
      if (r.label && r.labelAt && say(r.n, r.labelAt[0], r.labelAt[1], 9.5)) ok.rivers.add(r.n);
    }
    return ok;
  }, [view.k, projKey, solo, folk, named, coreNames, places, rivers.data, data.data, coreLayer.data, hidden]);

  const shown = stories.filter((s) => !span || spanByStory || (s.to >= span[0] && s.from <= span[1]));
  const periods = data.data?.periods ?? [];
  const drawn = active ? shown.filter((s) => s.title === active) : shown;

  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    const box = stage.current?.getBoundingClientRect();
    if (!box) return;
    // Частка курсора в полотні — від неї рахуємо ТОЧКУ В ПОТОЧНОМУ КАДРІ.
    // Була помилка: точка бралася в сталих координатах (0…W), тож після
    // панорамування зум і далі тримався першої позиції, і мапа «блукала».
    const fx = (e.clientX - box.left) / box.width;
    const fy = (e.clientY - box.top) / box.height;
    setView((v) => {
      const k = Math.min(14, Math.max(1, v.k * (e.deltaY < 0 ? 1.18 : 1 / 1.18)));
      const px = v.x + fx * (W / v.k);      // куди дивиться курсор ЗАРАЗ
      const py = v.y + fy * (H / v.k);
      return {
        k,
        x: clamp(px - fx * (W / k), 0, Math.max(0, W - W / k)),
        y: clamp(py - fy * (H / k), 0, Math.max(0, H - H / k))
      };
    });
  };
  const onMove = (e: React.MouseEvent) => {
    const start = drag.current;                 // знімок ДО setView
    const box = stage.current?.getBoundingClientRect();
    if (!start || !box || !box.width || !box.height) return;
    // Глобус не панорамують — його обертають: перетягування міняє точку, з якої
    // дивимось, а не зсуває полотно. Широту тримаємо в межах полюсів.
    if (globe) {
      const dLon = ((e.clientX - start.px) / box.width) * 180;
      const dLat = ((e.clientY - start.py) / box.height) * 120;
      setSpin({
        lat: clamp(start.spinLat - dLat, -85, 85),
        lon: ((start.spinLon - dLon + 540) % 360) - 180,
      });
      return;
    }
    const dx = ((e.clientX - start.px) / box.width) * (W / view.k);
    const dy = ((e.clientY - start.py) / box.height) * (H / view.k);
    // Оновлювач стану виконується асинхронно: читати drag.current усередині
    // не можна — до того моменту миша вже відпущена й там null. Саме на цьому
    // мапа падала після зуму з панорамою.
    setView((v) => ({
      ...v,
      x: clamp(start.x - dx, 0, Math.max(0, W - W / v.k)),
      y: clamp(start.y - dy, 0, Math.max(0, H - H / v.k))
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
      x: clamp((minX + maxX) / 2 - W / k / 2, 0, Math.max(0, W - W / k)),
      y: clamp((minY + maxY) / 2 - H / k / 2, 0, Math.max(0, H - H / k))
    });
  }, [places, H]);

  /** Наблизити до точки — коли клікаєш реперну точку в правій колонці. */
  const focus = useCallback((name: string) => {
    const p = places.get(name);
    if (!p) return;
    const k = 5;
    setView({
      k,
      x: clamp(p.x - W / k / 2, 0, Math.max(0, W - W / k)),
      y: clamp(p.y - H / k / 2, 0, Math.max(0, H - H / k))
    });
  }, [places, H]);

  if (data.isError) return <ErrorState error={data.error as Error} onRetry={() => void data.refetch()} />;
  if (data.isLoading) return <LoadingState label="Збираємо сюжети й місця…" />;
  if (!places.size) return <EmptyState title="Місць із координатами немає">Картки в 30-Research/Places ще не мають координат — їх ставить фонова задача «гео».</EmptyState>;

  return (
    <div className="route route-map">
      <div className={`map-split${(openEvent && card.data) || (openText && story.data && !story.data.error) ? " with-card" : ""}`}>
        <div className="map-left">
          <details className="map-block map-look" open>
              <summary>Погляд <span className="cnt">{globe ? "глобус" : FRAMES[frame].label}</span></summary>
              <div className="map-frames">
                {Object.entries(FRAMES).map(([id, f]) => (
                  <button key={id} type="button" className={!globe && frame === id ? "on" : ""}
                          onClick={() => { setGlobe(false); setFrame(id as Frame); setView({ x: 0, y: 0, k: 1 }); }}>
                    {f.label}
                  </button>
                ))}
                <button type="button" className={globe ? "on globe" : "globe"}
                        title="Глобус: перетягуванням обертати"
                        onClick={() => { setGlobe(true); setView({ x: 0, y: 0, k: 1 }); }}>
                  Глобус
                </button>
                {globe ? (
                  <span className="map-frames-hint">
                    {Math.abs(spin.lat).toFixed(0)}°{spin.lat >= 0 ? "пн" : "пд"}{" "}
                    {Math.abs(spin.lon).toFixed(0)}°{spin.lon >= 0 ? "сх" : "зх"} · тягніть, щоб обертати
                  </span>
                ) : null}
              </div>
            </details>

        <div className="map-stage" ref={attachStage}>
          <svg viewBox={`${view.x} ${view.y} ${W / view.k} ${H / view.k}`} className="map-svg"
               role="img" aria-label="Мапа сюжетів"
               onWheel={onWheel} onMouseMove={onMove}
               onMouseDown={(e) => { drag.current = { px: e.clientX, py: e.clientY, x: view.x, y: view.y, spinLat: spin.lat, spinLon: spin.lon }; }}
               onMouseUp={() => { drag.current = null; }} onMouseLeave={() => { drag.current = null; }}>
            <defs>
              <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4"
                      markerWidth={5 / view.k} markerHeight={5 / view.k} orient="auto">
                <path d="M0 0 L8 4 L0 8 z" className="map-arrow" />
              </marker>
            </defs>

            {/* Сфера планети: без неї глобус читається як розсип уривків
                ліній, бо ортографія малює саму лише сушу видимої півкулі. */}
            {globe ? (
              <circle className="map-globe" cx={W / 2} cy={H / 2}
                      r={Math.min(W, H) * 0.46} style={{ strokeWidth: 1 / view.k }} />
            ) : null}

            <g className="map-land">
              {(land.data ?? []).map((d, i) => <path key={i} d={d} style={{ strokeWidth: 0.6 / view.k }} />)}
            </g>

            {/* Люди — лінія життя, не точка народження. Юрій: «не бачу на нашій
                мапі іменних посилань… я маю на увазі людей: Геродота, Володимира».
                Маршрут із `place:` картки: «Галікарнас → Самос → Афіни → Фурії». */}
            {folk ? (
              <g className="map-folk">
                {(data.data?.people ?? [])
                  .filter((p) => (solo ? p.title === solo : true))
                  .filter((p) => solo || !span || ((p.year ?? 0) <= span[1] && (p.year_end ?? p.year ?? 9999) >= span[0]))
                  .map((person) => {
                    const stops = person.route.map((n) => places.get(n)).filter(Boolean) as (Place & { x: number; y: number; on: boolean })[];
                    const seen = stops.filter((s) => s.on);
                    if (!seen.length) return null;
                    const line = seen.map((s, i) => `${i ? "L" : "M"}${s.x.toFixed(1)} ${s.y.toFixed(1)}`).join("");
                    const head = seen[0];
                    return (
                      <g key={person.path} onClick={() => person.document_id && onOpenDocument?.(person.document_id)}>
                        {seen.length > 1 ? <path d={line} style={{ strokeWidth: 1.1 / view.k }} /> : null}
                        {seen.map((s, i) => (
                          <circle key={i} cx={s.x} cy={s.y} r={2.4 / view.k} />
                        ))}
                        {/* У соло-режимі підписуємо самі МІСТА маршруту: на
                            точці Москви стояло імʼя князя й рік народження, і
                            з мапи не було видно навіть, що це Москва (Юрій). */}
                        {solo === person.title
                          ? seen.map((s, i) => (
                              labels.folk.has(s.title)
                                ? <text key={`n${i}`} x={s.x + 5 / view.k} y={s.y + 3 / view.k}
                                        style={{ fontSize: `${10 / view.k}px` }}>
                                    {s.title}
                                    {person.when?.[s.title]
                                      ? ` · ${whenLabel(person.when[s.title], person.year, person.year_end)}`
                                      : ""}
                                  </text>
                                : null
                            ))
                          : null}
                        {labels.names.has(person.title) ? (
                          <text x={head.x + 5 / view.k} y={head.y - 7 / view.k}
                                style={{ fontSize: `${10.5 / view.k}px` }}>
                            {person.title}
                            {person.year !== null
                              ? ` · ${yearText(person.year)}${person.year_end !== null ? `–${yearText(person.year_end)}` : ""}`
                              : ""}
                          </text>
                        ) : null}
                      </g>
                    );
                  })}
              </g>
            ) : null}

            {rivers.data ? (
              <g className="map-rivers">
                {rivers.data.map((r, i) => (
                  <g key={`${r.n}-${i}`} className={r.big ? "big" : ""}>
                    <path d={r.d} style={{ strokeWidth: (r.big ? 1.3 : 0.7) / view.k }} />
                    {r.label && r.labelAt && labels.rivers.has(r.n) ? (
                      <text x={r.labelAt[0]} y={r.labelAt[1]} style={{ fontSize: `${9.5 / view.k}px` }}>{r.n}</text>
                    ) : null}
                  </g>
                ))}
              </g>
            ) : null}

            {/* Міста атласу — тлом під нашими точками: дрібно, без підписів,
                бо їх дві тисячі. Наші місця лишаються яскравими, бо про них
                бібліотека має що сказати. */}
            {towns && townLayer.data ? (
              <g className="map-towns">
                {townLayer.data.map((p) => (
                  <circle key={`${p.n}-${p.x}-${p.y}`} cx={p.sx} cy={p.sy}
                          r={(p.dated ? 1.9 : 1.3) / view.k}
                          className={p.dated ? "dated" : ""}>
                    <title>{p.o ? `${p.n} (${p.o})` : p.n}{p.s !== undefined ? ` · від ${p.s < 0 ? -p.s + " до н.е." : p.s}` : ""}</title>
                  </circle>
                ))}
              </g>
            ) : null}

            {/* Ядро Русі — під історичними кордонами, щоб було видно, як
                приріст лягає навколо нього. */}
            {coreLayer.data?.length ? (
              <g className="map-core">
                {coreLayer.data.filter((l) => !hidden.has(l.id)).map((l) => (
                  <g key={l.id} className={`own-${l.tone}${l.line ? " is-route" : ""}${l.outer ? " is-outer" : ""}`}>
                    <path d={l.path} style={{ strokeWidth: (l.outer ? 2.2 : l.line ? 2 : 1.6) / view.k }} />
                    {l.points.map((a) => (
                      <g key={a.name}>
                        <circle cx={a.xy[0]} cy={a.xy[1]} r={3.2 / view.k} />
                        {labels.anchors.has(a.name) ? (
                          <text x={a.xy[0] + 5 / view.k} y={a.xy[1] - 4 / view.k}
                                style={{ fontSize: `${11 / view.k}px` }}>{a.name}</text>
                        ) : null}
                      </g>
                    ))}
                  </g>
                ))}
              </g>
            ) : null}

            {/* Історичні кордони. Штрих несе певність джерела, а не прикрашає:
                precision 1 — атлас сам каже «приблизно», і межа розмита; 3 —
                визначена правом, лінія суцільна. Так ілюстративність не стає
                вигадкою: видно і де межа, і наскільки наука в ній певна. */}
            {realms.data ? (
              <g className="map-realms">
                {realms.data.realms.map((realm) => (
                  <g key={realm.name} className={`realm p${realm.precision && realm.precision >= 1 ? realm.precision : 1}`}
                     onMouseEnter={() => setRealm(realm)} onMouseLeave={() => setRealm(null)}>
                    {realm.paths.map((d, i) => (
                      <path key={i} d={d} style={{ strokeWidth: 1.1 / view.k }} />
                    ))}
                  </g>
                ))}
              </g>
            ) : null}

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
                   onClick={() => p.document_id && onOpenDocument?.(p.document_id)} role="button" tabIndex={0}>
                  <circle cx={p.x} cy={p.y} r={(hover?.title === p.title ? 6 : 4) / view.k} />
                  {named.has(p.title) && !coreNames.has(p.title)
                   && labels.points.has(p.title) ? (
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


          {/* Простір під мапою, де живуть самі кордони: рік зрізу, що на ньому
              видно, і звідки це взято. Юрій: «під картою може бути простір, де
              зберігається вся ця інформація по роках, по об'єктах». */}
          {/* Панель шарів — блоками, від великого до малого. ЗАУВАГА ЮРІЯ
              (2026-07-29): «зараз це подається як єдине поле, і шукай там серед
              цього те, що тобі потрібно… треба робити блоки, які розкриваються».
              Кожен блок — окреме питання до мапи: коли, де, хто, чим сполучене.
              Згорнуті за замовчуванням, крім часу: з нього все починається. */}
          <div className="map-realms-bar">
            <details className="map-block" open>
              <summary>Час <span className="cnt">{year === null ? "без кордонів" : year < 0 ? `${-year} до н.е.` : year}</span></summary>
              <div className="map-realms-years">
                <button type="button" className={year === null ? "on" : ""}
                        onClick={() => { setYear(null); setRealm(null); }}>без кордонів</button>
                {SLICES.map((y) => (
                  <button key={y} type="button" className={year === y ? "on" : ""}
                          onClick={() => setYear(y)}>
                    {y < 0 ? `${-y} до н.е.` : y}
                  </button>
                ))}
              </div>
            </details>

            {coreLayer.data?.length ? (
              <details className="map-block" open>
                <summary>
                  Наші контури <span className="cnt">{coreLayer.data.filter((l) => !hidden.has(l.id)).length} з {coreLayer.data.length}</span>
                </summary>
                <div className="map-realms-list">
                  {Object.entries(
                    coreLayer.data.reduce((acc, l) => {
                      const key = l.group ?? "Окремі контури";
                      (acc[key] ??= []).push(l);
                      return acc;
                    }, {} as Record<string, typeof coreLayer.data>)
                  ).map(([group, items]) => (
                    <div key={group} className="map-subgroup">
                      {/* Кластер — вмикається цілим. ЗАДУМ ЮРІЯ (2026-07-29):
                          «хочу мати можливість включати-виключати обʼєднані в
                          кластери обʼєкти, а в рамках одного кластеру вибірково
                          вмикати чи вимикати». Заголовок групи керує всією
                          групою, чипи всередині — кожен собою. */}
                      <button type="button" className="map-cluster"
                              onClick={() => {
                                const ids = items.map((l) => l.id);
                                const allOn = ids.every((id) => !hidden.has(id));
                                setHidden((s) => {
                                  const next = new Set(s);
                                  ids.forEach((id) => (allOn ? next.add(id) : next.delete(id)));
                                  return next;
                                });
                              }}>
                        <span className="cluster-box">
                          {items.every((l) => !hidden.has(l.id)) ? "◼" : items.some((l) => !hidden.has(l.id)) ? "◧" : "◻"}
                        </span>
                        {group}
                        <span className="cluster-count">
                          {items.filter((l) => !hidden.has(l.id)).length}/{items.length}
                        </span>
                      </button>
                      {items.map((l) => (
                        <button key={l.id} type="button"
                                className={`realm-chip own${hidden.has(l.id) ? " off" : ""}`}
                                title={`${l.note}\n\nДжерело: ${l.source}\n\nКлік — сховати або показати`}
                                onClick={() => toggleLayer(l.id)}>
                          {l.label}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              </details>
            ) : null}

            {realms.data ? (
              <details className="map-block">
                <summary>Кордони з атласу <span className="cnt">{realms.data.realms.length}</span></summary>
                <div className="map-realms-list">
                  <span className="map-realms-note">
                    Штрих — певність межі за джерелом: суцільна лінія означає кордон,
                    визначений правом, розмита — приблизний. Дані:{" "}
                    <code>aourednik/historical-basemaps</code> (GPL-3.0).
                  </span>
                  {realms.data.realms
                    .slice()
                    .sort((a, b) => a.name.localeCompare(b.name, "uk-UA"))
                    .map((r) => (
                      <button key={r.name} type="button"
                              className={`realm-chip p${r.precision && r.precision >= 1 ? r.precision : 1}`
                                         + (realm?.name === r.name ? " on" : "")
                                         + (REALM_CARDS[r.name] ? " has-card" : "")}
                              title={REALM_CARDS[r.name] ? `Відкрити картку «${REALM_CARDS[r.name]}»` : undefined}
                              onMouseEnter={() => setRealm(r)} onMouseLeave={() => setRealm(null)}
                              onClick={() => {
                                const card = REALM_CARDS[r.name];
                                if (card) setRealmCards((s) => (s.includes(card) ? s.filter((x) => x !== card) : [...s, card]));
                              }}>
                        {r.name}
                        {REALM_CARDS[r.name] ? <span className="chip-card"> · {REALM_CARDS[r.name]}</span> : null}
                      </button>
                    ))}
                  {realmCards.length ? (
                    <div className="map-realms-cards">
                      {realmCards.map((name) => (
                        <Entity key={name} name={name} opened={opened} setOpened={setOpened}
                                onOpenDocument={onOpenDocument} />
                      ))}
                    </div>
                  ) : null}
                </div>
              </details>
            ) : null}

            <details className="map-block">
              <summary>
                Люди <span className="cnt">{folk ? (solo ? solo : `${(data.data?.people ?? []).length} на мапі`) : "вимкнено"}</span>
              </summary>
              <div className="map-folk-list">
                <button type="button" className={`folk-chip${folk ? " on" : ""}`}
                        onClick={() => { setFolk((v) => !v); setSolo(null); }}>
                  {folk ? "прибрати з мапи" : "показати на мапі"}
                </button>
                {folk ? (data.data?.people ?? [])
                  .slice()
                  .sort((a, b) => (a.year ?? 0) - (b.year ?? 0))
                  .map((person) => (
                    <button key={person.path} type="button"
                            className={`folk-chip${solo === person.title ? " on" : ""}`}
                            title={person.place_raw}
                            onClick={() => setSolo((s) => (s === person.title ? null : person.title))}>
                      {person.title}
                      {person.year !== null ? <span className="folk-year"> {yearText(person.year)}</span> : null}
                    </button>
                  )) : null}
              </div>
            </details>

            <details className="map-block">
              <summary>Географія <span className="cnt">річки · {towns ? "міста епохи" : "без міст"}</span></summary>
              <div className="map-frames">
                <button type="button" className={towns ? "on towns" : "towns"}
                        title="Міста з історичного атласу — ширше за нашу бібліотеку"
                        onClick={() => setTowns((v) => !v)}>
                  Міста епохи {towns && townLayer.data ? `· ${townLayer.data.length}` : ""}
                </button>
                <span className="map-frames-hint">
                  Річки показані завжди: по них ішли межі земель і торгові шляхи.
                </span>
              </div>
            </details>
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
                              if (open) { setOpenStory(null); setActive(null); setSpan(null); setSpanByStory(false); setOpenEvent(null); setOpenText(null); setView({ x: 0, y: 0, k: 1 }); }
                              else { setOpenStory(story.title); setActive(story.title); setOpenEvent(null); setOpenText(story.title); showStory(story); }
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
                                    onClick={() => { if (ev.route[0]) focus(ev.route[0]); setOpened([]); setOpenText(null); setOpenEvent(openEvent === ev.path ? null : ev.path); }}>
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
      {openText && story.data && !story.data.error ? (
        <aside className={`map-card${sheet.on ? " sheet-light" : ""}`} data-sheet-tone={sheet.on ? sheet.tone : undefined}>
          <header>
            <span className="eyebrow">{story.data.kind === "essay" ? "ЕСЕЙ" : story.data.kind === "episode" ? "ЕПІЗОД" : "РОЗДІЛ"}</span>
            <h2>{story.data.title}</h2>
            {story.data.document_id ? (
              <button type="button" className="map-card-open" onClick={() => onOpenDocument?.(story.data!.document_id!)}>відкрити документ</button>
            ) : null}
          </header>
          <Prose content={story.data.body} onOpenDocument={onOpenDocument} />
        </aside>
      ) : null}

      {openEvent && card.data ? (
        <aside className={`map-card${sheet.on ? " sheet-light" : ""}`} data-sheet-tone={sheet.on ? sheet.tone : undefined}>
          <header>
            <span className="eyebrow">ПОДІЯ</span>
            <h2>{card.data.title}</h2>
            <p className="when">
              {card.data.year}{card.data.year_end && card.data.year_end !== card.data.year ? `–${card.data.year_end}` : ""}
              {card.data.place ? ` · ${card.data.place.slice(0, 90)}` : ""}
            </p>
            {card.data.document_id ? <button type="button" className="map-card-open" onClick={() => onOpenDocument?.(card.data!.document_id!)}>відкрити картку</button> : null}
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
                  <p className="related">
                    {card.data!.related.map((name) => (
                      <Entity key={name} name={name} opened={opened} setOpened={setOpened} onOpenDocument={onOpenDocument} />
                    ))}
                  </p>
                ) : null}
              </section>
            ) : null;
          })()}

          {card.data.what ? (
            <section className="map-card-block">
              <span className="eyebrow">ЩО СТАЛОСЯ</span>
              <Prose content={card.data.what} onOpenDocument={onOpenDocument} />
            </section>
          ) : null}

          {card.data.consequences ? (
            <section className="map-card-block after">
              <span className="eyebrow">НАСЛІДКИ</span>
              <Prose content={card.data.consequences} onOpenDocument={onOpenDocument} />
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
