/** I nomi di pagina della tabella lingue (02-11-2026, il template degli slider):
 *  l'albero e le linguette mostravano «{{t0072}}». */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "../src/i18n";
import { useAppStore } from "../src/store";
import { PageTabs } from "../src/editor/PageTabs";

describe("il nome di una pagina tradotta", () => {
  it("le linguette lo mostrano nella lingua d'anteprima", () => {
    useAppStore.setState({
      editorPreviewLang: "en",
      project: { languages: { default: "it", langs: ["it", "en"], entries: [{ key: "t0072", values: { it: "Stili", en: "Styles" } }] } } as never,
      pages: [{ id: "p1", name: "{{t0072}}", objects: [] }, { id: "p2", name: "Seconda", objects: [] }] as never,
      currentPageId: "p1",
    });
    render(<PageTabs />);
    expect(screen.getByText("Styles")).toBeTruthy();
    expect(screen.getByText("Seconda")).toBeTruthy();
    expect(screen.queryByText("{{t0072}}")).toBeNull();
  });
});
