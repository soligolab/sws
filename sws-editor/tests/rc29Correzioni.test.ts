// The small fixes of the rc.28 test run (22-11-2026), the pure parts.
import { describe, expect, it } from "vitest";
import { novitaRaccolte, type NovitaVersione } from "@/api/client";
import { fillFrame, type Box } from "@/symbols/editor/model";
import { sogliaFunzione, ruoloCheServe } from "@/auth/permessoScrittura";
import type { DescrizioneSimbolo } from "@/types";

describe("novitaRaccolte", () => {
  const n = (versione: string, testo: string, compatibilita = "- ports 7443"): NovitaVersione =>
    ({ versione, testo, compatibilita } as NovitaVersione);
  it("says the warnings of one release once, under its newest version", () => {
    const out = novitaRaccolte([
      n("2.26.0-rc.24", "- a"), n("2.26.0-rc.25", "- a\n- b"), n("2.26.0-rc.28", "- a\n- b\n- c"), n("2.27.0-rc.1", "- d"),
    ]);
    expect(out.map((x) => x.versione)).toEqual(["2.26.0-rc.28", "2.27.0-rc.1"]);
    expect(out[0].testo).toBe("- a\n- b\n- c");
  });
  it("leaves alone what has nothing to collapse", () => {
    expect(novitaRaccolte(undefined)).toEqual([]);
    expect(novitaRaccolte([n("2.25.1", "x"), n("2.26.0", "y")]).length).toBe(2);
  });
});

describe("fillFrame", () => {
  const d = {
    slug: "stufa", it: "Stufa", en: "Stove", w: 100, h: 140,
    ops: [
      { op: "corpo" },
      { op: "forma", tag: "rect", geo: [["x", 10], ["y", 20], ["width", 80], ["height", 70]] },
      { op: "bocca", x: 0, y: 50, side: "left", d: 10, id: "in" },
    ],
  } as unknown as DescrizioneSimbolo;
  const boxes = new Map<number, Box>([[1, { x: 10, y: 20, w: 80, h: 70 }]]);
  it("scales the drawing evenly to the frame, centred, ports on their border", () => {
    const out = fillFrame(d, boxes);
    const geo = Object.fromEntries((out.ops[1] as unknown as { geo: [string, number][] }).geo);
    // 98 / 80 = 1.225 limits (width); height 70 → 85.75, centred in 140.
    expect(geo.width).toBeCloseTo(98, 1);
    expect(geo.x).toBeCloseTo(1, 1);
    expect(geo.height).toBeCloseTo(85.75, 1);
    expect(geo.y + geo.height / 2).toBeCloseTo(70, 1);
    const port = out.ops[2] as { x: number; side: string };
    expect(port.side).toBe("left");
    expect(port.x).toBe(0);
  });
  it("does nothing on an empty drawing", () => {
    expect(fillFrame(d, new Map())).toBe(d);
  });
});

describe("a function's role", () => {
  const fns = [{ name: "tapparelle_tutte", min_role: "Viewer" }, { name: "reset" }];
  it("is Operator unless the function says otherwise", () => {
    expect(sogliaFunzione(fns, "tapparelle_tutte")).toBe("Viewer");
    expect(sogliaFunzione(fns, "reset")).toBe("Operator");
    expect(sogliaFunzione(fns, "missing")).toBe("Operator");
  });
  it("locks the button that runs it, like a tag it writes", () => {
    const chiudi = { type: "button", on_press_fn: "tapparelle_tutte" } as never;
    const reset = { type: "button", on_press_fn: "reset" } as never;
    expect(ruoloCheServe(chiudi, null, [], [], fns)).toBeNull();
    expect(ruoloCheServe(reset, null, [], [], fns)).toEqual({ ruolo: "Operator", attenua: false });
    expect(ruoloCheServe(reset, "Operator", [], [], fns)).toBeNull();
  });
});
