import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useProjectWatcher } from "../src/ws/projectWatcher";
import { api, AuthError, NoProjectError, PasswordChangeRequiredError, RuntimeUnavailableError } from "../src/api/client";

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

  // Il falso allarme dopo il login (visto il 20-09-2026 nelle schermate del manuale).
  it("NON avvisa quando l'impronta compare perché ci si è appena autenticati", async () => {
    const spia = vi.spyOn(api, "getProjectFingerprint").mockRejectedValue(new AuthError());
    const avvisato = vi.fn();
    renderHook(() => useProjectWatcher(avvisato, 3_000));
    await tick(0);
    await tick(3_000);
    // Login fatto: da qui l'impronta esiste.
    spia.mockResolvedValue({ sha256: "primo", computed_at_ms: 0 } as never);
    await tick(3_000);
    expect(avvisato).not.toHaveBeenCalled();
  });

  it("stesso se la password è ancora da cambiare", async () => {
    const spia = vi.spyOn(api, "getProjectFingerprint").mockRejectedValue(new PasswordChangeRequiredError());
    const avvisato = vi.fn();
    renderHook(() => useProjectWatcher(avvisato, 3_000));
    await tick(0);
    spia.mockResolvedValue({ sha256: "primo", computed_at_ms: 0 } as never);
    await tick(3_000);
    expect(avvisato).not.toHaveBeenCalled();
  });

  it("dopo l'accesso, un cambio esterno avvisa ancora", async () => {
    const spia = vi.spyOn(api, "getProjectFingerprint").mockRejectedValue(new AuthError());
    const avvisato = vi.fn();
    renderHook(() => useProjectWatcher(avvisato, 3_000));
    await tick(0);
    spia.mockResolvedValue({ sha256: "primo", computed_at_ms: 0 } as never);
    await tick(3_000);
    spia.mockResolvedValue({ sha256: "secondo", computed_at_ms: 0 } as never);
    await tick(3_000);
    expect(avvisato).toHaveBeenCalledWith("secondo");
  });

  // Il kiosk del TC620 il 18-10-2026: il deploy sostituisce gli utenti, la sessione
  // muore con un 401, il client prosegue anonimo e l'impronta è già quella nuova.
  it("un deploy che fa morire la sessione avvisa lo stesso", async () => {
    const spia = impronta("vecchia");
    const avvisato = vi.fn();
    renderHook(() => useProjectWatcher(avvisato, 3_000));
    await tick(0);
    spia.mockRejectedValueOnce(new AuthError());
    await tick(3_000);
    spia.mockResolvedValue({ sha256: "nuova", computed_at_ms: 0 } as never);
    await tick(3_000);
    expect(avvisato).toHaveBeenCalledWith("nuova");
  });

  it("uscire e rientrare senza cambi non avvisa", async () => {
    const spia = impronta("stessa");
    const avvisato = vi.fn();
    renderHook(() => useProjectWatcher(avvisato, 3_000));
    await tick(0);
    spia.mockRejectedValue(new AuthError());
    await tick(3_000);
    await tick(3_000);
    spia.mockResolvedValue({ sha256: "stessa", computed_at_ms: 0 } as never);
    await tick(3_000);
    expect(avvisato).not.toHaveBeenCalled();
  });

  it("un tick partito prima di un nostro salvataggio e finito dopo non lo fa passare per esterno", async () => {
    const onChange = vi.fn();
    let sblocca!: (v: { sha256: string | null; computed_at_ms: number }) => void;
    const spy = vi.spyOn(api, "getProjectFingerprint");
    spy.mockResolvedValueOnce({ sha256: "A", computed_at_ms: 0 } as never); // baseline
    renderHook(() => useProjectWatcher(onChange, 1000));
    await tick(0);
    // Il secondo tick resta in volo, con l'impronta vecchia.
    spy.mockImplementationOnce(() => new Promise((res) => { sblocca = res as typeof sblocca; }));
    await tick(1000);
    // Nel frattempo salviamo noi: la baseline riparte.
    window.dispatchEvent(new CustomEvent("sws:project-switched"));
    sblocca({ sha256: "A", computed_at_ms: 0 });
    await tick(0);
    // Dopo il nostro salvataggio l'impronta è quella nuova: è la baseline, non un avviso.
    spy.mockResolvedValue({ sha256: "B", computed_at_ms: 0 } as never);
    await tick(1000); // fissa la baseline su B
    await tick(1000);
    expect(onChange).not.toHaveBeenCalled();
    // Un cambio esterno vero continua ad avvisare.
    spy.mockResolvedValue({ sha256: "C", computed_at_ms: 0 } as never);
    await tick(1000);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

// Il runtime fermato 15 s sul WP630 (10-11-2026): un errore di rete valeva
// «progetto chiuso», e il viewer mostrava «No active project».
describe("sorvegliante del progetto — runtime che non risponde", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("un runtime fermo non è un cambio, e al ritorno chiama onRitorno", async () => {
    const spia = impronta("aaa");
    const avvisato = vi.fn();
    const tornato = vi.fn();
    renderHook(() => useProjectWatcher(avvisato, 3_000, tornato));
    await tick(0);

    spia.mockRejectedValue(new RuntimeUnavailableError());
    await tick(15_000);
    expect(avvisato).not.toHaveBeenCalled();
    expect(tornato).not.toHaveBeenCalled();

    spia.mockResolvedValue({ sha256: "aaa", computed_at_ms: 0 } as never);
    await tick(3_000);
    expect(avvisato).not.toHaveBeenCalled();
    expect(tornato).toHaveBeenCalledTimes(1);
    await tick(9_000);
    expect(tornato).toHaveBeenCalledTimes(1);
  });

  it("un progetto cambiato durante il fermo si vede al ritorno", async () => {
    const spia = impronta("aaa");
    const avvisato = vi.fn();
    renderHook(() => useProjectWatcher(avvisato, 3_000));
    await tick(0);
    spia.mockRejectedValue(new RuntimeUnavailableError());
    await tick(6_000);
    spia.mockResolvedValue({ sha256: "bbb", computed_at_ms: 0 } as never);
    await tick(3_000);
    expect(avvisato).toHaveBeenCalledTimes(1);
    expect(avvisato).toHaveBeenCalledWith("bbb");
  });

  it("il 503 resta un cambio a null: nessun progetto aperto", async () => {
    const spia = impronta("aaa");
    const avvisato = vi.fn();
    renderHook(() => useProjectWatcher(avvisato, 3_000));
    await tick(0);
    spia.mockRejectedValue(new NoProjectError());
    await tick(3_000);
    expect(avvisato).toHaveBeenCalledTimes(1);
    expect(avvisato).toHaveBeenCalledWith(null);
  });

  it("un ricarico fallito non si dà per visto: si richiama al giro dopo", async () => {
    const spia = impronta("aaa");
    let prima = true;
    const avvisato = vi.fn(() => {
      if (prima) { prima = false; return Promise.reject(new RuntimeUnavailableError()); }
      return Promise.resolve();
    });
    renderHook(() => useProjectWatcher(avvisato, 3_000));
    await tick(0);
    spia.mockResolvedValue({ sha256: "bbb", computed_at_ms: 0 } as never);
    await tick(3_000);
    await tick(3_000);
    expect(avvisato).toHaveBeenCalledTimes(2);
    await tick(3_000);
    expect(avvisato).toHaveBeenCalledTimes(2);
  });
});
