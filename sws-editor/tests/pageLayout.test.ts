import { describe, expect, it } from "vitest";
import {
  CASI_FUORI_PAGINA,
  PAGE_EDGE_RESIST_PX,
  editorFitSize,
  isOffPage,
  objectBBox,
  pageFillEnabled,
  softClampToPage,
  softEdgeAxis,
  viewerFitScale,
} from "../src/pageLayout";

// Which size the editor's "fit page" targets. The interesting cases are the
// ones where the page itself declares nothing.
describe("editorFitSize", () => {
  const page = { width: 1024, height: 600 };

  it("uses the page dimensions when they exist", () => {
    expect(editorFitSize(page, { size_mode: "fixed" })).toEqual(page);
    expect(editorFitSize(page, undefined)).toEqual(page); // legacy = fixed
  });

  it("returns null in fluid mode — there is no page to fit", () => {
    expect(editorFitSize(page, { size_mode: "fluid" })).toBeNull();
  });

  it("falls back to the reference resolution in ratio mode", () => {
    expect(editorFitSize({}, { size_mode: "ratio", aspect_ratio: "4:3" }))
      .toEqual({ width: 1024, height: 768 });
    // unknown/missing ratio → 16:9 reference
    expect(editorFitSize({}, { size_mode: "ratio" }))
      .toEqual({ width: 1920, height: 1080 });
  });

  it("returns null for a fixed page with no declared size", () => {
    expect(editorFitSize({}, { size_mode: "fixed" })).toBeNull();
    expect(editorFitSize(undefined, undefined)).toBeNull();
  });
});

// Quanto rimpicciolire la pagina nel viewer in modalità "fisso". Il cap a 1 è
// la regola che conta: si riduce, non si ingrandisce.
describe("viewerFitScale", () => {
  it("resta 1:1 quando la pagina entra esattamente", () => {
    expect(viewerFitScale(1280, 800, 1280, 800)).toBe(1);
  });

  it("non ingrandisce mai, anche su uno schermo più grande", () => {
    expect(viewerFitScale(1920, 1080, 1280, 800)).toBe(1);
  });

  it("riduce sul lato più stretto, mantenendo le proporzioni", () => {
    // 1280×800 in 640×800 → vincola la larghezza
    expect(viewerFitScale(640, 800, 1280, 800)).toBe(0.5);
    // 1280×800 in 1280×400 → vincola l'altezza
    expect(viewerFitScale(1280, 400, 1280, 800)).toBe(0.5);
    // entrambi stretti → vince il più restrittivo
    expect(viewerFitScale(640, 200, 1280, 800)).toBe(0.25);
  });

  it("non riduce quando le dimensioni non sono note", () => {
    expect(viewerFitScale(undefined, 800, 1280, 800)).toBe(1);
    expect(viewerFitScale(1280, 800, undefined, 800)).toBe(1);
    expect(viewerFitScale(0, 0, 1280, 800)).toBe(1);
  });
});

