/** The image library (plan docs/plans/2026-11-19-libreria-immagini.md, session A): the images of
 *  the project first with «+ Carica immagine…», the upload card with the name taken, the size of a
 *  new image object. */
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "../src/i18n";
import { api, ImageExistsError } from "../src/api/client";
import { ImageBrowser } from "../src/components/ImageBrowser";
import { UploadImage } from "../src/images/UploadImage";
import {
  freeImageName, hasTransparency, optimizedSize, safeImageName, shouldOptimize, withExtension,
} from "../src/images/optimize";
import { placedSize } from "../src/images/place";
import { imageNameOf, imageUses, renameImageRefs } from "../src/images/usage";
import { useAppStore } from "../src/store";
import { rispondi } from "../src/finestraAvviso/finestraAvviso";
import { SvgCanvas } from "../src/canvas/SvgCanvas";
import { registraAggiunta } from "../src/editor/azioniEditor";
import type { SynopticPage } from "../src/types";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("names, sizes and when to optimise", () => {
  it("a name the server accepts, and a free one", () => {
    expect(safeImageName("Foto del forno.JPG")).toBe("Foto_del_forno.JPG");
    // No leading dot, no «..»: the rules of the server.
    expect(safeImageName("..evil/../x.png")).toBe("evil_._x.png");
    expect(safeImageName("")).toBe("immagine.png");
    expect(freeImageName("a.png", ["b.png"])).toBe("a.png");
    expect(freeImageName("a.png", ["a.png", "a-2.png"])).toBe("a-3.png");
    expect(withExtension("forno.png", "image/jpeg")).toBe("forno.jpg");
    expect(withExtension("logo", "image/png")).toBe("logo.png");
  });

  it("a photo too big is optimised; SVG and GIF never", () => {
    expect(shouldOptimize("image/jpeg", 3_000_000, 4000, 3000)).toBe(true);
    expect(shouldOptimize("image/png", 200_000, 2400, 100)).toBe(true);
    expect(shouldOptimize("image/png", 200_000, 800, 600)).toBe(false);
    expect(shouldOptimize("image/svg+xml", 9_000_000, 4000, 4000)).toBe(false);
    expect(shouldOptimize("image/gif", 9_000_000, 4000, 4000)).toBe(false);
    expect(optimizedSize(4000, 3000)).toEqual([1920, 1440]);
    expect(optimizedSize(800, 600)).toEqual([800, 600]);
    expect(hasTransparency(new Uint8ClampedArray([1, 2, 3, 255, 0, 0, 0, 255]))).toBe(false);
    expect(hasTransparency(new Uint8ClampedArray([1, 2, 3, 128]))).toBe(true);
  });

  it("a new image object keeps the proportions of its picture", () => {
    expect(placedSize({ width: 4000, height: 3000 })).toEqual({ width: 240, height: 180 });
    expect(placedSize({ width: 64, height: 64 })).toEqual({ width: 64, height: 64 });
    expect(placedSize({ width: 100, height: 400 })).toEqual({ width: 60, height: 240 });
    expect(placedSize(undefined)).toEqual({ width: 160, height: 120 });
  });
});

