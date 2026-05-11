// TODO (ADR 0001): evaluate Redux Toolkit as an alternative before M1 freeze.
import { create } from "zustand";
import type { Project, SynopticObject, SynopticPage, TagState } from "@/types";

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function makePage(name: string): SynopticPage {
  return { id: genId(), name, objects: [] };
}

interface AppState {
  project: Project | null;
  pages: SynopticPage[];
  currentPageId: string;
  selectedObjectId: string | null;
  tagValues: Record<string, TagState>;

  setProject: (p: Project) => void;

  // Page management
  addPage: () => void;
  deletePage: (id: string) => void;
  renamePage: (id: string, name: string) => void;
  setCurrentPage: (id: string) => void;

  // Object CRUD (operates on current page)
  selectObject: (id: string | null) => void;
  addObject: (partial: Omit<SynopticObject, "id">) => void;
  updateObject: (id: string, patch: Partial<SynopticObject>) => void;
  deleteObject: (id: string) => void;

  // Tag values from WebSocket
  updateTagValue: (id: string, state: TagState) => void;
}

const first = makePage("Page 1");

export const useAppStore = create<AppState>((set, get) => ({
  project: null,
  pages: [first],
  currentPageId: first.id,
  selectedObjectId: null,
  tagValues: {},

  setProject: (project) => set({ project }),

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
}));

export type { AppState, SynopticObject };
