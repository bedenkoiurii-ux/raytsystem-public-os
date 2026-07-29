import type React from "react";
import { createContext, useContext, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getJson, postJson } from "../api";
import { SafeMarkdownView, type WikilinkTarget } from "./documents/SafeMarkdownView";

/** Розгортання сутності просто в тілі тексту — універсальний принцип системи.
 *
 *  ЗАДУМ ЮРІЯ (2026-07-28): «В тексті є "Острозький" — гарно було б при
 *  натисканні на нього прямо в тілі тексту розгортати додаткову картку.»
 *  Спершу зроблено в Мапі, тоді перенесено в Документи: читання не переривається
 *  переходом, довідка приходить до читача.
 *
 *  Порожнє посилання — не глухий кут, а замовлення: «сутність, якої в бібліотеці
 *  немає, — це привід дати поштовх нашим агентам шукати інформацію, перевіряти
 *  і додавати до бібліотеки». Кнопка кладе назву в посівний список конвеєра
 *  апарату й знімає сентинел, щоб той прокинувся сам. */
export interface EntityCard {
  title: string; kind: string; year: string; year_end: string; place: string;
  /** Хто це — перший абзац картки. Оповідь, а не хроніка. */
  lead: string;
  /** Чому ми це тут згадуємо — «Цінність для розповіді». */
  value: string;
  /** Чим сутність важить САМЕ в цьому документі — рядок із «Згадується в». */
  why: string;
  why_scope: string;
  what: string; consequences: string; related: string[];
  path: string; document_id: string | null;
  error?: string;
  /** Коли форма імені веде до кількох сутностей — вибір, а не вгадування. */
  choices?: { uid: string; title: string; path: string }[];
}

/** Словник форм для автопідсвітки. Один запит на сеанс — далі з кешу. */
export function useEntityForms(enabled: boolean) {
  return useQuery({
    queryKey: ["entity", "forms"],
    enabled,
    staleTime: Infinity,
    queryFn: () => getJson<{ forms: Record<string, string>; count: number }>("/api/v1/entities/forms")
  });
}

/** Позначити сутності в тексті, НЕ чіпаючи файл.
 *
 *  Юрій (2026-07-28): «кожного разу, коли згадується сутність, вона повинна
 *  мати вигляд гіперпосилання». Робимо це при читанні: у копію тексту
 *  вставляються `[[Назва|як стоїть у реченні]]`, файл лишається чистим.
 *
 *  Обережності, без яких вийшла б рябизна:
 *  · довші форми першими — «Флорентійська унія» перед «унія»;
 *  · те, що вже в [[…]], не чіпаємо, як і код, посилання й заголовки;
 *  · кожну сутність підсвічуємо ЛИШЕ доти, доки вона не стала суцільним
 *    рябінням: обмеження на повтори немає, бо саме цього Юрій і хотів. */
export function autolink(text: string, forms: Record<string, string>): string {
  const keys = Object.keys(forms);
  if (!keys.length) return text;
  const sorted = keys.sort((a, b) => b.length - a.length);
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(${sorted.map(escape).join("|")})(?![\\p{L}\\p{N}])`, "giu");

  // Ділимо на «недоторкані» шматки й решту: вже наявні вікілінки, код, URL,
  // рядки заголовків і frontmatter лишаються як є.
  const guard = /(\[\[[^\]]*\]\]|`[^`]*`|```[\s\S]*?```|\[[^\]]*\]\([^)]*\)|https?:\/\/\S+|^#{1,6} .*$)/gm;
  const parts = text.split(guard);
  return parts
    .map((piece, i) => {
      if (i % 2 === 1 || !piece) return piece;          // непарні — недоторкані
      return piece.replace(pattern, (match) => {
        const title = forms[match.toLowerCase()];
        if (!title) return match;
        return title === match ? `[[${match}]]` : `[[${title}|${match}]]`;
      });
    })
    .join("");
}

/** Документ, у якому стоїть посилання. Картка знає, чим вона важить у кожному
 *  документі окремо — без цього врізка показує цінність узагалі, писану під
 *  інший розділ. */
const CardScopeContext = createContext<string>("");
export const CardScope = CardScopeContext.Provider;