// ── T-52: il colore della pagina si ferma al bordo ──────────────────────────
describe("pageFillEnabled", () => {
  const EDITOR = true, VIEWER = false;

  it("in editor con una pagina dimensionata si dipinge il foglio", () => {
    expect(pageFillEnabled("#123a5f", 1280, 800, EDITOR, "fixed")).toBe(true);
    expect(pageFillEnabled("#123a5f", 1280, 800, EDITOR, "ratio")).toBe(true);
  });

  // Il difetto gemello: nel viewer in `ratio` il colore pagina dipingeva anche
  // le bande del letterbox.
  it("nel viewer in ratio si dipinge il foglio, in fisso no", () => {
    expect(pageFillEnabled("#123a5f", 1280, 800, VIEWER, "ratio")).toBe(true);
    // In `fixed` il nodo <svg> ha già le misure del foglio: attorno non c'è
    // niente da dipingere, e accendere il rect sarebbe lavoro inutile.
    expect(pageFillEnabled("#123a5f", 1280, 800, VIEWER, "fixed")).toBe(false);
  });

  // La regola unica di T-52: nessun bordo ⇒ nessun limite, in nessuno dei tre
  // punti. Una pagina fluida non ha un foglio da delimitare.
  it("una pagina fluida non ha foglio", () => {
    expect(pageFillEnabled("#123a5f", undefined, undefined, EDITOR, "fluid")).toBe(false);
    expect(pageFillEnabled("#123a5f", 1280, undefined, EDITOR, "fixed")).toBe(false);
    expect(pageFillEnabled("#123a5f", undefined, 800, EDITOR, "fixed")).toBe(false);
    expect(pageFillEnabled("#123a5f", 0, 0, EDITOR, "fixed")).toBe(false);
  });

  // **Il caso che si sbaglia in silenzio.** La miniatura delle pagine monta il
  // canvas in ramo viewer `ratio` e NON passa `background`: se si guardasse il
  // valore dopo il default del componente, le si dipingerebbe sopra un colore
  // inventato.
  it("senza colore dato non si dipinge niente — è la miniatura delle pagine", () => {
    expect(pageFillEnabled(undefined, 1920, 1080, VIEWER, "ratio")).toBe(false);
    expect(pageFillEnabled("", 1920, 1080, VIEWER, "ratio")).toBe(false);
  });

  // Un `fill` SVG non è un `background` CSS: gradienti e url() non si
  // dipingono. Meglio il comportamento di prima che un foglio trasparente.
  it("gradienti e url() restano al comportamento di prima", () => {
    expect(pageFillEnabled("linear-gradient(#000, #fff)", 1280, 800, EDITOR, "fixed")).toBe(false);
    expect(pageFillEnabled("radial-gradient(#000, #fff)", 1280, 800, EDITOR, "fixed")).toBe(false);
    expect(pageFillEnabled("url(/img/sfondo.png)", 1280, 800, EDITOR, "fixed")).toBe(false);
    expect(pageFillEnabled("URL( /img/x.png )", 1280, 800, EDITOR, "fixed")).toBe(false);
    // Ma un colore che contiene quelle lettere per caso si dipinge: la guardia
    // cerca la funzione CSS, non la sottostringa.
    expect(pageFillEnabled("#ur1abc", 1280, 800, EDITOR, "fixed")).toBe(true);
  });
});

