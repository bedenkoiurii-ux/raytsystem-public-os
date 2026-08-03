import { Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "../../components/Dialog";
import { getJson, postJson } from "../../api";
import { cleanTerm } from "./entityTerm";

/** Що бібліотека вже знає про це слово — щоб не плодити другу картку тому,
 *  що термін стоїть у відмінку або під псевдонімом. */
interface Known {
  exact: { uid: string; title: string; path: string }[];
  similar: { uid: string; title: string; path: string }[];
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
export function EntityOrderDialog({ request, onClose, onDone }: {
  request: EntityOrderRequest;
  onClose: () => void;
  onDone: (message: string) => void;
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

  const matches = [...(known?.exact ?? []), ...(known?.similar ?? [])];

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

        {matches.length ? (
          <section className="doc-entity-known">
            <strong>Схоже, вже є</strong>
            <ul>
              {matches.map((card) => (
                <li key={card.uid}>
                  <span>{card.title}</span>
                  <button type="button" disabled={pending} onClick={() => alias(card)}>
                    це alias наявної
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : known ? (
          <p className="doc-entity-hint">Бібліотека такого не знає — це справді нова сутність.</p>
        ) : null}

        {error ? <p className="doc-entity-error" role="alert">{error}</p> : null}

        <footer>
          <button type="button" onClick={onClose} disabled={pending}>Скасувати</button>
          <button type="submit" className="primary" disabled={pending || term.trim().length < 2}>
            Нова сутність
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
