import { describe, expect, it } from "vitest";
import { sorgentiSenzaRigheVuote } from "@/config/ConfigView";
import type { SourceDef } from "@/types";

/** Il caso vero: Sandokan, 2026-09-07. La sorgente `mqtt-casa` aveva 28 righe e
 *  la prima col topic vuoto; il broker chiudeva la connessione appena riceveva
 *  la sottoscrizione, portandosi dietro gli altri 27 topic. */
const conRigaVuota = (): SourceDef[] => ([
  { kind: "mqtt", id: "mqtt-casa", host: "192.168.1.6", port: 1883,
    client_id: "sws-mtkk4cm8g33iz",
    topics: [
      { tag: "", topic: "" },
      { tag: "", topic: "   " },
      { tag: "casa.luce", topic: "zigbee2mqtt/luce" },
    ] },
] as unknown as SourceDef[]);

describe("le righe MQTT senza topic non si salvano", () => {
  it("toglie le righe vuote e tiene le altre", () => {
    const out = sorgentiSenzaRigheVuote(conRigaVuota());
    const topics = (out[0] as { topics: { topic: string }[] }).topics;
    expect(topics).toHaveLength(1);
    expect(topics[0].topic).toBe("zigbee2mqtt/luce");
  });

  it("non tocca una riga senza tag ma col topic buono", () => {
    // Sottoscrivere senza mappare è legittimo (il validatore lo segnala come
    // avviso): butta i dati, ma non uccide la sorgente.
    const dentro = [{ kind: "mqtt", id: "m", host: "h", port: 1883, client_id: "c",
                      topics: [{ tag: "", topic: "casa/x" }] }] as unknown as SourceDef[];
    const out = sorgentiSenzaRigheVuote(dentro);
    expect((out[0] as { topics: unknown[] }).topics).toHaveLength(1);
  });

  it("restituisce la stessa referenza quando non c'è niente da togliere", () => {
    const dentro = [{ kind: "mqtt", id: "m", host: "h", port: 1883, client_id: "c",
                      topics: [{ tag: "t", topic: "casa/x" }] }] as unknown as SourceDef[];
    expect(sorgentiSenzaRigheVuote(dentro)).toBe(dentro);
  });

  it("lascia in pace le sorgenti che non sono MQTT", () => {
    const dentro = [{ kind: "modbus_tcp", id: "mb", host: "h", port: 502 }] as unknown as SourceDef[];
    expect(sorgentiSenzaRigheVuote(dentro)).toBe(dentro);
  });
});
