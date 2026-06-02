// TODO (ADR 0001): evaluate Redux Toolkit as an alternative before M1 freeze.
import { create } from "zustand";
import { setAuthToken } from "@/api/client";
import type {
  AlarmDef,
  AlarmState,
  CustomSymbol,
  FaceplateDef,
  FunctionDef,
  GridCell,
  LogEvent,
  ObjectGroup,
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

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
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

/** Object alignment commands operating on a set of objects. */
export type AlignMode =
  | "left" | "center-x" | "right"
  | "top"  | "middle-y" | "bottom"
  | "distribute-x" | "distribute-y";

export type Role = "Viewer" | "Operator" | "Supervisor" | "Admin";
export type AppMode = "edit" | "config";
export type AppConfigTab = "tags" | "protocols" | "alarms" | "scripts" | "faceplates" | "recipes" | "notifications" | "datastores" | "users" | "resources" | "system" | "backups" | "devices" | "runtime";

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

  /** Incremented by incSaveSerial() to trigger a save in EditorShell. */
  saveSerial: number;
  saveStatus: "idle" | "saving" | "ok" | "error";
  saveError: string | null;
  /** True when the canvas has unsaved changes (cleared on load and on save success). */
  isDirty: boolean;
  incSaveSerial: () => void;
  setSaveStatus: (s: "idle" | "saving" | "ok" | "error", e?: string | null) => void;

  /** True when the session token expired mid-session. Shows ReAuthModal overlay. */
  reAuthNeeded: boolean;

  setAuth: (token: string, username: string, role: Role, mustChangePassword?: boolean, expiresAtMs?: number | null) => void;
  setExpiresAtMs: (ms: number | null) => void;
  setMustChangePassword: (flag: boolean) => void;
  setReAuthNeeded: (v: boolean) => void;
  clearAuth: () => void;
  setNoActiveProject: (flag: boolean) => void;

  setProject: (p: ProjectInfo) => void;
  setProjectLoadError: (msg: string | null) => void;
  updateProjectTags: (tags: TagDef[]) => void;
  updateProjectSources: (sources: SourceDef[]) => void;
  updateProjectAlarms: (alarms: AlarmDef[]) => void;
  updateProjectFunctions: (functions: FunctionDef[]) => void;
  updateProjectCustomSymbols: (symbols: CustomSymbol[]) => void;
  setFaceplates: (faceplates: FaceplateDef[]) => void;

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
  duplicatePage: (id: string) => void;
  updatePageProps: (id: string, patch: Partial<Pick<SynopticPage, "name" | "background" | "width" | "height" | "auto_rotate_skip" | "zones">>) => void;
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
  updateObjects: (ids: string[], patch: Partial<SynopticObject>) => void;
  duplicateObject: (id: string) => void;
  duplicateSelection: () => void;
  deleteObject: (id: string) => void;
  deleteSelection: () => void;
  reorderObject: (id: string, dir: "front" | "forward" | "backward" | "back") => void;

  // Clipboard
  copySelection: () => void;
  pasteClipboard: () => void;
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
}

const first = makePage("Page 1");

