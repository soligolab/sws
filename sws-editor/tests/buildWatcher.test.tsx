/** La barra «nuova versione» (29-10-2026): il watcher rilegge la pagina
 *  d'ingresso **chiedendo HTML** — sulla porta dell'IDE il ripiego della SPA
 *  risponde 404 a una fetch qualunque, e dal 28-10 la barra non compariva più. */
import { render, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useBuildWatcher } from "../src/ws/buildWatcher";

function Sonda({ onNew }: { onNew: () => void }) {
  useBuildWatcher(onNew, 1000);
  return null;
}

const pagina = (asset: string) => new Response(`<script src="/assets/${asset}.js"></script>`, { status: 200 });

describe("useBuildWatcher", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("chiede HTML, e segnala il frontend nuovo una volta sola", async () => {
    vi.useFakeTimers();
    const risposte = [pagina("index-aaa"), pagina("index-aaa"), pagina("index-bbb"), pagina("index-ccc")];
    const fetchFinta = vi.fn(async () => risposte.shift() ?? pagina("index-ccc"));
    vi.stubGlobal("fetch", fetchFinta);
    const onNew = vi.fn();
    render(<Sonda onNew={onNew} />);
    for (let i = 0; i < 4; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    }
    const opzioni = fetchFinta.mock.calls[0][1] as RequestInit;
    expect((opzioni.headers as Record<string, string>).Accept).toBe("text/html");
    expect(opzioni.cache).toBe("no-store");
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it("un 404 non è un frontend nuovo", async () => {
    vi.useFakeTimers();
    const fetchFinta = vi.fn(async () => new Response("", { status: 404 }));
    vi.stubGlobal("fetch", fetchFinta);
    const onNew = vi.fn();
    render(<Sonda onNew={onNew} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(fetchFinta).toHaveBeenCalled();
    expect(onNew).not.toHaveBeenCalled();
  });
});
