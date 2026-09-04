import { create } from "zustand";
import { api, setAuthToken, ProjectChangedError } from "@/api/client";
import { applyAppearance, getStoredMode, type ThemeMode } from "@/theme";
import { genId } from "@/id";
import { getStoredProjectLang, setStoredProjectLang, getStoredEditorPreviewLang, setStoredEditorPreviewLang } from "@/i18n/projectI18n";
import { normalizeTrendObjects } from "@/canvas/trendModel";
import { uguale } from "@/ai/confronto";
import type {
  AlarmDef,
  LanguageTable,
  AlarmState,
  CustomSymbol,
  FaceplateDef,
  FunctionDef,
  GridCell,
  LogEvent,
  NotificationConfig,
  ObjectGroup,
  PageLayoutConfig,
  ProjectInfo,
  SourceDef,
  SubCellEntry,
  SubGrid,
  SynopticObject,
  SynopticPage,
  TagDef,
  TagState,
} from "@/types";

export interface HistoryEntry {
  pages: SynopticPage[];
  label: string;
  /** Value of `pagesRev` for the state stored in `pages`. Carried through
   *  undo/redo so the dirty check survives time travel: undoing back to the
   *  revision that was saved makes the project clean again. */
  rev: number;
  /** Snapshot di `project` — presente **solo** nelle voci spinte da una
   *  transazione dell'assistente (T-50).
   *
   *  La history nasce per le sole pagine, e per le modifiche a mano va bene:
   *  tag, sorgenti e allarmi si cambiano da ConfigView, che ha il proprio
   *  Salva. Una proposta dell'assistente però tocca le due metà insieme — un
   *  bottone MQTT è una sorgente, un tag e un oggetto in pagina — e un
   *  annullamento che ne recuperasse solo una sarebbe peggio di nessun
   *  annullamento, perché *sembra* funzionare.
   *
   *  Presente solo lì e non ovunque perché uno snapshot del progetto intero
   *  costa, e la history tiene 200 passi: si paga quando l'assistente lavora,
   *  non a ogni pixel di un drag. `undefined` = questa voce non cambia il
   *  progetto; il valore in vigore è quello della voce più vicina che ne porta
   *  uno. */
  project?: ProjectInfo | null;
}

/** Una proposta dell'assistente, come arriva da `/ws/ai`. */
export interface AiProposta {
  id: string;
  motivo: string;
  /** Il progetto INTERO con la modifica dentro. Assente = non lo tocca. */
  project?: ProjectInfo | null;
  /** Le pagine INTERE modificate. Assente = non tocca pagine. */
  pages?: SynopticPage[] | null;
  /** Impronta del progetto su disco quando l'assistente ha cominciato. */
  impronta?: string | null;
}

/** Esito di `applyAiProposal`. `avviso` non blocca: informa. */
export interface EsitoProposta {
  ok: boolean;
  motivo?: string;
  avviso?: string;
}

// Cap the in-memory log list. The runtime keeps ~1000 events in its ring,
// but a long-running browser session will accumulate many more from the WS
// stream; trim aggressively so React stays responsive.
const LOG_LIMIT = 2000;

// ── Auth persistence ────────────────────────────────────────────────────
// Persist the session token in localStorage so a page refresh doesn't kick
// the operator back to the login screen. Username + token only — no secrets.

const AUTH_KEY = "sws.auth";

type PersistedAuth = { token: string; username: string; role?: string; must_change_password?: boolean; expires_at_ms?: number | null };

function readPersistedAuth(): PersistedAuth | null {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(AUTH_KEY) : null;
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.token === "string" && typeof parsed?.username === "string") {
      // Discard already-expired sessions so we never restore a stale token.
      if (typeof parsed.expires_at_ms === "number" && Date.now() >= parsed.expires_at_ms) {
        return null;
      }
      return parsed;
    }
  } catch { /* ignore */ }
  return null;
}

function isRole(s: unknown): s is Role {
  return s === "Viewer" || s === "Operator" || s === "Supervisor" || s === "Admin";
}

function writePersistedAuth(payload: PersistedAuth | null) {
  try {
    if (payload) localStorage.setItem(AUTH_KEY, JSON.stringify(payload));
    else         localStorage.removeItem(AUTH_KEY);
  } catch { /* ignore */ }
}

function makePage(name: string): SynopticPage {
  return { id: genId(), name, objects: [] };
}

/** Shallow clone of a SynopticPage, deep-cloning the objects array. */
function clonePages(pages: SynopticPage[]): SynopticPage[] {
  return pages.map((p) => ({
    ...p,
    objects: p.objects.map((o) => ({ ...o })),
  }));
}

// ── Sub-cell tree traversal ───────────────────────────────────────────────
//
// The grid cell layout supports recursive split: a `GridCell` can have
// `sub: SubGrid { orientation, ratio, a?, b? }`, and each slot (a/b) is a
// `SubCellEntry` that may itself have a `sub`. The helpers below walk that
// tree by a `path: ("a" | "b")[]`. They return new objects (immutable
// update) so they're safe to drop into Zustand `set` callbacks.

/** Update the SubGrid at the given path inside `cell.sub`. Empty path =
 *  the cell-level sub. Path of length 1 = inside slot a/b's own sub.
 *  Returns a new GridCell. Bails (returns unchanged) if the path is
 *  invalid (e.g., walks into a slot whose `sub` is absent). */
function updateSubGridAtPath(
  cell: GridCell,
  path: ("a" | "b")[],
  fn: (sg: SubGrid) => SubGrid | undefined,
): GridCell {
  // Empty path: the target is cell.sub itself.
  if (path.length === 0) {
    if (!cell.sub) return cell;
    const next = fn(cell.sub);
    return { ...cell, sub: next };
  }
  // Recurse: target is path[0]'s entry, then walk path[1..].
  if (!cell.sub) return cell;
  const [head, ...rest] = path;
  const entry = cell.sub[head];
  if (!entry?.sub && rest.length > 0) return cell;
  // Build a synthetic cell where cell.sub is the entry's sub, recurse, and
  // splice the result back in.
  if (rest.length === 0) {
    // Path ends here — apply `fn` to entry.sub
    if (!entry?.sub) return cell;
    const nextSubGrid = fn(entry.sub);
    const nextEntry = { ...entry, sub: nextSubGrid };
    return { ...cell, sub: { ...cell.sub, [head]: nextEntry } };
  }
  // Deeper recursion: treat entry as a pseudo-cell. The early-return above
  // already ensured entry.sub exists when there are remaining path steps.
  const pseudoCell: GridCell = { row: 0, col: 0, sub: entry!.sub };
  const updatedPseudo = updateSubGridAtPath(pseudoCell, rest, fn);
  const nextEntry = { ...entry!, sub: updatedPseudo.sub };
  return { ...cell, sub: { ...cell.sub, [head]: nextEntry } };
}

/** Update the `SubCellEntry` at the given path (path must be non-empty —
 *  empty paths refer to the cell itself, which is a `GridCell`, not an entry). */
function updateSubCellEntryAtPath(
  cell: GridCell,
  path: ("a" | "b")[],
  fn: (entry: SubCellEntry | undefined) => SubCellEntry | undefined,
): GridCell {
  if (path.length === 0) return cell; // can't address a SubCellEntry with empty path
  const head = path[path.length - 1];
  const parentPath = path.slice(0, -1);
  return updateSubGridAtPath(cell, parentPath, (sg) => ({ ...sg, [head]: fn(sg[head]) }));
}

const HISTORY_LIMIT = 200;

/** F8.2 — campi copiati dal "copia stile". Solo aspetto: niente `tag`, niente
 *  geometria, niente azioni o binding. Aggiungere qui un campo nuovo di stile
 *  è l'unico passo necessario perché il pennello lo trasporti. */
const STYLE_KEYS = [
  "fill", "stroke", "stroke_width", "stroke_dasharray", "color", "bg_color", "bg_image",
  "corner_radius", "fill_gradient", "gradient_light_color", "gradient_dark_color",
  "font_size", "font_weight", "font_family", "text_anchor", "opacity",
  "quality_dot", "quality_dot_good_color", "quality_dot_bad_color", "quality_dot_uncertain_color",
  "transition_duration_ms", "blink_mode", "blink_rate_ms",
] as const satisfies readonly (keyof SynopticObject)[];

/** Object alignment commands operating on a set of objects.
 *  F8.1: `distribute-*` spazia a GAP uguali (prima distribuiva le posizioni,
 *  che con oggetti di larghezza diversa lascia spazi diversi); `match-*`
 *  uniforma le dimensioni al primo oggetto della selezione. */
export type AlignMode =
  | "left" | "center-x" | "right"
  | "top"  | "middle-y" | "bottom"
  | "distribute-x" | "distribute-y"
  | "match-width" | "match-height";

export type Role = "Viewer" | "Operator" | "Supervisor" | "Admin";
export type AppMode = "edit" | "config";
export type AppConfigTab = "tags" | "protocols" | "alarms" | "scripts" | "faceplates" | "recipes" | "notifications" | "languages" | "datastores" | "users" | "resources" | "system" | "backups" | "devices" | "runtime" | "ide";

interface AppState {
  // Auth
  authToken: string | null;
  authUser: string | null;
  authRole: Role | null;
  /** Unix timestamp (ms) when the session expires. Used to schedule proactive
   *  token refresh. Null when unknown (old persisted sessions without expiry). */
  expiresAtMs: number | null;
  /** True while the server insists the current account changes its password.
   *  The App shell renders ChangePasswordScreen until this clears. */
  mustChangePassword: boolean;
  /** True when the runtime has no active project (GET /api/project → 503).
   *  The App shell renders WelcomeScreen until a project is opened. */
  noActiveProject: boolean;

  project: ProjectInfo | null;
  projectLoadError: string | null;
  customSymbols: CustomSymbol[];
  faceplates: FaceplateDef[];
  pages: SynopticPage[];
  currentPageId: string;
  /** Primary selection — `null` when nothing or many. Equals `selectedObjectIds[0]` when one. */
  selectedObjectId: string | null;
  /** Full selection set. Length === 0 → nothing selected; 1 → single; >1 → multi. */
  selectedObjectIds: string[];
  /** Currently-focused FunctionDef.id (when editing a function). Mutually
   *  exclusive with object selection — selecting one clears the other. */
  selectedFunctionId: string | null;
  /** Currently-selected grid cell in edit mode (moved from EditorShell local state). */
  selectedCell: { objectId: string; row: number; col: number } | null;
  /** The child object inside the selected cell that has been individually clicked. */
  selectedCellChild: { objectId: string; row: number; col: number } | null;
  /** Rectangular range of grid cells selected for merge. Normalised so r1≤r2, c1≤c2. */
  selectedCellRange: { objectId: string; r1: number; c1: number; r2: number; c2: number } | null;
  /** Slot inside a split cell that the user clicked, for sub-cell property
   *  editing. `path` is the chain of slot keys from the cell down to the
   *  selected entry — `["a"]` for a first-level split, `["a","b"]` for a
   *  deeper one, and so on. */
  selectedSubCell: { objectId: string; row: number; col: number; path: ("a" | "b")[] } | null;
  /** Snapshot stacks for undo/redo. Each entry is a labeled clone of `pages`. */
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** Cut/paste buffer (in-memory only — not persisted across reloads). */
  clipboard: SynopticObject[];
  /** Page id the clipboard contents came from. Used by pasteClipboard to
   *  decide whether to keep grouping (same page → yes) and whether to
   *  offset coords (same page → +20 to avoid overlap, cross-page → 0). */
  clipboardSourcePageId: string | null;

