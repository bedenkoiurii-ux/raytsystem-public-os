import { Link2,
  ArrowDownAZ,
  BookOpen,
  Clock3,
  FileDiff,
  FilePlus2,
  Files,
  FolderPlus,
  GitCompare,
  Menu,
  Move,
  PanelRight,
  Pencil,
  RefreshCw,
  Save,
  Search,
  Shield,
  Sparkles,
  Star,
  Sun,
  X
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "../../components/StatePanel";
import { Dialog } from "../../components/Dialog";
import {
  DocumentApiError,
  documentGet,
  newIntentKey,
  queryString,
  useCreateDocument,
  useCreateDocumentFolder,
  useDocumentBacklinks,
  useDocumentDetail,
  useDocumentHistory,
  useDocumentIndexMutation,
  useDocumentLinks,
  useDocumentListing,
  useIndexPulse,
  useDocumentRestorePreview,
  useDocumentRevisionDetail,
  useMoveDocument,
  useRenameDocument,
  useRestoreDocument,
  useUpdateDocument
} from "./documentHooks";
import {
  documentWorkspaceReducer,
  persistDocumentWorkspace,
  restoreDocumentWorkspace
} from "./documentState";
import type {
  DocumentConflictDetails,
  DocumentDetailEnvelope,
  DocumentFolderSummary,
  DocumentFoldersEnvelope,
  DocumentHistoryEntry,
  DocumentLink,
  DocumentMode,
  DocumentQuery,
  DocumentRootMode,
  DocumentRootSummary,
  DocumentRestorePreviewEnvelope,
  DocumentSort,
  DocumentSummary,
  DocumentTabState,
  DocumentView
} from "./documentTypes";
import { inspectMarkdownForVisualEditing, visualEditorBlockReason, type MarkdownIssue } from "./markdownCodec";
import { DocumentActionDialog, type DocumentActionKind, type DocumentActionValue, type DocumentRootOption } from "./DocumentActionDialog";
import { DocumentConflictDialog } from "./DocumentConflictDialog";
import { DocumentDiff } from "./DocumentDiff";
import { DocumentInspector } from "./DocumentInspector";
import { DocumentRestoreDialog } from "./DocumentRestoreDialog";
import { DocumentTabs } from "./DocumentTabs";
import { DocumentTree } from "./DocumentTree";
import { headingId, SafeMarkdownView, safeImageUrl, type WikilinkTarget } from "./SafeMarkdownView";
import { CardScope, Prose } from "../InlineEntity";
import { findingsForDocument, useOpponentFindings, useOpponentTargets } from "./opponentFindings";

import { DocumentPeek } from "./DocumentPeek";
import { EntityOrderDialog, type EntityOrderRequest } from "./EntityOrderDialog";
import { EntitySelectionAction } from "./EntitySelectionAction";
import "./documents.css";

const SourceEditor = lazy(() => import("./SourceEditor"));
const VisualEditor = lazy(() => import("./VisualEditor"));

export interface DocumentsProps {
  onShowInGraph: (documentId: string) => void;
  initialDocumentId?: string | null;
}

const views: Array<{ id: DocumentView; label: string; icon: typeof Files }> = [
  { id: "files", label: "Файли", icon: Files },
  { id: "recent", label: "Нещодавні", icon: Clock3 },
  { id: "added", label: "Додані", icon: Sparkles },
  { id: "modified", label: "Змінені", icon: GitCompare },
  { id: "favorites", label: "Обране", icon: Star }
];

const modes: Array<{ id: DocumentMode; label: string; icon: typeof BookOpen }> = [
  { id: "read", label: "Читання", icon: BookOpen },
  { id: "visual", label: "Візуально", icon: Sparkles },
  { id: "source", label: "Markdown", icon: Files },
  { id: "diff", label: "Diff", icon: FileDiff }
];

function routeDocumentId(initialDocumentId?: string | null): string | null {
  if (initialDocumentId) return initialDocumentId;
  const candidate = new URLSearchParams(window.location.search).get("document");
  return candidate && /^doc_[A-Za-z0-9_-]+$/.test(candidate) ? candidate : null;
}

export function folderWithinRoot(path: string, rootPath: string): string {
  const parts = path.split("/").filter(Boolean);
  const rootParts = rootPath.split("/").filter(Boolean);
  if (!rootParts.length || parts.length <= rootParts.length) return "";
  if (rootParts.some((part, index) => parts[index] !== part)) return "";
  return parts.slice(rootParts.length, -1).join("/");
}

function wikilinkBase(value: string): string {
  return value.split("|", 1)[0].split("#", 1)[0].trim();
}

export function matchingDocumentLink(target: WikilinkTarget, links: DocumentLink[]): DocumentLink | undefined {
  return links.find((link) => {
    const sameTarget = wikilinkBase(link.target).localeCompare(target.target, "uk-UA", { sensitivity: "base" }) === 0;
    const sameHeading = !target.heading || Boolean(link.heading && link.heading.localeCompare(target.heading, "uk-UA", { sensitivity: "base" }) === 0);
    return sameTarget && sameHeading;
  });
}

export function focusMarkdownHeading(scope: ParentNode, heading: string): boolean {
  const id = headingId(heading);
  const element = [...scope.querySelectorAll<HTMLElement>("[id]")].find((candidate) => candidate.id === id);
  if (!element) return false;
  element.tabIndex = -1;
  element.scrollIntoView({ block: "start" });
  element.focus({ preventScroll: true });
  return true;
}

function tabFor(document: DocumentSummary): DocumentTabState {
  return {
    documentId: document.document_id,
    title: document.title || document.filename,
    mode: "read",
    pinned: false,
    dirty: false,
    readOnly: !document.can_edit
  };
}

function placeholderTab(documentId: string): DocumentTabState {
  return { documentId, title: "Документ", mode: "read", pinned: false, dirty: false, readOnly: true };
}

function mutationMessage(error: unknown): string {
  return error instanceof DocumentApiError ? error.message : "Операція з документом не виконана.";
}

function restoreFavorites(): Set<string> {
  try {
    const values = JSON.parse(window.localStorage.getItem("raytsystem.documents.favorites.v1") ?? "[]") as unknown;
    return new Set(Array.isArray(values) ? values.filter((value): value is string => typeof value === "string").slice(0, 100) : []);
  } catch {
    return new Set();
  }
}

function DocumentImageView({ detail }: { detail: DocumentDetailEnvelope }) {
  const source = safeImageUrl(detail.asset_url ?? "");
  return source ? (
    <figure className="doc-image-view">
      <img src={source} alt={detail.document.title || detail.document.filename} loading="lazy" decoding="async" />
      <figcaption><strong>{detail.document.title || detail.document.filename}</strong><span>{detail.image?.mime_type ?? detail.mime_type ?? detail.document.extension} · {detail.document.size_bytes.toLocaleString("uk-UA")} байт{detail.image?.width && detail.image.height ? ` · ${detail.image.width}×${detail.image.height}` : ""}</span><span>Вкладення доступне лише для безпечного перегляду.</span></figcaption>
    </figure>
  ) : <div className="doc-visual-unavailable" role="alert"><strong>Зображення заблоковано</strong><p>Сервер не видав дозволений opaque asset URL.</p></div>;
}

export function Documents({ onShowInGraph, initialDocumentId }: DocumentsProps) {
  const [workspace, dispatch] = useReducer(documentWorkspaceReducer, undefined, restoreDocumentWorkspace);
  // Гібридна тема: світлий «аркуш» тіла документа (опція Writer-Lab; зберігається локально)
  const [sheetLight, setSheetLight] = useState<boolean>(() => {
    // Дефолт: аркуш УВІМКНЕНО (читання — головний сценарій). Явне "0" вимикає.
    try { const s = window.localStorage.getItem("wl_sheet_light"); return s === null ? true : s === "1"; } catch { return true; }
  });
  const toggleSheetLight = () => setSheetLight((prev) => {
    const next = !prev;
    try { window.localStorage.setItem("wl_sheet_light", next ? "1" : "0"); } catch { /* noop */ }
    return next;
  });
  const [sheetTone, setSheetTone] = useState<string>(() => {
    // Дефолт: сепія (тепла, легша очам). Змінюється й запам'ятовується.
    try { return window.localStorage.getItem("wl_sheet_tone") ?? "sepia"; } catch { return "sepia"; }
  });
  const changeSheetTone = (tone: string) => {
    setSheetTone(tone);
    try { window.localStorage.setItem("wl_sheet_tone", tone); } catch { /* noop */ }
  };
  // Формат сторінки читалки: a4 (вертикальний), a4-land (горизонтальний), free (без сторінок, на всю ширину).
  // Для сценарних/широких документів вертикальний А4 тісний — тут перемикаємо.
  const [sheetFormat, setSheetFormat] = useState<string>(() => {
    try { return window.localStorage.getItem("wl_sheet_format") ?? "a4"; } catch { return "a4"; }
  });
  const changeSheetFormat = (fmt: string) => {
    setSheetFormat(fmt);
    try { window.localStorage.setItem("wl_sheet_format", fmt); } catch { /* noop */ }
  };
  // Масштаб шрифта читалки (−/+), 0.7…1.8, крок 0.1. Запам'ятовується.
  const [fontScale, setFontScale] = useState<number>(() => {
    const v = parseFloat(window.localStorage.getItem("wl_sheet_font") ?? "1");
    return Number.isFinite(v) && v >= 0.7 && v <= 1.8 ? v : 1;
  });
  const bumpFontScale = (delta: number) => {
    setFontScale((cur) => {
      const next = Math.min(1.8, Math.max(0.7, Math.round((cur + delta) * 10) / 10));
      try { window.localStorage.setItem("wl_sheet_font", String(next)); } catch { /* noop */ }
      return next;
    });
  };
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [rootId, setRootId] = useState("");
  const [kind, setKind] = useState("");
  const [policyMode, setPolicyMode] = useState<DocumentRootMode | "all">("all");
  const [sort, setSort] = useState<DocumentSort>("modified_desc");
  const [action, setAction] = useState<DocumentActionKind | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Замовлення сутності з виділення: тримаємо запит, поки відкритий діалог.
  const [entityOrder, setEntityOrder] = useState<EntityOrderRequest | null>(null);
  const [conflict, setConflict] = useState<DocumentConflictDetails | null>(null);
  const [revisionTarget, setRevisionTarget] = useState<DocumentHistoryEntry | null>(null);
  const [pendingHeading, setPendingHeading] = useState<{ documentId: string; heading: string } | null>(null);
  const [restoreRevision, setRestoreRevision] = useState<DocumentHistoryEntry | null>(null);
  const [restorePreview, setRestorePreview] = useState<DocumentRestorePreviewEnvelope | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [visualBlocked, setVisualBlocked] = useState<Record<string, boolean>>({});
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(restoreFavorites);
  const [pendingTabClose, setPendingTabClose] = useState<{ kind: "one" | "others"; documentId: string; label: string } | null>(null);
  // Вирівнювання карток по документу: висоту шапки стейджа (вкладки + заголовок +
  // панель режимів) НЕ вгадуємо константою — міряємо в рантаймі й віддаємо в CSS.
  // Так тіло картки завжди починається рівно там, де тіло документа, хоч би як
  // змінилися шрифт, масштаб чи кількість рядків у заголовку.
  const canvasRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const measure = () => {
      const content = canvas.querySelector(".document-content");
      if (!content) return;
      const offset = Math.round(content.getBoundingClientRect().top - canvas.getBoundingClientRect().top);
      if (offset > 0) canvas.style.setProperty("--stage-head-h", `${offset}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    return () => observer.disconnect();
  });

  const initializedRoute = useRef(false);
  const workspaceRef = useRef(workspace);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const navigationDrawerRef = useRef<HTMLElement>(null);
  const inspectorDrawerRef = useRef<HTMLDivElement>(null);
  const drawerReturnFocusRef = useRef<HTMLElement | null>(null);
  const previousDrawerRef = useRef<"navigation" | "inspector" | null>(null);
  const folderRequests = useRef(new Set<string>());
  const [expandedFolderProjection, setExpandedFolderProjection] = useState<{ snapshotId: string; items: DocumentFolderSummary[] }>({ snapshotId: "", items: [] });

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 180);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const timer = window.setTimeout(() => persistDocumentWorkspace(workspace), 350);
    return () => window.clearTimeout(timer);
  }, [workspace]);

  useLayoutEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);

  useEffect(() => () => persistDocumentWorkspace(workspaceRef.current), []);

  useEffect(() => {
    try { window.localStorage.setItem("raytsystem.documents.favorites.v1", JSON.stringify([...favoriteIds])); } catch { /* best effort */ }
  }, [favoriteIds]);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (window.location.pathname !== "/documents" || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "f") return;
      if ((event.target as HTMLElement | null)?.closest("[data-editor-scope]")) return;
      event.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  useEffect(() => {
    const dirty = workspace.tabs.some((tab) => tab.dirty);
    const listener = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", listener);
    return () => window.removeEventListener("beforeunload", listener);
  }, [workspace.tabs]);

  useEffect(() => {
    const drawer = workspace.mobileDrawer;
    if (!drawer) {
      if (previousDrawerRef.current) {
        const frame = requestAnimationFrame(() => drawerReturnFocusRef.current?.focus());
        previousDrawerRef.current = null;
        return () => cancelAnimationFrame(frame);
      }
      return undefined;
    }
    previousDrawerRef.current = drawer;
    const frame = requestAnimationFrame(() => {
      const panel = drawer === "navigation" ? navigationDrawerRef.current : inspectorDrawerRef.current;
      panel?.querySelector<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])")?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [workspace.mobileDrawer]);

  useEffect(() => {
    if (!workspace.mobileDrawer) return;
    const background = Array.from(document.querySelectorAll<HTMLElement>(".sidebar, .topbar, .activity-strip, .mobile-nav"));
    const previous = background.map((element) => [element, element.inert] as const);
    for (const element of background) element.inert = true;
    return () => {
      for (const [element, inert] of previous) element.inert = inert;
    };
  }, [workspace.mobileDrawer]);

  useEffect(() => {
    if (initializedRoute.current) return;
    initializedRoute.current = true;
    const documentId = routeDocumentId(initialDocumentId);
    if (documentId && !workspace.tabs.some((tab) => tab.documentId === documentId)) dispatch({ type: "open", tab: placeholderTab(documentId) });
  }, [initialDocumentId, workspace.tabs]);

  useEffect(() => {
    if (window.location.pathname !== "/documents") return;
    const url = new URL(window.location.href);
    if (workspace.activeDocumentId) url.searchParams.set("document", workspace.activeDocumentId);
    else url.searchParams.delete("document");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, [workspace.activeDocumentId]);

  const listingQuery: DocumentQuery = {
    view: workspace.view === "favorites" ? "files" : workspace.view,
    query: debouncedQuery,
    documentIds: workspace.view === "favorites" ? [...favoriteIds].slice(0, 100) : undefined,
    rootId: rootId || undefined,
    kind: kind || undefined,
    mode: policyMode,
    sort,
    limit: 200
  };
  const listing = useDocumentListing(listingQuery);
  useIndexPulse();   // дерево саме бачить файли, що з'явилися ззовні
  // Writer-Lab: у режимі перегляду ("Файли") без активного пошуку — автоматично довантажуємо
  // всі сторінки, щоб дерево показувало ПОВНУ структуру, а не лише першу сторінку за сортуванням.
  const browsingFullTree = workspace.view === "files" && debouncedQuery.trim() === "";
  useEffect(() => {
    if (browsingFullTree && listing.hasNextPage && !listing.isFetchingNextPage) {
      void listing.fetchNextPage();
    }
  }, [browsingFullTree, listing.hasNextPage, listing.isFetchingNextPage, listing.data?.pages.length]);
  const listedDocuments = useMemo(() => listing.data?.pages.flatMap((page) => page.items) ?? [], [listing.data?.pages]);
  const documents = useMemo(() => {
    if (workspace.view !== "favorites") return listedDocuments;
    const needle = debouncedQuery.trim().toLocaleLowerCase("uk-UA");
    return listedDocuments.filter((document) => favoriteIds.has(document.document_id) && (!needle || [document.filename, document.path, document.title, ...document.tags, ...document.aliases, ...document.headings].some((value) => value.toLocaleLowerCase("uk-UA").includes(needle))));
  }, [debouncedQuery, favoriteIds, listedDocuments, workspace.view]);
  const index = listing.data?.pages[0]?.index;
  const snapshotId = listing.data?.pages[0]?.snapshot_id ?? index?.snapshot_id ?? "";
  const activeId = workspace.activeDocumentId;
  const activeTab = workspace.tabs.find((tab) => tab.documentId === activeId) ?? null;
  // Максимум 3 вікна: документ → картка 1 → картка 2. Картка 1 статична (лише породжує картку 2).
  // Картка 2 — термінальна: навігація в самій собі (заміна на місці) з історією c2Hist/c2Pos та стрілками ←/→.
  const [card1, setCard1] = useState<{ id: string; heading?: string } | null>(null);
  const [c2Hist, setC2Hist] = useState<Array<{ id: string; heading?: string }>>([]);
  const [c2Pos, setC2Pos] = useState(-1);
  const card2 = c2Pos >= 0 && c2Pos < c2Hist.length ? c2Hist[c2Pos] : null;
  const detail = useDocumentDetail(activeId, snapshotId || null);
  // Не пінуємо зріз тут: цей список — лише щоб знайти, куди веде клік по вікілінку
  // (навігація, не редагування), а суворий збіг зі snapshotId старів швидше за
  // конвеєр, що комітить щохвилини, — картка мовчки переставала відкриватись.
  const links = useDocumentLinks(activeId, null);
  const backlinks = useDocumentBacklinks(activeId, snapshotId || null);
  const opponentFindings = useOpponentFindings();
  const docFindings = useMemo(
    () => findingsForDocument(opponentFindings.data?.items ?? [], detail.data?.document.path ?? ""),
    [opponentFindings.data, detail.data?.document.path]
  );
  const opponentTargets = useOpponentTargets(docFindings);
  const history = useDocumentHistory(activeId, snapshotId || null);
  const revisionDetail = useDocumentRevisionDetail(activeId, revisionTarget?.history_id ?? null, snapshotId || null);
  const activeDraft = activeId ? workspace.drafts[activeId] : undefined;
  const activeIsImage = detail.data?.format === "image";
  const activeUnsupported = detail.data?.format === "unsupported";
  const visualBlockReason = activeDraft ? visualEditorBlockReason(activeDraft.content, detail.data?.visual_qualification) : "Документ ще не завантажено.";
  const updateDocument = useUpdateDocument();
  const createDocument = useCreateDocument();
  const renameDocument = useRenameDocument();
  const moveDocument = useMoveDocument();
  const previewRestore = useDocumentRestorePreview();
  const restoreDocument = useRestoreDocument();
  const createFolder = useCreateDocumentFolder();
  const refreshIndex = useDocumentIndexMutation("refresh");

  useEffect(() => {
    if (detail.data) dispatch({ type: "load", detail: detail.data });
  }, [detail.data]);

  // Ширина картки в ПІКСЕЛЯХ: (доступна ширина − рейл − А4 − інспектор) / 2. Рахуємо в JS, бо з
  // відсотками контейнер не може стати fit-content (циклічна залежність ширини).
  const routeRef = useRef<HTMLDivElement>(null);
  const [cardPx, setCardPx] = useState(0);
  useEffect(() => {
    const route = routeRef.current;
    const host = route?.parentElement;
    if (!route || !host) return;
    const compute = () => {
      const styles = getComputedStyle(route);
      const hostStyles = getComputedStyle(host);
      const rail = parseFloat(styles.getPropertyValue("--documents-rail")) || 292;
      const inspector = parseFloat(styles.getPropertyValue("--documents-inspector")) || 340;
      // Доступна ширина = вміст host мінус його padding і мінус рамка/padding самого контейнера.
      const chrome =
        parseFloat(hostStyles.paddingLeft) + parseFloat(hostStyles.paddingRight) +
        parseFloat(styles.borderLeftWidth) + parseFloat(styles.borderRightWidth) +
        parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
      const avail = host.clientWidth - chrome;
      setCardPx(Math.max(0, Math.floor((avail - rail - 840 - inspector) / 2)));
    };
    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const closeCard1 = useCallback(() => { setCard1(null); setC2Hist([]); setC2Pos(-1); }, []);
  const closeCard2 = useCallback(() => { setC2Hist([]); setC2Pos(-1); }, []);
  const card2Back = useCallback(() => setC2Pos((p) => Math.max(0, p - 1)), []);
  const card2Forward = useCallback(() => setC2Pos((p) => (p < c2Hist.length - 1 ? p + 1 : p)), [c2Hist.length]);
  // Тимчасовий стан прив'язаний до ДОКУМЕНТА, а не до застосунку (рішення
  // Юрія 2026-08-03). Врізка тепер живе всередині `Prose` (`key={activeId}`
  // нижче примушує її скинутись разом із документом) — тут лишається тільки
  // каскадна картка праворуч.
  useEffect(() => { closeCard1(); setNotice(null); }, [activeId, closeCard1]);
  useEffect(() => {
    if (!card1) return;
    // Esc: спершу картка 2 (термінальна), потім картка 1.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      if (c2Pos >= 0) closeCard2();
      else closeCard1();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card1, c2Pos, closeCard1, closeCard2]);

  // Банер повідомлення гасне сам: він каже про подію, а не про стан, і не має
  // переживати ні перехід між документами, ні наступну дію автора.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setRevisionTarget(null);
      setRestoreRevision(null);
      setRestorePreview(null);
      setRestoreError(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [activeId]);

  useEffect(() => {
    if (!pendingHeading || pendingHeading.documentId !== activeId || activeTab?.mode !== "read" || !activeDraft) return;
    const frame = requestAnimationFrame(() => {
      const scope = document.querySelector<HTMLElement>(".documents-route .document-content");
      if (scope && focusMarkdownHeading(scope, pendingHeading.heading)) setPendingHeading(null);
      else {
        setPendingHeading(null);
        setNotice(`Розділ «${pendingHeading.heading}» не знайдено у відкритому документі.`);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [activeDraft, activeId, activeTab?.mode, pendingHeading]);

  const rootSummaries = useMemo<DocumentRootSummary[]>(() => {
    const map = new Map<string, DocumentRootSummary>();
    for (const page of listing.data?.pages ?? []) for (const root of page.roots ?? []) map.set(root.root_id, root);
    return [...map.values()];
  }, [listing.data?.pages]);
  const listedFolderSummaries = useMemo<DocumentFolderSummary[]>(() => {
    const map = new Map<string, DocumentFolderSummary>();
    for (const page of listing.data?.pages ?? []) for (const folder of page.folders ?? []) map.set(folder.folder_id, folder);
    return [...map.values()];
  }, [listing.data?.pages]);
  const folderSummaries = useMemo<DocumentFolderSummary[]>(() => {
    const map = new Map(listedFolderSummaries.map((folder) => [folder.folder_id, folder]));
    if (expandedFolderProjection.snapshotId === snapshotId) for (const folder of expandedFolderProjection.items) map.set(folder.folder_id, folder);
    return [...map.values()];
  }, [expandedFolderProjection, listedFolderSummaries, snapshotId]);
  const roots = useMemo<DocumentRootOption[]>(() => {
    const map = new Map<string, DocumentRootOption>();
    for (const root of rootSummaries) map.set(root.root_id, { id: root.root_id, label: root.label, writable: root.editable });
    for (const page of listing.data?.pages ?? []) {
      for (const document of page.items) if (!map.has(document.root_id)) map.set(document.root_id, { id: document.root_id, label: document.root_id, writable: document.can_edit });
    }
    return [...map.values()];
  }, [listing.data?.pages, rootSummaries]);
  const kinds = useMemo(() => [...new Set(documents.map((document) => document.kind))].sort(), [documents]);

  const expandFolder = useCallback((expandRootId: string, parentPath: string | null) => {
    if (!snapshotId) return;
    const requestKey = `${snapshotId}:${expandRootId}:${parentPath ?? "<root>"}`;
    if (folderRequests.current.has(requestKey)) return;
    folderRequests.current.add(requestKey);
    void (async () => {
      const collected: DocumentFolderSummary[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const response: DocumentFoldersEnvelope = await documentGet<DocumentFoldersEnvelope>(`/api/v1/documents/folders${queryString({ root_id: expandRootId, parent_path: parentPath, limit: 500, cursor })}`);
        if (response.snapshot_id !== snapshotId) throw new Error("Folder projection snapshot changed");
        collected.push(...response.items);
        cursor = response.next_cursor;
        pages += 1;
      } while (cursor && pages < 4);
      setExpandedFolderProjection((current) => {
        const map = new Map((current.snapshotId === snapshotId ? current.items : []).map((folder) => [folder.folder_id, folder]));
        for (const folder of collected) map.set(folder.folder_id, folder);
        return { snapshotId, items: [...map.values()] };
      });
      if (cursor) setNotice("У папці більше 2 000 вкладених папок; показано bounded першу частину.");
    })().catch(() => setNotice("Не вдалося завантажити вкладені папки для поточного snapshot.")).finally(() => folderRequests.current.delete(requestKey));
  }, [snapshotId]);

  useEffect(() => {
    for (const root of rootSummaries) expandFolder(root.root_id, null);
  }, [expandFolder, rootSummaries]);

  const openDocument = useCallback((document: DocumentSummary) => {
    dispatch({ type: "open", tab: tabFor(document) });
    setPendingHeading(null);
    setRevisionTarget(null);
  }, []);

  const openById = useCallback((documentId: string, heading?: string | null) => {
    const known = documents.find((document) => document.document_id === documentId);
    dispatch({ type: "open", tab: known ? tabFor(known) : placeholderTab(documentId) });
    setPendingHeading(heading ? { documentId, heading } : null);
    setRevisionTarget(null);
  }, [documents]);

  const closeTab = (documentId: string) => {
    const tab = workspace.tabs.find((item) => item.documentId === documentId);
    if (tab?.dirty) {
      setPendingTabClose({ kind: "one", documentId, label: tab.title });
      return;
    }
    dispatch({ type: "close", documentId, force: true });
  };

  const closeOthers = (documentId: string) => {
    const dirtyCount = workspace.tabs.filter((tab) => tab.documentId !== documentId && !tab.pinned && tab.dirty).length;
    if (dirtyCount) {
      setPendingTabClose({ kind: "others", documentId, label: `${dirtyCount} ${dirtyCount === 1 ? "незбережена чернетка" : "незбережених чернеток"}` });
      return;
    }
    dispatch({ type: "closeOthers", documentId, force: true });
  };

  const changeDraft = (content: string, issues: MarkdownIssue[] = []) => {
    if (!activeId) return;
    dispatch({ type: "draft", documentId: activeId, content, warnings: issues.map((issue) => issue.message) });
    setVisualBlocked((current) => ({ ...current, [activeId]: issues.some((issue) => issue.severity === "error") }));
    setNotice(null);
  };

  const saveContent = (content = activeDraft?.content, expectedSha = activeDraft?.baseSha256, expectedSnapshot = activeDraft?.baseSnapshotId) => {
    if (!activeId || !activeTab || content === undefined || !expectedSha || !expectedSnapshot || activeTab.readOnly || updateDocument.isPending) return;
    if (activeTab.mode === "visual" && visualBlocked[activeId]) {
      setNotice("Візуальне збереження заблоковано round-trip кваліфікацією. Перемкніться в Source mode.");
      return;
    }
    const idempotencyKey = newIntentKey("document-save");
    updateDocument.mutate({ payload: { document_id: activeId, content, expected_sha256: expectedSha, expected_snapshot_id: expectedSnapshot, format: "markdown" }, idempotencyKey }, {
      onSuccess: (result) => {
        dispatch({ type: "saved", documentId: activeId, content, sha256: result.document.content_sha256, snapshotId: result.snapshot_id });
        setConflict(null);
        setNotice(result.no_op ? "Змін для збереження немає." : "Документ збережено атомарно.");
      },
      onError: (error) => {
        const typed = error instanceof DocumentApiError ? error.conflict() : null;
        if (typed) setConflict(typed);
        else setNotice(mutationMessage(error));
      }
    });
  };

  // Клік у документі → картка 1 (скидає картку 2).
  // Каскад — основа (Юрій: «в документах картка більше ніж додаткова
  // інформація»), врізка — плюс. Вони не конкурують за клік:
  //   звичайний клік  → картка в панелі, каскадом
  //   ⌥-клік          → врізка просто в тексті, не покидаючи рядка
  //   ціль не знайдена → врізка теж (раніше клік просто мовчав)
  const [autoLink, setAutoLink] = useState<boolean>(() => {
    try { return window.localStorage.getItem("wl_autolink") !== "0"; } catch { return true; }
  });
  const toggleAutoLink = () => setAutoLink((prev) => {
    const next = !prev;
    try { window.localStorage.setItem("wl_autolink", next ? "1" : "0"); } catch { /* noop */ }
    return next;
  });
  // Каскад — головна дія на клік. Коли він безсилий (⌥-клік, чи слово без
  // власного документа), кажемо Prose «не я» (false), і ВОНА сама розкриває
  // врізку під абзацом, де клікнули — той самий механізм, що вже працює в
  // картках і на мапі. Раніше тут була власна копія («InlineStack» у кінці
  // документа) — у документі на тисячі рядків це десятки тисяч пікселів
  // униз, картка з'являлась, а Юрій бачив «нічого не відбулось».
  const resolveWikilink = (target: WikilinkTarget, event?: { altKey: boolean }): boolean => {
    if (event?.altKey) return false;
    // Знахідка опонента першою: ціль — назва варіанта, якого в графі посилань
    // ЦЬОГО документа немає (вікілінк вставлений при рендері, у файлі його
    // нема) — тож звичайний matchingDocumentLink тут завжди мовчав би.
    const opponentId = opponentTargets.data?.get(target.target);
    if (opponentId) { setCard1({ id: opponentId, heading: target.heading ?? undefined }); setC2Hist([]); setC2Pos(-1); return true; }
    const match = matchingDocumentLink(target, links.data?.items ?? []);
    const id = match?.target_document_id ?? (match?.candidates?.length === 1 ? match.candidates[0].document_id : null);
    if (!id) return false;
    setCard1({ id, heading: target.heading ?? match?.heading ?? undefined });
    setC2Hist([]); setC2Pos(-1);
    return true;
  };
  // Кнопки врізки («у панель» / «відкрити картку») ведуть в один і той самий
  // каскад, що й прямий клік по вікілінку (Юрій 2026-09-09: у документах
  // немає «просто відкрити» окремо від каскаду — тут це одна й та сама дія).
  const openCascade = (id: string) => { setCard1({ id }); setC2Hist([]); setC2Pos(-1); };
  // Клік у картці 1 → відкриває/замінює картку 2 (свіжа історія).
  const openFromCard1 = (id: string, heading?: string) => { setC2Hist([{ id, heading }]); setC2Pos(0); };
  // Клік у картці 2 → навігація в самій собі (обрізає forward-історію, додає нову сторінку).
  const openFromCard2 = (id: string, heading?: string) => {
    setC2Hist((h) => [...h.slice(0, c2Pos + 1), { id, heading }]);
    setC2Pos((p) => p + 1);
  };

  const submitAction = (value: DocumentActionValue) => {
    setActionError(null);
    if (!snapshotId) return;
    if (value.kind === "create") {
      createDocument.mutate({ payload: { root_id: value.rootId, folder: value.folder, name: value.name, template: value.template, properties: value.properties, tags: value.tags, expected_snapshot_id: snapshotId } }, {
        onSuccess: (result) => { setAction(null); openDocument(result.document); setNotice("Документ створено."); },
        onError: (error) => setActionError(mutationMessage(error))
      });
    } else if (value.kind === "folder") {
      createFolder.mutate({ payload: { root_id: value.rootId, folder: value.folder, expected_snapshot_id: snapshotId } }, {
        onSuccess: () => { setAction(null); setNotice("Папку створено в дозволеному root."); },
        onError: (error) => setActionError(mutationMessage(error))
      });
    } else if (activeId && activeDraft && detail.data) {
      if (value.kind === "rename") renameDocument.mutate({ payload: { document_id: activeId, name: value.name, expected_sha256: activeDraft.baseSha256, expected_snapshot_id: activeDraft.baseSnapshotId } }, {
        onSuccess: (result) => { dispatch({ type: "title", documentId: activeId, title: result.document.title }); setAction(null); setNotice("Документ перейменовано."); },
        onError: (error) => setActionError(mutationMessage(error))
      });
      else moveDocument.mutate({ payload: { document_id: activeId, destination_root_id: value.rootId, destination_folder: value.folder, expected_sha256: activeDraft.baseSha256, expected_snapshot_id: activeDraft.baseSnapshotId } }, {
        onSuccess: () => { setAction(null); setNotice("Документ переміщено."); },
        onError: (error) => setActionError(mutationMessage(error))
      });
    }
  };

  const requestRestore = (entry: DocumentHistoryEntry) => {
    if (!activeId || !activeDraft || activeTab?.readOnly) return;
    setRestoreRevision(entry);
    setRestorePreview(null);
    setRestoreError(null);
    setNotice("Перевіряємо immutable revision і поточний fingerprint…");
    previewRestore.mutate({
      payload: {
        document_id: activeId,
        history_id: entry.history_id,
        expected_sha256: activeDraft.baseSha256,
        expected_snapshot_id: activeDraft.baseSnapshotId
      }
    }, {
      onSuccess: (preview) => {
        if (preview.document_id !== activeId || preview.history_id !== entry.history_id) {
          setRestoreError("Restore preview не пов'язаний з вибраним документом або history record.");
          setNotice("Restore preview відхилено через невідповідність binding.");
          return;
        }
        setRestorePreview(preview);
        setNotice(null);
      },
      onError: (error) => {
        const message = mutationMessage(error);
        setRestoreError(message);
        setNotice(message);
      }
    });
  };

  const confirmRestore = () => {
    if (!activeId || !activeDraft || !restoreRevision || !restorePreview || typeof restorePreview.restored_content !== "string") return;
    restoreDocument.mutate({
      payload: {
        document_id: activeId,
        history_id: restoreRevision.history_id,
        preview_token: restorePreview.preview_token,
        expected_sha256: restorePreview.current_sha256,
        expected_snapshot_id: restorePreview.snapshot_id,
        confirmed: true
      }
    }, {
      onSuccess: (result) => {
        dispatch({ type: "saved", documentId: activeId, content: restorePreview.restored_content ?? "", sha256: result.document.content_sha256, snapshotId: result.snapshot_id });
        setRestoreRevision(null);
        setRestorePreview(null);
        setRestoreError(null);
        setNotice("Revision відновлено атомарно; audit event записано. Git commit не створювався.");
      },
      onError: (error) => {
        const typed = error instanceof DocumentApiError ? error.conflict() : null;
        if (typed) setConflict(typed);
        setRestoreError(mutationMessage(error));
      }
    });
  };

  const actionPending = createDocument.isPending || createFolder.isPending || renameDocument.isPending || moveDocument.isPending;
  const closeMobileDrawer = () => dispatch({ type: "drawer", drawer: null });
  const openMobileDrawer = (drawer: "navigation" | "inspector", trigger: HTMLElement) => {
    drawerReturnFocusRef.current = trigger;
    dispatch({ type: "drawer", drawer });
  };
  const trapDrawerFocus = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMobileDrawer();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])")]
      .filter((element) => element.getClientRects().length > 0);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div ref={routeRef} className="route documents-route" data-doc-format={sheetFormat} data-cards={card1 ? "open" : undefined} style={{ ["--doc-cards" as string]: String((card1 ? 1 : 0) + (card2 ? 1 : 0)), ["--doc-card" as string]: `${cardPx}px` }} data-editor-scope="documents" data-unsaved-changes={workspace.tabs.some((tab) => tab.dirty) ? "true" : "false"} data-editor-location={`${window.location.pathname}${window.location.search}`} onKeyDown={(event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); if (activeTab?.dirty) saveContent(); }
    }}>
      <div className="documents-commandbar" inert={workspace.mobileDrawer ? true : undefined}>
        <label className="documents-search"><Search size={16} aria-hidden="true" /><input ref={searchInputRef} value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Знайти документ" placeholder={'Назва, текст, tag:, property:relevance=high, is:modified'} /><kbd>⌘ F</kbd></label>
        <div className="documents-quick-views" aria-label="Представлення документів">{views.slice(1, 4).map((view) => <button type="button" aria-pressed={workspace.view === view.id} key={view.id} onClick={() => dispatch({ type: "view", view: view.id })}>{view.label}</button>)}</div>
        <button type="button" className="documents-index-button" onClick={() => refreshIndex.mutate({ expectedSnapshotId: snapshotId || null })} disabled={refreshIndex.isPending}><RefreshCw className={refreshIndex.isPending ? "spin" : ""} size={15} /><span>{index?.state === "current" ? `${index.file_count} · актуальний` : index?.state ?? "індекс"}</span></button>
        <button type="button" className="documents-mobile-panel" onClick={(event) => openMobileDrawer("navigation", event.currentTarget)} aria-controls="documents-navigation-drawer" aria-expanded={workspace.mobileDrawer === "navigation"} aria-label="Відкрити файли"><Menu size={18} /></button>
        <button type="button" className="documents-mobile-panel" onClick={(event) => openMobileDrawer("inspector", event.currentTarget)} aria-controls="documents-inspector-drawer" aria-expanded={workspace.mobileDrawer === "inspector"} aria-label="Відкрити властивості" disabled={!detail.data || !activeDraft}><PanelRight size={18} /></button>
      </div>

      <div className="documents-layout" data-cards={card1 ? "open" : undefined}>
        <aside ref={navigationDrawerRef} id="documents-navigation-drawer" className={`documents-navigation ${workspace.mobileDrawer === "navigation" ? "drawer-open" : ""}`} aria-label="Навігація документами" role={workspace.mobileDrawer === "navigation" ? "dialog" : undefined} aria-modal={workspace.mobileDrawer === "navigation" ? true : undefined} onKeyDown={workspace.mobileDrawer === "navigation" ? trapDrawerFocus : undefined}>
          <header><strong>Документи</strong><button type="button" className="documents-drawer-close" onClick={closeMobileDrawer} aria-label="Закрити файли"><X size={17} /></button><div><button type="button" onClick={() => setAction("create")} disabled={!roots.some((root) => root.writable)}><FilePlus2 size={15} />Новий</button><button type="button" aria-label="Створити папку" onClick={() => setAction("folder")} disabled={!roots.some((root) => root.writable)}><FolderPlus size={15} /></button></div></header>
          <nav aria-label="Зрізи документів">{views.map(({ id, label, icon: Icon }) => <button type="button" className={workspace.view === id ? "active" : ""} key={id} onClick={() => dispatch({ type: "view", view: id })}><Icon size={15} aria-hidden="true" /><span>{label}</span></button>)}</nav>
          <div className="documents-filters"><label><span className="sr-only">Root</span><select value={rootId} onChange={(event) => setRootId(event.target.value)}><option value="">Усі roots</option>{roots.map((root) => <option key={root.id} value={root.id}>{root.label}</option>)}</select></label><label><span className="sr-only">Тип</span><select value={kind} onChange={(event) => setKind(event.target.value)}><option value="">Усі типи</option>{kinds.map((item) => <option value={item} key={item}>{item}</option>)}</select></label><label><span className="sr-only">Політика</span><select value={policyMode} onChange={(event) => setPolicyMode(event.target.value as DocumentRootMode | "all")}><option value="all">Будь-який доступ</option><option value="read_write">Редаговані</option><option value="read_only">Лише читання</option><option value="protected_read_only">Захищені</option></select></label><label><ArrowDownAZ size={14} /><select aria-label="Сортування документів" value={sort} onChange={(event) => setSort(event.target.value as DocumentSort)}><option value="modified_desc">Нещодавно змінені</option><option value="added_desc">Нещодавно додані</option><option value="name_asc">Назва A–Z</option><option value="name_desc">Назва Z–A</option><option value="size_desc">Розмір</option><option value="folder_asc">Папка</option><option value="backlinks_desc">Backlinks</option><option value="links_desc">Вихідні посилання</option></select></label></div>
          {listing.isLoading ? <LoadingState label="Індексуємо дозволені roots…" /> : listing.isError ? <ErrorState error={listing.error} onRetry={() => void listing.refetch()} /> : <DocumentTree documents={documents} folders={folderSummaries} roots={rootSummaries} selectedDocumentId={activeId} loading={listing.isFetching} onOpen={openDocument} onExpandFolder={(expandRootId, parentPath) => expandFolder(expandRootId, parentPath)} />}
          {listing.hasNextPage && !browsingFullTree ? <button type="button" className="documents-load-more" onClick={() => void listing.fetchNextPage()} disabled={listing.isFetchingNextPage}>{listing.isFetchingNextPage ? "Завантажуємо…" : "Показати ще"}</button> : browsingFullTree && listing.isFetchingNextPage ? <div className="documents-load-more" style={{ opacity: 0.6 }}>Завантажуємо дерево…</div> : null}
          <footer aria-live="polite"><span>{documents.length} показано</span><span>{index?.last_refresh_at ? `оновлено ${new Date(index.last_refresh_at).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}` : "ще не оновлювався"}</span></footer>
        </aside>

        <div className="doc-canvas" ref={canvasRef} style={{ ["--doc-font-scale" as string]: String(fontScale) }}>
        <section className="documents-workspace" id="document-workbench" role="tabpanel" aria-label="Відкритий документ" inert={workspace.mobileDrawer ? true : undefined}>
          <DocumentTabs tabs={workspace.tabs} activeDocumentId={activeId} canReopen={workspace.recentlyClosed.length > 0} onActivate={(documentId) => dispatch({ type: "activate", documentId })} onClose={closeTab} onCloseOthers={closeOthers} onPin={(documentId) => dispatch({ type: "pin", documentId })} onReopen={() => dispatch({ type: "reopen" })} />
          {!activeId ? <EmptyState title="Відкрийте документ" action={<button type="button" className="primary-button" onClick={() => setAction("create")} disabled={!roots.some((root) => root.writable)}>Новий документ</button>}>Виберіть файл ліворуч або знайдіть його за назвою, вмістом, тегами й властивостями.</EmptyState> : detail.isError && !activeDraft ? <ErrorState error={detail.error} onRetry={() => void detail.refetch()} /> : !activeDraft ? <LoadingState label="Відкриваємо активний документ…" /> : activeTab && activeDraft ? (
            <CardScope value={activeTab.title}>
            <section className="document-stage" aria-label={activeTab.title}>
              <header className="document-stage-header"><div><span>{detail.data?.document.path ?? activeTab.title}</span><h2>{activeTab.title}</h2><small>{activeTab.readOnly ? <><Shield size={13} /> лише читання</> : activeTab.dirty ? "Є незбережені зміни" : "Збережено"}</small></div><div><button type="button" onClick={() => setFavoriteIds((current) => { const next = new Set(current); if (next.has(activeId)) next.delete(activeId); else if (next.size < 100) next.add(activeId); else setNotice("Можна зберігати не більше 100 обраних документів у session preferences."); return next; })} aria-label={favoriteIds.has(activeId) ? "Прибрати з обраного" : "Додати в обране"}><Star size={14} fill={favoriteIds.has(activeId) ? "currentColor" : "none"} /></button><button type="button" onClick={() => setAction("rename")} disabled={activeTab.readOnly}><Pencil size={14} />Перейменувати</button><button type="button" onClick={() => setAction("move")} disabled={activeTab.readOnly}><Move size={14} />Перемістити</button><button type="button" className="document-save" onClick={() => saveContent()} disabled={activeTab.readOnly || !activeTab.dirty || updateDocument.isPending}><Save size={15} />{updateDocument.isPending ? "Зберігаємо…" : "Зберегти"}</button></div></header>
              <div className="document-modebar" role="toolbar" aria-label="Режим документа">{modes.map(({ id, label, icon: Icon }) => <button type="button" aria-pressed={activeTab.mode === id} key={id} disabled={((activeIsImage || activeUnsupported) && id !== "read") || (id === "visual" && Boolean(visualBlockReason))} title={(activeIsImage || activeUnsupported) && id !== "read" ? "Вкладення доступні лише для читання" : id === "visual" ? visualBlockReason ?? undefined : undefined} onClick={() => { dispatch({ type: "mode", documentId: activeId, mode: id }); if (id !== "diff") setRevisionTarget(null); }}><Icon size={14} aria-hidden="true" />{label}</button>)}<button type="button" className="sheet-light-toggle" aria-pressed={autoLink} title="Підсвічувати сутності, які мають картку, навіть якщо в тексті немає посилання" onClick={toggleAutoLink}><Link2 size={14} aria-hidden="true" />Сутності</button><button type="button" className="sheet-light-toggle" aria-pressed={sheetLight} title="Світлий аркуш: тіло документа на світлому тлі (легше очам)" onClick={toggleSheetLight}><Sun size={14} aria-hidden="true" />Аркуш</button>{sheetLight ? <select className="sheet-tone-select" aria-label="Тон паперу" value={sheetTone} onChange={(event) => changeSheetTone(event.target.value)}><option value="warm">Теплий</option><option value="white">Білий</option><option value="sepia">Сепія</option></select> : null}{(activeTab.mode === "read" || activeTab.mode === "visual") ? <select className="sheet-format-select" aria-label="Формат сторінки" value={sheetFormat} onChange={(event) => changeSheetFormat(event.target.value)} title="Формат читання: А4 вертикальний / А4 горизонтальний / вільний простір на всю ширину (для сценаріїв і широких таблиць)"><option value="a4">А4 ▯</option><option value="a4-land">А4 ▭</option><option value="free">Вільний ⟷</option></select> : null}{(activeTab.mode === "read" || activeTab.mode === "visual") ? <span className="sheet-font-control" role="group" aria-label="Розмір шрифта"><button type="button" onClick={() => bumpFontScale(-0.1)} disabled={fontScale <= 0.7} aria-label="Менший шрифт" title="Менший шрифт">A−</button><button type="button" onClick={() => bumpFontScale(0.1)} disabled={fontScale >= 1.8} aria-label="Більший шрифт" title="Більший шрифт">A+</button></span> : null}</div>
              {notice ? <div className="documents-notice" role="status">{notice}<button type="button" onClick={() => setNotice(null)} aria-label="Приховати повідомлення"><X size={14} /></button></div> : null}
              <div className={`document-content${sheetLight && (activeTab.mode === "read" || activeTab.mode === "visual") ? " sheet-light" : ""}`} data-sheet-tone={sheetLight ? sheetTone : undefined} data-sheet-format={sheetFormat}>
                {activeIsImage && detail.data ? <DocumentImageView detail={detail.data} /> : null}
                {activeUnsupported ? <div className="doc-visual-unavailable" role="status"><strong>Для цього формату немає безпечного viewer</strong><p>Файл видно в керованому workspace, але його вміст не передано браузеру.</p></div> : null}
                {!activeIsImage && !activeUnsupported && activeTab.mode === "read" ? <Prose key={activeId} content={activeDraft.content} autoLink={autoLink} findings={docFindings} onOpenWikilinkOverride={resolveWikilink} onOpenDocument={openCascade} onOpenPanel={openCascade} onOpenSource={() => dispatch({ type: "mode", documentId: activeId, mode: "source" })} onOpenRelativeLink={(target) => { const match = links.data?.items.find((link) => link.target === target); if (match?.target_document_id) openById(match.target_document_id, match.heading); else setNotice("Відносне посилання не дозволене або не знайдене."); }} resolveImage={(target) => { const asset = detail.data?.assets?.[target]; return typeof asset === "string" ? asset : asset?.url ?? (target.startsWith("/api/v1/documents/") ? target : null); }} /> : null}
                {/* «У сутності» — замовлення картки з виділення в читанні
                    (рішення Юрія 2026-08-03). Кнопка плаває над текстом, поки
                    є виділення; текст документа не змінюється ніколи. */}
                {!activeIsImage && !activeUnsupported && activeTab.mode === "read" ? (
                  <EntitySelectionAction
                    documentPath={detail.data?.document.path ?? activeTab.title}
                    onOrder={setEntityOrder}
                  />
                ) : null}
                {!activeIsImage && !activeUnsupported && activeTab.mode === "source" ? <Suspense fallback={<LoadingState label="Завантажуємо Source editor…" />}><SourceEditor key={`${activeId}:${activeDraft.baseSha256}:${detail.data?.line_ending ?? "unknown"}`} value={activeDraft.content} readOnly={activeTab.readOnly} issues={inspectMarkdownForVisualEditing(activeDraft.content)} lineNumbers onChange={(content) => changeDraft(content)} onSave={() => saveContent()} onToggleVisual={() => dispatch({ type: "mode", documentId: activeId, mode: "visual" })} /></Suspense> : null}
                {!activeIsImage && !activeUnsupported && activeTab.mode === "visual" ? visualBlockReason ? <div className="doc-visual-unavailable" role="alert"><strong>Візуальний редактор не відкрито</strong><p>{visualBlockReason}</p><button type="button" onClick={() => dispatch({ type: "mode", documentId: activeId, mode: "source" })}>Відкрити Source mode</button></div> : <Suspense fallback={<LoadingState label="Завантажуємо візуальний editor…" />}><VisualEditor key={`${activeId}:${activeDraft.baseSha256}`} value={activeDraft.content} readOnly={activeTab.readOnly} qualification={detail.data?.visual_qualification} onChange={changeDraft} onSave={() => saveContent()} onToggleSource={() => dispatch({ type: "mode", documentId: activeId, mode: "source" })} /></Suspense> : null}
                {!activeIsImage && !activeUnsupported && activeTab.mode === "diff" ? revisionTarget ? revisionDetail.isLoading ? <LoadingState label="Завантажуємо immutable revision…" /> : revisionDetail.isError ? <ErrorState error={revisionDetail.error} onRetry={() => void revisionDetail.refetch()} /> : revisionDetail.data ? <DocumentDiff original={revisionDetail.data.content} current={activeDraft.content} /> : null : <DocumentDiff original={activeDraft.baseContent} current={activeDraft.content} /> : null}
              </div>
            </section>
            </CardScope>
          ) : null}
        {entityOrder ? (
          <EntityOrderDialog
            request={entityOrder}
            onClose={() => setEntityOrder(null)}
            onDone={(message) => setNotice(message)}
            onOpenCard={(path) => {
              // Картку знаємо за шляхом, а відкриваємо за id — беремо його
              // пошуком, як робить решта переходів у Документах.
              void (async () => {
                try {
                  const found = await documentGet<{ items: Array<{ path: string; document_id: string }> }>(
                    `/api/v1/documents/search?q=${encodeURIComponent(path.split("/").pop()?.replace(/\.md$/, "") ?? path)}`
                  );
                  const hit = found.items.find((item) => item.path === path) ?? found.items[0];
                  if (hit) openById(hit.document_id);
                  else setNotice("Картку знайдено в індексі імен, але не в дереві документів.");
                } catch {
                  setNotice("Не вдалося відкрити картку.");
                }
              })();
            }}
          />
        ) : null}
        </section>

          {card1 ? <DocumentPeek key="card1" sheetLight={sheetLight} sheetTone={sheetTone} documentId={card1.id} heading={card1.heading} index={0} showNav={false} snapshotId={snapshotId || null} onClose={closeCard1} onOpenFull={(id, heading) => { closeCard1(); openById(id, heading); }} onOpenLink={(_i, id, heading) => openFromCard1(id, heading)} /> : null}
          {card2 ? <DocumentPeek key="card2" sheetLight={sheetLight} sheetTone={sheetTone} documentId={card2.id} heading={card2.heading} index={1} showNav snapshotId={snapshotId || null} canBack={c2Pos > 0} canForward={c2Pos < c2Hist.length - 1} onBack={card2Back} onForward={card2Forward} onClose={closeCard2} onOpenFull={(id, heading) => { closeCard1(); openById(id, heading); }} onOpenLink={(_i, id, heading) => openFromCard2(id, heading)} /> : null}
        </div>

        {detail.data && activeDraft ? <div ref={inspectorDrawerRef} id="documents-inspector-drawer" className={`documents-inspector-shell ${workspace.mobileDrawer === "inspector" ? "drawer-open" : ""}`} role={workspace.mobileDrawer === "inspector" ? "dialog" : undefined} aria-modal={workspace.mobileDrawer === "inspector" ? true : undefined} aria-label={workspace.mobileDrawer === "inspector" ? "Відомості про документ" : undefined} onKeyDown={workspace.mobileDrawer === "inspector" ? trapDrawerFocus : undefined}><DocumentInspector detail={detail.data} content={activeDraft.content} section={workspace.inspectorSection} links={links.data} backlinks={backlinks.data} history={history.data} propertyEditingDisabled={activeTab?.mode === "visual"} onSectionChange={(section) => dispatch({ type: "inspector", section })} onContentChange={(content, warning) => { changeDraft(content); if (warning) setNotice(warning); }} onOpenDocument={openById} onPreviewRevision={(entry) => { setRevisionTarget(entry); dispatch({ type: "mode", documentId: activeId!, mode: "diff" }); }} onRequestRestore={requestRestore} onShowInGraph={() => onShowInGraph(activeId!)} onClose={closeMobileDrawer} /></div> : null}
      </div>

      {action ? <DocumentActionDialog kind={action} roots={roots} initialName={action === "rename" ? detail.data?.document.filename : ""} initialRootId={detail.data?.document.root_id} initialFolder={action === "move" ? folderWithinRoot(detail.data?.document.path ?? "", rootSummaries.find((root) => root.root_id === detail.data?.document.root_id)?.path ?? "") : ""} pending={actionPending} error={actionError} onCancel={() => { setAction(null); setActionError(null); }} onSubmit={submitAction} /> : null}
      {conflict && activeDraft ? <DocumentConflictDialog key={`${conflict.document_id}:${conflict.current_sha256}:${conflict.proposed_sha256}`} conflict={conflict} baseContent={activeDraft.baseContent} draftContent={activeDraft.content} onCancel={() => setConflict(null)} onResolve={(content, sha256, currentSnapshot) => saveContent(content, sha256, currentSnapshot)} /> : null}
      {restoreRevision && restorePreview && activeDraft ? <DocumentRestoreDialog revision={restoreRevision} preview={restorePreview} fallbackCurrentContent={activeDraft.baseContent} pending={restoreDocument.isPending} error={restoreError} onCancel={() => { setRestoreRevision(null); setRestorePreview(null); setRestoreError(null); }} onConfirm={confirmRestore} /> : null}
      {pendingTabClose ? (
        <Dialog className="small-modal panel" role="alertdialog" labelledBy="close-document-tabs-title" describedBy="close-document-tabs-description" closeOnBackdrop={false} initialFocus="cancel" onClose={() => setPendingTabClose(null)}>
          <header><div><span className="eyebrow">Session draft</span><h2 id="close-document-tabs-title">Закрити без збереження?</h2></div></header>
          <p id="close-document-tabs-description">{pendingTabClose.kind === "one" ? `Чернетку «${pendingTabClose.label}» буде видалено з поточної сесії.` : `${pendingTabClose.label} буде видалено з поточної сесії.`} Файли на диску не зміняться.</p>
          <footer><button type="button" data-dialog-cancel onClick={() => setPendingTabClose(null)}>Залишити вкладки відкритими</button><button className="danger-button" type="button" onClick={() => { if (pendingTabClose.kind === "one") dispatch({ type: "close", documentId: pendingTabClose.documentId, force: true }); else dispatch({ type: "closeOthers", documentId: pendingTabClose.documentId, force: true }); setPendingTabClose(null); }}>Закрити без збереження</button></footer>
        </Dialog>
      ) : null}
      {workspace.mobileDrawer ? <button className="documents-drawer-scrim" type="button" onClick={closeMobileDrawer} aria-label="Закрити бічну панель" tabIndex={-1} /> : null}
    </div>
  );
}

export default Documents;
