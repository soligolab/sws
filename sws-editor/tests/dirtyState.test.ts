import { beforeEach, describe, expect, it } from "vitest";
import { selectIsDirty, useAppStore } from "../src/store";
import type { SynopticPage } from "../src/types";

// The unsaved-changes flag is derived, not stored: `pages` dirtiness comes from
// a revision counter that time travel restores, and everything else from the
// pending-sections registry. These are the cases that used to be wrong.

const page = (): SynopticPage => ({ id: "p1", name: "Page 1", objects: [] });
const dirty = () => selectIsDirty(useAppStore.getState());

describe("dirty state", () => {
  beforeEach(() => {
    // setPages is the "loaded from disk" entry point: it resets the baseline.
    useAppStore.getState().setPages([page()], "p1");
    useAppStore.setState({ pendingSections: {} });
  });

  it("starts clean after a load", () => {
    expect(dirty()).toBe(false);
  });

  it("becomes dirty on a mutation and clean again after a save", () => {
    useAppStore.getState().addObject({ type: "label", x: 0, y: 0, text: "a" } as never);
    expect(dirty()).toBe(true);

    useAppStore.getState().markPagesSaved();
    expect(dirty()).toBe(false);
  });

  it("undo back to the saved revision clears the flag, redo sets it again", () => {
    const s = useAppStore.getState;
    s().addObject({ type: "label", x: 0, y: 0, text: "a" } as never);
    s().markPagesSaved();                     // saved at this revision
    s().addObject({ type: "label", x: 10, y: 0, text: "b" } as never);
    expect(dirty()).toBe(true);

    s().undo();                               // back to what is on disk
    expect(dirty()).toBe(false);

    s().redo();                               // forward again
    expect(dirty()).toBe(true);
  });

  it("undo past the saved revision stays dirty", () => {
    const s = useAppStore.getState;
    s().addObject({ type: "label", x: 0, y: 0, text: "a" } as never);
    s().addObject({ type: "label", x: 10, y: 0, text: "b" } as never);
    s().markPagesSaved();

    s().undo();
    expect(dirty()).toBe(true);
    s().undo();
    expect(dirty()).toBe(true);
  });

  it("tracks section drafts independently of the canvas", () => {
    const { registerPendingSection } = useAppStore.getState();
    registerPendingSection("tags", async () => {});
    expect(dirty()).toBe(true);

    // A page save must not clear a pending section draft.
    useAppStore.getState().markPagesSaved();
    expect(dirty()).toBe(true);

    registerPendingSection("tags", null);
    expect(dirty()).toBe(false);
  });

  it("resetDirty drops both sources (close project / logout)", () => {
    const s = useAppStore.getState;
    s().addObject({ type: "label", x: 0, y: 0, text: "a" } as never);
    s().registerPendingSection("alarms", async () => {});
    expect(dirty()).toBe(true);

    s().resetDirty();
    expect(dirty()).toBe(false);
  });
});