  tagValues: Record<string, TagState>;
  alarms: Record<string, AlarmState>;
  /** Recent runtime log events streamed from /ws/logs. Capped at LOG_LIMIT.
   *  Oldest first; new events append. */
  logs: LogEvent[];
  gridSize: number;
  snapEnabled: boolean;
  gridColor: string;
  /** Canvas rulers visible. Two entry points (editor toolbar + the corner
   *  square inside the canvas), hence global rather than local to SvgCanvas. */
  showRulers: boolean;
  toggleRulers: () => void;

  saveStatus: "idle" | "saving" | "ok" | "error";
  saveError: string | null;
  /** Q30: l'ultimo salvataggio è stato **rifiutato** perché il progetto era
   *  cambiato da quando lo si è caricato.
   *
   *  Distinto da `saveError` perché il rimedio è diverso e opposto a quello
   *  istintivo: non si ritenta — con gli stessi dati vecchi si prenderebbe lo
   *  stesso rifiuto — si ricarica. Sul disco non è stato scritto niente e il
   *  lavoro di chi ha salvato prima è intatto. */
  saveConflict: boolean;
  setSaveConflict: (v: boolean) => void;

  // ── Unsaved-changes tracking ──────────────────────────────────────────
  //
  // Two independent sources feed `selectIsDirty`:
  //
  //  1. `pages` — a monotonic revision counter. Every mutation bumps it and
  //     stamps the pre-mutation value into the history entry, so undo/redo
  //     restore the revision along with the pages. A save records the
  //     current revision in `savedPagesRev`.
  //  2. everything else — a registry of components that hold an unsaved
  //     draft (ConfigView tabs, the function editor). Each registers *how*
  //     to save itself, so `saveAll()` can flush them.
  //
  // Deliberately NOT dirty-tracked: the `updateProject*` setters. Those tabs
  // PUT to the API first and only then update the store, so the store copy
  // always matches disk — marking them dirty would make the project dirty
  // forever.
  /** Monotonic revision of `pages`. Only ever set by mutations and time travel. */
  pagesRev: number;
  /** Value of `pagesRev` at the last fully successful save. */
  savedPagesRev: number;
  /** Page names known to exist on disk, snapshotted whenever pages are freshly
   *  loaded (setPages). Used by saveAll() to detect pages deleted/renamed since
   *  then — a name that dropped out of the current `pages` array but is still
   *  in here means its file on disk needs to be removed, not just left orphaned. */
  persistedPageNames: string[];
  /** Sections with an unsaved draft, keyed by owner → flush function. */
  pendingSections: Record<string, () => Promise<void>>;
  /** Register (or, with `save === null`, deregister) a section holding a draft. */
  registerPendingSection: (key: string, save: (() => Promise<void>) | null) => void;
  /** Mark the current page revision as persisted. Only after a *complete* save. */
  markPagesSaved: () => void;
  /** Drop all unsaved-changes state (used when closing a project or logging out). */
  resetDirty: () => void;
  setSaveStatus: (s: "idle" | "saving" | "ok" | "error", e?: string | null) => void;
  /** Segnala "salvataggio riuscito" per i tab che salvano fuori da saveAll()
   *  (Tag/Sorgenti/Allarmi) — vedi commento sull'implementazione. */
  markSaveOk: () => void;
  /** Persist everything: pending section drafts first, then all pages and
   *  (for Admins) the project-level collections. Callable from any mode. */
  saveAll: () => Promise<void>;

  /** True when the session token expired mid-session. Shows ReAuthModal overlay. */
  reAuthNeeded: boolean;

  setAuth: (token: string, username: string, role: Role, mustChangePassword?: boolean, expiresAtMs?: number | null) => void;
  setExpiresAtMs: (ms: number | null) => void;
  setMustChangePassword: (flag: boolean) => void;
  setReAuthNeeded: (v: boolean) => void;
  clearAuth: () => void;
  setNoActiveProject: (flag: boolean) => void;

  /** Light/dark theme preference (persisted in localStorage by @/theme). */
  themeMode: ThemeMode;
  setThemeMode: (m: ThemeMode) => void;

  /** Lingua CORRENTE dei contenuti di progetto (tabella lingue, T-40).
   *  Asse indipendente dalla lingua UI. "" = usa il default della tabella. */
  projectLang: string;
  setProjectLang: (code: string) => void;

  /** Lingua di ANTEPRIMA dell'editor: in quale lingua il canvas dell'IDE
   *  risolve i token degli oggetti. Impostata dal tab Lingue; "" = default
   *  della tabella. Indipendente da projectLang (lingua attiva del viewer). */
  editorPreviewLang: string;
  setEditorPreviewLang: (code: string) => void;

  setProject: (p: ProjectInfo) => void;
  setProjectLoadError: (msg: string | null) => void;
  updateProjectTags: (tags: TagDef[]) => void;
  updateProjectSources: (sources: SourceDef[]) => void;
  updateProjectLanguages: (languages: LanguageTable) => void;
  updateProjectAlarms: (alarms: AlarmDef[]) => void;
  updateProjectNotifications: (notifications: NotificationConfig | null) => void;
  updateProjectPageLayout: (pageLayout: PageLayoutConfig | null) => void;
  updateProjectFunctions: (functions: FunctionDef[]) => void;
  updateProjectCustomSymbols: (symbols: CustomSymbol[]) => void;
  setFaceplates: (faceplates: FaceplateDef[]) => void;
  /** Clears every project-scoped field (project, pages, custom symbols,
   *  faceplates, selection/history) back to "nothing loaded". Call this
   *  BEFORE switching `noActiveProject` in either direction, so the
   *  EditorShell never remounts showing the previous project's canvas
   *  while the new project's data is still in flight. */
  resetProjectState: () => void;

  // ── Function CRUD (project-level reusable Python). All mutations push to
  //    `past` for undo and need to be persisted with api.updateFunctions
  //    by the caller — the store keeps the project tree in memory only.
  addFunction: () => string;        // returns the new id
  duplicateFunction: (id: string) => string | null;
  updateFunction: (id: string, patch: Partial<FunctionDef>) => void;
  renameFunction: (id: string, name: string) => void;
  deleteFunction: (id: string) => void;
  selectFunction: (id: string | null) => void;

  // Page management
  setPages: (pages: SynopticPage[], currentPageId?: string) => void;
  addPage: () => void;
  deletePage: (id: string) => void;
  renamePage: (id: string, name: string) => void;
  reorderPage: (id: string, dir: "up" | "down") => void;
  movePage: (id: string, toIndex: number) => void;
  duplicatePage: (id: string) => void;
  updatePageProps: (id: string, patch: Partial<Pick<SynopticPage, "name" | "background" | "background_dark" | "width" | "height" | "auto_rotate_skip" | "zones" | "locked">>) => void;
  updateGridCell: (pageId: string, objectId: string, cell: GridCell) => void;
  setSelectedCellRange: (range: { objectId: string; r1: number; c1: number; r2: number; c2: number } | null) => void;
  setSelectedSubCell: (sub: { objectId: string; row: number; col: number; path: ("a" | "b")[] } | null) => void;
  /** Merge an N×M range of cells into the top-left origin (rs/cs spans).
   *  Returns an error message if the range overlaps with another existing merge. */
  mergeCellRange: (pageId: string, objectId: string, r1: number, c1: number, r2: number, c2: number) => string | null;
  /** Reset rowspan/colspan on a previously-merged cell. */
  unmergeCell: (pageId: string, objectId: string, row: number, col: number) => void;
  /** Subdivide a cell or any sub-cell at the given path into 1×2 / 2×1.
   *  Empty path = cell level (migrates `child` to `sub.a`); non-empty path =
   *  recursive split of an existing sub-cell entry. */
  splitCell: (pageId: string, objectId: string, row: number, col: number, orientation: "rows" | "cols", path?: ("a" | "b")[]) => void;
  /** Remove the mini-grid at the given path. Empty path = cell level. */
  joinSplitCell: (pageId: string, objectId: string, row: number, col: number, path?: ("a" | "b")[]) => void;
  /** Update the `ratio` of the sub-grid at the given path during drag. */
  resizeSubBorder: (pageId: string, objectId: string, row: number, col: number, path: ("a" | "b")[], newRatio: number) => void;
  /** Patch fields of a sub-cell entry at the given path (bg_color, child, …).
   *  No-history per call: the panel coalesces edits via the existing interaction
   *  bracket only when needed; otherwise each save pushes one history entry. */
  updateSubCellAt: (pageId: string, objectId: string, row: number, col: number, path: ("a" | "b")[], patch: { bg_color?: string; bg_image?: string; visible?: boolean; visible_tag?: string; on_press_fn?: string; on_release_fn?: string; child?: SynopticObject; }) => void;
  setCurrentPage: (id: string) => void;
  setSelectedCell: (cell: { objectId: string; row: number; col: number } | null) => void;
  setSelectedCellChild: (cell: { objectId: string; row: number; col: number } | null) => void;

  // Object CRUD (operates on current page)
  selectObject: (id: string | null) => void;
  toggleSelection: (id: string) => void;
  selectMany: (ids: string[]) => void;
  clearSelection: () => void;
  addObject: (partial: Omit<SynopticObject, "id">) => void;
  updateObject: (id: string, patch: Partial<SynopticObject>) => void;
  /** Cattura waypoint dal canvas (MOVIMENTO SU PERCORSO): id dell'oggetto in
   *  cattura, o null. Effimero, non persistito. */
  capturePathTarget: string | null;
  setCapturePathTarget: (id: string | null) => void;
  /** Toggle toolbar "Anteprima effetti": applica in editor blink/motion/
   *  bordo allarme/stale/flusso pipe/rotazioni. Effimero, default off. */
  previewEffects: boolean;
  setPreviewEffects: (on: boolean) => void;
  /** Crocino sul canvas per il waypoint in focus nella tabella MOVIMENTO. */
  motionMarker: { x: number; y: number } | null;
  setMotionMarker: (pt: { x: number; y: number } | null) => void;
  updateObjects: (ids: string[], patch: Partial<SynopticObject>) => void;
  duplicateObject: (id: string) => void;
  duplicateSelection: () => void;
  deleteObject: (id: string) => void;
  deleteSelection: () => void;
  reorderObject: (id: string, dir: "front" | "forward" | "backward" | "back") => void;

  // Clipboard
  copySelection: () => void;
  pasteClipboard: () => void;
  /** F8.2 — copia stile: memorizza i campi di stile dell'oggetto indicato
   *  (o del primo selezionato) e li applica alla selezione corrente. */
  copyStyle: (objectId?: string) => void;
  applyStyle: () => void;
  styleClipboard: Partial<SynopticObject> | null;
  setClipboard: (objs: SynopticObject[], sourcePageId?: string | null) => void;

  // Alignment & distribution (multi-select)
  alignSelection: (mode: AlignMode) => void;

  // Undo / redo
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  jumpToPast: (index: number) => void;
  jumpToFuture: (index: number) => void;

  /**
   * Bracketed interaction (drag, resize, etc.). Captures the pre-state in
   * a single history entry on `begin`, then suspends per-mutation history
   * pushes until `end`. Without this, a 200 px drag turns into 200 undo
   * steps because `updateObject` pushes on every pixel.
   */
  beginInteraction: (label: string) => void;
  endInteraction: () => void;

  /** Applica una proposta dell'assistente come **una sola** transazione.
   *
   *  È il pezzo che tiene insieme le due metà del progetto. Le pagine stanno
   *  nella history e aspettano Salva; tag, sorgenti e allarmi no — ConfigView
   *  li scrive su disco subito, con il proprio Salva. Una proposta che tocca
   *  entrambe (un bottone MQTT è una sorgente, un tag e un oggetto) applicata
   *  per metà, e annullata per metà, è peggio di una non applicata.
   *
   *  Qui invece: un solo passo di history che porta anche il progetto, e le
   *  sezioni toccate registrate in `pendingSections` — così niente raggiunge
   *  il disco finché nessuno preme Salva, e Salva le scrive tutte insieme. */
  applyAiProposal: (p: AiProposta) => Promise<EsitoProposta>;

