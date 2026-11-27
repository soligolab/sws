/** The detail sections of a tag row (27-11-2026, the maintainer): λ, ⚙ and ∿
 *  open and close their section in every case, also with data inside. A
 *  section with data has a tinted button. */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vitest";
import "../src/i18n";
import i18n from "../src/i18n";
import { useAppStore } from "../src/store";
import { TagsTab, bottoneDettaglio } from "../src/config/schede/TagsTab";

const progetto = {
  meta: { name: "prova", version: "0.1.0" },
  tags: [
    { id: "con_dati", data_type: "f64", unit: "rpm", expression: "1 + 1",
      generator: { enabled: true, shape: "triangle", period_ms: 10000, min: 0, max: 100 } },
    { id: "vuoto", data_type: "f64" },
  ],
  types: [], sources: [], alarms: [], functions: [],
} as never;

beforeEach(() => {
  useAppStore.setState({ project: progetto, tagValues: {}, configTab: "tags", configFocus: null, authRole: "Admin" });
});

describe("the detail sections of a tag", () => {
  it("start closed, also with an expression and a generator, and open and close with their button", () => {
    render(<TagsTab scheda="tags" />);
    const gen = i18n.t("cfg.tagGeneratorRemove");
    expect(screen.queryByText(gen)).toBeNull();
    fireEvent.click(screen.getByTestId("dettaglio-gen-0"));
    expect(screen.getByText(gen)).toBeTruthy();
    expect(screen.getByTestId("dettaglio-gen-0").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByTestId("dettaglio-gen-0"));
    expect(screen.queryByText(gen)).toBeNull();
    expect(screen.getByTestId("dettaglio-expr-0").getAttribute("aria-pressed")).toBe("false");
  });

  it("a section with data has a tinted button, an empty one does not", () => {
    render(<TagsTab scheda="tags" />);
    for (const k of ["expr", "meta", "gen"]) {
      expect(screen.getByTestId(`dettaglio-${k}-0`).style.background, k).toContain("--sws-select-bg");
      expect(screen.getByTestId(`dettaglio-${k}-1`).style.background, k).not.toContain("--sws-select-bg");
    }
    expect(bottoneDettaglio(false, true).boxShadow).toContain("--brand-primary");
  });
});
