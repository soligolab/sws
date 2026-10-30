/** La scena 3D come dati (29-10-2026, ramo 2): il muro diventa scatole, le
 *  aperture lasciano il vano, un angolo spezza il tratto sui due lati. */
import { describe, expect, it } from "vitest";
import { costruisciScena, inquadraturaDiPartenza } from "../src/planimetrie/scena";
import { nuovaPlanimetria, type Planimetria } from "../src/planimetrie/modello";

const pianta = (patch: Partial<Planimetria>): Planimetria => ({ ...nuovaPlanimetria("p", "P"), ...patch });
const muro = { id: "m1", punti: [[0, 0], [10, 0]] as [number, number][], spessore: 0.2, altezza: 2.7 };

describe("costruisciScena", () => {
  it("un muro dritto senza aperture è una scatola sola, in piedi", () => {
    const s = costruisciScena(pianta({ muri: [muro] }));
    expect(s.scatole).toHaveLength(1);
    const [w] = s.scatole;
    expect(w.centro).toEqual([5, 1.35, 0]);
    expect(w.misure[1]).toBeCloseTo(2.7);
    expect(w.misure[2]).toBeCloseTo(0.2);
  });

  it("una porta lascia due pezzi pieni e l'architrave", () => {
    const s = costruisciScena(pianta({ muri: [muro], aperture: [{ id: "p", muro: "m1", t: 0.5, larghezza: 1, altezza: 2.1, tipo: "porta" }] }));
    expect(s.scatole).toHaveLength(3);
    const architrave = s.scatole.find((b) => b.centro[1] > 2)!;
    expect(architrave.misure[0]).toBeCloseTo(1);
    expect(architrave.misure[1]).toBeCloseTo(0.6);
  });

  it("un tratto che gira l'angolo si spezza sui due lati", () => {
    const s = costruisciScena(pianta({ muri: [{ ...muro, punti: [[0, 0], [4, 0], [4, 3]] }] }));
    expect(s.scatole).toHaveLength(2);
    expect(s.scatole[1].centro[0]).toBeCloseTo(4);
    expect(Math.abs(s.scatole[1].rotazioneY)).toBeCloseTo(Math.PI / 2);
  });

  it("blocchi in piedi sul pavimento, aree come pavimenti, limiti e altezza", () => {
    const s = costruisciScena(pianta({
      blocchi: [{ id: "b", x: 2, y: 3, larghezza: 1, profondita: 2, altezza: 1.5, rotazione: 0, colore: "#64748b", etichetta: "Caldaia" }],
      aree: [{ id: "z", punti: [[0, 0], [4, 0], [4, 4]], colore: "#1e3a5f", etichetta: "Cucina" }],
    }));
    expect(s.scatole[0]).toMatchObject({ centro: [2, 0.75, 3], tipo: "blocco", etichetta: "Caldaia" });
    expect(s.pavimenti[0].etichetta).toBe("Cucina");
    expect(s.limiti).toEqual([0, 0, 4, 4]);
    expect(s.altezzaMassima).toBe(1.5);
  });

  it("l'inquadratura di partenza guarda il centro da sopra", () => {
    const cam = inquadraturaDiPartenza(costruisciScena(pianta({ muri: [muro] })));
    expect(cam.target).toEqual([5, 0, 0]);
    expect(cam.pos[1]).toBeGreaterThan(5);
  });
});
