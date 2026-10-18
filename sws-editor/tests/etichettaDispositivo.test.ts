/** Il log del dispositivo nell'IDE (18-10-2026): l'etichetta delle righe è il nome del
 *  dispositivo registrato, altrimenti il pannello di un indirizzo del cloud, altrimenti l'host. */
import { describe, expect, it } from "vitest";
import { etichettaDispositivo } from "../src/ws/remoteLogStream";

describe("etichetta delle righe del dispositivo", () => {
  it("usa il nome registrato, poi il pannello del cloud, poi l'host", () => {
    const reg = [{ label: "TC620 casa", url: "https://192.168.1.204:8444/" }];
    expect(etichettaDispositivo("https://192.168.1.204:8444", reg)).toBe("TC620 casa");
    expect(etichettaDispositivo("https://sws.soligo.net/dev/tc620-a-p3", [])).toBe("tc620-a-p3");
    expect(etichettaDispositivo("https://wp630.local:8444", [])).toBe("wp630.local");
    expect(etichettaDispositivo(null, [])).toBe("remote");
  });
});
