import type React from "react";
import { useState } from "react";
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
  what: string; consequences: string; related: string[];
  path: string; document_id: string | null;
  error?: string;
  /** Коли форма імені веде до кількох сутностей — вибір, а не вгадування. */
  choices?: { uid: string; title: string; path: string }[];
}

export function useNamedCard(name: string | null) {
  return useQuery({
    queryKey: ["entity", "card", name],
    enabled: Boolean(name),
    staleTime: 60_000,
    queryFn: () => getJson<EntityCard>(`/api/v1/map/card?name=${encodeURIComponent(name ?? "")}`)
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
      {data.what ? <div className="aside-body"><SafeMarkdownView content={data.what} onOpenWikilink={onOpen} /></div> : null}
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
export function Prose({ content, open, setOpen, onOpenDocument, onOpenPanel, onOpenSource, onOpenRelativeLink, resolveImage }: {
  content: string;
  open: string[];
  setOpen: (fn: (s: string[]) => string[]) => void;
  onOpenDocument?: (id: string) => void;
  onOpenPanel?: (id: string) => void;
  onOpenSource?: () => void;
  onOpenRelativeLink?: (target: string) => void;
  resolveImage?: (target: string) => string | null;
}) {
  // Запис у списку відкритих: «слово_в_тексті\u0000uid». Слово потрібне, щоб
  // знайти МІСЦЕ врізки в абзаці; uid — щоб показати саме ту сутність, коли
  // ім'я неоднозначне. Друга частина зʼявляється лише після вибору.
  const toggle = (link: WikilinkTarget) => {
    const name = link.target.trim();
    if (!name) return;
    setOpen((s) => (s.some((x) => x.split("\u0000")[0] === name) ? s.filter((x) => x.split("\u0000")[0] !== name) : [...s, name]));
  };
  const pick = (word: string, uid: string) => setOpen((s) => s.map((x) => (x.split("\u0000")[0] === word ? `${word}\u0000${uid}` : x)));
  const props = { onOpenRelativeLink, resolveImage };

  // Абзац розривається В МІСЦІ ПОСИЛАННЯ: текст до нього (разом зі словом),
  // тоді врізка, тоді решта абзацу. Юрій: «я хочу конкретно після слова мати
  // текст картки — можливо не в форматі картки, просто текст на фоні іншого
  // кольору». Тому це не картка, а врізка: без рамки, з лівою рискою.
  const blocks = content.split(/\n{2,}/);
  const shown = new Set<string>();
  const pieces: React.ReactNode[] = [];

  blocks.forEach((block, bi) => {
    let rest = block;
    let guard = 0;
    while (guard++ < 8) {
      const hit = open
        .filter((entry) => !shown.has(entry))
        .map((entry) => ({ entry, word: entry.split("\u0000")[0] }))
        .map(({ entry, word }) => ({ name: entry, at: rest.search(new RegExp(`\\[\\[${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\||\\]\\])`)) }))
        .filter((x) => x.at >= 0)
        .sort((a, b) => a.at - b.at)[0];
      if (!hit) break;
      const close = rest.indexOf("]]", hit.at);
      const head = rest.slice(0, close + 2);
      rest = rest.slice(close + 2);
      shown.add(hit.name);
      pieces.push(
        <SafeMarkdownView key={`${bi}-h-${hit.name}`} content={head} onOpenWikilink={toggle}
                          onOpenSource={bi === 0 ? onOpenSource : undefined} {...props} />
      );
      pieces.push(<Aside key={`${bi}-a-${hit.name}`} entry={hit.name} onOpen={toggle} onPick={pick}
                         onOpenDocument={onOpenDocument} onOpenPanel={onOpenPanel}
                         onClose={() => setOpen((s) => s.filter((x) => x !== hit.name))} />);
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
    <div className="safe-markdown prose">
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
  if (card.isLoading) return <div className="inline-aside loading">{word}…</div>;
  if (card.data?.error === "ambiguous" && card.data.choices?.length) {
    return (
      <div className="inline-aside choose">
        <span className="aside-name">{word}</span>
        <span className="aside-q">котру сутність відкрити?</span>
        {card.data.choices.map((c) => (
          <button key={c.uid} type="button" onClick={() => onPick(word, c.uid)}>{c.title}</button>
        ))}
        <button type="button" className="close" onClick={onClose} aria-label="Згорнути">×</button>
      </div>
    );
  }
  if (!card.data || card.data.error) return <MissingAside name={word} onClose={onClose} />;
  const data = card.data;
  return (
    <div className="inline-aside">
      <button type="button" className="close" onClick={onClose} aria-label="Згорнути">×</button>
      <span className="aside-name">
        {data.title}{data.year ? ` · ${data.year}${data.year_end && data.year_end !== data.year ? `–${data.year_end}` : ""}` : ""}
      </span>
      {data.what ? <div className="aside-body"><SafeMarkdownView content={data.what} onOpenWikilink={onOpen} /></div> : null}
      <div className="aside-actions">
        {data.document_id && onOpenPanel ? <button type="button" onClick={() => onOpenPanel(data.document_id!)}>у панель</button> : null}
        {data.document_id ? <button type="button" onClick={() => onOpenDocument?.(data.document_id!)}>відкрити картку</button> : null}
      </div>
    </div>
  );
}

function MissingAside({ name, onClose }: { name: string; onClose: () => void }) {
  const [state, setState] = useState<"idle" | "sending" | "queued" | "already">("idle");
  return (
    <div className="inline-aside missing">
      <button type="button" className="close" onClick={onClose} aria-label="Згорнути">×</button>
      <span className="aside-name">{name}</span>
      <span className="aside-q">картки в бібліотеці немає</span>
      {state === "queued" ? <span className="done">замовлено — конвеєр візьме в роботу</span>
        : state === "already" ? <span className="done">уже в черзі</span>
        : <button type="button" disabled={state === "sending"} onClick={() => {
            setState("sending");
            postJson<{ ok: boolean; already: boolean }>("/api/v1/map/request", { name })
              .then((r) => setState(r.already ? "already" : "queued")).catch(() => setState("idle"));
          }}>{state === "sending" ? "…" : "замовити картку"}</button>}
    </div>
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
