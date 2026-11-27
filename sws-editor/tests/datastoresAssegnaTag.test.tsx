import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../src/i18n";

const { listDatastoreTags, addTagRename, datastoreStats } = vi.hoisted(() => ({
  listDatastoreTags: vi.fn(),
  addTagRename: vi.fn(),
  datastoreStats: vi.fn(),
}));
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { ...actual.api, listDatastoreTags, addTagRename, datastoreStats } };
});
vi.mock("../src/config/schede/RitenzioneAutomatica", () => ({ RitenzioneAutomatica: () => null }));

import { DatastoresTab } from "../src/config/schede/DatastoresTab";
import { useAppStore } from "../src/store";
import { rispondi } from "../src/finestraAvviso/finestraAvviso";
import type { ProjectInfo } from "../src/types";

/** «Assign to a tag…» on an orphan history tag (plan
 *  2026-11-27-cambio-di-nome-del-progetto, part C): it calls the same route as
 *  «Rinomina ovunque», with the orphan as `from` and the chosen tag as `to`. */
describe("Datastores → orphan tags → Assign to a tag", () => {
  let answers: ReturnType<typeof rispondi>;
  beforeEach(() => {
    vi.clearAllMocks();
    listDatastoreTags
      .mockResolvedValueOnce({ db_tags: ["old", "temp"], orphan_tags: ["old"] })
      .mockResolvedValue({ db_tags: ["temp"], orphan_tags: [] });
    addTagRename.mockResolvedValue({ rename: { id: "r1", from: "old", to: "temp" }, applied: 1 });
    datastoreStats.mockResolvedValue({ kind: "sqlite", tag_count: 1, sample_count: 3, connected: true });
    answers = rispondi(true);
    useAppStore.setState({
      remoteConnected: false,
      project: {
        meta: { name: "p", version: "1" },
        tags: [{ id: "temp", data_type: "float" }, { id: "level", data_type: "float" }],
        sources: [], alarms: [],
        datastores: [{ id: "default", label: "Local", backend: { kind: "sqlite", path: "history/historian.db" } }],
      } as unknown as ProjectInfo,
    });
  });
  afterEach(() => answers.ferma());

  it("moves the history of the orphan to the chosen tag", async () => {
    render(<DatastoresTab />);
    fireEvent.click(screen.getByText(i18n.t("cfgUi.findOrphanTags")));
    fireEvent.click(await screen.findByTestId("assign-tag"));
    const select = screen.getByTestId("assign-tag-select") as HTMLSelectElement;
    // The orphan itself is not a choice.
    expect(Array.from(select.options).map((o) => o.value)).toEqual(["", "level", "temp"]);
    fireEvent.change(select, { target: { value: "temp" } });
    fireEvent.click(screen.getByTestId("assign-tag-move"));
    await waitFor(() => expect(addTagRename).toHaveBeenCalledWith("old", "temp"));
    await screen.findByText(i18n.t("cfgUi.tagHistoryAssigned", { from: "old", to: "temp" }));
  });

  it("without a chosen tag the move button does nothing", async () => {
    render(<DatastoresTab />);
    fireEvent.click(screen.getByText(i18n.t("cfgUi.findOrphanTags")));
    fireEvent.click(await screen.findByTestId("assign-tag"));
    expect((screen.getByTestId("assign-tag-move") as HTMLButtonElement).disabled).toBe(true);
    expect(addTagRename).not.toHaveBeenCalled();
  });
});
