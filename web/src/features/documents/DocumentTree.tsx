import { ChevronRight, FileText, Folder, FolderOpen, Layers, LockKeyhole, Shield } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DocumentFolderSummary, DocumentRootMode, DocumentRootSummary, DocumentSummary } from "./documentTypes";

interface TreeFolder {
  id: string;
  name: string;
  path: string;
  rootId: string;
  workspacePath: string;
  folders: Map<string, TreeFolder>;
  documents: DocumentSummary[];
  mode?: DocumentRootMode;
  documentCount?: number;
  descendantCount?: number;
}

interface VisibleEntry {
  id: string;
  type: "folder" | "document" | "group";
  name: string;
  depth: number;
  parentId: string | null;
  expanded?: boolean;
  folder?: TreeFolder;
  document?: DocumentSummary;
  count?: number;
  expandable?: boolean;   // канонічна з попередніми версіями — працює як вимикач
  isVersion?: boolean;    // рядок попередньої версії (вкладений)
  groupKind?: "parts" | "versions" | "materials";   // вузол-гілка: Частини / Версії / Матеріали
}

interface DocumentTreeProps {
  documents: DocumentSummary[];
  folders?: DocumentFolderSummary[];
  roots?: DocumentRootSummary[];
  selectedDocumentId: string | null;
  loading?: boolean;
  onOpen: (document: DocumentSummary, disposition: "current" | "new") => void;
  onExpandFolder?: (rootId: string, parentPath: string) => void;
}

const ROW_HEIGHT = 50;   // вище — щоб повна назва містилась у 2 рядки (без обрізання)
const OVERSCAN = 8;

