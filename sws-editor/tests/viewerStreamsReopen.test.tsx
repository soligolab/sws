// A new project opens again the streams that are down (collaudo of
// 2.27.0-dev.3 on the PLX800, 25-11-2026; plan
// docs/plans/2026-11-25-correzioni-collaudo-dev3.md, part A).
//
// After «delete only the project» the runtime answered but refused the
// sockets: it was never unreachable, so the watcher's «the runtime is back»
// never came, and the deploy that followed loaded the pages but left the tag
// socket given up. Now the watcher asks the streams to open again at every
// project change.
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../src/i18n/index";
import { api } from "../src/api/client";
import { useAppStore } from "../src/store";
import { RuntimeViewer } from "../src/viewer/RuntimeViewer";
import type { ProjectInfo } from "../src/types";

const streams = vi.hoisted(() => ({ tags: vi.fn(), alarms: vi.fn() }));

vi.mock("@/runtime-view/RuntimeView", () => ({
  RuntimeView: () => <div data-testid="page" />,
}));
vi.mock("@/ws/buildWatcher", () => ({ useBuildWatcher: () => {} }));
vi.mock("@/ws/tagStream", () => ({ riprovaFlussoTag: streams.tags }));
vi.mock("@/ws/alarmStream", () => ({ riprovaFlussoAllarmi: streams.alarms }));

const project = { meta: { name: "PLX800", version: "1" }, tags: [], sources: [] } as unknown as ProjectInfo;

async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

describe("the viewer at a project change", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    streams.tags.mockClear();
    streams.alarms.mockClear();
    useAppStore.setState({ noActiveProject: false, project: null });
    vi.spyOn(api, "whoami").mockResolvedValue({ username: "", role: "Viewer" } as never);
    vi.spyOn(api, "listSynoptics").mockResolvedValue([]);
    vi.spyOn(api, "listFaceplates").mockResolvedValue([]);
    vi.spyOn(api, "getProject").mockResolvedValue(project);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("opens again the tag and alarm streams after a deploy", async () => {
    const fingerprint = vi.spyOn(api, "getProjectFingerprint")
      .mockResolvedValue({ sha256: "before", computed_at_ms: 0 } as never);
    render(<RuntimeViewer />);
    await advance(0);
    expect(screen.getByTestId("page")).toBeTruthy();
    await advance(3_000);
    expect(streams.tags).not.toHaveBeenCalled();

    // A deploy: the fingerprint changes, the runtime never stopped answering.
    fingerprint.mockResolvedValue({ sha256: "after", computed_at_ms: 1 } as never);
    await advance(3_000);
    expect(streams.tags).toHaveBeenCalled();
    expect(streams.alarms).toHaveBeenCalled();
  });
});
