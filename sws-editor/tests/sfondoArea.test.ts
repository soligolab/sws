/** L'immagine di sfondo dell'area attiva (25-10-2026): il gemello dell'editor
 *  deve dare gli stessi numeri del server (`cornici::sfondo_area`, test
 *  `lo_sfondo_dell_area_sta_fra_le_fasce_e_sotto_tutto`). */
import { describe, expect, it } from "vitest";
import { ID_SFONDO_AREA, oggettoSfondoArea } from "../src/cornici/modello";
import type { SynopticPage } from "../src/types";

const frame = { id: "frame", nome: "Frame", larghezza: 1280, altezza: 800,
  testata: { altezza: 56, sfondo: "#111111" }, piede: { altezza: 60 }, oggetti: [] };

describe("immagine di sfondo dell'area attiva", () => {
  it("fra testata e piede della cornice", () => {
    const p = { id: "garage", name: "Garage", objects: [], sfondo_immagine: "/api/project/images/garage.jpg" } as SynopticPage;
    const o = oggettoSfondoArea(p, frame as never)!;
    expect(o.id).toBe(ID_SFONDO_AREA);
    expect([o.x, o.y, o.width, o.height]).toEqual([0, 56, 1280, 684]);
    expect(o.bg_image).toBe("/api/project/images/garage.jpg");
    expect(o.fill).toBe("none");
  });

  it("senza cornice, tutta la pagina; senza immagine, niente", () => {
    const p = { id: "p", name: "P", objects: [], width: 1024, height: 600, sfondo_immagine: "x.png" } as SynopticPage;
    expect([oggettoSfondoArea(p, undefined)!.y, oggettoSfondoArea(p, undefined)!.height]).toEqual([0, 600]);
    expect(oggettoSfondoArea({ id: "n", name: "N", objects: [] } as SynopticPage, undefined)).toBeUndefined();
  });
});
