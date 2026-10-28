/** «Eseguito da …»: chi fa la scoperta si legge dove si legge il risultato.
 *
 *  Nasce da un'ora persa il 28-10-2026: progetto del WP630 aperto, ma IDE
 *  ancora collegato al TC620 di casa. Lo «Sfoglia broker» ha cercato un
 *  indirizzo dell'ufficio **dal pannello di casa** e ha risposto «0 topic» —
 *  corretto, e indistinguibile da un difetto.
 *
 *  Si prova il **nome**, non il testo tradotto: nel catalogo di prova `t()`
 *  torna la chiave, e un test che guardasse la frase proverebbe i18n invece
 *  di quello che conta. */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vitest";
import { usaChiEsegue } from "@/config/sorgenti/EseguitoDa";
import { useAppStore } from "@/store";

describe("chi esegue una scoperta", () => {
  beforeEach(() => {
    useAppStore.setState({ remoteConnected: false, remoteUrl: null });
  });

  it("col pannello collegato è il suo nome, preso dall'URL del cloud", () => {
    useAppStore.setState({ remoteConnected: true, remoteUrl: "https://sws.soligo.net/dev/tc620-garage" });
    expect(renderHook(() => usaChiEsegue()).result.current).toBe("tc620-garage");
  });

  it("senza pannello collegato è `null`: la ricerca parte da qui", () => {
    expect(renderHook(() => usaChiEsegue()).result.current).toBeNull();
  });

  it("collegato ma senza URL non inventa un nome", () => {
    useAppStore.setState({ remoteConnected: true, remoteUrl: null });
    expect(renderHook(() => usaChiEsegue()).result.current).toBe("remote");
  });

  /** Il caso del 28-10 in una riga: due pannelli, due nomi diversi. Se un
   *  giorno il nome smettesse di venire dall'URL, questa riga lo direbbe. */
  it("due pannelli diversi danno due nomi diversi", () => {
    useAppStore.setState({ remoteConnected: true, remoteUrl: "https://sws.soligo.net/dev/wp630-ufficio" });
    expect(renderHook(() => usaChiEsegue()).result.current).toBe("wp630-ufficio");
  });
});
