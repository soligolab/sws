// TODO (ADR 0001): evaluate Redux Toolkit as an alternative before M1 freeze.
import { create } from "zustand";
import type { Project, SynopticObject, TagValue } from "@/types";

interface AppState {
  project: Project | null;
  selectedObjectId: string | null;
  tagValues: Record<string, TagValue>;
  setProject: (p: Project) => void;
  selectObject: (id: string | null) => void;
  updateTagValues: (values: Record<string, TagValue>) => void;
}

export const useAppStore = create<AppState>((set) => ({
  project: null,
  selectedObjectId: null,
  tagValues: {},
  setProject: (project) => set({ project }),
  selectObject: (selectedObjectId) => set({ selectedObjectId }),
  updateTagValues: (incoming) =>
    set((s) => ({ tagValues: { ...s.tagValues, ...incoming } })),
}));

export type { AppState, SynopticObject };
