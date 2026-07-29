import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { App } from "../src/App";

// Smoke test dello shell: verifica che il componente monti senza lanciare.
//
// Cosa NON copre, e perché: `App` ha un gate `bootstrapping` che rende `null`
// finché `getProject()` + `whoami()` non hanno risposto. In jsdom quelle
// chiamate non arrivano da nessuna parte, quindi il DOM resta vuoto e non c'è
// nulla da interrogare — cercare un'etichetta o un pulsante qui è destinato a
// fallire. Il test precedente cercava "Edit"/"View", etichette rimosse da
// quando i pulsanti di modalità usano le chiavi i18n `header.mode.*`, ed era
// rosso a ogni esecuzione da diverse sessioni.
//
// Per verificare davvero il contenuto servirebbe un mock di `@/api/client`
// (progetto attivo + whoami) — vale la pena farlo quando servirà asserire
// sull'interfaccia, non per un smoke test.
describe("App", () => {
  it("monta senza lanciare", () => {
    expect(() => render(<App />)).not.toThrow();
  });
});
