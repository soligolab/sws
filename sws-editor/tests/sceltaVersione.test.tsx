// The choice of a version in a drop-down list (27-11-2026, collaudo of the
// dev.5: «un menù a tendina dove sia chiaro l'ordine di "vecchiaia"»).
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "../src/i18n/index";
import i18n from "../src/i18n/index";
import { scegliVersione, vociVersione } from "../src/components/sceltaVersione";
import { FinestraAvviso } from "../src/finestraAvviso/FinestraAvviso";

describe("the list of versions", () => {
  it("starts from the newest and marks the newest and the running one", () => {
    const v = vociVersione(["2.27.0", "2.28.0-dev.4", "2.28.0-dev.5"], { inUso: "2.28.0-dev.4", recente: "N", attuale: "R" });
    expect(v.map((x) => x.valore)).toEqual(["2.28.0-dev.5", "2.28.0-dev.4", "2.27.0"]);
    expect(v[0].etichetta).toBe("2.28.0-dev.5 — N");
    expect(v[1].etichetta).toBe("2.28.0-dev.4 — R");
    expect(v[2].etichetta).toBe("2.27.0");
  });

  it("is a drop-down with «No cap» first and the current cap selected; Apply gives the choice", async () => {
    render(<FinestraAvviso />);
    let answer: Promise<string | null> = Promise.resolve(null);
    act(() => {
      answer = scegliVersione({ titolo: "Cap", testo: "t", versioni: ["2.27.0", "2.28.0"], iniziale: "2.27.0", nessuna: "No cap" });
    });
    const select = await screen.findByTestId("scelta-versione") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(["", "2.28.0", "2.27.0"]);
    expect(select.value).toBe("2.27.0");
    expect(screen.getByText(i18n.t("sceltaVersione.ordine", { n: 2 }))).toBeTruthy();
    fireEvent.change(select, { target: { value: "" } });
    fireEvent.click(screen.getByTestId("scelta-versione-ok"));
    expect(await answer).toBe("");
  });
});
