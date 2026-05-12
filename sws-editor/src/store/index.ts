// TODO (ADR 0001): evaluate Redux Toolkit as an alternative before M1 freeze.
import { create } from "zustand";
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

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function makePage(name: string): SynopticPage {
  return { id: genId(), name, objects: [] };
}

interface AppState {
  project: ProjectInfo | null;
  pages: SynopticPage[];
  currentPageId: string;
  selectedObjectId: string | null;
  tagValues: Record<string, TagState>;
  alarms: Record<string, AlarmState>;
  gridSize: number;
  snapEnabled: boolean;

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

export const useAppStore = create<AppState>((set, get) => ({
  project: null,
  pages: [first],
  currentPageId: first.id,
  selectedObjectId: null,
  tagValues: {},
  alarms: {},
  gridSize: 10,
  snapEnabled: true,

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
