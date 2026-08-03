import { Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Dialog } from "../../components/Dialog";
import { getJson, postJson } from "../../api";

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
  const [term, setTerm] = useState(request.term);
  const [known, setKnown] = useState<Known | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <Dialog className="doc-dialog-shell" onClose={onClose} labelledBy="entity-order-title">
      <div className="doc-dialog">
        <header>
          <h2 id="entity-order-title"><Sparkles size={17} aria-hidden="true" /> У сутності</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Закрити"><X size={16} /></button>
        </header>

        <label className="doc-field">
          <span>Термін</span>
          <input value={term} onChange={(event) => setTerm(event.target.value)} autoFocus />
        </label>

        <p className="doc-hint">
          З документа <code>{request.document}</code>. Текст документа не змінюється —
          замовлення тримається на шляху й цитаті.
        </p>
        {request.context ? <blockquote className="doc-quote">{request.context}</blockquote> : null}

        {matches.length ? (
          <section className="doc-known">
            <strong>Схоже, вже є</strong>
            <ul>
              {matches.map((card) => (
                <li key={card.uid}>
                  <span>{card.title}</span>
                  <button type="button" className="text-button" disabled={pending} onClick={() => alias(card)}>
                    це alias наявної
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : known ? (
          <p className="doc-hint">Бібліотека такого не знає — це справді нова сутність.</p>
        ) : null}

        {error ? <p className="doc-error" role="alert">{error}</p> : null}

        <footer>
          <button type="button" className="text-button" onClick={onClose}>Скасувати</button>
          <button type="button" className="primary-button" disabled={pending || term.trim().length < 2} onClick={order}>
            Нова сутність
          </button>
        </footer>
      </div>
    </Dialog>
  );
}
