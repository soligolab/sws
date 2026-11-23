import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ImageExistsError } from "../src/api/client";

// Il 20-09-2026 il pannello proprietà di pagina salvò `page_layout` senza
// avvisare il sorvegliante del progetto: comparve «il progetto è cambiato» e
// «Ricarica» buttò una pagina non salvata. Ora ogni scrittura riuscita sul
// progetto **fatta da questo client** rifissa la baseline, da un posto solo.

function risposta(status = 204): Response {
  return new Response(null, { status, headers: { "content-length": "0" } });
}

function conFetch(status: number) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(risposta(status)));
  const visti: string[] = [];
  const ascolta = () => { visti.push("evento"); };
  window.addEventListener("sws:project-switched", ascolta);
  return { visti, stop: () => window.removeEventListener("sws:project-switched", ascolta) };
}

describe("scritture nostre sul progetto", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("un salvataggio del layout di pagina rifissa la baseline", async () => {
    const { visti, stop } = conFetch(204);
    await api.updatePageLayout({ size_mode: "fixed" });
    stop();
    expect(visti).toHaveLength(1);
  });

  it("anche il salvataggio di una pagina, di un faceplate e di una sezione", async () => {
    const { visti, stop } = conFetch(204);
    await api.updateAlarms([]);
    await api.saveFaceplate({ id: "f", label: "f", params: [], objects: [] });
    stop();
    expect(visti).toHaveLength(2);
  });

  it("una lettura non lo fa", async () => {
    const { visti, stop } = conFetch(200);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("[]", { status: 200, headers: { "content-type": "application/json" } })));
    await api.listFaceplates();
    stop();
    expect(visti).toHaveLength(0);
  });

  it("una scrittura rifiutata non lo fa: il progetto non è cambiato", async () => {
    const { visti, stop } = conFetch(500);
    await expect(api.updatePageLayout({ size_mode: "fixed" })).rejects.toThrow();
    stop();
    expect(visti).toHaveLength(0);
  });
});

// rc.30 (test of the rc.29, 23-11-2026): the images, «Genera foto» and the
// lock's heartbeat. The event carries the path, which the symbol editor's own
// window forwards to the IDE.
describe("our writes: images, AI photo, lock, backups", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  function withFetch(res: () => Response) {
    vi.stubGlobal("fetch", vi.fn(async () => res()));
    const paths: (string | undefined)[] = [];
    const on = (e: Event) => { paths.push((e as CustomEvent<{ path?: string } | null>).detail?.path); };
    window.addEventListener("sws:project-switched", on);
    return { paths, stop: () => window.removeEventListener("sws:project-switched", on) };
  }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("an image uploaded re-fixes the baseline, once, with its path", async () => {
    const { paths, stop } = withFetch(() => json({ name: "x.png", url: "/api/project/images/x.png" }));
    await api.uploadProjectImage("x.png", new Blob(["png"]));
    stop();
    expect(paths).toHaveLength(1);
    expect(paths[0]).toMatch(/^\/api\/project\/images\//);
  });

  it("an upload refused (name taken, or an error) doesn't", async () => {
    const taken = withFetch(() => json({}, 409));
    await expect(api.uploadProjectImage("x.png", new Blob(["png"]), { replace: false })).rejects.toBeInstanceOf(ImageExistsError);
    taken.stop();
    const failed = withFetch(() => new Response("no", { status: 500 }));
    await expect(api.uploadProjectImage("x.png", new Blob(["png"]))).rejects.toThrow();
    failed.stop();
    expect([...taken.paths, ...failed.paths]).toHaveLength(0);
  });

  it("«Genera foto» writes in images/: it re-fixes the baseline", async () => {
    const { paths, stop } = withFetch(() => json({ url: "/api/project/images/ai.png" }));
    await api.symbolAiPhoto({ description: "a stove", w: 100, h: 140 });
    stop();
    expect(paths).toEqual(["/api/symbols/ai/photo"]);
  });

  it("the lock's heartbeat and its release don't: they write nothing in the project", async () => {
    const { paths, stop } = withFetch(() => json({ held: true }));
    await api.projectLock("tab");
    stop();
    const release = withFetch(() => new Response(null, { status: 204, headers: { "content-length": "0" } }));
    await api.releaseProjectLock("tab");
    release.stop();
    expect([...paths, ...release.paths]).toHaveLength(0);
  });

  it("the symbols' PUT says its path", async () => {
    const { paths, stop } = withFetch(() => new Response(null, { status: 204, headers: { "content-length": "0" } }));
    await api.updateSimboli([]);
    stop();
    expect(paths).toEqual(["/api/project/simboli"]);
  });

  // Not to be added to the writes of ours: after a restore `BackupsTab`
  // reloads the synoptics only, so the IDE lacks boot pages, frames and
  // faceplates, and the «project changed» bar (with its «Reload») is right.
  it("restoring a backup doesn't re-fix the baseline", async () => {
    const { paths, stop } = withFetch(() => new Response(null, { status: 204, headers: { "content-length": "0" } }));
    await api.restoreBackup("2026-11-23");
    stop();
    expect(paths).toHaveLength(0);
  });
});
