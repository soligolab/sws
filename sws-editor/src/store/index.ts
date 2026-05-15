// TODO (ADR 0001): evaluate Redux Toolkit as an alternative before M1 freeze.
import { create } from "zustand";
import { setAuthToken } from "@/api/client";
import type {
  AlarmDef,
  AlarmState,
  CustomSymbol,
  FunctionDef,
  LogEvent,
  ProjectInfo,
  SourceDef,
  SynopticObject,
  SynopticPage,
  TagDef,
  TagState,
} from "@/types";

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

const HISTORY_LIMIT = 50;

/** Object alignment commands operating on a set of objects. */
export type AlignMode =
  | "left" | "center-x" | "right"
  | "top"  | "middle-y" | "bottom"
  | "distribute-x" | "distribute-y";

export type Role = "Viewer" | "Operator" | "Supervisor" | "Admin";

interface AppState {
  // Auth
  authToken: string | null;
  authUser: string | null;
  authRole: Role | null;
  /** True while the server insists the current account changes its password.
   *  The App shell renders ChangePasswordScreen until this clears. */
  mustChangePassword: boolean;

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
  /** Snapshot stacks for undo/redo. Each entry is a full clone of `pages`. */
  past: SynopticPage[][];
  future: SynopticPage[][];
  /** Cut/paste buffer (in-memory only — not persisted across reloads). */
  clipboard: SynopticObject[];

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

  setAuth: (token: string, username: string, role: Role, mustChangePassword?: boolean) => void;
  setMustChangePassword: (flag: boolean) => void;
  clearAuth: () => void;

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
  updatePageProps: (id: string, patch: Partial<Pick<SynopticPage, "name" | "background">>) => void;
  setCurrentPage: (id: string) => void;

  // Object CRUD (operates on current page)
  selectObject: (id: string | null) => void;
  toggleSelection: (id: string) => void;
  selectMany: (ids: string[]) => void;
  clearSelection: () => void;
  addObject: (partial: Omit<SynopticObject, "id">) => void;
  updateObject: (id: string, patch: Partial<SynopticObject>) => void;
  duplicateObject: (id: string) => void;
  duplicateSelection: () => void;
  deleteObject: (id: string) => void;
  deleteSelection: () => void;

  // Clipboard
  copySelection: () => void;
  pasteClipboard: () => void;

  // Alignment & distribution (multi-select)
  alignSelection: (mode: AlignMode) => void;

  // Undo / redo
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

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
}

const first = makePage("Page 1");

// Hydrate persisted auth at module load time so api.client picks up the
// token before the first network request fires.
const persisted = readPersistedAuth();
if (persisted) setAuthToken(persisted.token);

export const useAppStore = create<AppState>((set, get) => {
  /**
   * Push a snapshot of the current `pages` onto the history stack before
   * applying a mutation that's part of the user's edit history. Clears
   * the redo stack (a new edit invalidates "future"). Capped at HISTORY_LIMIT.
   */
  const pushHistory = () => {
    const { pages, past } = get();
    const snapshot = clonePages(pages);
    const trimmed = past.length >= HISTORY_LIMIT
      ? past.slice(past.length - HISTORY_LIMIT + 1)
      : past;
    set({ past: [...trimmed, snapshot], future: [] });
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

    project: null,
    customSymbols: [],
    pages: [first],
    currentPageId: first.id,
    selectedObjectId: null,
    selectedObjectIds: [],
    selectedFunctionId: null,
    past: [],
    future: [],
    clipboard: [],
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

    setPages: (pages, currentPageId) =>
      set({
        pages,
        currentPageId: currentPageId ?? pages[0]?.id ?? first.id,
        selectedObjectId: null,
        selectedObjectIds: [],
        past: [],
        future: [],
      }),

    addPage: () => {
      pushHistory();
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
      pushHistory();
      const next = pages.filter((p) => p.id !== id);
      set({
        pages: next,
        currentPageId: currentPageId === id ? next[0].id : currentPageId,
        selectedObjectId: null,
        selectedObjectIds: [],
      });
    },

    renamePage: (id, name) => {
      pushHistory();
      set((s) => ({ pages: s.pages.map((p) => (p.id === id ? { ...p, name } : p)) }));
    },

    updatePageProps: (id, patch) => {
      pushHistory();
      set((s) => ({ pages: s.pages.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
    },

    setCurrentPage: (id) => set({
      currentPageId: id,
      selectedObjectId: null,
      selectedObjectIds: [],
      selectedFunctionId: null,
    }),

    selectObject: (id) =>
      set({
        selectedObjectId: id,
        selectedObjectIds: id ? [id] : [],
        // Selecting an object closes the function editor on the right panel.
        selectedFunctionId: null,
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
      set({ selectedObjectId: null, selectedObjectIds: [], selectedFunctionId: null }),

    selectFunction: (id) =>
      set({
        selectedFunctionId: id,
        // Editing a function preempts the object/page properties panel.
        selectedObjectId: null,
        selectedObjectIds: [],
      }),

    addObject: (partial) => {
      pushHistory();
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
      pushHistory();
      set((s) => ({
        pages: s.pages.map((p) =>
          p.id === s.currentPageId
            ? { ...p, objects: p.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)) }
            : p
        ),
      }));
    },

    duplicateObject: (id) => {
      const src = findObj(id);
      if (!src) return;
      pushHistory();
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
      pushHistory();
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
      pushHistory();
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
      pushHistory();
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

    copySelection: () => {
      const { selectedObjectIds, pages, currentPageId } = get();
      if (selectedObjectIds.length === 0) return;
      const page = pages.find((p) => p.id === currentPageId);
      if (!page) return;
      const picked = selectedObjectIds
        .map((id) => page.objects.find((o) => o.id === id))
        .filter((o): o is SynopticObject => !!o)
        .map((o) => ({ ...o })); // shallow clone — values are primitives or arrays we'll overwrite on paste
      set({ clipboard: picked });
    },

    pasteClipboard: () => {
      const { clipboard, currentPageId } = get();
      if (clipboard.length === 0) return;
      pushHistory();
      const newIds: string[] = [];
      const copies = clipboard.map((src) => {
        const id = genId();
        newIds.push(id);
        return {
          ...src,
          id,
          name: src.name ? `${src.name} (incolla)` : undefined,
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

      pushHistory();
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
      const newPast = past.slice(0, past.length - 1);
      set({
        past: newPast,
        future: [clonePages(pages), ...future].slice(0, HISTORY_LIMIT),
        pages: prev,
        selectedObjectId: null,
        selectedObjectIds: [],
      });
    },

    redo: () => {
      const { past, future, pages } = get();
      if (future.length === 0) return;
      const next = future[0];
      set({
        past: [...past, clonePages(pages)].slice(-HISTORY_LIMIT),
        future: future.slice(1),
        pages: next,
        selectedObjectId: null,
        selectedObjectIds: [],
      });
    },

    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,

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

    incSaveSerial: () => set((s) => ({ saveSerial: s.saveSerial + 1 })),
    setSaveStatus: (saveStatus, saveError = null) => set({ saveStatus, saveError }),
  };
});

export type { AppState, SynopticObject };