  // Object grouping (UI-only, no canvas effect)
  groupObjects: (ids: string[], name?: string) => void;
  ungroupObjects: (groupId: string) => void;
  renameGroup: (groupId: string, name: string) => void;
  moveObjectToGroup: (objId: string, groupId: string | null) => void;
  /** Reorder an object in the page array next to another object, inheriting its group_id. */
  moveObjectAdjacent: (objId: string, targetId: string, place: "before" | "after") => void;
  /** Append an object at the end of a group (or to the ungrouped tail when null). */
  moveObjectToGroupEnd: (objId: string, groupId: string | null) => void;
  /** Reorder a group next to another group. Target null = end of list. */
  moveGroupAdjacent: (groupId: string, targetGroupId: string | null, place: "before" | "after") => void;

  // Tag values from WebSocket
  updateTagValue: (id: string, state: TagState) => void;

  // Alarms
  setAlarms: (list: AlarmState[]) => void;
  updateAlarm: (state: AlarmState) => void;

  // Logs
  setLogs: (list: LogEvent[]) => void;
  appendLog: (ev: LogEvent) => void;
  clearLogs: () => void;

  // Canvas settings
  setGridSize: (size: number) => void;
  setSnapEnabled: (enabled: boolean) => void;
  setGridColor: (color: string) => void;

  // App-level navigation (allows cross-view navigation, e.g. LeftPanel → ConfigView)
  appMode: AppMode;
  configTab: AppConfigTab;
  setAppMode: (mode: AppMode) => void;
  setConfigTab: (tab: AppConfigTab) => void;
  navigateToConfig: (tab: AppConfigTab) => void;

  // Kiosk auto-rotate
  autoRotate: boolean;
  autoRotateIntervalS: number;
  setAutoRotate: (v: boolean) => void;
  setAutoRotateIntervalS: (v: number) => void;

  // Remote runtime bridge (relay via /ws/remote/*)
  remoteConnected: boolean;
  remoteUrl: string | null;
  setRemoteConnected: (connected: boolean, url?: string | null) => void;
  remoteDeployStatus: "idle" | "syncing" | "ok" | "error";
}

const first = makePage("Page 1");

// Hydrate persisted auth at module load time so api.client picks up the
// token before the first network request fires.
const persisted = readPersistedAuth();
if (persisted) setAuthToken(persisted.token);

/** Pending timeout that flips `saveStatus` back from "ok" to "idle". */
let saveOkTimer: number | null = null;