// ── T-52: il bordo pagina trattiene ma non imprigiona ───────────────────────
//
// Tutta la matematica del limite morbido è qui, e qui è provabile a tavolino:
// il canvas ci mette solo la gabbia e lo zoom. Le prove col mouse vero stanno
// in `scripts/check_soft_edge.sh`.
describe("softEdgeAxis", () => {
  const R = PAGE_EDGE_RESIST_PX;      // 24, in pixel schermo a zoom 1
  const NON_SGANCIATO = false;

  it("dentro la pagina non tocca niente", () => {
    expect(softEdgeAxis(300, 300, 100, 1280, R, NON_SGANCIATO))
      .toEqual({ pos: 300, freed: false });
  });

  // Il limite è sul lato **lontano**: si trattiene `x + width`, non `x`.
  it("trattiene al bordo finché il puntatore non ha superato la soglia", () => {
    // max = 1280 - 100 = 1180. Puntatore a 1190: 10 oltre, sotto i 24.
    expect(softEdgeAxis(1190, 1190, 100, 1280, R, NON_SGANCIATO))
      .toEqual({ pos: 1180, freed: false });
    expect(softEdgeAxis(-15, -15, 100, 1280, R, NON_SGANCIATO))
      .toEqual({ pos: 0, freed: false });
  });

  it("oltre la soglia si sgancia e segue il puntatore", () => {
    expect(softEdgeAxis(1220, 1220, 100, 1280, R, NON_SGANCIATO))
      .toEqual({ pos: 1220, freed: true });
    expect(softEdgeAxis(-40, -40, 100, 1280, R, NON_SGANCIATO))
      .toEqual({ pos: -40, freed: true });
  });

  // Esattamente sulla soglia si è ancora trattenuti: il confronto è `>`, e
  // avere un lato deciso conta più di quale dei due sia.
  it("sulla soglia esatta è ancora trattenuto", () => {
    expect(softEdgeAxis(1204, 1204, 100, 1280, R, NON_SGANCIATO).freed).toBe(false);
    expect(softEdgeAxis(1204.5, 1204.5, 100, 1280, R, NON_SGANCIATO).freed).toBe(true);
  });

  // La soglia si misura sul **puntatore**, non sul candidato: con la griglia
  // attiva il candidato è già stato spostato di mezzo passo, e misurare lì
  // renderebbe lo sganciamento più facile o più difficile a seconda di dove
  // cade la griglia.
  it("misura sul puntatore, non sulla posizione snappata", () => {
    // Candidato ben oltre (snap a 1250) ma puntatore appena fuori: trattenuto.
    expect(softEdgeAxis(1250, 1185, 100, 1280, R, NON_SGANCIATO))
      .toEqual({ pos: 1180, freed: false });
    // E il contrario: candidato dentro, puntatore lontano ⇒ sganciato.
    expect(softEdgeAxis(1180, 1250, 100, 1280, R, NON_SGANCIATO))
      .toEqual({ pos: 1180, freed: true });
  });

  it("sganciato resta sganciato fino al rilascio", () => {
    // Stesso ingresso del primo caso «trattiene», ma con freed già true:
    // rientrando non si viene ri-agganciati a metà gesto.
    expect(softEdgeAxis(1190, 1190, 100, 1280, R, true))
      .toEqual({ pos: 1190, freed: true });
    expect(softEdgeAxis(300, 300, 100, 1280, R, true))
      .toEqual({ pos: 300, freed: true });
  });

  // La regola unica di T-52: nessun bordo ⇒ niente da trattenere. È la
  // proprietà che il vecchio `clampToPage` aveva e che non si può perdere.
  it("pagina fluida: no-op", () => {
    expect(softEdgeAxis(-500, -500, 100, undefined, R, NON_SGANCIATO))
      .toEqual({ pos: -500, freed: false });
    expect(softEdgeAxis(-500, -500, 100, 0, R, NON_SGANCIATO))
      .toEqual({ pos: -500, freed: false });
  });

  // Oggetto più largo della pagina: `pageSize - size` è negativo, e il
  // `Math.max(0, …)` fa collassare la fascia di trattenimento sul solo x=0 —
  // senza, il limite superiore starebbe **prima** di quello inferiore e
  // l'oggetto verrebbe sbattuto a sinistra invece che appoggiato al bordo.
  //
  // Conseguenza voluta: un oggetto che nella pagina non ci sta si aggancia a 0
  // ma si libera subito, perché ogni posizione diversa da 0 è già «oltre il
  // bordo». È l'opposto del vecchio `clampToPage`, che lo inchiodava a 0 e non
  // lo lasciava più muovere.
  it("oggetto più grande della pagina: si aggancia a 0, ma non ci resta prigioniero", () => {
    expect(softEdgeAxis(5, 5, 2000, 1280, R, NON_SGANCIATO))
      .toEqual({ pos: 0, freed: false });
    expect(softEdgeAxis(50, 50, 2000, 1280, R, NON_SGANCIATO))
      .toEqual({ pos: 50, freed: true });
  });

  // La resistenza arriva già divisa per lo zoom: al 400% ventiquattro pixel
  // schermo sono sei unità di pagina, e la sensazione al tatto non cambia.
  it("la soglia è in pixel schermo, quindi lo zoom la scala", () => {
    const alQuadruplo = PAGE_EDGE_RESIST_PX / 4;   // 6 unità pagina
    expect(softEdgeAxis(1188, 1188, 100, 1280, alQuadruplo, NON_SGANCIATO).freed).toBe(true);
    expect(softEdgeAxis(1188, 1188, 100, 1280, PAGE_EDGE_RESIST_PX, NON_SGANCIATO).freed).toBe(false);
  });
});

