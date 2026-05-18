// TODO (ADR 0001): evaluate Redux Toolkit as an alternative before M1 freeze.
import { create } from "zustand";
import { setAuthToken } from "@/api/client";
import type {
  AlarmDef,
  AlarmState,
  CustomSymbol,
  FunctionDef,
  GridCell,
  LogEvent,
  ObjectGroup,
  ProjectInfo,
  SourceDef,
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

type PersistedAuth = { token: string; username: string; role?: string; must_change_password?: boolean };

function readPersistedAuth(): PersistedAuth | null {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(AUTH_KEY) : null;
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.token === "string" && typeof parsed?.username === "string") {
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

const HISTORY_LIMIT = 200;

/** Object alignment commands operating on a set of objects. */
export type AlignMode =
  | "left" | "center-x" | "right"
  | "top"  | "middle-y" | "bottom"
  | "distribute-x" | "distribute-y";

export type Role = "Viewer" | "Operator" | "Supervisor" | "Admin";
export type AppMode = "edit" | "view" | "config";
export type AppConfigTab = "tags" | "protocols" | "alarms" | "users" | "resources" | "system";

interface AppState {
  // Auth
  authToken: string | null;
  authUser: string | null;
  authRole: Role | null;
  /** True while the server insists the current account changes its password.
   *  The App shell renders ChangePasswordScreen until this clears. */
  mustChangePassword: boolean;
  /** True when the runtime has no active project (GET /api/project → 503).
   *  The App shell renders WelcomeScreen until a project is opened. */
  noActiveProject: boolean;

  project: ProjectInfo | null;
  customSymbols: CustomSymbol[];
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
  incSaveSerial: () => void;
  setSaveStatus: (s: "idle" | "saving" | "ok" | "error", e?: string | null) => void;

  /** True when the session token expired mid-session. Shows ReAuthModal overlay. */
  reAuthNeeded: boolean;

  setAuth: (token: string, username: string, role: Role, mustChangePassword?: boolean) => void;
  setMustChangePassword: (flag: boolean) => void;
  setReAuthNeeded: (v: boolean) => void;
  clearAuth: () => void;
  setNoActiveProject: (flag: boolean) => void;

  setProject: (p: ProjectInfo) => void;
  updateProjectTags: (tags: TagDef[]) => void;
  updateProjectSources: (sources: SourceDef[]) => void;
  updateProjectAlarms: (alarms: AlarmDef[]) => void;
  updateProjectFunctions: (functions: FunctionDef[]) => void;
  updateProjectCustomSymbols: (symbols: CustomSymbol[]) => void;

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
  updatePageProps: (id: string, patch: Partial<Pick<SynopticPage, "name" | "background" | "width" | "height">>) => void;
  updateGridCell: (pageId: string, objectId: string, cell: GridCell) => void;
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
    set({ past: [...trimmed, entry], future: [] });
  };

  /** Force-push a history entry even mid-interaction; used by begin. */
  const pushHistoryUnconditional = (label: string) => {
    const { pages, past } = get();
    const entry: HistoryEntry = { pages: clonePages(pages), label };
    const trimmed = past.length >= HISTORY_LIMIT
      ? past.slice(past.length - HISTORY_LIMIT + 1)
      : past;
    set({ past: [...trimmed, entry], future: [] });
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
    mustChangePassword: persisted?.must_change_password === true,
    noActiveProject: false,
    reAuthNeeded: false,

    project: null,
    customSymbols: [],
    pages: [first],
    currentPageId: first.id,
    selectedObjectId: null,
    selectedObjectIds: [],
    selectedFunctionId: null,
    selectedCell: null,
    selectedCellChild: null,
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

    setAuth: (token, username, role, mustChangePassword = false) => {
      setAuthToken(token);
      writePersistedAuth({ token, username, role, must_change_password: mustChangePassword });
      set({ authToken: token, authUser: username, authRole: role, mustChangePassword });
    },

    setReAuthNeeded: (v) => set({ reAuthNeeded: v }),

    setMustChangePassword: (flag) => {
      const { authToken, authUser, authRole } = get();
      if (authToken && authUser && authRole) {
        writePersistedAuth({
          token: authToken,
          username: authUser,
          role: authRole,
          must_change_password: flag,
        });
      }
      set({ mustChangePassword: flag });
    },

    clearAuth: () => {
      setAuthToken(null);
      writePersistedAuth(null);
      set({ authToken: null, authUser: null, authRole: null, mustChangePassword: false });
    },

    setNoActiveProject: (flag) => set({ noActiveProject: flag }),

    setProject: (project) => set({ project, customSymbols: project.custom_symbols ?? [] }),

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
        return { selectedCell: cell, selectedCellChild: same ? s.selectedCellChild : null };
      }),

    setSelectedCellChild: (cell) => set({ selectedCellChild: cell }),

    setPages: (pages, currentPageId) =>
      set({
        pages,
        currentPageId: currentPageId ?? pages[0]?.id ?? first.id,
        selectedObjectId: null,
        selectedObjectIds: [],
        selectedCell: null,
        selectedCellChild: null,
        past: [],
        future: [],
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

    setCurrentPage: (id) => set({
      currentPageId: id,
      selectedObjectId: null,
      selectedObjectIds: [],
      selectedFunctionId: null,
      selectedCell: null,
      selectedCellChild: null,
    }),

    selectObject: (id) =>
      set({
        selectedObjectId: id,
        selectedObjectIds: id ? [id] : [],
        selectedFunctionId: null,
        selectedCell: null,
        selectedCellChild: null,
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
            selectedCell: null, selectedCellChild: null }),

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
      set((s) => ({
        pages: s.pages.map((p) => p.id !== s.currentPageId ? p : {
          ...p,
          objects: p.objects.map((o) =>
            o.id === objId ? { ...o, group_id: groupId ?? undefined } : o
          ),
        }),
      }));
    },
  };
});

export type { AppState, SynopticObject, ObjectGroup };
