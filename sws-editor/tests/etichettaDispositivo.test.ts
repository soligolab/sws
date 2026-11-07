/** Il log del dispositivo nell'IDE (18-10-2026): l'etichetta delle righe è il nome del
 *  dispositivo registrato, altrimenti il pannello di un indirizzo del cloud, altrimenti l'host. */
import { describe, expect, it } from "vitest";
import { etichettaDispositivo, urlLogRemoti } from "../src/ws/remoteLogStream";

describe("etichetta delle righe del dispositivo", () => {
  it("usa il nome registrato, poi il pannello del cloud, poi l'host", () => {
    const reg = [{ label: "TC620 casa", url: "https://192.168.1.204:8444/" }];
    expect(etichettaDispositivo("https://192.168.1.204:8444", reg)).toBe("TC620 casa");
    expect(etichettaDispositivo("https://sws.soligo.net/dev/tc620-a-p3", [])).toBe("tc620-a-p3");
    expect(etichettaDispositivo("https://wp630.local:8444", [])).toBe("wp630.local");
    expect(etichettaDispositivo(null, [])).toBe("remote");
  });
});

describe("indirizzo del relay dei log", () => {
  // Collaudo del 07-11-2026: nel cloud mancava il prefisso del progetto, e il
  // socket andava al gateway invece che al container — nessuna riga del pannello.
  it("porta il prefisso del gateway, come tags e allarmi", () => {
    expect(urlLogRemoti("wss", "sws.soligo.net", "/p/-/CasaDomotica", "t1", false))
      .toBe("wss://sws.soligo.net/p/-/CasaDomotica/ws/remote/logs?token=t1");
    expect(urlLogRemoti("ws", "localhost:8460", "", null, true))
      .toBe("ws://localhost:8460/ws/remote/logs?livello=debug");
  });
});
