// Il difetto: «creo una variabile pippo, dice di aver salvato, cambio tab e
// non c'è più» (maintainer, 2026-09-08).
//
// Causa: il pannello variabili si risincronizzava sull'INTERO oggetto
// `project`, che cambia identità ogni volta che si salva una qualunque altra
// sezione. La riga in corso di scrittura veniva cancellata e `touched`
// azzerato, quindi niente avvisava; il salvataggio poi scriveva onestamente la
// lista vuota.
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSezioneSincronizzata } from "@/config/useSezioneSincronizzata";

type Riga = { id: string };

/** Il pannello: `applica` è ciò che sovrascrive lo stato locale. */
function monta(iniziale: { remoto: Riga[]; modificato: boolean; progetto: string }) {
  const applicati: Riga[][] = [];
  const h = renderHook(
    (p: { remoto: Riga[]; modificato: boolean; progetto: string }) =>
      useSezioneSincronizzata<Riga[]>({
        remoto: p.remoto,
        applica: (v) => { applicati.push(v); },
        modificato: p.modificato,
        progetto: p.progetto,
      }),
    { initialProps: iniziale },
  );
  return { h, applicati };
}

const VUOTO: Riga[] = [];
const PROG = "TestWP630";

describe("useSezioneSincronizzata", () => {
  it("si allinea in silenzio quando non c'è niente di non salvato", () => {
    const { h, applicati } = monta({ remoto: VUOTO, modificato: false, progetto: PROG });
    expect(applicati).toEqual([VUOTO]);          // primo allineamento
    const nuovo = [{ id: "a" }];
    act(() => h.rerender({ remoto: nuovo, modificato: false, progetto: PROG }));
    expect(applicati).toEqual([VUOTO, nuovo]);
    expect(h.result.current.conflitto).toBe(false);
  });

  it("NON sovrascrive mentre stai scrivendo: chiede", () => {
    // È il caso segnalato: salvi le sorgenti, `project` cambia identità, e il
    // pannello variabili si azzerava sotto le dita.
    const { h, applicati } = monta({ remoto: VUOTO, modificato: false, progetto: PROG });
    applicati.length = 0;
    act(() => h.rerender({ remoto: VUOTO, modificato: true, progetto: PROG }));
    // Nuovo oggetto progetto, stesso contenuto: prima bastava questo a cancellare.
    act(() => h.rerender({ remoto: [], modificato: true, progetto: PROG }));
    expect(applicati).toEqual([]);               // niente è stato sovrascritto
    expect(h.result.current.conflitto).toBe(true);
  });

  it("«tieni le mie» non riapre la domanda per lo stesso cambiamento", () => {
    const { h, applicati } = monta({ remoto: VUOTO, modificato: true, progetto: PROG });
    applicati.length = 0;
    const remoto2: Riga[] = [];
    act(() => h.rerender({ remoto: remoto2, modificato: true, progetto: PROG }));
    expect(h.result.current.conflitto).toBe(true);
    act(() => h.result.current.mantieni());
    expect(h.result.current.conflitto).toBe(false);
    expect(applicati).toEqual([]);
    // Lo stesso valore non deve ripresentarsi.
    act(() => h.rerender({ remoto: remoto2, modificato: true, progetto: PROG }));
    expect(h.result.current.conflitto).toBe(false);
  });

  it("«ricarica» applica la versione del progetto", () => {
    const { h, applicati } = monta({ remoto: VUOTO, modificato: true, progetto: PROG });
    applicati.length = 0;
    const remoto2 = [{ id: "dal-progetto" }];
    act(() => h.rerender({ remoto: remoto2, modificato: true, progetto: PROG }));
    act(() => h.result.current.ricarica());
    expect(applicati).toEqual([remoto2]);
    expect(h.result.current.conflitto).toBe(false);
  });

  it("cambiando PROGETTO si allinea sempre, senza chiedere", () => {
    // Modifiche che riguardano un progetto non più aperto: tenerle sarebbe
    // peggio che perderle.
    const { h, applicati } = monta({ remoto: VUOTO, modificato: true, progetto: PROG });
    applicati.length = 0;
    const altro = [{ id: "altro-progetto" }];
    act(() => h.rerender({ remoto: altro, modificato: true, progetto: "AltroProgetto" }));
    expect(applicati).toEqual([altro]);
    expect(h.result.current.conflitto).toBe(false);
  });
});