function relativeToRoot(path: string, rootPath: string): string {
  const normalizedRoot = rootPath.replace(/^\/+|\/+$/g, "");
  const normalizedPath = path.replace(/^\/+|\/+$/g, "");
  return normalizedRoot && (normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`))
    ? normalizedPath.slice(normalizedRoot.length).replace(/^\/+/, "")
    : normalizedPath;
}

interface VersionIndex {
  versionsFor: Map<string, DocumentSummary[]>;   // фінальний файл → діти (частини, матеріали, версії)
  versionIds: Set<string>;                       // id дітей (виносимо з плаского списку — вони під якорем)
  versionChildIds: Set<string>;                  // діти-ВЕРСІЇ (superseded_by, приглушуємо)
  materialChildIds: Set<string>;                 // діти-МАТЕРІАЛИ (related_to — джерела, рефлексії, суміжні файли)
}

// Ранг версії з імені файлу: (v4)→4, «версія 001»→1, «оригінал/пролог/рання»→0
function versionRank(name: string): number {
  const v = name.match(/\(v(\d+)\)/i);
  if (v) return Number.parseInt(v[1], 10);
  const num = name.match(/(?:версі[яї]|version)\s*0*(\d+)/i);
  if (num) return Number.parseInt(num[1], 10);
  return 0;
}

// Порядок частини з «Блок <римська>»: III→3, IV→4, VIII→8, X→10 …
function romanToInt(s: string): number {
  const map: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let total = 0;
  const up = s.toUpperCase();
  for (let i = 0; i < up.length; i++) {
    const cur = map[up[i]] ?? 0;
    const next = map[up[i + 1]] ?? 0;
    total += cur < next ? -cur : cur;
  }
  return total || 999;
}
function partOrder(name: string): number {
  const m = name.match(/Блок\s+([IVXLCDM]+)/i);
  return m ? romanToInt(m[1]) : 999;
}

// Резолвимо [[Заголовок]] у документ за назвою
function resolveLink(raw: unknown, byTitle: Map<string, DocumentSummary>): DocumentSummary | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const m = raw.match(/\[\[([^\]|#]+)/);
  return byTitle.get((m ? m[1] : raw).trim()) ?? null;
}

function indexVersions(documents: DocumentSummary[]): VersionIndex {
  const byTitle = new Map<string, DocumentSummary>();
  for (const doc of documents) if (doc.title) byTitle.set(doc.title, doc);
  const versionsFor = new Map<string, DocumentSummary[]>();
  const versionIds = new Set<string>();
  const versionChildIds = new Set<string>();
  const materialChildIds = new Set<string>();
  const attach = (canonical: DocumentSummary, doc: DocumentSummary) => {
    const list = versionsFor.get(canonical.document_id) ?? [];
    list.push(doc);
    versionsFor.set(canonical.document_id, list);
    versionIds.add(doc.document_id);
  };
  // 1) частини (part_of) — вкладаються під фінальний файл
  for (const doc of documents) {
    const canonical = resolveLink(doc.properties?.part_of, byTitle);
    if (canonical && canonical.document_id !== doc.document_id) attach(canonical, doc);
  }
  // 2) матеріали (related_to) — джерела, рефлексії, суміжні файли
  for (const doc of documents) {
    if (versionIds.has(doc.document_id)) continue;
    const canonical = resolveLink(doc.properties?.related_to, byTitle);
    if (canonical && canonical.document_id !== doc.document_id) { attach(canonical, doc); materialChildIds.add(doc.document_id); }
  }
  // 3) старі версії (superseded_by) — теж під фінальний файл, приглушені
  for (const doc of documents) {
    if (versionIds.has(doc.document_id)) continue;
    const canonical = resolveLink(doc.properties?.superseded_by, byTitle);
    if (canonical && canonical.document_id !== doc.document_id) { attach(canonical, doc); versionChildIds.add(doc.document_id); }
  }
  // порядок під якорем: 1) частини (за номером блоку) → 2) листкова лінія версій (v4→оригінал)
  // → 3) гілки-чернетки, що мають власні під-гілки (повна версія 1, план)
  for (const list of versionsFor.values()) {
    list.sort((a, b) => {
      const av = versionChildIds.has(a.document_id), bv = versionChildIds.has(b.document_id);
      if (av !== bv) return av ? 1 : -1;                       // частини перед версіями
      if (!av) return partOrder(a.filename) - partOrder(b.filename);   // частини — за номером блоку
      const aBranch = versionsFor.has(a.document_id), bBranch = versionsFor.has(b.document_id);
      if (aBranch !== bBranch) return aBranch ? 1 : -1;        // листкові версії перед гілками-чернетками
      return versionRank(b.filename) - versionRank(a.filename) || b.filename.localeCompare(a.filename, "uk-UA");
    });
  }
  return { versionsFor, versionIds, versionChildIds, materialChildIds };
}

function buildTree(documents: DocumentSummary[], projections: DocumentFolderSummary[], roots: DocumentRootSummary[], versionIds: ReadonlySet<string>): TreeFolder {
  const root: TreeFolder = { id: "folder:/", name: "workspace", path: "", rootId: "", workspacePath: "", folders: new Map(), documents: [] };
  const rootMeta = new Map(roots.map((item) => [item.root_id, item]));
  const rootFolders = new Map<string, TreeFolder>();
  const ensureRoot = (rootId: string): TreeFolder => {
    const existing = rootFolders.get(rootId);
    if (existing) return existing;
    const meta = rootMeta.get(rootId);
    const folder: TreeFolder = { id: `folder-root:${rootId}`, name: meta?.label ?? rootId, path: "", rootId, workspacePath: meta?.path ?? "", folders: new Map(), documents: [], mode: meta?.mode };
    rootFolders.set(rootId, folder);
    root.folders.set(rootId, folder);
    return folder;
  };
  const ensureFolder = (rootId: string, workspacePath: string, projection?: DocumentFolderSummary): TreeFolder => {
    const rootFolder = ensureRoot(rootId);
    const relativePath = relativeToRoot(workspacePath, rootMeta.get(rootId)?.path ?? "");
    const parts = relativePath.split("/").filter(Boolean);
    let folder = rootFolder;
    let path = "";
    for (const part of parts) {
      path = path ? `${path}/${part}` : part;
      let next = folder.folders.get(part);
      if (!next) {
        const rootPath = rootMeta.get(rootId)?.path.replace(/^\/+|\/+$/g, "") ?? "";
        next = { id: `folder:${rootId}:${path}`, name: part, path, rootId, workspacePath: [rootPath, path].filter(Boolean).join("/"), folders: new Map(), documents: [] };
        folder.folders.set(part, next);
      }
      folder = next;
    }
    if (projection) {
      folder.id = projection.folder_id;
      folder.name = projection.name || folder.name;
      folder.workspacePath = projection.path;
      folder.mode = projection.mode;
      folder.documentCount = projection.document_count;
      folder.descendantCount = projection.descendant_count;
    }
    return folder;
  };
  for (const projection of projections) ensureFolder(projection.root_id, projection.path, projection);
  for (const document of documents) {
    if (versionIds.has(document.document_id)) continue;   // версії показуємо під канонічною, не в теці
    const parts = document.path.split("/").filter(Boolean);
    parts.pop();
    const folder = ensureFolder(document.root_id, parts.join("/"));
    folder.documents.push(document);
  }
  return root;
}

function countDocuments(folder: TreeFolder): number {
  if (folder.descendantCount !== undefined) return folder.descendantCount;
  let count = 0;
  const stack = [folder];
  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    count += current.documents.length;
    for (const child of current.folders.values()) {
      if (child.descendantCount !== undefined) count += child.descendantCount;
      else stack.push(child);
    }
  }
  return count;
}

// Гілки під фіналом: частини й версії групуються у вузли-гілки; чернетки з власними
// під-гілками (напр. повна версія 1 → PDF) лишаються окремими файлами-гілками.
function emitChildren(
  anchorId: string,
  depth: number,
  versionsFor: Map<string, DocumentSummary[]>,
  versionChildIds: ReadonlySet<string>,
  materialChildIds: ReadonlySet<string>,
  expanded: ReadonlySet<string>,
  out: VisibleEntry[],
): void {
  const children = versionsFor.get(anchorId) ?? [];
  const parts = children.filter((c) => !versionChildIds.has(c.document_id) && !materialChildIds.has(c.document_id));
  const materials = children.filter((c) => materialChildIds.has(c.document_id));
  const versions = children.filter((c) => versionChildIds.has(c.document_id));
  const leafVersions = versions.filter((c) => !versionsFor.has(c.document_id));   // версії без власних під-гілок
  const branchDrafts = versions.filter((c) => versionsFor.has(c.document_id));    // чернетки-гілки (повна версія 1, план)

  const emitGroup = (kind: "parts" | "versions" | "materials", label: string, members: DocumentSummary[], collapseSingle: boolean) => {
    if (!members.length) return;
    if (collapseSingle && members.length === 1) { emitDocument(members[0], depth, anchorId, versionsFor, versionChildIds, materialChildIds, expanded, out); return; }
    const gid = `group:${anchorId}:${kind}`;
    const isExpanded = expanded.has(gid);
    out.push({ id: gid, type: "group", name: label, depth, parentId: anchorId, expanded: isExpanded, expandable: true, count: members.length, groupKind: kind });
    if (isExpanded) for (const m of members) emitDocument(m, depth + 1, gid, versionsFor, versionChildIds, materialChildIds, expanded, out);
  };

  emitGroup("parts", "Частини", parts, true);
  emitGroup("materials", "Матеріали", materials, false);   // окрема категорія-гілка — групуємо навіть з одним
  emitGroup("versions", "Версії", leafVersions, true);
  for (const draft of branchDrafts) emitDocument(draft, depth, anchorId, versionsFor, versionChildIds, materialChildIds, expanded, out);
}

// Рекурсивний рендер вузла-піраміди: документ + (якщо розгорнутий) його гілки вглиб на будь-який рівень.
function emitDocument(
  document: DocumentSummary,
  depth: number,
  parentId: string | null,
  versionsFor: Map<string, DocumentSummary[]>,
  versionChildIds: ReadonlySet<string>,
  materialChildIds: ReadonlySet<string>,
  expanded: ReadonlySet<string>,
  out: VisibleEntry[],
): void {
  const children = versionsFor.get(document.document_id);
  const hasChildren = !!children?.length;
  const isExpanded = hasChildren && expanded.has(document.document_id);
  out.push({
    id: document.document_id,
    type: "document",
    name: document.title || document.filename,
    depth,
    parentId,
    document,
    expandable: hasChildren,
    expanded: isExpanded,
    count: hasChildren ? children!.length : undefined,
    isVersion: versionChildIds.has(document.document_id),
  });
  if (isExpanded) emitChildren(document.document_id, depth + 1, versionsFor, versionChildIds, materialChildIds, expanded, out);
}

function flattenTree(folder: TreeFolder, expanded: ReadonlySet<string>, versionsFor: Map<string, DocumentSummary[]>, versionChildIds: ReadonlySet<string>, materialChildIds: ReadonlySet<string>, depth = 1, parentId: string | null = null): VisibleEntry[] {
  const entries: VisibleEntry[] = [];
  const folders = [...folder.folders.values()].sort((a, b) => a.name.localeCompare(b.name, "uk-UA"));
  for (const child of folders) {
    if (child.documents.length === 0 && child.folders.size === 0) continue;   // ховаємо порожні теки
    const isExpanded = expanded.has(child.id);
    entries.push({ id: child.id, type: "folder", name: child.name, depth, parentId, expanded: isExpanded, folder: child, count: countDocuments(child) });
    if (isExpanded) entries.push(...flattenTree(child, expanded, versionsFor, versionChildIds, materialChildIds, depth + 1, child.id));
  }
  for (const document of [...folder.documents].sort((a, b) => a.filename.localeCompare(b.filename, "uk-UA"))) {
    emitDocument(document, depth, parentId, versionsFor, versionChildIds, materialChildIds, expanded, entries);
  }
  return entries;
}

// Індикатор аудиту доказової бази: три лінії ✅ підтверджено / 🟡 інтерпретація / 🔴 потребує опори.
// Довжина лінії = кількість; нульова — ледь помітний обрубок.
function AuditBar({ triple }: { triple: readonly number[] }) {
  const g = triple[0] || 0, y = triple[1] || 0, r = triple[2] || 0;
  if (g + y + r === 0) return null;
  const seg = (n: number, cls: string) => (
    <i className={`${cls}${n === 0 ? " zero" : ""}`} style={{ width: n === 0 ? 4 : Math.min(4 + n * 3, 40) }} aria-hidden="true" />
  );
  return (
    <span
      className="doc-audit"
      title={`Доказова база — ✅ ${g} підтверджено · 🟡 ${y} інтерпретація · 🔴 ${r} потребує опори`}
      aria-label={`Аудит: підтверджено ${g}, інтерпретація ${y}, потребує опори ${r}`}
    >
      {seg(g, "g")}
      {seg(y, "y")}
      {seg(r, "r")}
    </span>
  );
}

function auditTriple(document?: DocumentSummary): readonly number[] | null {
  const raw = document?.properties?.source_audit;
  return Array.isArray(raw) && raw.length === 3 && raw.every((n) => typeof n === "number") ? (raw as number[]) : null;
}

export function DocumentTree({ documents, folders = [], roots = [], selectedDocumentId, loading, onOpen, onExpandFolder }: DocumentTreeProps) {
  const versionIndex = useMemo(() => indexVersions(documents), [documents]);
  const tree = useMemo(() => buildTree(documents, folders, roots, versionIndex.versionIds), [documents, folders, roots, versionIndex]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([...tree.folders.values()].map((folder) => folder.id)));
  const [focusedId, setFocusedId] = useState<string | null>(selectedDocumentId);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(520);
  const viewportRef = useRef<HTMLDivElement>(null);
  const visible = useMemo(() => flattenTree(tree, expanded, versionIndex.versionsFor, versionIndex.versionChildIds, versionIndex.materialChildIds), [expanded, tree, versionIndex]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setViewportHeight(entry.contentRect.height));
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!selectedDocumentId) return;
    const frame = requestAnimationFrame(() => setFocusedId(selectedDocumentId));
    return () => cancelAnimationFrame(frame);
  }, [selectedDocumentId]);

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const count = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2;
  const rendered = visible.slice(first, first + count);

  const focusEntry = (index: number) => {
    const boundedIndex = Math.max(0, Math.min(visible.length - 1, index));
    const entry = visible[boundedIndex];
    if (!entry) return;
    setFocusedId(entry.id);
    const viewport = viewportRef.current;
    if (viewport) {
      const top = boundedIndex * ROW_HEIGHT;
      const bottom = top + ROW_HEIGHT;
      if (top < viewport.scrollTop) viewport.scrollTop = top;
      else if (bottom > viewport.scrollTop + viewport.clientHeight) viewport.scrollTop = Math.max(0, bottom - viewport.clientHeight);
      setScrollTop(viewport.scrollTop);
    }
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const next = [...(viewportRef.current?.querySelectorAll<HTMLElement>("[data-tree-id]") ?? [])]
        .find((candidate) => candidate.dataset.treeId === entry.id);
      next?.focus();
    }));
  };

  const toggleFolder = (entry: VisibleEntry, force?: boolean) => {
    if (entry.type !== "folder" && !entry.expandable) return;
    const opening = force ?? !expanded.has(entry.id);
    if (opening && entry.folder && !entry.id.startsWith("folder-root:")) onExpandFolder?.(entry.folder.rootId, entry.folder.workspacePath);
    setExpanded((current) => {
      const next = new Set(current);
      const open = force ?? !next.has(entry.id);
      if (open) next.add(entry.id); else next.delete(entry.id);
      return next;
    });
  };

  const onKeyDown = (event: React.KeyboardEvent, entry: VisibleEntry) => {
    const index = visible.findIndex((item) => item.id === entry.id);
    if (event.key === "ArrowDown") { event.preventDefault(); focusEntry(index + 1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); focusEntry(index - 1); }
    else if (event.key === "Home") { event.preventDefault(); focusEntry(0); }
    else if (event.key === "End") { event.preventDefault(); focusEntry(visible.length - 1); }
    else if (event.key === "ArrowRight" && (entry.type === "folder" || entry.expandable)) {
      event.preventDefault();
      if (entry.expanded) focusEntry(index + 1);
      else toggleFolder(entry, true);
    }
    else if (event.key === "ArrowLeft") {
      event.preventDefault();
      if ((entry.type === "folder" || entry.expandable) && entry.expanded) toggleFolder(entry, false);
      else if (entry.parentId) focusEntry(visible.findIndex((item) => item.id === entry.parentId));
    } else if ((event.key === "Enter" || event.key === " ") && entry.document) {
      event.preventDefault();
      onOpen(entry.document, event.ctrlKey || event.metaKey ? "new" : "current");
    }
  };

  if (!documents.length && !folders.length && !roots.length && !loading) return <div className="doc-tree-empty">Дозволені документи не знайдено.</div>;
  return (
    <div
      ref={viewportRef}
      className="doc-tree-viewport"
      role="tree"
      aria-label="Файли документного workspace"
      aria-busy={loading || undefined}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div className="doc-tree-spacer">
        {first > 0 ? <svg className="doc-tree-virtual-space" width="1" height={first * ROW_HEIGHT} aria-hidden="true" /> : null}
        {rendered.map((entry, renderedIndex) => {
          const index = first + renderedIndex;
          const selected = entry.document?.document_id === selectedDocumentId;
          return (
            <div
              key={entry.id}
              className={`doc-tree-row ${selected ? "selected" : ""} ${entry.isVersion ? "is-version" : ""} ${entry.expandable && entry.type === "document" ? "has-versions" : ""} ${entry.type === "group" ? "is-group" : ""}`}
              data-tree-id={entry.id}
              data-clickable="true"
              role="treeitem"
              aria-label={entry.type === "folder" ? `${entry.name}, ${entry.count ?? 0} документів` : entry.type === "group" ? `${entry.name}, ${entry.count ?? 0}` : entry.expandable ? `${entry.name}, ${entry.count ?? 0} частин і версій` : undefined}
              aria-level={entry.depth}
              aria-expanded={entry.type === "folder" || entry.type === "group" || entry.expandable ? entry.expanded : undefined}
              aria-selected={entry.type === "document" ? selected : undefined}
              tabIndex={focusedId === entry.id || (!focusedId && index === 0) ? 0 : -1}
              onFocus={() => setFocusedId(entry.id)}
              onKeyDown={(event) => onKeyDown(event, entry)}
              onClick={() => entry.type === "folder" || entry.type === "group" ? toggleFolder(entry) : entry.document && onOpen(entry.document, "current")}
              onDoubleClick={() => entry.document && onOpen(entry.document, "new")}
            >
              {Array.from({ length: Math.max(0, entry.depth - 1) }, (_, depth) => <span className="doc-tree-indent" key={depth} aria-hidden="true" />)}
              {entry.type === "folder" || entry.type === "group" ? (
                <ChevronRight className={entry.expanded ? "expanded" : ""} size={14} aria-hidden="true" />
              ) : entry.expandable ? (
                <ChevronRight
                  className={`doc-tree-version-toggle ${entry.expanded ? "expanded" : ""}`}
                  size={14}
                  role="button"
                  aria-label={entry.expanded ? "Згорнути" : "Показати гілку"}
                  onClick={(event) => { event.stopPropagation(); toggleFolder(entry); }}
                />
              ) : (
                <span className="doc-tree-chevron" />
              )}
              {entry.type === "folder" ? (entry.expanded ? <FolderOpen size={15} aria-hidden="true" /> : <Folder size={15} aria-hidden="true" />) : entry.type === "group" ? <Layers size={14} aria-hidden="true" /> : entry.expandable ? <Layers size={15} aria-hidden="true" /> : <FileText size={15} aria-hidden="true" />}
              <span title={entry.document?.path ?? entry.folder?.workspacePath}>{entry.name}</span>
              {entry.type === "folder" ? <small className="doc-tree-count" aria-label={`${entry.count ?? 0} документів`}>{entry.count ?? 0}</small> : entry.type === "group" ? <small className="doc-tree-count doc-tree-versions-count" aria-label={`${entry.count ?? 0}`}>{entry.count ?? 0}</small> : entry.expandable ? <small className="doc-tree-count doc-tree-versions-count" aria-label={`${entry.count ?? 0} частин і версій`} title="частини й версії">{entry.count ?? 0}</small> : null}
              {(() => { const triple = auditTriple(entry.document); return triple ? <AuditBar triple={triple} /> : null; })()}
              {entry.folder?.mode === "protected_read_only" ? <Shield size={13} aria-label="Захищено" /> : entry.folder?.mode === "read_only" ? <LockKeyhole size={13} aria-label="Лише читання" /> : null}
              {entry.document?.mode === "protected_read_only" ? <Shield size={13} aria-label="Захищено" /> : entry.document && !entry.document.can_edit ? <LockKeyhole size={13} aria-label="Лише читання" /> : null}
              {entry.document?.is_modified ? <i className="doc-tree-modified" aria-label="Змінено" /> : null}
            </div>
          );
        })}
        {first + rendered.length < visible.length ? <svg className="doc-tree-virtual-space" width="1" height={(visible.length - first - rendered.length) * ROW_HEIGHT} aria-hidden="true" /> : null}
      </div>
    </div>
  );
}
