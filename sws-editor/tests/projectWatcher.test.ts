import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useProjectWatcher } from "../src/ws/projectWatcher";
import { api } from "../src/api/client";

// Il sorvegliante del progetto, e il falso allarme che rendeva rumoroso l'IDE.
//
// Il 2026-09-07 il maintainer ha segnalato che creando un progetto vuoto, appena
// si entrava, compariva «Il progetto sul runtime è cambiato (deploy o modifica
// esterna)». Non era un deploy: era la sua stessa creazione.
//
// Il sorvegliante gira anche sulla schermata di benvenuto, quindi fissa la
// baseline quando NON c'è progetto (impronta assente). Creare o aprire un
// progetto cambia l'impronta, e al tick successivo il cambio veniva attribuito a
// una modifica esterna. La guardia che esisteva in App.tsx copriva solo i
// salvataggi (`saveStatus === "ok"`), e una creazione non passa da lì.
//
// La correzione: il client API emette `sws:project-switched` da ogni percorso
// che cambia il progetto attivo, e qui la baseline si rifissa in silenzio.
// Questi test difendono le due metà che contano — che il nostro cambio NON
// avvisi, e che un cambio esterno continui ad avvisare.

const impronta = (sha: string | null) =>
  vi.spyOn(api, "getProjectFingerprint").mockResolvedValue(
    { sha256: sha, computed_at_ms: 0 } as Awaited<ReturnType<typeof api.getProjectFingerprint>>,
  );

/** Lascia girare i timer finti e le promesse che ne discendono. */
async function tick(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
}

describe("sorvegliante del progetto", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("non avvisa al primo rilevamento: quello fissa solo la baseline", async () => {
    impronta("aaa");
    const avvisato = vi.fn();
    renderHook(() => useProjectWatcher(avvisato, 3_000));
    await tick(0);
    expect(avvisato).not.toHaveBeenCalled();
  });

  it("avvisa quando l'impronta cambia sotto i piedi — un deploy esterno", async () => {
    const spia = impronta("aaa");
    const avvisato = vi.fn();
    renderHook(() => useProjectWatcher(avvisato, 3_000));
    await tick(0);

    spia.mockResolvedValue({ sha256: "bbb", computed_at_ms: 0 } as never);
    await tick(3_000);
    expect(avvisato).toHaveBeenCalledWith("bbb");
  });

  // Il cuore della correzione.
  it("NON avvisa quando il cambio di progetto è nostro", async () => {
    // Baseline sulla schermata di benvenuto: nessun progetto attivo.
    const spia = impronta(null);
    const avvisato = vi.fn();
    renderHook(() => useProjectWatcher(avvisato, 3_000));
    await tick(0);

    // Creiamo/apriamo noi un progetto: il client lo segnala…
    window.dispatchEvent(new CustomEvent("sws:project-switched"));
    // …e da quel momento l'impronta esiste.
    spia.mockResolvedValue({ sha256: "nuovo", computed_at_ms: 0 } as never);

    await tick(3_000);
    expect(avvisato).not.toHaveBeenCalled();
  });

  it("dopo un cambio nostro, un cambio ESTERNO successivo avvisa lo stesso", async () => {
    const spia = impronta(null);
    const avvisato = vi.fn();
    renderHook(() => useProjectWatcher(avvisato, 3_000));
    await tick(0);

    window.dispatchEvent(new CustomEvent("sws:project-switched"));
    spia.mockResolvedValue({ sha256: "nostro", computed_at_ms: 0 } as never);
    await tick(3_000);
    expect(avvisato).not.toHaveBeenCalled();

    // Ora qualcun altro fa un deploy: questo deve arrivare.
    spia.mockResolvedValue({ sha256: "altrui", computed_at_ms: 0 } as never);
    await tick(3_000);
    expect(avvisato).toHaveBeenCalledWith("altrui");
  });

  it("smontando, l'ascoltatore viene rimosso", async () => {
    impronta("aaa");
    const avvisato = vi.fn();
    const { unmount } = renderHook(() => useProjectWatcher(avvisato, 3_000));
    await tick(0);
    const rimuovi = vi.spyOn(window, "removeEventListener");
    unmount();
    expect(rimuovi).toHaveBeenCalledWith("sws:project-switched", expect.any(Function));
  });
});