export function useNamedCard(name: string | null) {
  const scope = useContext(CardScopeContext);
  return useQuery({
    queryKey: ["entity", "card", name, scope],
    enabled: Boolean(name),
    staleTime: 60_000,
    queryFn: () => getJson<EntityCard>(
      `/api/v1/map/card?name=${encodeURIComponent(name ?? "")}`
      + (scope ? `&context=${encodeURIComponent(scope)}` : ""))
  });
}

function MissingCard({ name, onClose }: { name: string; onClose: () => void }) {
  const [state, setState] = useState<"idle" | "sending" | "queued" | "already">("idle");
  const order = () => {
    setState("sending");
    postJson<{ ok: boolean; already: boolean }>("/api/v1/map/request", { name })
      .then((r) => setState(r.already ? "already" : "queued"))
      .catch(() => setState("idle"));
  };
  return (
    <div className="inline-card missing">
      <header>
        <strong>{name}</strong>
        <button type="button" className="close" onClick={onClose} aria-label="Згорнути">×</button>
      </header>
      <p>Картки в бібліотеці немає.</p>
      {state === "queued" ? <p className="done">Замовлено — конвеєр апарату візьме її в роботу.</p>
        : state === "already" ? <p className="done">Уже в черзі.</p>
        : <button type="button" className="order" disabled={state === "sending"} onClick={order}>
            {state === "sending" ? "…" : "замовити картку"}
          </button>}
    </div>
  );
}

export function InlineCard({ name, onClose, onOpen, onOpenDocument, onOpenPanel }: {
  name: string;
  onClose: () => void;
  onOpen: (link: WikilinkTarget) => void;
  onOpenDocument?: (id: string) => void;
  /** Необовʼязково: відкрити ту саму сутність у peek-панелі (Документи). */
  onOpenPanel?: (id: string) => void;
}) {
  const card = useNamedCard(name);
  if (card.isLoading) return <div className="inline-card loading">{name}…</div>;
  if (card.data?.error === "ambiguous" && card.data.choices?.length) {
    // Індекс знає кілька сутностей під цим іменем — «Катинь» це і місце,
    // і розстріл. Вгадати тут гірше, ніж спитати.
    return (
      <div className="inline-card choose">
        <header>
          <strong>{name}</strong>
          <button type="button" className="close" onClick={onClose} aria-label="Згорнути">×</button>
        </header>
        <p>Це ім'я має кілька сутностей — котру відкрити?</p>
        <div className="inline-actions">
          {card.data.choices.map((c) => (
            <button key={c.uid} type="button" className="order"
                    onClick={() => onOpen({ target: c.title, label: c.title, heading: null, embed: false })}>
              {c.title}
            </button>
          ))}
        </div>
      </div>
    );
  }
  if (!card.data || card.data.error) return <MissingCard name={name} onClose={onClose} />;
  const data = card.data;
  return (
    <div className="inline-card">
      <header>
        <strong>{data.title}</strong>
        {data.year ? <span className="when">{data.year}{data.year_end && data.year_end !== data.year ? `–${data.year_end}` : ""}</span> : null}
        <button type="button" className="close" onClick={onClose} aria-label="Згорнути">×</button>
      </header>
      {data.lead ? <div className="aside-body"><SafeMarkdownView content={data.lead} onOpenWikilink={onOpen} /></div> : null}
      {data.value ? <div className="aside-body value"><SafeMarkdownView content={data.value} onOpenWikilink={onOpen} /></div> : null}
      {!data.lead && !data.value && data.what ? <div className="aside-body"><SafeMarkdownView content={data.what} onOpenWikilink={onOpen} /></div> : null}
      <div className="inline-actions">
        {data.document_id && onOpenPanel ? (
          <button type="button" className="map-card-open" onClick={() => onOpenPanel(data.document_id!)}>у панель</button>
        ) : null}
        {data.document_id ? (
          <button type="button" className="map-card-open" onClick={() => onOpenDocument?.(data.document_id!)}>відкрити картку</button>
        ) : null}
      </div>
    </div>
  );
}

