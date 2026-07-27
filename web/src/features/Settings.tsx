import { FolderPlus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "../components/StatePanel";
import { postJson } from "../api";

/** Налаштування — списки, якими живляться фонові задачі.
 *
 *  Рішення Юрія (2026-07-26): налаштування задаються ТУТ, а не в діалозі з ШІ —
 *  витрачати токени й розмову на список тек безглуздо. Механізм загальний:
 *  нова категорія на бекенді (LISTS у settings_routes.py) зʼявляється тут сама,
 *  без правок цього файлу. */
interface Entry {
  value: string;
  exists: boolean;
}

interface ListBlock {
  key: string;
  label: string;
  hint: string;
  items: Entry[];
}

export function Settings() {
  const [lists, setLists] = useState<ListBlock[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    fetch("/api/v1/settings/lists", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => setLists(d.lists ?? []))
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(load, [load]);

  const edit = (key: string, value: string, action: "add" | "remove") => {
    if (!value.trim()) return;
    setBusy(`${key}:${value}`);
    setError(null);
    postJson<{ ok: boolean }>("/api/v1/settings/lists/edit", { key, value: value.trim(), action })
      .then(() => { setDrafts((d) => ({ ...d, [key]: "" })); load(); })
      // Повідомлення бекенда українською й змістовні («теки немає або немає доступу») —
      // показуємо їх, а не голий код помилки.
      .catch((e) => setError(e?.message ? String(e.message) : String(e)))
      .finally(() => setBusy(null));
  };

  if (error && !lists) return <ErrorState error={new Error(error)} onRetry={load} />;
  if (!lists) return <LoadingState label="Читаємо налаштування…" />;
  if (!lists.length) return <EmptyState title="Налаштувань немає">Списків для керування ще не заведено.</EmptyState>;

  return (
    <div className="route route-settings">
      <header className="settings-head">
        <span className="eyebrow">НАЛАШТУВАННЯ</span>
        <h1>Списки Writer-Lab</h1>
        <p>Те, чим живляться фонові задачі. Змінюється тут — без діалогу й без витрати токенів.</p>
      </header>

      {error ? <p className="settings-error" role="alert">{error}</p> : null}

      {lists.map((block) => (
        <section key={block.key} className="settings-block">
          <h2>{block.label}</h2>
          <p className="settings-hint">{block.hint}</p>

          {block.items.length ? (
            <ul className="settings-items">
              {block.items.map((it) => (
                <li key={it.value} className={it.exists ? "" : "missing"}>
                  <span className="mark" aria-hidden="true">{it.exists ? "✓" : "✗"}</span>
                  <code>{it.value}</code>
                  {!it.exists ? <span className="settings-warn">теки немає або немає доступу</span> : null}
                  <button
                    type="button"
                    aria-label={`Прибрати ${it.value}`}
                    title="Прибрати зі списку"
                    disabled={busy === `${block.key}:${it.value}`}
                    onClick={() => edit(block.key, it.value, "remove")}
                  >
                    <Trash2 size={15} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="settings-empty">Список порожній.</p>
          )}

          <form
            className="settings-add"
            onSubmit={(e) => { e.preventDefault(); edit(block.key, drafts[block.key] ?? "", "add"); }}
          >
            <input
              type="text"
              value={drafts[block.key] ?? ""}
              onChange={(e) => setDrafts((d) => ({ ...d, [block.key]: e.target.value }))}
              placeholder="Повний шлях, наприклад /Users/Nemo/Тексти"
              aria-label={`Додати до списку «${block.label}»`}
              spellCheck={false}
            />
            <button type="submit" disabled={!(drafts[block.key] ?? "").trim()}>
              <FolderPlus size={15} /> Додати
            </button>
          </form>
        </section>
      ))}
    </div>
  );
}
