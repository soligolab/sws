/** A local model costs nothing (plan 2026-11-17-ia-a-scelta-del-cliente, F3):
 *  the chat shows its tokens, not «0.00 $ / 10 $» against a cap it cannot
 *  reach. A paid provider keeps its spending. */
import { render, act, cleanup, fireEvent, screen } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import "../src/i18n/index";
import type { MsgIn } from "../src/types/ai";

let listener: ((m: MsgIn) => void) | null = null;

vi.mock("@/ws/aiStream", () => ({
  ascolta: (fn: (m: MsgIn) => void) => { listener = fn; return () => { listener = null; }; },
  chiedi: () => true,
  approvaSfondo: () => true,
  nuovaConversazione: () => {},
  suConversazioneNuova: () => () => {},
}));

import { ChatPanel } from "../src/components/ChatPanel";

Element.prototype.scrollIntoView = () => {};

afterEach(() => { cleanup(); });

const arrives = (m: unknown) => act(() => { listener!(m as MsgIn); });
const turn = { t: "risorse", input: 12000, output: 800, cache_lettura: 0, cache_scrittura: 0 };

describe("the chat's spending line", () => {
  it("a local model shows its tokens and no dollars", async () => {
    render(<ChatPanel open onClose={() => {}} />);
    await arrives({ t: "pronto", attivo: true, modello: "qwen3:8b", fornitore: "local" });
    await arrives({ ...turn, costo: 0, speso: 0, tetto: 10, prezzi_noti: true, fornitore: "local" });
    expect(document.body.textContent).toMatch(/12k/);
    expect(document.body.textContent).not.toMatch(/\$ \/ 10 \$/);
  });

  it("a paid provider keeps its spending against the cap", async () => {
    render(<ChatPanel open onClose={() => {}} />);
    await arrives({ t: "pronto", attivo: true, modello: "claude-opus-5-5", fornitore: "anthropic" });
    await arrives({ ...turn, costo: 0.12, speso: 0.12, tetto: 10, prezzi_noti: true, fornitore: "anthropic" });
    expect(document.body.textContent).toContain("0.12 $ / 10 $");
  });

  it("with a local assistant, a symbol drawn by a paid model still shows what it cost", async () => {
    render(<ChatPanel open onClose={() => {}} />);
    await arrives({ t: "pronto", attivo: true, modello: "qwen3:8b", fornitore: "local" });
    await arrives({ ...turn, costo: 0, speso: 0, tetto: 10, prezzi_noti: true, fornitore: "local" });
    await arrives({ t: "risorse_extra", costo: 0.03, speso: 0.03, chi: "simboli" });
    expect(document.body.textContent).toContain("0.03 $ / 10 $");
  });
});

describe("the chat's errors", () => {
  it("a local model with too small a context is said in the IDE's language", async () => {
    const { default: i18n } = await import("../src/i18n/index");
    await i18n.changeLanguage("it");
    render(<ChatPanel open onClose={() => {}} />);
    await arrives({ t: "errore", messaggio: "the context of the local model is 4096 tokens",
                    codice: { id: "local_context_too_small", loaded: 4096, needed: 20000 } });
    expect(document.body.textContent).toContain("Il modello in casa ha un contesto di 4096 token");
    expect(document.body.textContent).toContain("circa 20000");
  });

  it("a model that closed its turn twice without writing is said in the IDE's language", async () => {
    const { default: i18n } = await import("../src/i18n/index");
    await i18n.changeLanguage("it");
    render(<ChatPanel open onClose={() => {}} />);
    await arrives({ t: "errore", messaggio: "il modello ha chiuso il turno senza scrivere niente, due volte",
                    codice: { id: "model_silent" } });
    expect(document.body.textContent).toContain("Scrivi «continua» per farlo proseguire");
    await i18n.changeLanguage("en");
    expect(i18n.t("aiErrors.model_silent")).toContain("Write «continue»");
  });

  it("an error without a code, or with one the IDE does not know, shows the message", async () => {
    render(<ChatPanel open onClose={() => {}} />);
    await arrives({ t: "errore", messaggio: "tetto di spesa raggiunto" });
    await arrives({ t: "errore", messaggio: "from a newer runtime", codice: { id: "not_known_yet" } });
    expect(document.body.textContent).toContain("tetto di spesa raggiunto");
    expect(document.body.textContent).toContain("from a newer runtime");
  });
});

describe("the chat's waiting line", () => {
  it("stays for the whole turn, tool rows in progress included, and goes at the end", async () => {
    const { default: i18n } = await import("../src/i18n/index");
    await i18n.changeLanguage("it");
    render(<ChatPanel open onClose={() => {}} />);
    await arrives({ t: "pronto", attivo: true, modello: "qwen3.5:9b", fornitore: "local" });
    expect(screen.queryByTestId("chat-attesa")).toBeNull();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "aggiungi un LED" } });
    fireEvent.click(screen.getByText(i18n.t("chat.send")));
    const line = () => screen.queryByTestId("chat-attesa");
    expect(line()?.textContent).toMatch(/✻In attesa del modello\.\.\. · \d+:\d\d/);
    await arrives({ t: "strumento", nome: "elenca_tag", stato: "eseguo" });
    expect(line()).not.toBeNull();
    await arrives({ t: "strumento", nome: "elenca_tag", stato: "fatto" });
    await arrives({ t: "pensiero", delta: "ora il LED" });
    expect(line()?.textContent).toMatch(/Sto pensando\.\.\. · \d+:\d\d/);
    expect(line()?.querySelector(".sws-chat-sparkle")).not.toBeNull();
    await arrives({ t: "fine" });
    expect(line()).toBeNull();
    // The end of the turn is said, and goes with the next question.
    expect(screen.getByTestId("chat-tocca-a-te").textContent).toContain(i18n.t("chat.yourTurn"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "continua" } });
    fireEvent.click(screen.getByText(i18n.t("chat.send")));
    expect(screen.queryByTestId("chat-tocca-a-te")).toBeNull();
  });
});
