// Il diff che il pannello mostra prima di applicare una proposta.
//
// # Perché questi test esistono
//
// Fino al 2026-09-02 `riassumi` confrontava tag, sorgenti, allarmi e pagine, e
// **niente altro**. Una proposta che riscriveva il corpo di una funzione
// produceva quindi un diff vuoto, e il pannello mostrava «nessuna modifica» — su
// una proposta che cambiava il progetto. È la forma peggiore di difetto in
// questa funzione: non nasconde un errore, nasconde una modifica, e chi approva
// non ha modo di accorgersene.
//
// Il primo test è quello: è scritto perché fallisca se qualcuno toglie il blocco
// degli script.

import { describe, expect, it } from "vitest";

import { diffRighe, LIMITE_RIGHE } from "@/ai/diffRighe";
import { riassumi } from "@/ai/riassunto";
import type { ProjectInfo } from "@/types";

const base = (extra: Partial<ProjectInfo> = {}): ProjectInfo => ({
  meta: { name: "prova", version: "1.0.0" },
  tags: [], sources: [],
  ...extra,
});

const fn = (name: string, code: string) => ({ id: name, name, code, params: [] });

describe("il diff vede il Python", () => {
  it("una funzione riscritta non è «nessuna modifica»", () => {
    const prima = base({ functions: [fn("allarme", "x = 1\nprint(x)\n")] });
    const dopo  = base({ functions: [fn("allarme", "x = 2\nprint(x)\n")] });

    const d = riassumi(dopo, null, prima, []);
    expect(d.length).toBeGreaterThan(0);
    expect(d[0].testo).toContain("allarme");
    expect(d[0].verso).toBe("~");
    // E porta il diff per righe: senza, «modificata» non dice cosa è cambiato.
    expect(d[0].righe?.some((r) => r.verso === "-" && r.testo === "x = 1")).toBe(true);
    expect(d[0].righe?.some((r) => r.verso === "+" && r.testo === "x = 2")).toBe(true);
  });

  it("una funzione aggiunta e una togliuta si vedono entrambe", () => {
    const prima = base({ functions: [fn("vecchia", "pass\n")] });
    const dopo  = base({ functions: [fn("nuova", "pass\n")] });
    const d = riassumi(dopo, null, prima, []);
    expect(d.find((x) => x.verso === "+" && x.testo.includes("nuova"))).toBeTruthy();
    expect(d.find((x) => x.verso === "-" && x.testo.includes("vecchia"))).toBeTruthy();
  });

  it("uno script globale riscritto si vede", () => {
    const g = (id: string, code: string) =>
      ({ id, code, enabled: true, trigger: { kind: "startup" } }) as never;
    const prima = base({ global_scripts: [g("boot", "print(1)\n")] });
    const dopo  = base({ global_scripts: [g("boot", "print(2)\n")] });
    const d = riassumi(dopo, null, prima, []);
    expect(d.some((x) => x.verso === "~" && x.testo.includes("boot"))).toBe(true);
  });

  /// Il verso rotto dell'altra metà: **assente non è vuoto**.
  it("una proposta che non nomina le funzioni non le dichiara rimosse", () => {
    const prima = base({ functions: [fn("importante", "pass\n")] });
    // `functions` assente = «non ne ho parlato». Trattarla come lista vuota
    // farebbe comparire nel diff la rimozione di tutto quello che c'è, e chi
    // legge approverebbe una cancellazione che nessuno ha proposto.
    const dopo = base({});
    const d = riassumi(dopo, null, prima, []);
    expect(d.some((x) => x.testo.includes("importante"))).toBe(false);
  });

  it("ma un elenco vuoto ESPLICITO è una rimozione, e si vede", () => {
    const prima = base({ functions: [fn("importante", "pass\n")] });
    const dopo  = base({ functions: [] });
    const d = riassumi(dopo, null, prima, []);
    expect(d.some((x) => x.verso === "-" && x.testo.includes("importante"))).toBe(true);
  });
});

describe("il diff per righe", () => {
  it("mostra la riga aggiunta e quella togliuta, col contesto", () => {
    const d = diffRighe("a\nb\nc\n", "a\nB\nc\n");
    expect(d.righe.filter((r) => r.verso === "-").map((r) => r.testo)).toEqual(["b"]);
    expect(d.righe.filter((r) => r.verso === "+").map((r) => r.testo)).toEqual(["B"]);
    // Il contesto c'è: senza, non si capisce dove sia la modifica.
    expect(d.righe.some((r) => r.verso === " " && r.testo === "a")).toBe(true);
  });

  it("su due blocchi identici non trova niente", () => {
    const d = diffRighe("x = 1\n", "x = 1\n");
    expect(d.righe.filter((r) => r.verso !== " ")).toEqual([]);
  });

  it("un inserimento in mezzo non fa sembrare riscritto tutto il blocco", () => {
    // È la ragione per cui c'è un LCS e non un taglio di prefisso e suffisso:
    // quello mostrerebbe come «cambiato» tutto ciò che sta fra la prima e
    // l'ultima differenza, e una riga aggiunta in mezzo a venti diventerebbe
    // venti righe di diff che nessuno rilegge.
    const prima = Array.from({ length: 20 }, (_, i) => `r${i}`).join("\n");
    const dopo  = prima.split("\n").flatMap((r, i) => i === 10 ? [r, "NUOVA"] : [r]).join("\n");
    const d = diffRighe(prima, dopo);
    const cambiate = d.righe.filter((r) => r.verso !== " ");
    expect(cambiate).toHaveLength(1);
    expect(cambiate[0]).toEqual({ verso: "+", testo: "NUOVA" });
  });

  it("oltre il limite rinuncia e lo DICE, invece di restituire un elenco vuoto", () => {
    // Un elenco vuoto sarebbe indistinguibile da «nessuna modifica»: lo stesso
    // difetto, per un'altra strada.
    const grande = Array.from({ length: LIMITE_RIGHE + 10 }, (_, i) => `r${i}`).join("\n");
    const d = diffRighe(grande, grande + "\nextra");
    expect(d.righe).toEqual([]);
    expect(d.parziale).toBe(true);
    expect(d.nota).toBeTruthy();
    expect(d.nota).toContain("righe");
  });
});