const RULERS_KEY = "sws.canvas.showRulers";
/** Rulers default to visible; only an explicit "0" hides them. */
function readShowRulers(): boolean {
  try { return localStorage.getItem(RULERS_KEY) !== "0"; }
  catch { return true; }
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * After a successful save, push the project to the connected remote runtime.
 * Fire-and-forget: the header Deploy button reflects `remoteDeployStatus`.
 */
function autoDeployIfConnected() {
  const { remoteConnected, authToken: tok } = useAppStore.getState();
  if (!remoteConnected) return;
  useAppStore.setState({ remoteDeployStatus: "syncing" });
  const hdrs: HeadersInit = tok ? { "Authorization": `Bearer ${tok}` } : {};
  fetch("/api/remote/deploy", { method: "POST", headers: hdrs })
    .then(async (res) => {
      if (res.body) {
        const rdr = res.body.getReader();
        while (!(await rdr.read()).done) { /* drain streaming body */ }
      }
      useAppStore.setState({ remoteDeployStatus: res.ok ? "ok" : "error" });
    })
    .catch(() => useAppStore.setState({ remoteDeployStatus: "error" }))
    .finally(() => {
      setTimeout(() => useAppStore.setState({ remoteDeployStatus: "idle" }), 3000);
    });
}

/**
 * True when anything is unsaved: the canvas has moved away from the revision
 * that was last persisted, or some section holds a draft. Returns a boolean
 * (not an object), so it is safe with zustand's default equality check.
 */
export const selectIsDirty = (s: AppState) =>
  s.pagesRev !== s.savedPagesRev || Object.keys(s.pendingSections).length > 0;

export const useAppStore = create<AppState>((set, get) => {
  // Suspend per-mutation history pushes while > 0. Lets a drag/resize
  // capture one history entry up front (at beginInteraction) instead of
  // one per pixel.
  let interactionDepth = 0;

  /**
   * Push a labeled snapshot of the current `pages` onto the history stack
   * before applying a mutation. Clears the redo stack. Capped at HISTORY_LIMIT.
   * Becomes a no-op while inside a bracketed interaction.
   */
  const pushHistory = (label: string) => {
    if (interactionDepth > 0) return;
    const { pages, past, pagesRev } = get();
    const entry: HistoryEntry = { pages: clonePages(pages), label, rev: pagesRev };
    const trimmed = past.length >= HISTORY_LIMIT
      ? past.slice(past.length - HISTORY_LIMIT + 1)
      : past;
    set({ past: [...trimmed, entry], future: [], pagesRev: pagesRev + 1 });
  };

  /** Force-push a history entry even mid-interaction; used by begin.
   *  `project` va passato solo dalle transazioni dell'assistente — vedi il
   *  commento su `HistoryEntry.project`. */
  const pushHistoryUnconditional = (label: string, project?: ProjectInfo | null) => {
    const { pages, past, pagesRev } = get();
    const entry: HistoryEntry = { pages: clonePages(pages), label, rev: pagesRev };
    if (project !== undefined) entry.project = project;
    const trimmed = past.length >= HISTORY_LIMIT
      ? past.slice(past.length - HISTORY_LIMIT + 1)
      : past;
    set({ past: [...trimmed, entry], future: [], pagesRev: pagesRev + 1 });
  };

  /** Helper: object id → page id (current page only). */
  const findObj = (id: string): SynopticObject | undefined => {
    const { pages, currentPageId } = get();
    return pages.find((p) => p.id === currentPageId)?.objects.find((o) => o.id === id);
  };

  return {
    authToken: persisted?.token ?? null,
    authUser:  persisted?.username ?? null,
    authRole:  isRole(persisted?.role) ? (persisted!.role as Role) : null,
    expiresAtMs: persisted?.expires_at_ms ?? null,
    mustChangePassword: persisted?.must_change_password === true,
    noActiveProject: false,
    reAuthNeeded: false,

    project: null,
    projectLoadError: null,
    customSymbols: [],
    faceplates: [],
    pages: [first],
    currentPageId: first.id,
    selectedObjectId: null,
    selectedObjectIds: [],
    selectedFunctionId: null,
    selectedCell: null,
    selectedCellChild: null,
    selectedCellRange: null,
    selectedSubCell: null,
    past: [],
    future: [],
    clipboard: [],
    clipboardSourcePageId: null,
    styleClipboard: null,
    tagValues: {},
    alarms: {},
    logs: [],
    gridSize: 10,
    snapEnabled: true,
    gridColor: "#1e293b",
    showRulers: readShowRulers(),
    saveStatus: "idle",
    saveConflict: false,
    setSaveConflict: (v: boolean) => set({ saveConflict: v }),
    saveError: null,
    pagesRev: 0,
    savedPagesRev: 0,
    persistedPageNames: [],
    pendingSections: {},

    setAuth: (token, username, role, mustChangePassword = false, expiresAtMs) => {
      setAuthToken(token);
      writePersistedAuth({ token, username, role, must_change_password: mustChangePassword, expires_at_ms: expiresAtMs });
      set({ authToken: token, authUser: username, authRole: role, mustChangePassword, expiresAtMs: expiresAtMs ?? null });
    },

    setExpiresAtMs: (ms) => {
      const { authToken, authUser, authRole, mustChangePassword } = get();
      if (authToken && authUser && authRole) {
        writePersistedAuth({ token: authToken, username: authUser, role: authRole, must_change_password: mustChangePassword, expires_at_ms: ms });
      }
      set({ expiresAtMs: ms });
    },

    setReAuthNeeded: (v) => set({ reAuthNeeded: v }),

    setMustChangePassword: (flag) => {
      const { authToken, authUser, authRole, expiresAtMs } = get();
      if (authToken && authUser && authRole) {
        writePersistedAuth({
          token: authToken,
          username: authUser,
          role: authRole,
          must_change_password: flag,
          expires_at_ms: expiresAtMs ?? undefined,
        });
      }
      set({ mustChangePassword: flag });
    },

    clearAuth: () => {
      setAuthToken(null);
      writePersistedAuth(null);
      set({ authToken: null, authUser: null, authRole: null, expiresAtMs: null, mustChangePassword: false });
    },

    setNoActiveProject: (flag) => set({ noActiveProject: flag }),

    themeMode: getStoredMode(),
    setThemeMode: (m) => { applyAppearance(m); set({ themeMode: m }); },

    projectLang: getStoredProjectLang(),
    setProjectLang: (code) => { setStoredProjectLang(code); set({ projectLang: code }); },

    editorPreviewLang: getStoredEditorPreviewLang(),
    setEditorPreviewLang: (code) => { setStoredEditorPreviewLang(code); set({ editorPreviewLang: code }); },

    setProject: (project) => set({ project, projectLoadError: null, customSymbols: project.custom_symbols ?? [] }),
    setProjectLoadError: (msg) => set({ projectLoadError: msg }),

    updateProjectTags: (tags) =>
      set((s) => ({ project: s.project ? { ...s.project, tags } : s.project })),

    updateProjectSources: (sources) =>
      set((s) => ({ project: s.project ? { ...s.project, sources } : s.project })),

    updateProjectLanguages: (languages) =>
      set((s) => ({ project: s.project ? { ...s.project, languages } : s.project })),

    updateProjectAlarms: (alarms) =>
      set((s) => ({ project: s.project ? { ...s.project, alarms } : s.project })),

    updateProjectNotifications: (notifications) =>
      set((s) => ({ project: s.project ? { ...s.project, notifications: notifications ?? undefined } : s.project })),

    updateProjectPageLayout: (pageLayout) =>
      set((s) => ({ project: s.project ? { ...s.project, page_layout: pageLayout ?? undefined } : s.project })),

    updateProjectFunctions: (functions) =>
      set((s) => ({ project: s.project ? { ...s.project, functions } : s.project })),

    updateProjectCustomSymbols: (symbols) =>
      set((s) => ({
        customSymbols: symbols,
        project: s.project ? { ...s.project, custom_symbols: symbols } : s.project,
      })),

    setFaceplates: (faceplates) => set({ faceplates }),

    resetProjectState: () => {
      get().setPages([], "");
      set({ project: null, projectLoadError: null, customSymbols: [], faceplates: [], alarms: {} });
    },

    // ── Function CRUD ──────────────────────────────────────────────────────
    // Mutations live in the in-memory `project.functions`; the caller is
    // responsible for persisting via `api.updateFunctions(...)`. We DON'T
    // push history snapshots here — undo only tracks page edits.

    addFunction: () => {
      const id = genId();
      const fn: FunctionDef = {
        id,
        name: `funzione_${id.slice(-4)}`,
        description: undefined,
        code: '# scrivi qui il corpo della funzione\n',
        params: [],
      };
      set((s) => ({
        project: s.project
          ? { ...s.project, functions: [...(s.project.functions ?? []), fn] }
          : s.project,
        selectedFunctionId: id,
        selectedObjectId: null,
        selectedObjectIds: [],
      }));
      return id;
    },

    duplicateFunction: (id) => {
      const { project } = get();
      const src = project?.functions?.find((f) => f.id === id);
      if (!src) return null;
      const copyId = genId();
      const copy: FunctionDef = {
        ...src,
        id: copyId,
        name: `${src.name}_copia`,
        params: src.params.map((p) => ({ ...p })),
      };
      set((s) => ({
        project: s.project
          ? { ...s.project, functions: [...(s.project.functions ?? []), copy] }
          : s.project,
        selectedFunctionId: copyId,
      }));
      return copyId;
    },

    updateFunction: (id, patch) =>
      set((s) => ({
        project: s.project
          ? {
              ...s.project,
              functions: (s.project.functions ?? []).map((f) =>
                f.id === id ? { ...f, ...patch } : f),
            }
          : s.project,
      })),

    renameFunction: (id, name) =>
      set((s) => ({
        project: s.project
          ? {
              ...s.project,
              functions: (s.project.functions ?? []).map((f) =>
                f.id === id ? { ...f, name } : f),
            }
          : s.project,
      })),

    deleteFunction: (id) =>
      set((s) => ({
        project: s.project
          ? {
              ...s.project,
              functions: (s.project.functions ?? []).filter((f) => f.id !== id),
            }
          : s.project,
        selectedFunctionId: s.selectedFunctionId === id ? null : s.selectedFunctionId,
      })),

    setSelectedCell: (cell) =>
      set((s) => {
        const prev = s.selectedCell;
        const same = prev && cell &&
          prev.objectId === cell.objectId && prev.row === cell.row && prev.col === cell.col;
        // Setting a single cell clears multi-cell and sub-cell selection so
        // the panel can show the right UI without flicker.
        return {
          selectedCell: cell,
          selectedCellChild: same ? s.selectedCellChild : null,
          selectedCellRange: null,
          selectedSubCell: same ? s.selectedSubCell : null,
        };
      }),

    setSelectedCellChild: (cell) => set({ selectedCellChild: cell }),

    setSelectedCellRange: (range) =>
      set((s) => {
        if (!range) return { selectedCellRange: null };
        // Normalise to r1≤r2, c1≤c2 so consumers don't have to guess.
        const r1 = Math.min(range.r1, range.r2);
        const r2 = Math.max(range.r1, range.r2);
        const c1 = Math.min(range.c1, range.c2);
        const c2 = Math.max(range.c1, range.c2);
        // Setting a multi-cell range clears the sub-cell focus; the single
        // selectedCell stays put so the user can still see "where the range
        // started" if helpful.
        return {
          selectedCellRange: { objectId: range.objectId, r1, c1, r2, c2 },
          selectedSubCell: null,
          // Also drop any cell-child focus (range edits live at cell level).
          selectedCellChild: s.selectedCellChild,
        };
      }),

    setSelectedSubCell: (sub) => set({ selectedSubCell: sub }),

    setPages: (pages, currentPageId) =>
      set({
        // Migrazione trend legacy → trend_tags al load (taglio netto,
        // 2026-08-23): il primo salvataggio scrive solo il formato nuovo.
        pages: pages.map((p) => {
          const objs = normalizeTrendObjects(p.objects);
          return objs === p.objects ? p : { ...p, objects: objs };
        }),
        currentPageId: currentPageId ?? pages[0]?.id ?? first.id,
        selectedObjectId: null,
        selectedObjectIds: [],
        selectedCell: null,
        selectedCellChild: null,
        selectedCellRange: null,
        selectedSubCell: null,
        past: [],
        future: [],
        // Freshly loaded from disk: revision baseline resets to clean.
        pagesRev: 0,
        savedPagesRev: 0,
        // Snapshot of what's actually on disk right now, so saveAll() can
        // later tell a deleted/renamed page apart from one that was simply
        // never loaded in the first place.
        persistedPageNames: pages.map((p) => p.name),
      }),

    addPage: () => {
      pushHistory("Nuova pagina");
      const page = makePage(`Page ${get().pages.length + 1}`);
      set((s) => ({
        pages: [...s.pages, page],
        currentPageId: page.id,
        selectedObjectId: null,
        selectedObjectIds: [],
      }));
    },

    deletePage: (id) => {
      const { pages, currentPageId } = get();
      if (pages.length <= 1) return;
      pushHistory("Elimina pagina");
      const next = pages.filter((p) => p.id !== id);
      set({
        pages: next,
        currentPageId: currentPageId === id ? next[0].id : currentPageId,
        selectedObjectId: null,
        selectedObjectIds: [],
      });
    },

    renamePage: (id, name) => {
      pushHistory("Rinomina pagina");
      set((s) => ({ pages: s.pages.map((p) => (p.id === id ? { ...p, name } : p)) }));
    },

    reorderPage: (id, dir) => {
      pushHistory("Riordina pagine");
      set((s) => {
        const idx = s.pages.findIndex((p) => p.id === id);
        if (idx < 0) return s;
        const pages = [...s.pages];
        const [page] = pages.splice(idx, 1);
        const newIdx = dir === "up" ? Math.max(0, idx - 1) : Math.min(pages.length, idx + 1);
        pages.splice(newIdx, 0, page);
        return { pages };
      });
    },

    movePage: (id, toIndex) => {
      pushHistory("Riordina pagine");
      set((s) => {
        const idx = s.pages.findIndex((p) => p.id === id);
        if (idx < 0) return s;
        const pages = [...s.pages];
        const [page] = pages.splice(idx, 1);
        const clamped = Math.max(0, Math.min(pages.length, toIndex));
        pages.splice(clamped, 0, page);
        return { pages };
      });
    },

    duplicatePage: (id) => {
      pushHistory("Duplica pagina");
      set((s) => {
        const page = s.pages.find((p) => p.id === id);
        if (!page) return s;
        const ts = Date.now();
        const copy: SynopticPage = {
          ...page,
          id: `page_${ts}`,
          name: `${page.name} (copia)`,
          objects: page.objects.map((o, i) => ({
            ...o,
            id: `${o.id}_c${i}`,
          })),
        };
        const idx = s.pages.findIndex((p) => p.id === id);
        const pages = [...s.pages];
        pages.splice(idx + 1, 0, copy);
        return { pages, currentPageId: copy.id };
      });
    },

    updatePageProps: (id, patch) => {
      pushHistory("Proprietà pagina");
      set((s) => ({ pages: s.pages.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
    },

    updateGridCell: (pageId, objectId, cell) => {
      pushHistory("Modifica cella");
      set((s) => ({
        pages: s.pages.map((p) =>
          p.id === pageId
            ? {
                ...p,
                objects: p.objects.map((o) => {
                  if (o.id !== objectId) return o;
                  const cells = (o.grid_cells ?? []) as GridCell[];
                  const idx = cells.findIndex((c) => c.row === cell.row && c.col === cell.col);
                  const next = idx >= 0
                    ? cells.map((c, i) => (i === idx ? cell : c))
                    : [...cells, cell];
                  return { ...o, grid_cells: next };
                }),
              }
            : p
        ),
      }));
    },

    mergeCellRange: (pageId, objectId, r1, c1, r2, c2) => {
      // Normalise + bail on degenerate ranges.
      const rs = Math.max(r1, r2) - Math.min(r1, r2) + 1;
      const cs = Math.max(c1, c2) - Math.min(c1, c2) + 1;
      if (rs < 1 || cs < 1) return "Range non valido.";
      if (rs === 1 && cs === 1) return "Seleziona almeno due celle.";
      const topR = Math.min(r1, r2);
      const topC = Math.min(c1, c2);

      // Look up the grid object first so we can validate before mutating.
      const page = get().pages.find((p) => p.id === pageId);
      const obj = page?.objects.find((o) => o.id === objectId);
      if (!obj || obj.type !== "grid") return "Oggetto non trovato.";
      const cells = (obj.grid_cells ?? []) as GridCell[];

      // Reject if any cell inside the range is already the origin of a merge
      // whose footprint extends outside the new range — that would orphan the
      // overlapping portion.
      for (const c of cells) {
        const cRs = c.rowspan ?? 1;
        const cCs = c.colspan ?? 1;
        if (cRs === 1 && cCs === 1) continue;
        const inside = c.row >= topR && c.row < topR + rs && c.col >= topC && c.col < topC + cs;
        if (!inside) continue;
        const extendsOut = c.row + cRs > topR + rs || c.col + cCs > topC + cs;
        if (extendsOut) {
          return `La cella (${c.row},${c.col}) ha già un merge che sborderebbe.`;
        }
      }

      pushHistory("Unisci celle");
      set((s) => ({
        pages: s.pages.map((p) =>
          p.id !== pageId ? p : {
            ...p,
            objects: p.objects.map((o) => {
              if (o.id !== objectId || o.type !== "grid") return o;
              const list = (o.grid_cells ?? []) as GridCell[];
              // Drop every entry strictly inside the range (origin is updated below).
              const survivors = list.filter((c) =>
                !(c.row >= topR && c.row < topR + rs &&
                  c.col >= topC && c.col < topC + cs) ||
                (c.row === topR && c.col === topC)
              );
              const originIdx = survivors.findIndex((c) => c.row === topR && c.col === topC);
              const origin: GridCell = originIdx >= 0
                ? { ...survivors[originIdx], rowspan: rs, colspan: cs }
                : { row: topR, col: topC, rowspan: rs, colspan: cs };
              const next = originIdx >= 0
                ? survivors.map((c, i) => (i === originIdx ? origin : c))
                : [...survivors, origin];
              return { ...o, grid_cells: next };
            }),
          }
        ),
        selectedCellRange: null,
        selectedCell: { objectId, row: topR, col: topC },
      }));
      return null;
    },

    unmergeCell: (pageId, objectId, row, col) => {
      pushHistory("Annulla unione");
      set((s) => ({
        pages: s.pages.map((p) =>
          p.id !== pageId ? p : {
            ...p,
            objects: p.objects.map((o) => {
              if (o.id !== objectId || o.type !== "grid") return o;
              const list = (o.grid_cells ?? []) as GridCell[];
              const next = list.map((c) => {
                if (c.row !== row || c.col !== col) return c;
                // Strip span fields; preserve everything else.
                const { rowspan: _rs, colspan: _cs, ...rest } = c;
                return rest;
              });
              return { ...o, grid_cells: next };
            }),
          }
        ),
      }));
    },

    splitCell: (pageId, objectId, row, col, orientation, path = []) => {
      pushHistory(path.length === 0 ? "Dividi cella" : "Dividi sub-cella");
      set((s) => ({
        pages: s.pages.map((p) =>
          p.id !== pageId ? p : {
            ...p,
            objects: p.objects.map((o) => {
              if (o.id !== objectId || o.type !== "grid") return o;
              const list = (o.grid_cells ?? []) as GridCell[];
              const idx = list.findIndex((c) => c.row === row && c.col === col);
              const prev: GridCell = idx >= 0 ? list[idx] : { row, col };
              let updated: GridCell;
              if (path.length === 0) {
                // Cell-level split: migrate any existing `child` to sub.a.
                const newSub: SubGrid = {
                  orientation,
                  ratio: 0.5,
                  a: prev.child ? { child: prev.child } : undefined,
                };
                updated = { ...prev, child: undefined, sub: newSub };
              } else {
                // Sub-level split: target the entry at `path`, migrate its
                // child into the new mini-grid's slot A.
                updated = updateSubCellEntryAtPath(prev, path, (entry) => {
                  const e = entry ?? {};
                  const newSub: SubGrid = {
                    orientation,
                    ratio: 0.5,
                    a: e.child ? { child: e.child } : undefined,
                  };
                  return { ...e, child: undefined, sub: newSub };
                });
              }
              const next = idx >= 0
                ? list.map((c, i) => (i === idx ? updated : c))
                : [...list, updated];
              return { ...o, grid_cells: next };
            }),
          }
        ),
      }));
    },

    joinSplitCell: (pageId, objectId, row, col, path = []) => {
      pushHistory(path.length === 0 ? "Rimuovi split" : "Rimuovi split sub-cella");
      set((s) => ({
        pages: s.pages.map((p) =>
          p.id !== pageId ? p : {
            ...p,
            objects: p.objects.map((o) => {
              if (o.id !== objectId || o.type !== "grid") return o;
              const list = (o.grid_cells ?? []) as GridCell[];
              const next = list.map((c) => {
                if (c.row !== row || c.col !== col) return c;
                if (path.length === 0) {
                  // Cell-level un-split: lift `sub.a.child` (or .b.child) back to cell-level.
                  const promoted = c.sub?.a?.child ?? c.sub?.b?.child;
                  const { sub: _sub, ...rest } = c;
                  return promoted ? { ...rest, child: promoted } : rest;
                }
                // Sub-level un-split: clear the entry's `sub`, promote its
                // sub.a.child (or .b.child) back into the entry's child.
                return updateSubCellEntryAtPath(c, path, (entry) => {
                  if (!entry?.sub) return entry;
                  const promoted = entry.sub.a?.child ?? entry.sub.b?.child;
                  const { sub: _sub, ...rest } = entry;
                  return promoted ? { ...rest, child: promoted } : rest;
                });
              });
              return { ...o, grid_cells: next };
            }),
          }
        ),
        selectedSubCell: null,
      }));
    },

    resizeSubBorder: (pageId, objectId, row, col, path, newRatio) => {
      // No pushHistory — the SvgCanvas drag interaction bracket covers it.
      set((s) => ({
        pages: s.pages.map((p) =>
          p.id !== pageId ? p : {
            ...p,
            objects: p.objects.map((o) => {
              if (o.id !== objectId || o.type !== "grid") return o;
              const list = (o.grid_cells ?? []) as GridCell[];
              const next = list.map((c) => {
                if (c.row !== row || c.col !== col) return c;
                // path is the path TO THE SUBGRID being resized. Empty path
                // means cell.sub itself; non-empty means a nested SubGrid
                // inside that path's entry.
                if (path.length === 0) {
                  if (!c.sub) return c;
                  return { ...c, sub: { ...c.sub, ratio: newRatio } };
                }
                return updateSubGridAtPath(c, path, (sg) => ({ ...sg, ratio: newRatio }));
              });
              return { ...o, grid_cells: next };
            }),
          }
        ),
      }));
    },

    updateSubCellAt: (pageId, objectId, row, col, path, patch) => {
      pushHistory("Modifica sub-cella");
      set((s) => ({
        pages: s.pages.map((p) =>
          p.id !== pageId ? p : {
            ...p,
            objects: p.objects.map((o) => {
              if (o.id !== objectId || o.type !== "grid") return o;
              const list = (o.grid_cells ?? []) as GridCell[];
              const next = list.map((c) => {
                if (c.row !== row || c.col !== col) return c;
                return updateSubCellEntryAtPath(c, path, (entry) => ({ ...(entry ?? {}), ...patch }));
              });
              return { ...o, grid_cells: next };
            }),
          }
        ),
      }));
    },

    setCurrentPage: (id) => set({
      currentPageId: id,
      selectedObjectId: null,
      selectedObjectIds: [],
      selectedFunctionId: null,
      selectedCell: null,
      selectedCellChild: null,
      selectedCellRange: null,
      selectedSubCell: null,
    }),

    selectObject: (id) =>
      set({
        selectedObjectId: id,
        selectedObjectIds: id ? [id] : [],
        selectedFunctionId: null,
        selectedCell: null,
        selectedCellChild: null,
        selectedCellRange: null,
        selectedSubCell: null,
      }),

    toggleSelection: (id) => set((s) => {
      const has = s.selectedObjectIds.includes(id);
      const ids = has
        ? s.selectedObjectIds.filter((x) => x !== id)
        : [...s.selectedObjectIds, id];
      return {
        selectedObjectIds: ids,
        selectedObjectId: ids.length === 1 ? ids[0] : null,
        selectedFunctionId: null,
      };
    }),

    selectMany: (ids) =>
      set({
        selectedObjectIds: [...ids],
        selectedObjectId: ids.length === 1 ? ids[0] : null,
        selectedFunctionId: null,
      }),

    clearSelection: () =>
      set({ selectedObjectId: null, selectedObjectIds: [], selectedFunctionId: null,
            selectedCell: null, selectedCellChild: null,
            selectedCellRange: null, selectedSubCell: null }),

    selectFunction: (id) =>
      set({
        selectedFunctionId: id,
        // Editing a function preempts the object/page properties panel.
        selectedObjectId: null,
        selectedObjectIds: [],
      }),

    addObject: (partial) => {
      pushHistory(`Aggiungi ${partial.type}`);
      const obj: SynopticObject = { ...partial, id: genId() };
      set((s) => {
        // Nessuna pagina corrente valida (progetto vuoto senza sinottici, o
        // currentPageId disallineato): crea al volo una prima pagina con dentro
        // l'oggetto, così la palette funziona anche a progetto appena creato.
        if (!s.pages.some((p) => p.id === s.currentPageId)) {
          const page: SynopticPage = { ...makePage(`Page ${s.pages.length + 1}`), objects: [obj] };
          return {
            pages: [...s.pages, page],
            currentPageId: page.id,
            selectedObjectId: obj.id,
            selectedObjectIds: [obj.id],
          };
        }
        return {
          pages: s.pages.map((p) =>
            p.id === s.currentPageId ? { ...p, objects: [...p.objects, obj] } : p
          ),
          selectedObjectId: obj.id,
          selectedObjectIds: [obj.id],
        };
      });
    },

    capturePathTarget: null,
    setCapturePathTarget: (id) => set({ capturePathTarget: id }),
    previewEffects: false,
    setPreviewEffects: (on) => set({ previewEffects: on }),
    motionMarker: null,
    setMotionMarker: (pt) => set({ motionMarker: pt }),
    updateObject: (id, patch) => {
      pushHistory("Modifica oggetto");
      set((s) => ({
        pages: s.pages.map((p) =>
          p.id === s.currentPageId
            ? { ...p, objects: p.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)) }
            : p
        ),
      }));
    },

    updateObjects: (ids, patch) => {
      pushHistory("Modifica oggetti");
      set((s) => ({
        pages: s.pages.map((p) =>
          p.id === s.currentPageId
            ? { ...p, objects: p.objects.map((o) => (ids.includes(o.id) ? { ...o, ...patch } : o)) }
            : p
        ),
      }));
    },

    duplicateObject: (id) => {
      const src = findObj(id);
      if (!src) return;
      pushHistory("Duplica oggetto");
      const copy: SynopticObject = {
        ...src,
        id: genId(),
        name: src.name ? `${src.name} (copia)` : undefined,
        x: (src.x ?? 0) + 20,
        y: (src.y ?? 0) + 20,
        x2: src.x2 != null ? src.x2 + 20 : undefined,
        y2: src.y2 != null ? src.y2 + 20 : undefined,
      };
      set((s) => ({
        pages: s.pages.map((p) =>
          p.id === s.currentPageId ? { ...p, objects: [...p.objects, copy] } : p
        ),
        selectedObjectId: copy.id,
        selectedObjectIds: [copy.id],
      }));
    },

    duplicateSelection: () => {
      const { selectedObjectIds, pages, currentPageId } = get();
      if (selectedObjectIds.length === 0) return;
      const page = pages.find((p) => p.id === currentPageId);
      if (!page) return;
      pushHistory("Duplica selezione");
      const newIds: string[] = [];
      const copies: SynopticObject[] = selectedObjectIds
        .map((id) => page.objects.find((o) => o.id === id))
        .filter((o): o is SynopticObject => !!o)
        .map((src) => {
          const id = genId();
          newIds.push(id);
          return {
            ...src,
            id,
            name: src.name ? `${src.name} (copia)` : undefined,
            x: (src.x ?? 0) + 20,
            y: (src.y ?? 0) + 20,
            x2: src.x2 != null ? src.x2 + 20 : undefined,
            y2: src.y2 != null ? src.y2 + 20 : undefined,
          };
        });
      set((s) => ({
        pages: s.pages.map((p) =>
          p.id === currentPageId ? { ...p, objects: [...p.objects, ...copies] } : p
        ),
        selectedObjectIds: newIds,
        selectedObjectId: newIds.length === 1 ? newIds[0] : null,
      }));
    },

    deleteObject: (id) => {
      pushHistory("Elimina oggetto");
      set((s) => {
        const ids = s.selectedObjectIds.filter((x) => x !== id);
        return {
          pages: s.pages.map((p) =>
            p.id === s.currentPageId
              ? { ...p, objects: p.objects.filter((o) => o.id !== id) }
              : p
          ),
          selectedObjectIds: ids,
          selectedObjectId: ids.length === 1 ? ids[0] : null,
        };
      });
    },

    deleteSelection: () => {
      const { selectedObjectIds } = get();
      if (selectedObjectIds.length === 0) return;
      pushHistory("Elimina selezione");
      const deleting = new Set(selectedObjectIds);
      set((s) => ({
        pages: s.pages.map((p) =>
          p.id === s.currentPageId
            ? { ...p, objects: p.objects.filter((o) => !deleting.has(o.id)) }
            : p
        ),
        selectedObjectId: null,
        selectedObjectIds: [],
      }));
    },

    reorderObject: (id, dir) => {
      pushHistory("Riordina oggetto");
      set((s) => {
        const page = s.pages.find((p) => p.id === s.currentPageId);
        if (!page) return s;
        const idx = page.objects.findIndex((o) => o.id === id);
        if (idx < 0) return s;
        const objs = [...page.objects];
        const [obj] = objs.splice(idx, 1);
        if      (dir === "front")   objs.push(obj);
        else if (dir === "back")    objs.unshift(obj);
        else if (dir === "forward") objs.splice(Math.min(idx + 1, objs.length), 0, obj);
        else                        objs.splice(Math.max(idx - 1, 0), 0, obj);
        return { pages: s.pages.map((p) => p.id === s.currentPageId ? { ...p, objects: objs } : p) };
      });
    },

    copySelection: () => {
      const { selectedObjectIds, pages, currentPageId } = get();
      if (selectedObjectIds.length === 0) return;
      const page = pages.find((p) => p.id === currentPageId);
      if (!page) return;
      const picked = selectedObjectIds
        .map((id) => page.objects.find((o) => o.id === id))
        .filter((o): o is SynopticObject => !!o)
        .map((o) => ({ ...o })); // shallow clone — values are primitives or arrays we'll overwrite on paste
      set({ clipboard: picked, clipboardSourcePageId: currentPageId });
    },

    // F8.2 — format painter. La whitelist è esplicita: mai `tag`, `id`, `type`,
    // geometria o azioni, altrimenti "copia stile" copierebbe anche il dato e
    // due oggetti finirebbero a leggere la stessa variabile.
    copyStyle: (objectId) => {
      const { selectedObjectIds, pages, currentPageId } = get();
      const page = pages.find((p) => p.id === currentPageId);
      if (!page) return;
      const id = objectId ?? selectedObjectIds[0];
      const src = page.objects.find((o) => o.id === id);
      if (!src) return;
      const style: Partial<SynopticObject> = {};
      for (const k of STYLE_KEYS) {
        if (src[k] !== undefined) (style as Record<string, unknown>)[k] = src[k];
      }
      set({ styleClipboard: style });
    },

    applyStyle: () => {
      const { styleClipboard, selectedObjectIds, currentPageId } = get();
      if (!styleClipboard || selectedObjectIds.length === 0) return;
      pushHistory("Applica stile");
      set((s) => ({
        pages: s.pages.map((p) => p.id !== currentPageId ? p : {
          ...p,
          objects: p.objects.map((o) =>
            selectedObjectIds.includes(o.id) ? { ...o, ...styleClipboard } : o),
        }),
      }));
    },

    pasteClipboard: () => {
      const { clipboard, currentPageId, clipboardSourcePageId } = get();
      if (clipboard.length === 0) return;
      // Same-page paste behaves like a duplicate: offset by +20 to make the
      // copies visually distinct, and keep group_id so the original
      // grouping is preserved.
      // Cross-page paste keeps the original coordinates (no overlap risk on
      // the destination page) and strips group_id (the destination page's
      // group registry doesn't know about the source page's groups).
      const samePage = clipboardSourcePageId === currentPageId;
      pushHistory("Incolla");
      const newIds: string[] = [];
      const copies = clipboard.map((src) => {
        const id = genId();
        newIds.push(id);
        const offset = samePage ? 20 : 0;
        const out: SynopticObject = {
          ...src,
          id,
          name: src.name ? `${src.name} (incolla)` : undefined,
          x: (src.x ?? 0) + offset,
          y: (src.y ?? 0) + offset,
          x2: src.x2 != null ? src.x2 + offset : undefined,
          y2: src.y2 != null ? src.y2 + offset : undefined,
        };
        if (!samePage) delete out.group_id;
        return out;
      });
      set((s) => ({
        pages: s.pages.map((p) =>
          p.id === currentPageId ? { ...p, objects: [...p.objects, ...copies] } : p
        ),
        selectedObjectIds: newIds,
        selectedObjectId: newIds.length === 1 ? newIds[0] : null,
      }));
    },

    setClipboard: (objs, sourcePageId = null) =>
      set({ clipboard: objs, clipboardSourcePageId: sourcePageId }),

    alignSelection: (mode) => {
      const { selectedObjectIds, pages, currentPageId } = get();
      if (selectedObjectIds.length < 2) return;
      const page = pages.find((p) => p.id === currentPageId);
      if (!page) return;
      const targets = page.objects.filter((o) => selectedObjectIds.includes(o.id));
      if (targets.length < 2) return;

      // For alignment we treat each object's anchor as (x, y) and its size as
      // (width, height) where defined; line endpoints (x2, y2) move along with
      // the anchor by the same delta so the geometry stays consistent.
      const xs = targets.map((o) => o.x ?? 0);
      const ys = targets.map((o) => o.y ?? 0);
      const rights  = targets.map((o) => (o.x ?? 0) + (o.width ?? 0));
      const bottoms = targets.map((o) => (o.y ?? 0) + (o.height ?? 0));

      const minX = Math.min(...xs);
      const maxR = Math.max(...rights);
      const minY = Math.min(...ys);
      const maxB = Math.max(...bottoms);
      const cx = (minX + maxR) / 2;
      const cy = (minY + maxB) / 2;

      pushHistory(`Allinea (${mode})`);
      const patches = new Map<string, { x?: number; y?: number; x2?: number; y2?: number; width?: number; height?: number }>();

      const move = (o: SynopticObject, dx: number, dy: number) => {
        const p: { x?: number; y?: number; x2?: number; y2?: number } = {};
        if (dx !== 0) { p.x = (o.x ?? 0) + dx; if (o.x2 != null) p.x2 = o.x2 + dx; }
        if (dy !== 0) { p.y = (o.y ?? 0) + dy; if (o.y2 != null) p.y2 = o.y2 + dy; }
        return p;
      };

      if (mode === "left") {
        for (const o of targets) patches.set(o.id, move(o, minX - (o.x ?? 0), 0));
      } else if (mode === "right") {
        for (const o of targets) {
          const right = (o.x ?? 0) + (o.width ?? 0);
          patches.set(o.id, move(o, maxR - right, 0));
        }
      } else if (mode === "center-x") {
        for (const o of targets) {
          const ocx = (o.x ?? 0) + (o.width ?? 0) / 2;
          patches.set(o.id, move(o, cx - ocx, 0));
        }
      } else if (mode === "top") {
        for (const o of targets) patches.set(o.id, move(o, 0, minY - (o.y ?? 0)));
      } else if (mode === "bottom") {
        for (const o of targets) {
          const bottom = (o.y ?? 0) + (o.height ?? 0);
          patches.set(o.id, move(o, 0, maxB - bottom));
        }
      } else if (mode === "middle-y") {
        for (const o of targets) {
          const ocy = (o.y ?? 0) + (o.height ?? 0) / 2;
          patches.set(o.id, move(o, 0, cy - ocy));
        }
      } else if (mode === "distribute-x" && targets.length >= 3) {
        // F8.1 — GAP uguali, non posizioni equidistanti: con larghezze diverse
        // le due cose non coincidono e a occhio il risultato sembrava storto.
        // Primo e ultimo restano fermi; lo spazio libero fra i bordi si divide
        // in parti uguali fra gli intervalli.
        const sorted = [...targets].sort((a, b) => (a.x ?? 0) - (b.x ?? 0));
        const first = sorted[0];
        const last  = sorted[sorted.length - 1];
        const span = ((last.x ?? 0) + (last.width ?? 0)) - (first.x ?? 0);
        const totalW = sorted.reduce((acc, o) => acc + (o.width ?? 0), 0);
        const gap = (span - totalW) / (sorted.length - 1);
        let cursor = (first.x ?? 0) + (first.width ?? 0) + gap;
        sorted.slice(1, -1).forEach((o) => {
          patches.set(o.id, move(o, cursor - (o.x ?? 0), 0));
          cursor += (o.width ?? 0) + gap;
        });
      } else if (mode === "distribute-y" && targets.length >= 3) {
        const sorted = [...targets].sort((a, b) => (a.y ?? 0) - (b.y ?? 0));
        const first = sorted[0];
        const last  = sorted[sorted.length - 1];
        const span = ((last.y ?? 0) + (last.height ?? 0)) - (first.y ?? 0);
        const totalH = sorted.reduce((acc, o) => acc + (o.height ?? 0), 0);
        const gap = (span - totalH) / (sorted.length - 1);
        let cursor = (first.y ?? 0) + (first.height ?? 0) + gap;
        sorted.slice(1, -1).forEach((o) => {
          patches.set(o.id, move(o, 0, cursor - (o.y ?? 0)));
          cursor += (o.height ?? 0) + gap;
        });
      } else if (mode === "match-width" || mode === "match-height") {
        // F8.1 — uniforma le dimensioni al PRIMO oggetto selezionato (il
        // riferimento è quello che l'utente ha scelto per primo, non il più
        // grande: così l'esito è prevedibile).
        const refId = selectedObjectIds[0];
        const ref = targets.find((o) => o.id === refId) ?? targets[0];
        const key = mode === "match-width" ? "width" : "height";
        const val = ref[key];
        if (val === undefined) return;
        for (const o of targets) {
          if (o.id === ref.id || o[key] === undefined) continue;
          patches.set(o.id, { [key]: val } as { width?: number; height?: number });
        }
      }

      if (patches.size === 0) return;
      set((s) => ({
        pages: s.pages.map((p) =>
          p.id === currentPageId
            ? {
                ...p,
                objects: p.objects.map((o) =>
                  patches.has(o.id) ? { ...o, ...patches.get(o.id) } : o
                ),
              }
            : p
        ),
      }));
    },

    undo: () => {
      const { past, future, pages, pagesRev, project } = get();
      if (past.length === 0) return;
      const prev = past[past.length - 1];
      const currentLabel = prev.label;
      // Se la voce che si sta ripristinando porta uno snapshot del progetto,
      // anche la sua controparte nell'altra pila deve portarlo: altrimenti il
      // redo riporterebbe le pagine e non i tag, cioè metà transazione.
      const controparte: HistoryEntry = { pages: clonePages(pages), label: currentLabel, rev: pagesRev };
      if (prev.project !== undefined) controparte.project = project;
      set({
        past: past.slice(0, past.length - 1),
        future: [controparte, ...future].slice(0, HISTORY_LIMIT),
        pages: prev.pages,
        pagesRev: prev.rev,
        ...(prev.project !== undefined ? { project: prev.project } : {}),
        selectedObjectId: null,
        selectedObjectIds: [],
        selectedCell: null,
        selectedCellChild: null,
        selectedCellRange: null,
        selectedSubCell: null,
      });
    },

    redo: () => {
      const { past, future, pages, pagesRev, project } = get();
      if (future.length === 0) return;
      const next = future[0];
      const currentLabel = next.label;
      const controparte: HistoryEntry = { pages: clonePages(pages), label: currentLabel, rev: pagesRev };
      if (next.project !== undefined) controparte.project = project;
      set({
        past: [...past, controparte].slice(-HISTORY_LIMIT),
        future: future.slice(1),
        pages: next.pages,
        pagesRev: next.rev,
        ...(next.project !== undefined ? { project: next.project } : {}),
        selectedObjectId: null,
        selectedObjectIds: [],
        selectedCell: null,
        selectedCellChild: null,
        selectedCellRange: null,
        selectedSubCell: null,
      });
    },

    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,

    jumpToPast: (index) => {
      const { past, future, pages, pagesRev, project } = get();
      if (index < 0 || index >= past.length) return;
      const target = past[index];
      const currentLabel = past.length > 0 ? past[past.length - 1].label : "Modifica";
      // Il progetto in vigore a `index`: solo le transazioni dell'assistente
      // ne registrano uno, quindi una voce senza snapshot vale quanto la prima
      // che ne porta uno **più avanti** nella pila — fra le due non è cambiato
      // niente. Se nessuna ne porta, il progetto di oggi è già quello giusto.
      const progettoLi = past.slice(index).find((e) => e.project !== undefined)?.project;
      const controparte: HistoryEntry = { pages: clonePages(pages), label: currentLabel, rev: pagesRev };
      if (progettoLi !== undefined) controparte.project = project;
      const newFuture = [
        ...past.slice(index + 1),
        controparte,
        ...future,
      ].slice(0, HISTORY_LIMIT);
      set({
        pages: target.pages,
        pagesRev: target.rev,
        ...(progettoLi !== undefined ? { project: progettoLi } : {}),
        past: past.slice(0, index),
        future: newFuture,
        selectedObjectId: null,
        selectedObjectIds: [],
        selectedCell: null,
        selectedCellChild: null,
        selectedCellRange: null,
        selectedSubCell: null,
      });
    },

    jumpToFuture: (index) => {
      const { past, future, pages, pagesRev, project } = get();
      if (index < 0 || index >= future.length) return;
      const target = future[index];
      const currentLabel = past.length > 0 ? past[past.length - 1].label : "Modifica";
      // `future` è ordinata in avanti nel tempo, quindi qui si guarda
      // all'indietro: la voce con snapshot più vicina fra 0 e `index`.
      const progettoLi = future.slice(0, index + 1).reverse()
        .find((e) => e.project !== undefined)?.project;
      const controparte: HistoryEntry = { pages: clonePages(pages), label: currentLabel, rev: pagesRev };
      if (progettoLi !== undefined) controparte.project = project;
      const newPast = [
        ...past,
        controparte,
        ...future.slice(0, index),
      ].slice(-HISTORY_LIMIT);
      set({
        pages: target.pages,
        pagesRev: target.rev,
        ...(progettoLi !== undefined ? { project: progettoLi } : {}),
        past: newPast,
        future: future.slice(index + 1),
        selectedObjectId: null,
        selectedObjectIds: [],
        selectedCell: null,
        selectedCellChild: null,
        selectedCellRange: null,
        selectedSubCell: null,
      });
    },

    beginInteraction: (label) => {
      // Only the outermost begin actually pushes — nested begins (which
      // would otherwise happen if a resize handler also called begin)
      // just bump the depth counter.
      if (interactionDepth === 0) pushHistoryUnconditional(label);
      interactionDepth += 1;
    },

    endInteraction: () => {
      if (interactionDepth > 0) interactionDepth -= 1;
    },

    applyAiProposal: async (p) => {
      const s = get();
      if (!s.project) return { ok: false, motivo: "Nessun progetto aperto." };

      // ── 1. Il progetto è ancora quello su cui l'assistente ha ragionato? ──
      // Un turno dura decine di secondi. Se nel frattempo il progetto su disco
      // è cambiato — un'altra scheda, un deploy, un'altra persona — applicare
      // alla cieca cancella quel lavoro.
      if (p.impronta) {
        try {
          const ora = await api.getProjectFingerprint();
          if (ora.sha256 !== p.impronta) {
            return { ok: false, motivo:
              "Il progetto è cambiato da quando l'assistente l'ha letto: la proposta " +
              "è stata scartata. Richiedila e la ricostruirà su quello attuale." };
          }
        } catch {
          // Impronta non verificabile (runtime irraggiungibile): si procede,
          // ma non si finge di aver controllato.
          return { ok: false, motivo:
            "Non riesco a verificare che il progetto non sia cambiato nel frattempo. " +
            "Riprova quando il runtime risponde." };
        }
      }

      // ── 2. Cosa tocca davvero ─────────────────────────────────────────────
      const prima = s.project;
      // Cintura oltre alla bretella. Il server ricompone gli script mancanti
      // prima di validare e manda indietro il progetto ricomposto
      // (`validate::ricomponi_script`), quindi qui non dovrebbero arrivare
      // proposte lacunose. «Non dovrebbero» non basta per una collezione che
      // il Salva riscrive per intero: una proposta che omette `functions`
      // diventerebbe `updateFunctions([])`, cioè tutte le funzioni via dal
      // disco senza niente nel diff. È già successo sui tag il 2026-07-28.
      const grezzo = p.project ?? prima;
      const dopo = grezzo === prima ? prima : {
        ...grezzo,
        functions:      grezzo.functions      ?? prima.functions,
        global_scripts: grezzo.global_scripts ?? prima.global_scripts,
      };
      // Solo se c'è davvero qualcosa da perdere. Un avviso che scatta su un
      // progetto senza script è rumore, e — visto in un test — copriva
      // l'avviso sulle modifiche non salvate, che è più importante.
      const c_era_python = (prima.functions?.length ?? 0) > 0
                        || (prima.global_scripts?.length ?? 0) > 0;
      const lacunoso = grezzo !== prima && c_era_python
        && (grezzo.functions === undefined || grezzo.global_scripts === undefined);
      const tocca = {
        tags:    !uguale(prima.tags,    dopo.tags),
        sources: !uguale(prima.sources, dopo.sources),
        alarms:  !uguale(prima.alarms,  dopo.alarms),
        functions:      !uguale(prima.functions      ?? [], dopo.functions      ?? []),
        global_scripts: !uguale(prima.global_scripts ?? [], dopo.global_scripts ?? []),
      };

      // Le pagine proposte si sovrappongono per nome; le altre restano.
      //
      // **Oggetto per oggetto, non pagina per pagina.** L'assistente legge la
      // pagina dal disco e la rimanda intera, ma passando dalla struct Rust i
      // campi escono in ordine di dichiarazione mentre l'API li serve
      // nell'ordine del file YAML. Gli oggetti sono gli stessi; rimpiazzare la
      // pagina intera li riscriverebbe tutti — misurato il 2026-08-31: su una
      // proposta che aggiungeva UN bottone, 46 oggetti su 47 risultavano
      // toccati. Il diff diventava illeggibile e il salvataggio avrebbe
      // riordinato ogni chiave di ogni oggetto in YAML, per niente.
      //
      // Tenendo l'istanza esistente dove è semanticamente uguale, una proposta
      // può cambiare solo quello che cambia davvero.
      const proposte = p.pages ?? [];
      const fondi = (attuale: SynopticPage, proposta: SynopticPage): SynopticPage => {
        const perId = new Map(attuale.objects.map((o) => [o.id, o]));
        const objects = proposta.objects.map((o) => {
          const vecchio = perId.get(o.id);
          return vecchio && uguale(vecchio, o) ? vecchio : o;
        });
        return uguale({ ...attuale, objects: [] }, { ...proposta, objects: [] })
          ? { ...attuale, objects }
          : { ...proposta, objects };
      };
      const nuovePages = [
        ...s.pages.map((pg) => {
          const q = proposte.find((x) => x.name === pg.name);
          return q ? fondi(pg, q) : pg;
        }),
        ...proposte.filter((q) => !s.pages.some((pg) => pg.name === q.name)),
      ];

      // ── 3. Un solo passo, con dentro anche il progetto ────────────────────
      pushHistoryUnconditional(`Assistente: ${p.motivo}`, prima);
      // Se la modifica è su un'altra pagina, ci si va: applicare qualcosa che
      // non si vede è il modo più veloce per smettere di guardare il diff.
      const toccata = proposte[0]
        ? nuovePages.find((pg) => pg.name === proposte[0].name)
        : undefined;
      const vaSuAltraPagina = toccata !== undefined
        && !proposte.some((q) => nuovePages.find((pg) => pg.name === q.name)?.id === s.currentPageId);
      set({
        pages: nuovePages,
        project: dopo,
        ...(vaSuAltraPagina ? { currentPageId: toccata.id } : {}),
        selectedObjectId: null,
        selectedObjectIds: [],
        selectedCell: null,
        selectedCellChild: null,
        selectedCellRange: null,
        selectedSubCell: null,
      });

      // ── 4. Le sezioni fuori dalle pagine, differite a Salva ───────────────
      //
      // `saveAll()` di proposito NON scrive tags/sources/alarms: spingeva la
      // copia in memoria sopra quella su disco, e un momento in cui la copia è
      // più povera del disco cancella dati (audit del 2026-07-28,
      // `{"count": 0, "what": "tags"}` su un progetto che ne aveva 16).
      //
      // Passare da `pendingSections` non riapre quella ferita, e la ragione è
      // il punto 1: la proposta parte da una lettura fresca del disco, e
      // l'impronta la rifiuta se il disco è cambiato da allora. La copia che
      // scriviamo non può essere più povera di quella che c'è.
      const registra = (chiave: string, scrivi: () => Promise<void>) =>
        get().registerPendingSection(chiave, async () => {
          await scrivi();
          // Scritta una volta, la sezione non è più in sospeso: senza questo
          // resterebbe a riscriversi a ogni Salva successivo.
          get().registerPendingSection(chiave, null);
        });

      if (tocca.tags) {
        registra("ai:tags", async () => { await api.updateTags(get().project?.tags ?? []); });
      }
      if (tocca.sources) {
        registra("ai:sources", async () => { await api.updateSources(get().project?.sources ?? []); });
      }
      if (tocca.alarms) {
        registra("ai:alarms", async () => { await api.updateAlarms(get().project?.alarms ?? []); });
      }
      if (tocca.functions) {
        // `saveAll` scrive già le functions, ma passa dallo stesso
        // `project.yaml` di queste altre sezioni: registrandola qui la
        // scrittura viene **incatenata** invece di affiancata, che è la
        // ragione per cui due Salva insieme se ne perdevano uno.
        registra("ai:functions",
          async () => { await api.updateFunctions(get().project?.functions ?? []); });
      }
      if (tocca.global_scripts) {
        // Questo è il terzo difetto della famiglia, e il più silenzioso:
        // `saveGlobalScripts` è chiamato **solo** dal Salva della sua tab in
        // Configurazione, e `saveAll` non lo chiama affatto. Una proposta che
        // cambiava uno script globale finiva nello store, si vedeva sul canvas
        // — e al reload non c'era più. Approvata e sparita.
        registra("ai:global_scripts",
          async () => { await api.saveGlobalScripts(get().project?.global_scripts ?? []); });
      }

      // ── 5. Quello che questo controllo NON copre ──────────────────────────
      // L'assistente legge le pagine dal **disco**. Se qui in memoria c'erano
      // modifiche non ancora salvate su una pagina che la proposta rimpiazza,
      // quelle modifiche se ne vanno — l'impronta non se ne accorge, perché il
      // disco non è cambiato. Un Ctrl+Z le riporta indietro, ma è giusto
      // dirlo prima invece di lasciarlo scoprire.
      const sporco = s.pagesRev !== s.savedPagesRev;
      const avviso = lacunoso
        ? "La proposta non conteneva gli script del progetto: sono stati tenuti quelli " +
          "esistenti. Se l'assistente doveva modificarne uno, la modifica non c'è."
        : sporco && proposte.length > 0
        ? "C'erano modifiche non salvate: l'assistente ha letto le pagine dal disco, " +
          "quindi le pagine sostituite tornano alla versione salvata. Ctrl+Z annulla tutto."
        : undefined;

      return { ok: true, avviso };
    },

    updateTagValue: (id, state) =>
      set((s) => ({ tagValues: { ...s.tagValues, [id]: state } })),

    setAlarms: (list) =>
      set({ alarms: Object.fromEntries(list.map((a) => [a.def.id, a])) }),

    updateAlarm: (state) =>
      set((s) => ({ alarms: { ...s.alarms, [state.def.id]: state } })),

    setLogs: (list) => {
      // Snapshot replaces the current list but stays within the cap.
      const trimmed = list.length > LOG_LIMIT ? list.slice(list.length - LOG_LIMIT) : list;
      set({ logs: trimmed });
    },

    appendLog: (ev) =>
      set((s) => {
        const next = s.logs.length >= LOG_LIMIT
          ? [...s.logs.slice(s.logs.length - LOG_LIMIT + 1), ev]
          : [...s.logs, ev];
        return { logs: next };
      }),

    clearLogs: () => set({ logs: [] }),

    setGridSize: (gridSize) => set({ gridSize }),
    setSnapEnabled: (snapEnabled) => set({ snapEnabled }),
    setGridColor: (gridColor) => set({ gridColor }),
    toggleRulers: () => set((s) => {
      const showRulers = !s.showRulers;
      try { localStorage.setItem(RULERS_KEY, showRulers ? "1" : "0"); }
      catch { /* quota — ignore */ }
      return { showRulers };
    }),

    appMode: "edit",
    configTab: "tags",
    setAppMode: (appMode) => set({ appMode }),
    setConfigTab: (configTab) => set({ configTab }),
    navigateToConfig: (tab) => set({ appMode: "config", configTab: tab }),

    // Ripreso da localStorage: `setAutoRotate` lo scriveva ma nessuno lo
    // rileggeva all'avvio, quindi dopo un reboot del pannello la rotazione
    // tornava sempre spenta — ed è l'unico modo di cambiare pagina su un
    // viewer a schermo pieno senza oggetti navbutton.
    autoRotate: (() => {
      try { return localStorage.getItem("sws:autoRotate") === "true"; }
      catch { return false; }
    })(),
    autoRotateIntervalS: parseInt(localStorage.getItem("sws:autoRotateIntervalS") ?? "30", 10) || 30,
    setAutoRotate: (autoRotate) => {
      localStorage.setItem("sws:autoRotate", String(autoRotate));
      set({ autoRotate });
    },
    setAutoRotateIntervalS: (autoRotateIntervalS) => {
      localStorage.setItem("sws:autoRotateIntervalS", String(autoRotateIntervalS));
      set({ autoRotateIntervalS });
    },

    remoteConnected: false,
    remoteUrl: null,
    setRemoteConnected: (connected, url = null) =>
      set({ remoteConnected: connected, remoteUrl: connected ? (url ?? null) : null }),
    remoteDeployStatus: "idle",

    setSaveStatus: (saveStatus, saveError = null) => set({ saveStatus, saveError }),

    /** Per i salvataggi che non passano da saveAll() (tab Tag/Sorgenti/Allarmi
     *  in ConfigView, che salvano da sole) ma devono comunque alimentare
     *  `lastLocalSaveAt` in App.tsx — altrimenti il watcher del progetto
     *  scambia il loro salvataggio per un cambio esterno. Stesso
     *  saveOkTimer di saveAll() così i due non si pestano i piedi. */
    markSaveOk: () => {
      if (saveOkTimer !== null) { window.clearTimeout(saveOkTimer); saveOkTimer = null; }
      set({ saveStatus: "ok" });
      saveOkTimer = window.setTimeout(() => {
        saveOkTimer = null;
        if (get().saveStatus === "ok") set({ saveStatus: "idle" });
      }, 2000);
    },

    registerPendingSection: (key, save) =>
      set((s) => {
        const next = { ...s.pendingSections };
        if (save) next[key] = save; else delete next[key];
        return { pendingSections: next };
      }),

    markPagesSaved: () => set((s) => ({ savedPagesRev: s.pagesRev })),

    resetDirty: () => set((s) => ({ savedPagesRev: s.pagesRev, pendingSections: {} })),

    saveAll: async () => {
      if (get().saveStatus === "saving") return;
      if (saveOkTimer !== null) { window.clearTimeout(saveOkTimer); saveOkTimer = null; }
      set({ saveStatus: "saving", saveError: null, saveConflict: false });

      const failures: string[] = [];

      // 1. Flush section drafts owned by ConfigView tabs / the function
      //    editor. Each PUTs to its own endpoint and refreshes the store.
      //
      //    **Una per volta, non in parallelo.** Tags, sources e alarms
      //    finiscono tutti in `project.yaml` attraverso `patch_project`, che è
      //    un leggi-modifica-scrivi senza lock (`router.rs:1963`): due PUT in
      //    volo insieme leggono lo stesso file di partenza e l'ultimo che
      //    scrive cancella l'altro, in silenzio.
      //
      //    Misurato il 2026-08-31 con l'assistente: una proposta che creava un
      //    tag *e* una sorgente salvava la sorgente e perdeva il tag. Non è un
      //    difetto dell'assistente — bastano due tab di Configurazione
      //    modificate insieme, ed è così da sempre.
      //
      //    Questo mette al sicuro il salvataggio dell'editor. La corsa lato
      //    server resta possibile da altre strade (due schede, uno script,
      //    l'API): è Q30 in `docs/OPEN_QUESTIONS.md`.
      // Q30: un rifiuto per versione non è un fallimento fra i tanti — ha un
      // rimedio suo (ricaricare, non ritentare) e va riconosciuto qui, dove si
      // sa che stiamo salvando. Si ferma il ciclo: le sezioni successive
      // partono dagli stessi dati vecchi e prenderebbero lo stesso rifiuto,
      // riempiendo l'elenco degli errori di righe che dicono la stessa cosa.
      const pending = Object.entries(get().pendingSections);
      let conflitto = false;
      for (const [key, save] of pending) {
        try {
          await save();
        } catch (e) {
          if (e instanceof ProjectChangedError) {
            conflitto = true;
            failures.push(errText(e));
            break;
          }
          failures.push(`${key}: ${errText(e)}`);
        }
      }
      if (conflitto) {
        set({ saveStatus: "error", saveError: failures.join("; "), saveConflict: true });
        return;
      }

      // Re-read: the flush above mutated `project`.
      const state = get();
      const isAdmin = state.authRole === "Admin";

      // 2. Le pagine (tutte, non solo quella corrente) più le sole collezioni
      //    di cui l'editor è proprietario.
      //
      //    Tags, sources e alarms NON si scrivono più da qui, ed è una
      //    correzione, non una semplificazione: questa funzione spingeva la
      //    copia in memoria sopra quella su disco, e un momento in cui la
      //    copia è più povera del disco cancella dati. È successo davvero —
      //    audit log del 2026-07-28, `{"count": 0, "what": "tags"}` su un
      //    progetto che sul disco aveva 16 variabili. Quelle tre collezioni
      //    appartengono alle tab di Configurazione, che si salvano da sole
      //    attraverso i propri endpoint; `pendingSections` copre il caso in
      //    cui l'utente abbia una bozza aperta.
      //
      //    Restano functions e custom_symbols: si modificano dall'editor
      //    (FunctionEditor, symbol picker) e non hanno altro percorso di
      //    salvataggio.
      const tasks: Promise<unknown>[] = state.pages.map((p) => api.saveSynoptic(p));
      if (isAdmin && state.project) {
        // Anche questi due passano da `patch_project` sullo stesso
        // `project.yaml`: incatenati, non affiancati, per la stessa ragione
        // spiegata al punto 1. Le pagine invece sono file distinti e restano
        // in parallelo.
        tasks.push((async () => {
          await api.updateFunctions(state.project?.functions ?? []);
          await api.updateCustomSymbols(state.customSymbols ?? []);
        })());
      }
      // Names present when pages were last loaded but missing from the
      // current array: deleted, or renamed (old name orphaned, new name
      // already covered by the upsert above). Their files never disappear
      // from disk on their own — list_synoptics just enumerates *.yaml, so
      // a page "deleted" only in memory silently reappears on next load.
      const currentNames = new Set(state.pages.map((p) => p.name));
      const namesToDelete = state.persistedPageNames.filter((n) => !currentNames.has(n));
      tasks.push(...namesToDelete.map((n) => api.deleteSynoptic(n)));
      const results = await Promise.allSettled(tasks);
      results.forEach((r) => {
        if (r.status === "rejected") {
          if (r.reason instanceof ProjectChangedError) conflitto = true;
          failures.push(errText(r.reason));
        }
      });

      if (failures.length > 0) {
        set({ saveStatus: "error", saveError: failures.join("; "), saveConflict: conflitto });
        return;
      }

      // All-or-nothing: only a fully successful save clears the dirty flag.
      // On a partial failure some pages are on disk and some are not, so
      // "modified" is the only honest answer; a retry re-PUTs everything
      // (the endpoints are idempotent).
      set({ persistedPageNames: state.pages.map((p) => p.name) });
      set({ saveStatus: "ok" });
      get().markPagesSaved();
      saveOkTimer = window.setTimeout(() => {
        saveOkTimer = null;
        if (get().saveStatus === "ok") set({ saveStatus: "idle" });
      }, 2000);

      autoDeployIfConnected();
    },

    groupObjects: (ids, name) => {
      if (ids.length < 1) return;
      pushHistory("Raggruppa oggetti");
      const groupId = genId();
      const groupName = name ?? `Gruppo ${Date.now() % 10000}`;
      set((s) => {
        const page = s.pages.find((p) => p.id === s.currentPageId);
        if (!page) return s;
        const newGroup: ObjectGroup = { id: groupId, name: groupName };
        return {
          pages: s.pages.map((p) => p.id !== s.currentPageId ? p : {
            ...p,
            groups: [...(p.groups ?? []), newGroup],
            objects: p.objects.map((o) =>
              ids.includes(o.id) ? { ...o, group_id: groupId } : o
            ),
          }),
        };
      });
    },

    ungroupObjects: (groupId) => {
      pushHistory("Separa gruppo");
      set((s) => ({
        pages: s.pages.map((p) => p.id !== s.currentPageId ? p : {
          ...p,
          groups: (p.groups ?? []).filter((g) => g.id !== groupId),
          objects: p.objects.map((o) =>
            o.group_id === groupId ? { ...o, group_id: undefined } : o
          ),
        }),
      }));
    },

    renameGroup: (groupId, name) => {
      pushHistory("Rinomina gruppo");
      set((s) => ({
        pages: s.pages.map((p) => p.id !== s.currentPageId ? p : {
          ...p,
          groups: (p.groups ?? []).map((g) => g.id === groupId ? { ...g, name } : g),
        }),
      }));
    },

    moveObjectToGroup: (objId, groupId) => {
      pushHistory(groupId ? "Sposta in gruppo" : "Rimuovi da gruppo");
      set((s) => ({
        pages: s.pages.map((p) => p.id !== s.currentPageId ? p : {
          ...p,
          objects: p.objects.map((o) =>
            o.id === objId ? { ...o, group_id: groupId ?? undefined } : o
          ),
        }),
      }));
    },

    moveObjectAdjacent: (objId, targetId, place) => {
      if (objId === targetId) return;
      pushHistory("Riordina oggetto");
      set((s) => {
        const page = s.pages.find((p) => p.id === s.currentPageId);
        if (!page) return s;
        const srcIdx = page.objects.findIndex((o) => o.id === objId);
        if (srcIdx < 0) return s;
        const src = page.objects[srcIdx];
        const objs = [...page.objects];
        objs.splice(srcIdx, 1);
        const tgtIdx = objs.findIndex((o) => o.id === targetId);
        if (tgtIdx < 0) return s;
        const target = objs[tgtIdx];
        const insertAt = place === "before" ? tgtIdx : tgtIdx + 1;
        // Inherit target's group_id so the move is consistent with the
        // group the drop landed inside.
        objs.splice(insertAt, 0, { ...src, group_id: target.group_id });
        return { pages: s.pages.map((p) => p.id === s.currentPageId ? { ...p, objects: objs } : p) };
      });
    },

    moveObjectToGroupEnd: (objId, groupId) => {
      pushHistory(groupId ? "Sposta in gruppo" : "Rimuovi da gruppo");
      set((s) => {
        const page = s.pages.find((p) => p.id === s.currentPageId);
        if (!page) return s;
        const srcIdx = page.objects.findIndex((o) => o.id === objId);
        if (srcIdx < 0) return s;
        const src = page.objects[srcIdx];
        const objs = [...page.objects];
        objs.splice(srcIdx, 1);
        // For "drop on group header" we insert at the END of that group's
        // member streak so it appears as the last member. Ungrouped (null)
        // goes to the very end of the array.
        if (groupId == null) {
          objs.push({ ...src, group_id: undefined });
        } else {
          let lastMemberIdx = -1;
          for (let i = 0; i < objs.length; i++) {
            if (objs[i].group_id === groupId) lastMemberIdx = i;
          }
          const insertAt = lastMemberIdx + 1;
          objs.splice(insertAt, 0, { ...src, group_id: groupId });
        }
        return { pages: s.pages.map((p) => p.id === s.currentPageId ? { ...p, objects: objs } : p) };
      });
    },

    moveGroupAdjacent: (groupId, targetGroupId, place) => {
      if (groupId === targetGroupId) return;
      pushHistory("Riordina gruppo");
      set((s) => {
        const page = s.pages.find((p) => p.id === s.currentPageId);
        if (!page) return s;
        const groups = [...(page.groups ?? [])];
        const srcIdx = groups.findIndex((g) => g.id === groupId);
        if (srcIdx < 0) return s;
        const [src] = groups.splice(srcIdx, 1);
        if (targetGroupId == null) {
          groups.push(src);
        } else {
          const tgtIdx = groups.findIndex((g) => g.id === targetGroupId);
          if (tgtIdx < 0) { groups.push(src); }
          else {
            const insertAt = place === "before" ? tgtIdx : tgtIdx + 1;
            groups.splice(insertAt, 0, src);
          }
        }
        return { pages: s.pages.map((p) => p.id === s.currentPageId ? { ...p, groups } : p) };
      });
    },
  };
});

export type { AppState, SynopticObject, ObjectGroup };