describe("softClampToPage", () => {
  const R = PAGE_EDGE_RESIST_PX;
  const NIENTE = { x: false, y: false };

  // Gli assi sono indipendenti: è quel che fa scivolare un oggetto lungo il
  // bordo inferiore mentre esce a destra, invece di bloccarlo in un angolo.
  it("gli assi sono indipendenti", () => {
    // X: 1400 contro un massimo di 1180 ⇒ 220 oltre, sganciato.
    // Y: 760 contro un massimo di 750 ⇒ 10 oltre, ancora trattenuto.
    const r = softClampToPage(
      { x: 1400, y: 760 }, { x: 1400, y: 760 },
      100, 50, 1280, 800, R, NIENTE,
    );
    expect(r.x).toBe(1400);
    expect(r.y).toBe(750);
    expect(r.freed).toEqual({ x: true, y: false });
  });

  it("trattiene su entrambi gli assi finché nessuno supera la soglia", () => {
    const r = softClampToPage(
      { x: 1190, y: 760 }, { x: 1190, y: 760 },
      100, 50, 1280, 800, R, NIENTE,
    );
    expect(r).toEqual({ x: 1180, y: 750, freed: { x: false, y: false } });
  });

  it("pagina fluida: restituisce il candidato così com'è", () => {
    const r = softClampToPage(
      { x: -300, y: -300 }, { x: -300, y: -300 },
      100, 50, undefined, undefined, R, NIENTE,
    );
    expect(r).toEqual({ x: -300, y: -300, freed: { x: false, y: false } });
  });
});

// ── T-52: il fuori pagina è un parcheggio ───────────────────────────────────
describe("objectBBox", () => {
  it("rettangoli: x/y più le dimensioni", () => {
    expect(objectBBox({ type: "rect", x: 10, y: 20, width: 100, height: 50 }))
      .toEqual({ x1: 10, y1: 20, x2: 110, y2: 70 });
  });

  // Una linea può essere disegnata da destra a sinistra: il box è il min/max
  // dei due estremi, non «origine più dimensioni».
  it("linee: il min/max dei due estremi, in qualunque verso", () => {
    expect(objectBBox({ type: "line", x: 300, y: 200, x2: 100, y2: 50 }))
      .toEqual({ x1: 100, y1: 50, x2: 300, y2: 200 });
  });

  it("pipe: l'inviluppo dei waypoint", () => {
    expect(objectBBox({ type: "pipe", x: 0, y: 0,
      points: [{ x: 50, y: 400 }, { x: 50, y: 100 }, { x: 250, y: 100 }] }))
      .toEqual({ x1: 50, y1: 100, x2: 250, y2: 400 });
  });

  // Divergenza dichiarata, non difetto: il render disegna `?? 100`/`?? 50`, la
  // bbox misura `?? 0`. Il gemello Rust fa `unwrap_or(0.0)` per la stessa
  // ragione, e i due restano d'accordo fra loro.
  it("senza width/height il box ha area zero", () => {
    expect(objectBBox({ type: "rect", x: 40, y: 40 }))
      .toEqual({ x1: 40, y1: 40, x2: 40, y2: 40 });
  });
});

describe("isOffPage", () => {
  // La tabella è **dato**, non codice: la stessa dichiarazione esiste in
  // `sws-core/src/geometry.rs` e `scripts/check_off_page.sh` le confronta. Se
  // qui si aggiunge un caso e là no, la guardia lo dice.
  it.each(CASI_FUORI_PAGINA)("%s", (_nome, tipo, x, y, w, h, pw, ph, atteso) => {
    expect(isOffPage({ type: tipo as never, x, y, width: w, height: h }, pw || undefined, ph || undefined))
      .toBe(atteso);
  });

  // Una pipe con i capi ancorati non vive dove è scritta: con `points` vuoti
  // sta nel file come [(0,0),(0,0)] e verrebbe spenta ovunque siano davvero i
  // suoi estremi. Per parcheggiarne una si staccano i capi.
  it("una pipe agganciata non è mai fuori pagina", () => {
    const pipe = { type: "pipe" as const, x: 0, y: 0, points: [{ x: 5000, y: 5000 }] };
    expect(isOffPage(pipe, 1280, 800)).toBe(true);
    expect(isOffPage({ ...pipe, from_obj_id: "pump_1" }, 1280, 800)).toBe(false);
    expect(isOffPage({ ...pipe, to_obj_id: "tank_2" }, 1280, 800)).toBe(false);
  });

  // Le linee si misurano sui due estremi: una che parte dentro e finisce
  // lontano resta dentro, e una interamente oltre il bordo no.
  it("le linee si misurano sui due estremi", () => {
    expect(isOffPage({ type: "line", x: 1200, y: 100, x2: 2000, y2: 100 }, 1280, 800)).toBe(false);
    expect(isOffPage({ type: "line", x: 1400, y: 100, x2: 2000, y2: 100 }, 1280, 800)).toBe(true);
  });
});