/** Текст, у якому картка розкривається ПІД СВОЇМ АБЗАЦОМ.
 *
 *  Юрій (2026-07-28): «додатковий текст відкривається одразу після слова-
 *  посилання прямо в тілі основного, а згортається повторним натисканням
 *  на посилання або хрестиком».
 *
 *  Механіка проста навмисно: розбиваємо прозу на абзаци й рендеримо кожен
 *  окремо; картка йде після того абзацу, де посилання трапилось уперше.
 *  Без порталів і вимірювань DOM — вставка живе в самій розмітці тексту. */
export function Prose({ content, autoLink = true, onOpenWikilinkOverride, onOpenDocument, onOpenPanel, onOpenSource, onOpenRelativeLink, resolveImage }: {
  content: string;
  /** Підсвічувати сутності, яких автор не позначив руками. */
  autoLink?: boolean;
  /** Документи перехоплюють клік: там основна дія — картка в панелі, каскадом.
   *  Врізка лишається на ⌥-клік і там, де каскад безсилий. */
  onOpenWikilinkOverride?: (target: WikilinkTarget, event?: { altKey: boolean; node?: HTMLElement }) => void;
  onOpenDocument?: (id: string) => void;
  onOpenPanel?: (id: string) => void;
  onOpenSource?: () => void;
  onOpenRelativeLink?: (target: string) => void;
  resolveImage?: (target: string) => string | null;
}) {
  // Стан ВЛАСНИЙ у кожного шматка тексту: спільний на всі секції відкривав
  // врізку в кожному місці, де трапилось те саме слово («йосифлян» і в «Що
  // сталося», і в «Наслідках»). Розкривається там, де клікнув, — і тільки там.
  // Запис відкритого: «слово\u0000uid\u0000n», де n — ЯКЕ САМЕ входження слова
  // клікнули. Без нього врізка ставала на першому входженні: клік по «Острог»
  // у третьому абзаці відкривав довідку вгорі тексту (скарга Юрія).
  const [open, setOpen] = useState<string[]>([]);
  const host = useRef<HTMLDivElement | null>(null);

  // Запис у списку відкритих: «слово_в_тексті\u0000uid». Слово потрібне, щоб
  // знайти МІСЦЕ врізки в абзаці; uid — щоб показати саме ту сутність, коли
  // ім'я неоднозначне. Друга частина зʼявляється лише після вибору.
  const toggle = (link: WikilinkTarget, event?: { altKey?: boolean; node?: HTMLElement }) => {
    if (onOpenWikilinkOverride) { onOpenWikilinkOverride(link, { altKey: Boolean(event?.altKey), node: event?.node }); return; }
    const name = link.target.trim();
    if (!name) return;
    // Котре це входження: рахуємо серед посилань на ту саму ціль у DOM —
    // порядок у розмітці збігається з порядком у тексті.
    let nth = 0;
    if (event?.node && host.current) {
      // Рахуємо за ЦІЛЛЮ, не за текстом кнопки: «Київську» і «Києва» — різні
      // написання одного [[Київ]], і рахунок за написанням давав хибу (клік
      // у пʼятому абзаці відкривав довідку біля першого «Києва»).
      //
      // І тільки серед посилань САМОГО ТЕКСТУ: у розкритій врізці теж є
      // вікілінки, і вони зсували лічильник — клік по першому «Боголюбському»
      // відкривав врізку біля третього, бо дві попередні врізки додали в DOM
      // власні згадки тієї ж особи (скарга Юрія). Місце врізки шукається в
      // тексті, тож і рахувати треба лише те, що в тексті є.
      const inAside = event.node.closest(".inline-aside, .inline-card");
      const same = [...host.current.querySelectorAll<HTMLElement>(".doc-wikilink")]
        .filter((b) => b.dataset.target === event.node!.dataset.target
                       && !b.closest(".inline-aside, .inline-card"));
      // Клік із самої врізки місця в тексті не має — лишаємо перше входження.
      nth = inAside ? 0 : Math.max(0, same.indexOf(event.node));
    }
    const key = `${name}\u0000\u0000${nth}`;
    setOpen((s) => (s.some((x) => x.split("\u0000")[0] === name) ? s.filter((x) => x.split("\u0000")[0] !== name) : [...s, key]));
  };
  const pick = (word: string, uid: string) => setOpen((s) => s.map((x) => { const [w, , n] = x.split("\u0000"); return w === word ? `${w}\u0000${uid}\u0000${n ?? 0}` : x; }));
  const props = { onOpenRelativeLink, resolveImage };

  // Абзац розривається В МІСЦІ ПОСИЛАННЯ: текст до нього (разом зі словом),
  // тоді врізка, тоді решта абзацу. Юрій: «я хочу конкретно після слова мати
  // текст картки — можливо не в форматі картки, просто текст на фоні іншого
  // кольору». Тому це не картка, а врізка: без рамки, з лівою рискою.
  const forms = useEntityForms(autoLink);
  const prepared = autoLink && forms.data?.forms ? autolink(content, forms.data.forms) : content;
  const blocks = prepared.split(/\n{2,}/);
  const shown = new Set<string>();
  const pieces: React.ReactNode[] = [];
  // Лічильник входжень НАСКРІЗНИЙ по всьому тексту: у межах абзацу він давав
  // хибу — клік по другому «Острог» у третьому абзаці ставив врізку вгорі,
  // бо кожен абзац рахував із нуля.
  const seenCount = new Map<string, number>();

  blocks.forEach((block, bi) => {
    let rest = block;
    let guard = 0;
    while (guard++ < 12) {
      // Найближче входження будь-якого відкритого слова в залишку абзацу.
      const candidates = open
        .filter((entry) => !shown.has(entry))
        .map((entry) => {
          const word = entry.split("\u0000")[0];
          const at = rest.search(new RegExp(`\\[\\[${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\||\\]\\])`));
          return { entry, word, at };
        })
        .filter((x) => x.at >= 0)
        .sort((a, b) => a.at - b.at);
      if (!candidates.length) break;
      const hit = candidates[0];
      const wanted = Number(hit.entry.split("\u0000")[2] ?? 0);
      const passed = seenCount.get(hit.word) ?? 0;
      const close = rest.indexOf("]]", hit.at);
      const head = rest.slice(0, close + 2);
      seenCount.set(hit.word, passed + 1);

      if (passed < wanted) {
        // Це не те входження, яке клікнули — просто відрендерити й іти далі.
        rest = rest.slice(close + 2);
        pieces.push(<SafeMarkdownView key={`${bi}-s-${passed}-${hit.word}`} content={head} onOpenWikilink={toggle}
                                      onOpenSource={bi === 0 && !pieces.length ? onOpenSource : undefined} {...props} />);
        continue;
      }
      rest = rest.slice(close + 2);
      shown.add(hit.entry);
      pieces.push(
        <SafeMarkdownView key={`${bi}-h-${hit.entry}`} content={head} onOpenWikilink={toggle}
                          onOpenSource={bi === 0 && !pieces.length ? onOpenSource : undefined} {...props} />
      );
      pieces.push(<Aside key={`${bi}-a-${hit.entry}`} entry={hit.entry} onOpen={toggle} onPick={pick}
                         onOpenDocument={onOpenDocument} onOpenPanel={onOpenPanel}
                         onClose={() => setOpen((s) => s.filter((x) => x !== hit.entry))} />);
    }
    if (rest.trim()) {
      pieces.push(
        <SafeMarkdownView key={`${bi}-t`} content={rest} onOpenWikilink={toggle}
                          onOpenSource={bi === 0 && !pieces.length ? onOpenSource : undefined} {...props} />
      );
    }
  });

  const orphans = open.filter((name) => !shown.has(name));
  // Один контейнер на весь текст: обгортка на кожен фрагмент подвоювала
  // відступи, і текст розсипався на купу абзаців (Юрій: «текст повинен
  // залишатись текстом»).
  return (
    <div className="safe-markdown prose" ref={host}>
      {pieces}
      {orphans.map((entry) => (
        <Aside key={`o-${entry}`} entry={entry} onOpen={toggle} onPick={pick} onOpenDocument={onOpenDocument} onOpenPanel={onOpenPanel}
               onClose={() => setOpen((s) => s.filter((x) => x !== entry))} />
      ))}
    </div>
  );
}

