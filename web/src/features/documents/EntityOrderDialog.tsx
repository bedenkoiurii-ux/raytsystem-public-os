import { Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "../../components/Dialog";
import { getJson, postJson } from "../../api";
import { cleanTerm } from "./entityTerm";

/** Що бібліотека вже знає про це слово — щоб не плодити другу картку тому,
 *  що термін стоїть у відмінку або під псевдонімом. */
interface Card { uid: string; title: string; path: string }
/** Три рубежі зіставлення: точна форма · відмінок · здогад. Див. `entity_match`. */
interface Known {
  exact: Card[];
  inflected: Card[];
  fuzzy: Card[];
}

export interface EntityOrderRequest {
  term: string;
  document: string;
  context: string;
}

/**
 * «У сутності» — замовлення картки з виділення в читанні.
 *
 * Діалог мінімальний навмисно (рішення Юрія 2026-08-03): термін, який можна
 * поправити, і блок «схоже вже є». Дві дії, і вони різного роду:
 *
 *   нова сутність   → рядок у реєстрі замовлень, далі конвеєр `karty`;
 *   це alias наявної → пропозиція в Приймальню, бо правка чужої картки
 *                      мусить іти воротами, а не з вікна читання.
 *
 * Документ-джерело не редагується ні в тому, ні в тому випадку.
 */
export function EntityOrderDialog({ request, onClose, onDone, onOpenCard }: {
  request: EntityOrderRequest;
  onClose: () => void;
  onDone: (message: string) => void;
  /** Відкрити наявну картку — коли виявилось, що сутність уже є. */
  onOpenCard?: (path: string) => void;
}) {
  // Очищення на вході, не на виході: людина бачить готову назву й може її
  // виправити. Оригінал виділення лишається в цитаті-контексті реєстру.
  const [term, setTerm] = useState(() => cleanTerm(request.term));
  const [known, setKnown] = useState<Known | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement | null>(null);

  // Висота поля = висота вмісту. Спершу `auto`, інакше `scrollHeight` міряв би
  // від уже роздутої висоти й поле росло б лише в один бік.
  useEffect(() => {
    const node = field.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${node.scrollHeight}px`;
  }, [term]);

  useEffect(() => {
    let alive = true;
    const handle = window.setTimeout(() => {
      getJson<Known>(`/api/v1/entities/known?term=${encodeURIComponent(term)}`)
        .then((data) => { if (alive) setKnown(data); })
        .catch(() => { if (alive) setKnown(null); });
    }, 250);
    return () => { alive = false; window.clearTimeout(handle); };
  }, [term]);

  const send = async (path: string, body: unknown, message: string) => {
    setPending(true);
    setError(null);
    try {
      await postJson(path, body);
      onDone(message);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося записати замовлення.");
    } finally {
      setPending(false);
    }
  };

  const order = () => send("/api/v1/entity-orders",
    { term: term.trim(), document: request.document, context: request.context },
    `Замовлено: ${term.trim()}`);

  const alias = (card: { title: string; path: string }) => send("/api/v1/entity-orders/alias",
    { term: term.trim(), card_path: card.path, card_title: card.title,
      document: request.document, context: request.context },
    `Пропозиція alias у Приймальні: ${card.title}`);

  // Певне окремо від здогаду: точна форма й відмінок — це та сама сутність,
  // нечіткий ключ — лише «можливо». Змішати їх означало б видати здогад за факт.
  const certain = [...(known?.exact ?? []), ...(known?.inflected ?? [])];
  const guesses = known?.fuzzy ?? [];
  // Чи бібліотека взагалі щось знайшла — лише для підпису, НЕ для заборони.
  const nothingFound = Boolean(known) && certain.length === 0 && guesses.length === 0;

  return (
    <Dialog className="doc-action-dialog doc-entity-dialog" backdropClassName="doc-modal-backdrop"
            labelledBy="entity-order-title" busy={pending} onClose={onClose}>
      <header>
        <Sparkles size={20} aria-hidden="true" />
        <h2 id="entity-order-title">У сутності</h2>
        <button type="button" onClick={onClose} disabled={pending} aria-label="Закрити"><X size={18} /></button>
      </header>

      <form onSubmit={(event) => { event.preventDefault(); order(); }}>
        <label>
          <span>Термін</span>
          {/* Багаторядкове поле, що росте під вміст: довга назва мусить бути
              видима цілком. Внутрішнього скролу немає навмисно — обрізаного
              терміна не видно, а невидиме не перевіриш.
              Enter відправляє, Shift+Enter дає новий рядок. */}
          <textarea
            ref={field}
            className="doc-term-input"
            rows={1}
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (term.trim().length >= 2 && !pending) order();
              }
            }}
            autoFocus
          />
        </label>

        <p className="doc-entity-hint">
          З документа <code>{request.document}</code>. Текст документа не змінюється —
          замовлення тримається на шляху й цитаті.
        </p>
        {request.context ? <blockquote className="doc-entity-quote">{request.context}</blockquote> : null}

        {certain.length ? (
          <section className="doc-entity-known">
            <strong>Схоже, вже є</strong>
            <ul>
              {certain.map((card) => (
                <li key={card.uid}>
                  {/* Канонічна назва картки, а не те, що виділили: людина має
                      бачити, під яким іменем сутність живе в бібліотеці. */}
                  <span>{card.title}</span>
                  <span className="doc-entity-actions">
                    {onOpenCard ? (
                      <button type="button" disabled={pending} onClick={() => { onOpenCard(card.path); onClose(); }}>
                        відкрити картку
                      </button>
                    ) : null}
                    <button type="button" disabled={pending} onClick={() => alias(card)}>
                      додати форму як alias
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {guesses.length ? (
          <section className="doc-entity-known doc-entity-guess">
            <strong>Можливо, це</strong>
            <ul>
              {guesses.map((card) => (
                <li key={card.uid}>
                  <span>{card.title}</span>
                  <span className="doc-entity-actions">
                    {onOpenCard ? (
                      <button type="button" disabled={pending} onClick={() => { onOpenCard(card.path); onClose(); }}>
                        відкрити картку
                      </button>
                    ) : null}
                    <button type="button" disabled={pending} onClick={() => alias(card)}>
                      додати форму як alias
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {nothingFound ? (
          <p className="doc-entity-hint">Бібліотека такого не знає — це справді нова сутність.</p>
        ) : null}
        {!nothingFound && (certain.length > 0 || guesses.length > 0) ? (
          <p className="doc-entity-hint">
            Це підказка, не заборона: якщо ваш термін — інша сутність (омонім), заводьте нову.
          </p>
        ) : null}

        {error ? <p className="doc-entity-error" role="alert">{error}</p> : null}

        <footer>
          <button type="button" onClick={onClose} disabled={pending}>Скасувати</button>
          {/* «Нова сутність» доступна ЗАВЖДИ (рішення Юрія 2026-08-03).
              Перевірка на дублікат — підказка, а не брама: омоніми існують, і
              система не має права вирішувати за автора. Юрій не зміг завести
              поняття «максима», бо форма «максима» лежить в індексі як родовий
              відмінок митрополита Максима — і кнопка була згашена. */}
          <button type="submit" className="primary" disabled={pending || term.trim().length < 2}>
            Нова сутність
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
