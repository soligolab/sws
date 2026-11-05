import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "../src/i18n";
import { GruppoAttivo, PageProps } from "../src/editor/EditorShell";
import type { ComponentProps } from "react";

/** **Il campo «Immagine di sfondo» sulla pagina di boot** (26-10-2026).
 *
 *  Il maintainer ha messo un'immagine sulla pagina di boot nel cloud e il PNG
 *  l'ha persa. Sono venute fuori due cose: un difetto (le immagini `blob:` non
 *  si incorporavano — vedi `rasterizzaBoot.test.ts`) e una funzione che
 *  mancava, questa. Il campo Rust esisteva gia' (`synoptic.rs`), il canvas lo
 *  disegnava gia': era nascosto con `{!boot && !cornice && …}`, e basta.
 *
 *  Si prova rendendo, perche' quello che e' cambiato **e'** una condizione nel
 *  JSX — il tipo di riga che regredisce senza far fallire niente. */
const comuni = {
  name: "Avvio", background: "#000000", sizeMode: "fixed" as const,
  offPageCount: 0, onChange: () => {},
};

/** Dal 05-11-2026 le sezioni della pagina hanno un ramo (Pagina, Sfondo): nel
 *  pannello vero stanno sotto `GruppoAttivo` «tutti», che qui si dà a mano. */
const Pagina = (p: ComponentProps<typeof PageProps>) => (
  <GruppoAttivo.Provider value="tutti"><PageProps {...p} /></GruppoAttivo.Provider>
);

describe("l'immagine di sfondo, e dove si puo' impostare", () => {
  it("sulla pagina di boot c'e', con le parole del boot", () => {
    render(<Pagina {...comuni} boot pageId="boot1" />);
    // Sul boot non esiste un'«area attiva» fra testata e piede: non c'e' la
    // cornice. L'etichetta lo dice.
    expect(screen.getByText(/^Background image$/)).toBeTruthy();
    expect(screen.queryByText(/active area/i)).toBeNull();
  });

  it("su una pagina normale c'e', con le parole di sempre", () => {
    render(<Pagina {...comuni} pageId="p1" />);
    expect(screen.getByText(/active area/i)).toBeTruthy();
  });

  it("**su una cornice non c'e'**: una cornice uno sfondo suo non ce l'ha", () => {
    render(<Pagina {...comuni} cornice pageId="c1" />);
    expect(screen.queryByText(/Background image/i)).toBeNull();
    expect(screen.queryByText(/active area/i)).toBeNull();
  });
});