/** Врізка — довідка просто в потоці читання. Не картка: без рамки, з рискою
 *  й іншим тлом, щоб око бачило вставку, а не окремий обʼєкт. */
function Aside({ entry, onClose, onOpen, onPick, onOpenDocument, onOpenPanel }: {
  entry: string; onClose: () => void; onOpen: (l: WikilinkTarget) => void;
  onPick: (word: string, uid: string) => void;
  onOpenDocument?: (id: string) => void; onOpenPanel?: (id: string) => void;
}) {
  const [word, uid] = entry.split("\u0000");
  const name = uid ? `uid:${uid}` : word;
  const card = useNamedCard(name);
  if (card.isLoading) return <span className="inline-aside loading">{word}…</span>;
  if (card.data?.error === "ambiguous" && card.data.choices?.length) {
    return (
      <span className="inline-aside choose">
        <b className="aside-name">{word} — </b>
        <span className="aside-q">котру сутність?</span>
        {card.data.choices.map((c) => (
          <button key={c.uid} type="button" onClick={() => onPick(word, c.uid)}>{c.title}</button>
        ))}
        <button type="button" onClick={onClose}>згорнути</button>
      </span>
    );
  }
  if (!card.data || card.data.error) return <MissingAside name={word} onClose={onClose} />;
  const data = card.data;
  // Не картка, а продовження тексту: назва інлайном на початку, дії — дрібним
  // текстом у кінці. Юрій: «зроби це як продовження тексту, а не як картка
  // всередині тексту».
  return (
    <span className="inline-aside">
      <b className="aside-name">
        {data.title}{data.year ? ` · ${data.year}${data.year_end && data.year_end !== data.year ? `–${data.year_end}` : ""}` : ""} —{" "}
      </b>
      {data.lead ? <SafeMarkdownView content={data.lead} onOpenWikilink={onOpen} /> : null}
      {/* «Чому тут» сильніше за «цінність узагалі»: цінність написана під той
          розділ, де сутність є вершиною, і в іншому місці читається як чуже
          твердження. Коли прив'язки до цього документа нема — не підставляємо
          чужу натомість, вистачить характеристики. */}
      {data.why || data.value ? (
        <span className="aside-value">
          <SafeMarkdownView content={data.why || data.value} onOpenWikilink={onOpen} />
        </span>
      ) : null}
      {!data.lead && !data.value && data.what ? <SafeMarkdownView content={data.what} onOpenWikilink={onOpen} /> : null}
      <span className="aside-tail">
        {data.document_id && onOpenPanel ? <button type="button" onClick={() => onOpenPanel(data.document_id!)}>у панель</button> : null}
        {data.document_id ? <button type="button" onClick={() => onOpenDocument?.(data.document_id!)}>відкрити картку</button> : null}
        <button type="button" onClick={onClose}>згорнути</button>
      </span>
    </span>
  );
}