// Hydrate persisted auth at module load time so api.client picks up the
// token before the first network request fires.
const persisted = readPersistedAuth();
if (persisted) setAuthToken(persisted.token);

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
    const { pages, past } = get();
    const entry: HistoryEntry = { pages: clonePages(pages), label };
    const trimmed = past.length >= HISTORY_LIMIT
      ? past.slice(past.length - HISTORY_LIMIT + 1)
      : past;
    set({ past: [...trimmed, entry], future: [], isDirty: true });
  };

  /** Force-push a history entry even mid-interaction; used by begin. */
  const pushHistoryUnconditional = (label: string) => {
    const { pages, past } = get();
    const entry: HistoryEntry = { pages: clonePages(pages), label };
    const trimmed = past.length >= HISTORY_LIMIT
      ? past.slice(past.length - HISTORY_LIMIT + 1)
      : past;
    set({ past: [...trimmed, entry], future: [], isDirty: true });
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
    tagValues: {},
    alarms: {},
    logs: [],
    gridSize: 10,
    snapEnabled: true,
    saveSerial: 0,
    saveStatus: "idle",
    saveError: null,
    isDirty: false,

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

    setProject: (project) => set({ project, projectLoadError: null, customSymbols: project.custom_symbols ?? [] }),
    setProjectLoadError: (msg) => set({ projectLoadError: msg }),

    updateProjectTags: (tags) =>
      set((s) => ({ project: s.project ? { ...s.project, tags } : s.project })),

    updateProjectSources: (sources) =>
      set((s) => ({ project: s.project ? { ...s.project, sources } : s.project })),

    updateProjectAlarms: (alarms) =>
      set((s) => ({ project: s.project ? { ...s.project, alarms } : s.project })),

    updateProjectFunctions: (functions) =>
      set((s) => ({ project: s.project ? { ...s.project, functions } : s.project })),

    updateProjectCustomSymbols: (symbols) =>
      set((s) => ({
        customSymbols: symbols,
        project: s.project ? { ...s.project, custom_symbols: symbols } : s.project,
      })),

    setFaceplates: (faceplates) => set({ faceplates }),

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
        pages,
        currentPageId: currentPageId ?? pages[0]?.id ?? first.id,
        selectedObjectId: null,
        selectedObjectIds: [],
        selectedCell: null,
        selectedCellChild: null,
        selectedCellRange: null,
        selectedSubCell: null,
        past: [],
        future: [],
        isDirty: false,
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
      set((s) => ({
        pages: s.pages.map((p) =>
          p.id === s.currentPageId ? { ...p, objects: [...p.objects, obj] } : p
        ),
        selectedObjectId: obj.id,
        selectedObjectIds: [obj.id],
      }));
    },

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
      const patches = new Map<string, { x?: number; y?: number; x2?: number; y2?: number }>();

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
        const sorted = [...targets].sort((a, b) => (a.x ?? 0) - (b.x ?? 0));
        const first = sorted[0].x ?? 0;
        const last  = sorted[sorted.length - 1].x ?? 0;
        const step  = (last - first) / (sorted.length - 1);
        sorted.forEach((o, i) => {
          const target = first + i * step;
          patches.set(o.id, move(o, target - (o.x ?? 0), 0));
        });
      } else if (mode === "distribute-y" && targets.length >= 3) {
        const sorted = [...targets].sort((a, b) => (a.y ?? 0) - (b.y ?? 0));
        const first = sorted[0].y ?? 0;
        const last  = sorted[sorted.length - 1].y ?? 0;
        const step  = (last - first) / (sorted.length - 1);
        sorted.forEach((o, i) => {
          const target = first + i * step;
          patches.set(o.id, move(o, 0, target - (o.y ?? 0)));
        });
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
      const { past, future, pages } = get();
      if (past.length === 0) return;
      const prev = past[past.length - 1];
      const currentLabel = prev.label;
      set({
        past: past.slice(0, past.length - 1),
        future: [{ pages: clonePages(pages), label: currentLabel }, ...future].slice(0, HISTORY_LIMIT),
        pages: prev.pages,
        selectedObjectId: null,
        selectedObjectIds: [],
        selectedCell: null,
        selectedCellChild: null,
        selectedCellRange: null,
        selectedSubCell: null,
      });
    },

    redo: () => {
      const { past, future, pages } = get();
      if (future.length === 0) return;
      const next = future[0];
      const currentLabel = next.label;
      set({
        past: [...past, { pages: clonePages(pages), label: currentLabel }].slice(-HISTORY_LIMIT),
        future: future.slice(1),
        pages: next.pages,
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
      const { past, future, pages } = get();
      if (index < 0 || index >= past.length) return;
      const target = past[index];
      const currentLabel = past.length > 0 ? past[past.length - 1].label : "Modifica";
      const newFuture = [
        ...past.slice(index + 1),
        { pages: clonePages(pages), label: currentLabel },
        ...future,
      ].slice(0, HISTORY_LIMIT);
      set({
        pages: target.pages,
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
      const { past, future, pages } = get();
      if (index < 0 || index >= future.length) return;
      const target = future[index];
      const currentLabel = past.length > 0 ? past[past.length - 1].label : "Modifica";
      const newPast = [
        ...past,
        { pages: clonePages(pages), label: currentLabel },
        ...future.slice(0, index),
      ].slice(-HISTORY_LIMIT);
      set({
        pages: target.pages,
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

    appMode: "edit",
    configTab: "tags",
    setAppMode: (appMode) => set({ appMode }),
    setConfigTab: (configTab) => set({ configTab }),
    navigateToConfig: (tab) => set({ appMode: "config", configTab: tab }),

    autoRotate: false,
    autoRotateIntervalS: parseInt(localStorage.getItem("sws:autoRotateIntervalS") ?? "30", 10) || 30,
    setAutoRotate: (autoRotate) => {
      localStorage.setItem("sws:autoRotate", String(autoRotate));
      set({ autoRotate });
    },
    setAutoRotateIntervalS: (autoRotateIntervalS) => {
      localStorage.setItem("sws:autoRotateIntervalS", String(autoRotateIntervalS));
      set({ autoRotateIntervalS });
    },

    incSaveSerial: () => set((s) => ({ saveSerial: s.saveSerial + 1 })),
    setSaveStatus: (saveStatus, saveError = null) => set({ saveStatus, saveError }),

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
