import { describe, it, expect } from "vitest";
import {
  modoAccesso, spiegaCredenzialiMancanti, spiegaLoginFallito,
} from "../src/config/credenzialiDispositivo";

/** Come ci si autentica verso un dispositivo registrato (T-68).
 *
 *  Il guasto da cui nasce: «Connetti» riusciva, «Deploy» rispondeva `429 Too
 *  Many Requests`, e dal messaggio non si capiva né perché né che riprovare
 *  peggiorava le cose.
 */

describe("modoAccesso — si fa il login, o no?", () => {
  it("il pannello dice di non avere utenti: niente login", () => {
    // È la lezione di T-57, che era stata applicata a «Connetti» e non al
    // deploy: su un pannello appena installato il login non serve, e
    // tentarlo comunque fallisce per forza perché quell'utente non esiste.
    expect(modoAccesso(false, "", "")).toBe("senza-login");
    expect(modoAccesso(false, "admin", "segreta")).toBe("senza-login");
  });

  it("il pannello vuole un utente e ce l'abbiamo: login", () => {
    expect(modoAccesso(true, "admin", "segreta")).toBe("login");
  });

  it("il pannello vuole un utente e non ce l'abbiamo: non si tenta", () => {
    // Un login con utente vuoto è un fallimento sicuro, e cinque fallimenti
    // bloccano l'account per un minuto: tentarlo brucia il budget di
    // qualcun altro oltre che il proprio.
    expect(modoAccesso(true, "", "")).toBe("credenziali-mancanti");
    expect(modoAccesso(true, "   ", "segreta")).toBe("credenziali-mancanti");
  });

  it("la password vuota si prova: è il dispositivo a decidere, non noi", () => {
    expect(modoAccesso(true, "admin", "")).toBe("login");
  });

  it("non sapere vale come «serve il login»", () => {
    // `/api/system` irraggiungibile: provare costa un tentativo, saltare il
    // login su un pannello che lo vuole farebbe fallire tutto il deploy più
    // avanti, con un errore meno chiaro.
    expect(modoAccesso(undefined, "admin", "x")).toBe("login");
    expect(modoAccesso(undefined, "", "")).toBe("credenziali-mancanti");
  });
});

describe("spiegaLoginFallito — il 429 deve dire di NON riprovare", () => {
  it("dice quanto aspettare, quando il pannello lo dichiara", () => {
    const m = spiegaLoginFallito(429, "42");
    expect(m).toContain("42 secondi");
  });

  it("e la cosa che dal codice di stato non si indovina", () => {
    // Senza questa frase si fa esattamente la cosa che tiene bloccati:
    // ogni nuovo tentativo allunga il lockout.
    expect(spiegaLoginFallito(429, null)).toMatch(/senza.*riprovare/i);
    expect(spiegaLoginFallito(429, null)).toContain("allunga");
  });

  it("senza Retry-After, o con un valore assurdo, non inventa un numero", () => {
    expect(spiegaLoginFallito(429, null)).toContain("circa un minuto");
    expect(spiegaLoginFallito(429, "non-un-numero")).toContain("circa un minuto");
    expect(spiegaLoginFallito(429, "0")).toContain("circa un minuto");
  });

  it("il 401 dice quali credenziali sono, che è la confusione di sempre", () => {
    expect(spiegaLoginFallito(401, null)).toContain("SWS");
    expect(spiegaLoginFallito(401, null)).toContain("SSH");
  });

  it("gli altri codici restano riportati com'è, senza fingere di sapere", () => {
    expect(spiegaLoginFallito(500, null)).toContain("500");
  });
});

describe("spiegaCredenzialiMancanti", () => {
  it("dice dove si scrive l'utente, non solo che manca", () => {
    // Il difetto era proprio questo: il campo non c'era e nessuno diceva dove
    // cercarlo.
    expect(spiegaCredenzialiMancanti()).toContain("Utente SWS");
  });
});
