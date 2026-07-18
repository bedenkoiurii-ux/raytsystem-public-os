import { FilePlus2, FolderPlus, Move, Pencil, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Dialog } from "../../components/Dialog";

export type DocumentActionKind = "create" | "rename" | "move" | "folder";

export interface DocumentRootOption {
  id: string;
  label: string;
  writable: boolean;
}

export interface DocumentActionValue {
  kind: DocumentActionKind;
  name: string;
  rootId: string;
  folder: string;
  template: string;
  tags: string[];
  properties: Record<string, string | number | boolean | string[]>;
}

interface DocumentActionDialogProps {
  kind: DocumentActionKind;
  roots: DocumentRootOption[];
  initialName?: string;
  initialRootId?: string;
  initialFolder?: string;
  pending?: boolean;
  error?: string | null;
  onCancel: () => void;
  onSubmit: (value: DocumentActionValue) => void;
}

const templates = [
  ["empty", "Порожній документ"],
  ["note", "Нотатка"],
  ["project", "Проект"],
  ["meeting", "Зустріч"],
  ["research", "Дослідження"],
  ["daily", "Щоденна нотатка"]
] as const;

const copy: Record<DocumentActionKind, { title: string; submit: string; icon: typeof FilePlus2 }> = {
  create: { title: "Новий документ", submit: "Створити і відкрити", icon: FilePlus2 },
  rename: { title: "Перейменувати документ", submit: "Перейменувати", icon: Pencil },
  move: { title: "Перемістити документ", submit: "Перемістити", icon: Move },
  folder: { title: "Нова папка", submit: "Створити папку", icon: FolderPlus }
};

function safeFolder(value: string): boolean {
  return !value.startsWith("/") && !value.includes("\\") && !value.split("/").some((part) => part === ".." || part === ".");
}

function safeName(value: string): boolean {
  const hasControlCharacter = [...value].some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127);
  return Boolean(value.trim()) && !value.includes("\\") && !value.includes("/") && !hasControlCharacter && value !== "." && value !== "..";
}

function parsePropertyValue(value: string): string | number | boolean | string[] {
  const normalized = value.trim();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(normalized)) return Number(normalized);
  if (normalized.startsWith("[") && normalized.endsWith("]")) return normalized.slice(1, -1).split(",").map((item) => item.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
  return normalized;
}

export function DocumentActionDialog({
  kind,
  roots,
  initialName = "",
  initialRootId,
  initialFolder = "",
  pending,
  error,
  onCancel,
  onSubmit
}: DocumentActionDialogProps) {
  const writableRoots = roots.filter((root) => root.writable);
  const [name, setName] = useState(initialName);
  const [rootId, setRootId] = useState(initialRootId && writableRoots.some((root) => root.id === initialRootId) ? initialRootId : writableRoots[0]?.id ?? "");
  const [folder, setFolder] = useState(initialFolder);
  const [template, setTemplate] = useState("empty");
  const [tags, setTags] = useState("");
  const [properties, setProperties] = useState("");
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const meta = copy[kind];
  const Icon = meta.icon;
  const normalizedName = kind === "create" && name.trim() && !name.toLowerCase().endsWith(".md") ? `${name.trim()}.md` : name.trim();
  const valid = rootId && safeFolder(folder) && (kind === "move" || (kind === "folder" ? safeFolder(folder) && Boolean(folder) : safeName(normalizedName)));
  const preview = useMemo(() => [rootId, kind === "folder" ? folder : [folder, normalizedName].filter(Boolean).join("/")].filter(Boolean).join(":/"), [folder, kind, normalizedName, rootId]);
  const dirty = name !== initialName || rootId !== (initialRootId && writableRoots.some((root) => root.id === initialRootId) ? initialRootId : writableRoots[0]?.id ?? "") || folder !== initialFolder || template !== "empty" || tags !== "" || properties !== "";
  const requestClose = () => {
    if (pending) return;
    if (dirty) setDiscardConfirm(true);
    else onCancel();
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid || pending) return;
    const parsedProperties = Object.fromEntries(properties.split("\n").map((line) => line.split(":", 2).map((part) => part.trim())).filter(([key, value]) => key && value).map(([key, value]) => [key, parsePropertyValue(value)]));
    onSubmit({ kind, name: normalizedName, rootId, folder: folder.replace(/^\/+|\/+$/g, ""), template, tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean), properties: parsedProperties });
  };

  return (
    <>
      <Dialog className="doc-action-dialog" backdropClassName="doc-modal-backdrop" labelledBy="doc-action-title" busy={pending} onClose={requestClose}>
        <header><Icon size={20} aria-hidden="true" /><h2 id="doc-action-title">{meta.title}</h2><button type="button" onClick={requestClose} disabled={pending} aria-label="Закрити"><X size={18} /></button></header>
        <form onSubmit={submit}>
          {kind !== "move" && kind !== "folder" ? <label><span>{kind === "rename" ? "Нове ім'я" : "Назва"}</span><input name="name" autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Наприклад: План проєкту" /></label> : null}
          <label><span>Дозволений root</span><select name="root_id" value={rootId} onChange={(event) => { const next = event.target.value; setRootId(next); if (kind === "move") setFolder(next === initialRootId ? initialFolder : ""); }}>{writableRoots.map((root) => <option value={root.id} key={root.id}>{root.label}</option>)}</select></label>
          {kind !== "rename" ? <label><span>{kind === "folder" ? "Шлях нової папки" : "Папка"}</span><input name="folder" value={folder} onChange={(event) => setFolder(event.target.value)} placeholder="Наприклад: notes/projects" /></label> : null}
          {kind === "create" ? <><label><span>Шаблон</span><select name="template" value={template} onChange={(event) => setTemplate(event.target.value)}>{templates.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>Теги через кому</span><input name="tags" value={tags} onChange={(event) => setTags(event.target.value)} /></label><label><span>Властивості, по одній key: value</span><textarea name="properties" value={properties} onChange={(event) => setProperties(event.target.value)} rows={3} /></label></> : null}
          <div className="doc-destination-preview"><span>Призначення</span><code>{preview || "—"}</code></div>
          {!safeFolder(folder) || (kind !== "move" && kind !== "folder" && !safeName(normalizedName)) ? <p className="doc-form-error" role="alert">Абсолютні шляхи, traversal, розділювачі в імені та порожні значення заборонені.</p> : null}
          {error ? <p className="doc-form-error" role="alert">{error}</p> : null}
          <footer><button type="button" data-dialog-cancel onClick={requestClose} disabled={pending}>Скасувати</button><button type="submit" className="primary" disabled={!valid || pending}>{pending ? "Перевіряємо…" : meta.submit}</button></footer>
        </form>
      </Dialog>
      {discardConfirm ? (
        <Dialog className="small-modal panel" role="alertdialog" labelledBy="discard-document-title" describedBy="discard-document-description" closeOnBackdrop={false} initialFocus="cancel" onClose={() => setDiscardConfirm(false)}>
          <header><div><span className="eyebrow">Незбережені дані</span><h2 id="discard-document-title">Закрити без збереження?</h2></div></header>
          <p id="discard-document-description">Введені значення форми буде втрачено. Документи на диску не змінювалися.</p>
          <footer><button type="button" data-dialog-cancel onClick={() => setDiscardConfirm(false)}>Продовжити редагування</button><button type="button" className="danger-button" onClick={onCancel}>Закрити без збереження</button></footer>
        </Dialog>
      ) : null}
    </>
  );
}

export { safeFolder, safeName };
