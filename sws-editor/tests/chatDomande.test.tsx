/** The chat before working (20-11-2026): the assistant's questions as a card
 *  with answers to click, the answers sent as the next message; and the
 *  assistant's text formatted, not raw Markdown. */
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import "../src/i18n/index";
import type { MsgIn } from "../src/types/ai";
import { blocks } from "../src/ai/Markdown";

let ascoltatore: ((m: MsgIn) => void) | null = null;
const inviati: string[] = [];

vi.mock("@/ws/aiStream", () => ({
  ascolta: (fn: (m: MsgIn) => void) => { ascoltatore = fn; return () => { ascoltatore = null; }; },
  chiedi: (testo: string) => { inviati.push(testo); return true; },
  approvaSfondo: () => true,
  mandaFoto: () => true,
  nuovaConversazione: () => {},
  suConversazioneNuova: () => () => {},
}));

import { ChatPanel } from "../src/components/ChatPanel";

Element.prototype.scrollIntoView = () => {};
afterEach(() => { cleanup(); inviati.length = 0; });
const arriva = (m: unknown) => act(() => { ascoltatore!(m as MsgIn); });

describe("the questions before working", () => {
  it("shows the questions and the plan, and sends the answers as a message", async () => {
    render(<ChatPanel open onClose={() => {}} />);
    await arriva({ t: "pronto", attivo: true, modello: "finto" });
    await arriva({ t: "domande", piano: ["Sorgente MQTT e tag", "La pagina", "Gli allarmi"], domande: [
      { testo: "Quale broker?", scelte: ["Quello che c'è", "Uno nuovo"] },
      { testo: "Quante pompe?", scelte: [] },
    ] });
    await arriva({ t: "fine" });
    expect(screen.getByTestId("chat-domande").textContent).toMatch(/La pagina/);
    fireEvent.click(screen.getByText("Uno nuovo"));
    fireEvent.change(screen.getByTestId("chat-risposta-1"), { target: { value: "3" } });
    // The third «question» is how to go on with the plan; left empty.
    fireEvent.click(screen.getByTestId("chat-rispondi"));
    expect(inviati).toHaveLength(1);
    expect(inviati[0]).toMatch(/Quale broker\? → Uno nuovo/);
    expect(inviati[0]).toMatch(/Quante pompe\? → 3/);
    expect(inviati[0]).toMatch(/→ (decidi tu|you decide)$/m);
    // Sent once: the card is read only.
    expect(screen.queryByTestId("chat-rispondi")).toBeNull();
    expect((screen.getByTestId("chat-risposta-1") as HTMLInputElement).disabled).toBe(true);
  });

  it("formats the assistant's Markdown instead of showing the asterisks", async () => {
    render(<ChatPanel open onClose={() => {}} />);
    await arriva({ t: "pronto", attivo: true, modello: "finto" });
    await arriva({ t: "testo", delta: "## Piano\n\nFarò **due** cose:\n\n1. la sorgente `mqtt`\n2. la pagina\n" });
    const a = screen.getByTestId("chat-assistente");
    expect(a.querySelector("strong")?.textContent).toBe("due");
    expect(a.querySelector("code")?.textContent).toBe("mqtt");
    expect(a.querySelectorAll("ol li")).toHaveLength(2);
    expect(a.querySelector("[role=heading]")?.textContent).toBe("Piano");
    expect(a.textContent).not.toMatch(/\*\*/);
  });
});

describe("the Markdown of the chat", () => {
  it("reads blocks: code to the end when still open, tables, quotes, lists with continuations", () => {
    const b = blocks([
      "Testo su", "due righe", "",
      "- uno", "  segue", "- due",
      "| a | b |", "|---|---|", "| 1 | 2 |", "",
      "> citato", "",
      "```yaml", "tags:", "  - x",
    ].join("\n"));
    expect(b.map((x) => x.k)).toEqual(["p", "ul", "table", "quote", "code"]);
    expect(b[0]).toEqual({ k: "p", lines: ["Testo su", "due righe"] });
    expect(b[1]).toEqual({ k: "ul", items: ["uno\nsegue", "due"] });
    expect(b[2]).toEqual({ k: "table", head: ["a", "b"], rows: [["1", "2"]] });
    expect(b[4]).toEqual({ k: "code", lang: "yaml", text: "tags:\n  - x" });
  });

  it("never lets the model's HTML through", async () => {
    render(<ChatPanel open onClose={() => {}} />);
    await arriva({ t: "pronto", attivo: true, modello: "finto" });
    await arriva({ t: "testo", delta: "<img src=x onerror=alert(1)> e [link](javascript:alert(1)) e [buono](https://sws.soligo.net)" });
    const a = screen.getByTestId("chat-assistente");
    expect(a.querySelector("img")).toBeNull();
    const links = [...a.querySelectorAll("a")].map((x) => x.getAttribute("href"));
    expect(links).toEqual(["https://sws.soligo.net"]);
  });
});
