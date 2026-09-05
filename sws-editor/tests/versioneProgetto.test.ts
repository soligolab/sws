import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, dimenticaVersioneProgetto } from "../src/api/client";

/**
 * Q30 — la versione di `project.yaml` che il client tiene in mano.
 *
 * Il difetto che questi test chiudono, trovato dal maintainer il 2026-09-05:
 * premere «⚠ Aggiorna progetto» faceva rifiutare ogni salvataggio successivo
 * con un 409 «qualcun altro ha modificato il progetto mentre lavoravi». Non era
 * qualcun altro — era questo stesso client, un pulsante prima: il server manda
 * l'`ETag` nuovo e il client lo buttava, perché `/api/project/migrate` non era
 * in nessuna delle due liste.
 *
 * Si prova sull'`If-Match` **della chiamata dopo**, che è l'unico punto in cui
 * il difetto si vedeva: la migrazione riusciva sempre.
 */

/** Le chiamate viste dal finto `fetch`, in ordine. */
let chiamate: { url: string; ifMatch: string | null }[] = [];

/** `fetch` finto: risponde 204 con l'`ETag` che gli si dice, come fa
 *  `patch_project` su ogni scrittura riuscita. */
function fetchFinto(etagPerUrl: (url: string) => string | null) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    chiamate.push({ url: String(url), ifMatch: headers.get("If-Match") });
    const etag = etagPerUrl(String(url));
    const h = new Headers();
    if (etag) h.set("ETag", `"${etag}"`);
    return new Response(null, { status: 204, headers: h });
  });
}

describe("versione del progetto (Q30)", () => {
  beforeEach(() => {
    chiamate = [];
    dimenticaVersioneProgetto();
  });

  it("la migrazione porta la versione nuova, e il salvataggio dopo la usa", async () => {
    vi.stubGlobal("fetch", fetchFinto((u) => (u.includes("/migrate") ? "v2" : null)));
    await api.migrateProject();
    await api.updateTags([]);
    expect(chiamate[0].url).toContain("/api/project/migrate");
    // Il difetto era qui: senza la correzione questo era `null`, il server
    // confrontava con la versione di prima della migrazione e rispondeva 409.
    expect(chiamate[1].ifMatch).toBe("v2");
  });

  it("un ETag che non riguarda project.yaml non diventa la versione del progetto", async () => {
    // Un sinottico ha una versione **sua**: prenderla per quella del progetto
    // farebbe fallire il salvataggio successivo con un 409 inventato.
    vi.stubGlobal("fetch", fetchFinto(() => "v-di-una-pagina"));
    await api.saveSynoptic({ id: "p", name: "Pagina 1", objects: [] } as never);
    await api.updateTags([]);
    expect(chiamate[1].ifMatch).toBeNull();
  });

  it("dimenticare la versione azzera l'If-Match", async () => {
    vi.stubGlobal("fetch", fetchFinto(() => "v9"));
    await api.updateTags([]);          // incassa v9 dalla propria risposta
    await api.updateTags([]);
    expect(chiamate[1].ifMatch).toBe("v9");
    dimenticaVersioneProgetto();
    await api.updateTags([]);
    expect(chiamate[2].ifMatch).toBeNull();
  });
});
