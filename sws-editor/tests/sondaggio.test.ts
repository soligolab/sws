import { describe, expect, it } from "vitest";
import type { ControlloDispositivo, SondaggioDispositivo } from "../src/api/client";
import {
  esitoComplessivo, etichettaDispositivo, hostDaUrl, imageRefAutomatico,
  imageRefDaVariante, installazioneConsentita, varianteDaArch,
} from "../src/config/installazione/sondaggio";

const controllo = (esito: ControlloDispositivo["esito"]): ControlloDispositivo =>
  ({ id: esito, esito, titolo: "", dettaglio: "", rimedio: null });

const sondaggio = (p: Partial<SondaggioDispositivo>): SondaggioDispositivo => ({
  ok_ssh: true, chiave_host_cambiata: false, sshpass: true, dispositivo: null,
  controlli: [], variante_immagine: null,
  sws: { installato: false, versione: null, immagine: null, attivo: null, data_path: null },
  pronto: true, diagnostica: [], ...p,
});

describe("hostDaUrl", () => {
  it("prende l'hostname e lascia fuori schema, porta e percorso", () => {
    expect(hostDaUrl("https://wp630.local:8444/")).toBe("wp630.local");
    expect(hostDaUrl("http://192.168.1.50:8444")).toBe("192.168.1.50");
  });
  it("con un URL rotto restituisce vuoto, non inventa", () => {
    expect(hostDaUrl("")).toBe("");
    expect(hostDaUrl("wp630")).toBe("");
  });
});

describe("riferimento immagine", () => {
  it("la variante diventa il tag del nostro registry", () => {
    expect(imageRefDaVariante("latest-arm64-generic")).toBe("ghcr.io/soligolab/sws-runtime:latest-arm64-generic");
    expect(imageRefDaVariante(null)).toBe("");
  });
  it("il sondaggio può sovrascrivere solo il vuoto o i nostri tag", () => {
    expect(imageRefAutomatico("")).toBe(true);
    expect(imageRefAutomatico("  ")).toBe(true);
    expect(imageRefAutomatico("ghcr.io/soligolab/sws-runtime:2.7.1-arm64")).toBe(true);
    // Scritto a mano verso un altro posto: è una scelta, non si tocca.
    expect(imageRefAutomatico("docker.io/qualcuno/sws:x")).toBe(false);
  });
});

describe("esitoComplessivo", () => {
  it("vince il peggiore", () => {
    expect(esitoComplessivo([controllo("ok"), controllo("avviso"), controllo("errore")])).toBe("errore");
    expect(esitoComplessivo([controllo("ok"), controllo("avviso")])).toBe("avviso");
    expect(esitoComplessivo([controllo("ok")])).toBe("ok");
    expect(esitoComplessivo([])).toBe("ok");
  });
});

describe("etichettaDispositivo", () => {
  it("una riga con i pezzi che ci sono", () => {
    expect(etichettaDispositivo({
      hostname: "wp630", arch: "aarch64", os: { name: "Pixsys OS", version: "2.1" },
      kernel: "5.10", utente: "user", uid: 1000,
    })).toBe("wp630 · aarch64 · Pixsys OS 2.1 · user (uid 1000)");
  });
  it("non ripete la versione se il nome del sistema la contiene già (visto sul TC620)", () => {
    expect(etichettaDispositivo({
      hostname: "tc620-a-p3-c6-07aff9", arch: "aarch64", os: { name: "Pixsys OS 2.1.1", version: "2.1.1" },
      kernel: "5.10", utente: "user", uid: 1000,
    })).toBe("tc620-a-p3-c6-07aff9 · aarch64 · Pixsys OS 2.1.1 · user (uid 1000)");
    expect(etichettaDispositivo({
      hostname: "pc", arch: "x86_64", os: { name: "Debian GNU/Linux 12 (bookworm)", version: "12" },
      kernel: "", utente: "", uid: null,
    })).toBe("pc · x86_64 · Debian GNU/Linux 12 (bookworm)");
  });
  it("salta i pezzi vuoti invece di lasciare separatori orfani", () => {
    expect(etichettaDispositivo({
      hostname: "", arch: "x86_64", os: { name: "", version: "" }, kernel: "", utente: "", uid: null,
    })).toBe("x86_64");
  });
});

describe("installazioneConsentita", () => {
  it("senza sondaggio si può installare, come prima di Q52", () => {
    expect(installazioneConsentita(null)).toBe(true);
  });
  it("con ssh fallito o errori no", () => {
    expect(installazioneConsentita(sondaggio({ ok_ssh: false, pronto: false }))).toBe(false);
    expect(installazioneConsentita(sondaggio({ pronto: false }))).toBe(false);
  });
  it("pronto sì", () => {
    expect(installazioneConsentita(sondaggio({}))).toBe(true);
  });
});

describe("varianteDaArch", () => {
  it("aarch64 propone la stessa immagine che l'installer sceglie da solo, x86 la amd64", () => {
    expect(varianteDaArch("aarch64")).toBe("latest-arm64");
    expect(varianteDaArch("x86_64")).toBe("latest-amd64");
  });
  it("architettura sconosciuta o assente: nessuna proposta", () => {
    expect(varianteDaArch("armv7l")).toBeNull();
    expect(varianteDaArch(undefined)).toBeNull();
    expect(varianteDaArch("")).toBeNull();
  });
});
