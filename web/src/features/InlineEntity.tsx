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
      {data.what ? <div className="safe-markdown"><SafeMarkdownView content={data.what} onOpenWikilink={onOpen} /></div> : null}
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
  /** Прокидаємо решту можливостей рендерера — у документі є зображення,
   *  відносні посилання й перехід у Source. */
  onOpenSource?: () => void;
  onOpenRelativeLink?: (target: string) => void;
  resolveImage?: (target: string) => string | null;
}) {
  const toggle = (link: WikilinkTarget) => {
    const name = link.target.trim();
    if (!name) return;
    // Повторний клік по тому самому посиланню згортає — як і хрестик.
    setOpen((s) => (s.includes(name) ? s.filter((x) => x !== name) : [...s, name]));
  };
  const blocks = content.split(/\n{2,}/);
  const shown = new Set<string>();
  return (
    <>
      {blocks.map((block, i) => {
        const here = open.filter((name) => !shown.has(name) && block.includes(`[[${name}`));
        here.forEach((name) => shown.add(name));
        return (
          <div key={i} className="prose-block">
            <div className="safe-markdown"><SafeMarkdownView content={block} onOpenWikilink={toggle} onOpenSource={i === 0 ? onOpenSource : undefined} onOpenRelativeLink={onOpenRelativeLink} resolveImage={resolveImage} /></div>
            {here.length ? (
              <div className="map-inline">
                {here.map((name) => (
                  <InlineCard key={name} name={name} onOpen={toggle} onOpenDocument={onOpenDocument} onOpenPanel={onOpenPanel}
                              onClose={() => setOpen((s) => s.filter((x) => x !== name))} />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
      {/* Те, що відкрили не з цього тексту (вибір із неоднозначності) — у кінці. */}
      {open.some((name) => !shown.has(name)) ? (
        <div className="map-inline">
          {open.filter((name) => !shown.has(name)).map((name) => (
            <InlineCard key={name} name={name} onOpen={toggle} onOpenDocument={onOpenDocument} onOpenPanel={onOpenPanel}
                        onClose={() => setOpen((s) => s.filter((x) => x !== name))} />
          ))}
        </div>
      ) : null}
    </>
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
