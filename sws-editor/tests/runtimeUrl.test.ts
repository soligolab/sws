import { describe, expect, it } from "vitest";
import { viewerUrlFromAdmin } from "../src/runtimeUrl";

describe("viewerUrlFromAdmin", () => {
  it("deduce la porta del viewer come admin − 1", () => {
    expect(viewerUrlFromAdmin("http://192.168.1.120:8444")).toBe("http://192.168.1.120:8443");
  });

  // start_runtime.sh --instance 2 usa 8445/8446: la deduzione deve reggere
  // anche fuori dalla coppia canonica.
  it("vale anche per le istanze successive", () => {
    expect(viewerUrlFromAdmin("http://localhost:8446")).toBe("http://localhost:8445");
  });

  it("conserva lo schema https", () => {
    expect(viewerUrlFromAdmin("https://192.168.1.84:8444")).toBe("https://192.168.1.84:8443");
  });

  // L'URL salvato può portarsi dietro un percorso o una query da un
  // copia-incolla: al viewer va offerta la radice, non quello che c'era.
  it("scarta percorso, query e frammento", () => {
    expect(viewerUrlFromAdmin("http://host:8444/api/system/status?x=1#y"))
      .toBe("http://host:8444".replace("8444", "8443"));
  });

  // Senza porta esplicita la deduzione non significa niente (80 − 1 = 79):
  // meglio nessun bottone che un bottone che apre un indirizzo inventato.
  it("rifiuta un URL senza porta esplicita", () => {
    expect(viewerUrlFromAdmin("http://runtime.local")).toBeNull();
    expect(viewerUrlFromAdmin("https://runtime.local/")).toBeNull();
  });

  it("rifiuta URL vuoti o non validi", () => {
    expect(viewerUrlFromAdmin(null)).toBeNull();
    expect(viewerUrlFromAdmin(undefined)).toBeNull();
    expect(viewerUrlFromAdmin("")).toBeNull();
    expect(viewerUrlFromAdmin("non-un-url")).toBeNull();
  });
});
