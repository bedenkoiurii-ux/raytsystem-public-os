import { Check, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "../components/StatePanel";
import { postJson } from "../api";

/** Приймальня — черга матеріалів на входження в бібліотеку.
 *  Варта інбоксу кладе пропозиції в 00-Inbox/Пропозиції зі `status: proposed`.
 *  Тут Юрій виносить резолюцію: прийняти · доопрацювати (з поясненням) · відхилити.
 *  Далі конвеєр (НАКАЗ-інбоксу) виконує рішення. Нічого не потрапляє в бібліотеку без «прийнято».
 *
 *  ponytail: свій вузький ендпойнт /api/v1/reception замість наріжного API документів —
 *  той вимагає sha/snapshot/CSRF-танцю заради двох полів frontmatter. */
interface Item {
  name: string;
  title: string;
  lead: string;
  kind: string;
  proposed_at: string;
  body: string;
}

type Verdict = "accepted" | "revise" | "rejected";

export function Reception() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    fetch("/api/v1/reception", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => setItems(d.items ?? []))
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(load, [load]);

  const resolve = (name: string, verdict: Verdict) => {
    if (verdict === "revise" && !note.trim()) return;   // «доопрацювати» без пояснення марне
    setBusy(name);
    // postJson сам мінтить сесію й додає X-CSRF-Token — власний fetch це не вміє
    postJson("/api/v1/reception/resolve", { name, verdict, resolution: note.trim() })
      .then(() => { setNote(""); setOpen(null); load(); })
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(null));
  };

  if (error) return <ErrorState error={new Error(error)} onRetry={load} />;
  if (!items) return <LoadingState label="Читаємо чергу на входження…" />;
  if (!items.length)
    return <EmptyState title="Черга порожня">Варта інбоксу нічого нового не принесла. Нові матеріали зʼявляться тут — у бібліотеку без вашого рішення нічого не потрапляє.</EmptyState>;

  return (
    <div className="route route-reception">
      <header className="reception-head">
        <span className="eyebrow">ПРИЙМАЛЬНЯ</span>
        <h1>Черга на входження <span className="sub">{items.length}</span></h1>
        <p>Нічого не потрапляє в бібліотеку без вашої резолюції.</p>
      </header>

      <ul className="reception-list">
        {items.map((it) => {
          const isOpen = open === it.name;
          return (
            <li key={it.name} className={`reception-item${isOpen ? " open" : ""}`}>
              <button type="button" className="reception-summary" onClick={() => { setOpen(isOpen ? null : it.name); setNote(""); }}>
                <strong>{it.title}</strong>
                <span className="reception-meta">{it.kind}{it.proposed_at ? ` · ${it.proposed_at}` : ""}</span>
                {it.lead ? <span className="reception-lead">{it.lead}</span> : null}
              </button>

              {isOpen ? (
                <div className="reception-body">
                  <pre className="reception-text">{it.body}</pre>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Що саме доопрацювати / чому відхилено (обовʼязково для «доопрацювати»)"
                    rows={3}
                    aria-label="Резолюція"
                  />
                  <div className="reception-actions" role="group" aria-label="Резолюція">
                    <button type="button" className="accept" disabled={busy === it.name} onClick={() => resolve(it.name, "accepted")}>
                      <Check size={15} /> Прийняти
                    </button>
                    <button type="button" className="revise" disabled={busy === it.name || !note.trim()} onClick={() => resolve(it.name, "revise")}>
                      <RotateCcw size={15} /> Доопрацювати
                    </button>
                    <button type="button" className="reject" disabled={busy === it.name} onClick={() => resolve(it.name, "rejected")}>
                      <X size={15} /> Відхилити
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
