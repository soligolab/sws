/** Page navigator → «Extra buttons» (plan 2026-11-19-navigatore-pulsanti-in-piu): a button towards a
 *  chosen page, to enter a sub-menu or to leave it. The panel writes `nav_links`; the logic is in
 *  the shared fixture `tests/fixtures/navigatore-pagine.json`. */
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import type { ReactNode } from "react";
import "../src/i18n";
import { NavigatorProperties } from "../src/editor/NavigatorProperties";
import { useAppStore } from "../src/store";
import type { SynopticObject, SynopticPage } from "../src/types";

const page = (id: string, name: string, extra: Partial<SynopticPage> = {}): SynopticPage =>
  ({ id, name, objects: [], ...extra }) as SynopticPage;

const nav = (extra: Partial<SynopticObject> = {}): SynopticObject =>
  ({ id: "n", type: "page_navigator", x: 0, y: 0, width: 400, height: 40, nav_source: "roots", ...extra }) as SynopticObject;

function show(obj: SynopticObject) {
  const onChange = vi.fn();
  render(
    <NavigatorProperties
      obj={obj}
      onChange={onChange}
      field={(label: string, content: ReactNode) => <div><span>{label}</span>{content}</div>}
      numInput={() => null}
      colorInput={() => null}
      inputStyle={{}}
    />,
  );
  return onChange;
}

beforeEach(() => {
  useAppStore.setState({
    pages: [
      page("sistema", "Sistema"),
      page("idrico_sinottico", "Idrico - Sinottico"),
      page("idrico_trend", "Idrico - Trend"),
      page("popup", "Popup", { finestra: { modale: true } } as Partial<SynopticPage>),
    ],
    project: {
      page_layout: { page_tree: [{ id: "sistema", children: [{ id: "idrico_sinottico" }, { id: "idrico_trend" }] }, { id: "popup" }] },
    } as never,
  });
});
afterEach(cleanup);

describe("page navigator — extra buttons", () => {
  it("«+ Button» adds one towards the first navigable page", () => {
    const onChange = show(nav());
    fireEvent.click(screen.getByTestId("nav-link-add"));
    expect(onChange).toHaveBeenCalledWith({ nav_links: [{ page_id: "sistema" }] });
  });

  it("the page menu offers the navigable pages only (no pop-up windows), and changes the destination", () => {
    const onChange = show(nav({ nav_links: [{ page_id: "sistema", label: "Idro", order: 2 }] }));
    const select = screen.getByTestId("nav-link-0").querySelector("select") as HTMLSelectElement;
    const values = [...select.options].map((o) => o.value);
    expect(values).toEqual(["sistema", "idrico_sinottico", "idrico_trend"]);
    fireEvent.change(select, { target: { value: "idrico_sinottico" } });
    expect(onChange).toHaveBeenCalledWith({ nav_links: [{ page_id: "idrico_sinottico", label: "Idro", order: 2 }] });
  });

  it("removing the last one removes the field", () => {
    const onChange = show(nav({ nav_links: [{ page_id: "sistema" }] }));
    const remove = [...screen.getByTestId("nav-link-0").querySelectorAll("button")].find((b) => b.textContent === "×");
    fireEvent.click(remove as HTMLButtonElement);
    expect(onChange).toHaveBeenCalledWith({ nav_links: undefined });
  });
});