describe("the library", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ json: async () => ({ categories: [
      { id: "mdi", label: "MDI", license: "Apache-2.0", items: [{ id: "pump", path: "/images/mdi/pump.svg", label: "Pump" }] },
    ] }) } as Response);
    vi.spyOn(api, "listProjectImages").mockResolvedValue([
      { name: "forno.jpg", size_bytes: 300_000, width: 1920, height: 1080 },
      { name: "logo.svg", size_bytes: 4_000, width: 64, height: 32 },
    ]);
  });

  it("opens on the images of the project, with «+ Carica immagine…» first", async () => {
    render(<ImageBrowser mode="place" onSelect={() => {}} onClose={() => {}} />);
    const grid = await screen.findByTestId("image-project-forno.jpg");
    const tiles = [...grid.parentElement!.querySelectorAll("button")].map((b) => b.getAttribute("data-testid"));
    expect(tiles).toEqual(["image-upload-tile", "image-project-forno.jpg", "image-project-logo.svg"]);
    expect(screen.getByTestId("image-browser-info").textContent).toMatch(/2/);
  });

  it("a picture is chosen, then inserted with its size", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<ImageBrowser mode="place" onSelect={onSelect} onClose={onClose} />);
    fireEvent.click(await screen.findByTestId("image-project-forno.jpg"));
    fireEvent.click(screen.getByTestId("image-browser-confirm"));
    expect(onSelect).toHaveBeenCalledWith("/api/project/images/forno.jpg", { width: 1920, height: 1080 });
    expect(onClose).toHaveBeenCalled();
  });

  it("an icon of the catalog is square; a double click inserts it", async () => {
    const onSelect = vi.fn();
    render(<ImageBrowser mode="choose" onSelect={onSelect} onClose={() => {}} />);
    fireEvent.click(await screen.findByTestId("image-tab-0"));
    fireEvent.doubleClick(await screen.findByTitle("Pump"));
    expect(onSelect).toHaveBeenCalledWith("/images/mdi/pump.svg", { width: 64, height: 64 });
  });

  it("the files chosen go to the upload card, and the uploaded one is selected", async () => {
    const upload = vi.spyOn(api, "uploadProjectImage").mockResolvedValue({ name: "nuova.png", url: "/api/project/images/nuova.png" });
    const onSelect = vi.fn();
    render(<ImageBrowser mode="place" onSelect={onSelect} onClose={() => {}} />);
    await screen.findByTestId("image-project-forno.jpg");
    const file = new File(["png"], "nuova.png", { type: "image/png" });
    fireEvent.change(screen.getByTestId("image-upload-input"), { target: { files: [file] } });
    fireEvent.click(await screen.findByTestId("upload-image-go"));
    await waitFor(() => expect(upload).toHaveBeenCalledWith("nuova.png", file, { replace: false }));
    await waitFor(() => expect((screen.getByTestId("image-browser-confirm") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId("image-browser-confirm"));
    expect(onSelect).toHaveBeenCalledWith("/api/project/images/nuova.png", undefined);
  });

  it("dragging to select the name and letting go outside the card closes nothing; a press on the backdrop does", async () => {
    const onClose = vi.fn();
    render(<ImageBrowser mode="place" onSelect={() => {}} onClose={onClose} />);
    await screen.findByTestId("image-project-forno.jpg");
    fireEvent.change(screen.getByTestId("image-upload-input"), { target: { files: [new File(["png"], "nuova.png", { type: "image/png" })] } });
    const name = await screen.findByTestId("upload-image-name");
    // Pressed in the field, let go on the backdrop: the browser sends the
    // click to the backdrop (20-11-2026: both windows closed).
    const backdrop = screen.getByTestId("upload-image").parentElement!;
    fireEvent.mouseDown(name);
    fireEvent.mouseUp(backdrop);
    fireEvent.click(backdrop);
    expect(screen.getByTestId("upload-image")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    // A press that starts on the backdrop closes the card, not the library.
    fireEvent.mouseDown(backdrop);
    expect(screen.queryByTestId("upload-image")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByTestId("image-browser").parentElement!);
    expect(onClose).toHaveBeenCalled();
  });
});

describe("the upload card", () => {
  const file = () => new File(["x"], "forno.jpg", { type: "image/jpeg" });

  it("a name taken: replace everywhere, or keep both with a free name", async () => {
    const upload = vi.spyOn(api, "uploadProjectImage").mockResolvedValue({ name: "forno.jpg", url: "/api/project/images/forno.jpg" });
    const onDone = vi.fn();
    const { unmount } = render(<UploadImage files={[file()]} taken={["forno.jpg", "forno-2.jpg"]} onDone={onDone} onCancel={() => {}} />);
    expect(await screen.findByTestId("upload-image-exists")).toBeTruthy();
    fireEvent.click(screen.getByTestId("upload-image-keep-both"));
    await waitFor(() => expect(upload).toHaveBeenCalledWith("forno-3.jpg", expect.anything(), { replace: false }));
    unmount();
    upload.mockClear();
    render(<UploadImage files={[file()]} taken={["forno.jpg"]} onDone={onDone} onCancel={() => {}} />);
    fireEvent.click(await screen.findByTestId("upload-image-replace"));
    await waitFor(() => expect(upload).toHaveBeenCalledWith("forno.jpg", expect.anything(), { replace: true }));
  });

  it("the server says the name is taken (someone else uploaded it): the three choices appear", async () => {
    vi.spyOn(api, "uploadProjectImage").mockRejectedValue(new ImageExistsError("forno.jpg"));
    render(<UploadImage files={[file()]} taken={[]} onDone={() => {}} onCancel={() => {}} />);
    await act(async () => { fireEvent.click(await screen.findByTestId("upload-image-go")); });
    expect(await screen.findByTestId("upload-image-exists")).toBeTruthy();
  });
});

/** Session B: where an image is used, the rename everywhere, the management in the library,
 *  a file dropped on the canvas. */

const page = (id: string, objects: object[], extra: object = {}) =>
  ({ id, name: `Pagina ${id}`, objects, ...extra }) as unknown as SynopticPage;
const PAGES = [
  page("p1", [
    { id: "a", type: "image", src: "/api/project/images/forno.jpg?v=3" },
    { id: "g", type: "grid", grid_cells: [{ row: 0, col: 0, child: { type: "image", src: "/api/project/images/logo.svg" } }] },
  ], { sfondo_immagine: "/api/project/images/forno.jpg" }),
  page("p2", [{ id: "b", type: "rect", bg_image: "/api/project/images/vecchia.png" }]),
];

describe("where an image is used", () => {
  it("every string with its URL, ?v= or not, page by page and object by object", () => {
    expect(imageNameOf("/api/project/images/a%20b.png?v=2")).toBe("a b.png");
    expect(imageNameOf("/images/mdi/pump.svg")).toBeNull();
    const uses = imageUses(PAGES);
    expect(uses.get("forno.jpg")).toEqual([
      { pageId: "p1", pageName: "Pagina p1", objectId: "a", faceplate: undefined },
      { pageId: "p1", pageName: "Pagina p1", faceplate: undefined },
    ]);
    expect(uses.get("logo.svg")?.[0].objectId).toBe("g");
    expect(uses.get("vecchia.png")?.[0].pageId).toBe("p2");
  });

  it("a rename rewrites the URLs of that image only, and leaves untouched what doesn't use it", () => {
    const [p1, p2] = PAGES.map((p) => renameImageRefs(p, "forno.jpg", "cucina.jpg"));
    expect(p2).toBe(PAGES[1]);
    expect((p1.objects[0] as { src: string }).src).toBe("/api/project/images/cucina.jpg");
    expect((p1 as unknown as { sfondo_immagine: string }).sfondo_immagine).toBe("/api/project/images/cucina.jpg");
    expect(renameImageRefs(p1, "forno.jpg", "x.jpg")).toBe(p1);
  });

  it("the store renames the file and writes the pages that use it", async () => {
    const renamed = vi.spyOn(api, "renameProjectImage").mockResolvedValue({ name: "cucina.jpg", url: "/api/project/images/cucina.jpg" });
    const saved = vi.spyOn(api, "saveSynoptic").mockResolvedValue(undefined as never);
    act(() => {
      useAppStore.getState().setProject({ name: "p", tags: [] } as never);
      useAppStore.getState().setPages(PAGES as never, "p1");
      useAppStore.getState().resetDirty();
    });
    await act(async () => { expect(await useAppStore.getState().rinominaImmagine("forno.jpg", "cucina.jpg")).toBe(1); });
    expect(renamed).toHaveBeenCalledWith("forno.jpg", "cucina.jpg");
    expect(saved).toHaveBeenCalledTimes(1);
    const p1 = useAppStore.getState().pages.find((p) => p.id === "p1")!;
    expect((p1.objects[0] as { src?: string }).src).toBe("/api/project/images/cucina.jpg");
  });
});

describe("managing the images in the library", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ json: async () => ({ categories: [] }) } as Response);
    vi.spyOn(api, "listProjectImages").mockResolvedValue([
      { name: "forno.jpg", size_bytes: 300_000 },
      { name: "inutile.png", size_bytes: 1_000 },
    ]);
    act(() => useAppStore.getState().setPages(PAGES as never, "p1"));
  });

  it("an unused image is marked; a missing one is counted; the uses of the chosen one are listed", async () => {
    render(<ImageBrowser mode="manage" onClose={() => {}} />);
    expect(await screen.findByTestId("image-unused-inutile.png")).toBeTruthy();
    expect(screen.queryByTestId("image-unused-forno.jpg")).toBeNull();
    // logo.svg and vecchia.png are used and not in the project.
    expect(screen.getByTestId("image-missing").textContent).toMatch(/2/);
    fireEvent.click(screen.getByTestId("image-project-forno.jpg"));
    expect(screen.getByTestId("image-uses").textContent).toMatch(/2/);
    expect(screen.queryByTestId("image-browser-confirm")).toBeNull();
  });

  it("deleting asks first, saying how many places use it", async () => {
    const del = vi.spyOn(api, "deleteProjectImage").mockResolvedValue(undefined);
    render(<ImageBrowser mode="manage" onClose={() => {}} />);
    fireEvent.click(await screen.findByTestId("image-project-forno.jpg"));
    const auto = rispondi(true);
    try {
      await act(async () => { fireEvent.click(screen.getByTestId("image-delete")); });
    } finally { auto.ferma(); }
    const asked = auto.chiamate[0];
    expect(asked && "testo" in asked ? asked.testo : "").toMatch(/2/);
    expect(del).toHaveBeenCalledWith("forno.jpg");
  });
});

describe("a file dropped on the canvas", () => {
  it("becomes an image to upload, where it was dropped", () => {
    const add = vi.fn();
    registraAggiunta(add);
    try {
      const { container } = render(<SvgCanvas objects={[]} onMove={() => {}} accettaFaceplate />);
      const svg = container.querySelector("svg")!;
      const file = new File(["png"], "foto.png", { type: "image/png" });
      fireEvent.drop(svg, { clientX: 10, clientY: 20, dataTransfer: { files: [file], types: ["Files"], getData: () => "" } });
      expect(add).toHaveBeenCalledWith("image", expect.objectContaining({ files: [file] }));
    } finally {
      registraAggiunta(null);
    }
  });
});
