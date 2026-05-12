// TODO (ADR 0001): evaluate Redux Toolkit as an alternative before M1 freeze.
import { create } from "zustand";
import { setAuthToken } from "@/api/client";
import type {
  AlarmDef,
  AlarmState,
  ProjectInfo,
  SourceDef,
  SynopticObject,
  SynopticPage,
  TagDef,
  TagState,
} from "@/types";

// ── Auth persistence ────────────────────────────────────────────────────
// Persist the session token in localStorage so a page refresh doesn't kick
// the operator back to the login screen. Username + token only — no secrets.

const AUTH_KEY = "sws.auth";

function readPersistedAuth(): { token: string; username: string } | null {
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

function writePersistedAuth(payload: { token: string; username: string } | null) {
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

interface AppState {
  // Auth
  authToken: string | null;
  authUser: string | null;

  project: ProjectInfo | null;
  pages: SynopticPage[];
  currentPageId: string;
  selectedObjectId: string | null;
  tagValues: Record<string, TagState>;
  alarms: Record<string, AlarmState>;
  gridSize: number;
  snapEnabled: boolean;

  setAuth: (token: string, username: string) => void;
  clearAuth: () => void;

  setProject: (p: ProjectInfo) => void;
  updateProjectTags: (tags: TagDef[]) => void;
  updateProjectSources: (sources: SourceDef[]) => void;
  updateProjectAlarms: (alarms: AlarmDef[]) => void;

  // Page management
  setPages: (pages: SynopticPage[], currentPageId?: string) => void;
  addPage: () => void;
  deletePage: (id: string) => void;
  renamePage: (id: string, name: string) => void;
  updatePageProps: (id: string, patch: Partial<Pick<SynopticPage, "name" | "background">>) => void;
  setCurrentPage: (id: string) => void;

  // Object CRUD (operates on current page)
  selectObject: (id: string | null) => void;
  addObject: (partial: Omit<SynopticObject, "id">) => void;
  updateObject: (id: string, patch: Partial<SynopticObject>) => void;
  duplicateObject: (id: string) => void;
  deleteObject: (id: string) => void;

  // Tag values from WebSocket
  updateTagValue: (id: string, state: TagState) => void;

  // Alarms
  setAlarms: (list: AlarmState[]) => void;
  updateAlarm: (state: AlarmState) => void;

  // Canvas settings
  setGridSize: (size: number) => void;
  setSnapEnabled: (enabled: boolean) => void;
}

const first = makePage("Page 1");

// Hydrate persisted auth at module load time so api.client picks up the
// token before the first network request fires.
const persisted = readPersistedAuth();
if (persisted) setAuthToken(persisted.token);

export const useAppStore = create<AppState>((set, get) => ({
  authToken: persisted?.token ?? null,
  authUser:  persisted?.username ?? null,

  project: null,
  pages: [first],
  currentPageId: first.id,
  selectedObjectId: null,
  tagValues: {},
  alarms: {},
  gridSize: 10,
  snapEnabled: true,

  setAuth: (token, username) => {
    setAuthToken(token);
    writePersistedAuth({ token, username });
    set({ authToken: token, authUser: username });
  },

  clearAuth: () => {
    setAuthToken(null);
    writePersistedAuth(null);
    set({ authToken: null, authUser: null });
  },

  setProject: (project) => set({ project }),

  updateProjectTags: (tags) =>
    set((s) => ({
      project: s.project ? { ...s.project, tags } : s.project,
    })),

  updateProjectSources: (sources) =>
    set((s) => ({
      project: s.project ? { ...s.project, sources } : s.project,
    })),

  updateProjectAlarms: (alarms) =>
    set((s) => ({
      project: s.project ? { ...s.project, alarms } : s.project,
    })),

  setPages: (pages, currentPageId) =>
    set({ pages, currentPageId: currentPageId ?? pages[0]?.id ?? first.id, selectedObjectId: null }),

  addPage: () => {
    const page = makePage(`Page ${get().pages.length + 1}`);
    set((s) => ({ pages: [...s.pages, page], currentPageId: page.id, selectedObjectId: null }));
  },

  deletePage: (id) => {
    const { pages, currentPageId } = get();
    if (pages.length <= 1) return;
    const next = pages.filter((p) => p.id !== id);
    set({
      pages: next,
      currentPageId: currentPageId === id ? next[0].id : currentPageId,
      selectedObjectId: null,
    });
  },

  renamePage: (id, name) =>
    set((s) => ({ pages: s.pages.map((p) => (p.id === id ? { ...p, name } : p)) })),

  updatePageProps: (id, patch) =>
    set((s) => ({ pages: s.pages.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),

  setCurrentPage: (id) => set({ currentPageId: id, selectedObjectId: null }),

  selectObject: (selectedObjectId) => set({ selectedObjectId }),

  addObject: (partial) => {
    const obj: SynopticObject = { ...partial, id: genId() };
    set((s) => ({
      pages: s.pages.map((p) =>
        p.id === s.currentPageId ? { ...p, objects: [...p.objects, obj] } : p
      ),
      selectedObjectId: obj.id,
    }));
  },

  updateObject: (id, patch) =>
    set((s) => ({
      pages: s.pages.map((p) =>
        p.id === s.currentPageId
          ? { ...p, objects: p.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)) }
          : p
      ),
    })),

  // Duplicate: clone the object with a fresh id, offset by +20px so it's
  // visually distinct, append at the end (so it draws on top within its
  // z-index tier), and select the copy.
  duplicateObject: (id) => {
    const { pages, currentPageId } = get();
    const page = pages.find((p) => p.id === currentPageId);
    const src  = page?.objects.find((o) => o.id === id);
    if (!page || !src) return;
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
        p.id === currentPageId ? { ...p, objects: [...p.objects, copy] } : p
      ),
      selectedObjectId: copy.id,
    }));
  },

  deleteObject: (id) =>
    set((s) => ({
      pages: s.pages.map((p) =>
        p.id === s.currentPageId
          ? { ...p, objects: p.objects.filter((o) => o.id !== id) }
          : p
      ),
      selectedObjectId: s.selectedObjectId === id ? null : s.selectedObjectId,
    })),

  updateTagValue: (id, state) =>
    set((s) => ({ tagValues: { ...s.tagValues, [id]: state } })),

  setAlarms: (list) =>
    set({ alarms: Object.fromEntries(list.map((a) => [a.def.id, a])) }),

  updateAlarm: (state) =>
    set((s) => ({ alarms: { ...s.alarms, [state.def.id]: state } })),

  setGridSize: (gridSize) => set({ gridSize }),
  setSnapEnabled: (snapEnabled) => set({ snapEnabled }),
}));

export type { AppState, SynopticObject };