function MissingAside({ name, onClose }: { name: string; onClose: () => void }) {
  const [state, setState] = useState<"idle" | "sending" | "queued" | "already">("idle");
  return (
    <span className="inline-aside missing">
      <b className="aside-name">{name} — </b>
      <span className="aside-q">картки в бібліотеці немає.</span>
      {state === "queued" ? <span className="done">замовлено — конвеєр візьме в роботу</span>
        : state === "already" ? <span className="done">уже в черзі</span>
        : <button type="button" disabled={state === "sending"} onClick={() => {
            setState("sending");
            postJson<{ ok: boolean; already: boolean }>("/api/v1/map/request", { name })
              .then((r) => setState(r.already ? "already" : "queued")).catch(() => setState("idle"));
          }}>{state === "sending" ? "…" : "замовити картку"}</button>}
      <button type="button" onClick={onClose}>згорнути</button>
    </span>
  );
}

/** Стек розгорнутих сутностей під текстом. Порядок — як відкривали. */
export function InlineStack({ names, setNames, onOpenDocument, onOpenPanel }: {
  names: string[];
  setNames: (fn: (s: string[]) => string[]) => void;
  onOpenDocument?: (id: string) => void;
  onOpenPanel?: (id: string) => void;
}) {
  if (!names.length) return null;
  const open = (link: WikilinkTarget) => {
    const next = link.target.trim();
    setNames((s) => (s.includes(next) ? s : [...s, next]));
  };
  return (
    <div className="map-inline">
      {names.map((name) => (
        <InlineCard key={name} name={name} onOpen={open} onOpenDocument={onOpenDocument} onOpenPanel={onOpenPanel}
                    onClose={() => setNames((s) => s.filter((x) => x !== name))} />
      ))}
    </div>
  );
}
