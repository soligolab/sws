// Project-wide page sizing (OPEN_QUESTIONS-adjacent page-management work):
// standard reference resolutions for "Solo proporzioni" mode + a
// brand-extensible device-preset library for "Fisso" mode. Pure data/helpers,
// no React.

import type { PageLayoutConfig, PageSizeMode, PipePoint, SynopticObject, SynopticPage } from "@/types";
import { getBrand } from "@/branding";

/** Aspect ratios offered in the "Solo proporzioni" mode picker, with their
 *  standard reference/authoring resolution. */
export const ASPECT_RATIOS: { label: string; ratio: string; width: number; height: number }[] = [
  { label: "16:9", ratio: "16:9", width: 1920, height: 1080 },
  { label: "4:3", ratio: "4:3", width: 1024, height: 768 },
  { label: "21:9 (UltraWide)", ratio: "21:9", width: 2560, height: 1080 },
  { label: "1:1 (Quadrato)", ratio: "1:1", width: 1080, height: 1080 },
];

/** Reference width/height for a given aspect_ratio label (falls back to 16:9). */
export function referenceResolutionFor(aspectRatio: string | undefined): { width: number; height: number } {
  const found = ASPECT_RATIOS.find((a) => a.ratio === aspectRatio);
  return found ?? { width: ASPECT_RATIOS[0].width, height: ASPECT_RATIOS[0].height };
}

/** Generic standard resolutions for "Fisso" mode — always available
 *  regardless of the active brand. */
export const STANDARD_DEVICE_PRESETS: { label: string; width: number; height: number }[] = [
  { label: "HD 16:9 (1280×720)", width: 1280, height: 720 },
  { label: "Full HD 16:9 (1920×1080)", width: 1920, height: 1080 },
  { label: "21:9 UltraWide (2560×1080)", width: 2560, height: 1080 },
  { label: "Quadrato (1080×1080)", width: 1080, height: 1080 },
];

/** Device presets for "Fisso" mode — the standard resolutions plus any
 *  hardware models declared by the active brand (e.g. Pixsys WP-series
 *  panels in public/branding/pixsys/brand.json → "device_presets"). */
export function getDevicePresets(): { label: string; width: number; height: number }[] {
  return [...STANDARD_DEVICE_PRESETS, ...getBrand().devicePresets];
}

/** Effective size_mode for a project — `undefined`/absent config = legacy
 *  behavior = "fixed" (every project authored before this feature already
 *  has literal per-page width/height). */
export function effectiveSizeMode(pageLayout: PageLayoutConfig | undefined | null): PageSizeMode {
  return pageLayout?.size_mode ?? "fixed";
}

/** Page size the editor's "fit page" should target, or null when there is
 *  nothing to fit: "fluid" mode declares no size, and a "fixed" page may
 *  legitimately have no width/height yet. In "ratio" mode a page without
 *  explicit dimensions still fits the reference resolution. */
export function editorFitSize(
  page: Pick<SynopticPage, "width" | "height"> | undefined | null,
  pageLayout: PageLayoutConfig | undefined | null,
): { width: number; height: number } | null {
  const mode = effectiveSizeMode(pageLayout);
  if (mode === "fluid") return null;
  if (page?.width && page?.height) return { width: page.width, height: page.height };
  if (mode === "ratio") {
    // referenceResolutionFor may return a whole ASPECT_RATIOS entry — keep
    // only the two fields the caller declares.
    const { width, height } = referenceResolutionFor(pageLayout?.aspect_ratio);
    return { width, height };
  }
  return null;
}

/** Fattore di scala per la modalità "fisso" nel viewer: la pagina va
 *  rimpicciolita quando non entra nello spazio disponibile, invece di far
 *  comparire barre di scorrimento.
 *
 *  **Cap a 1 voluto**: si rimpicciolisce, non si ingrandisce. La modalità
 *  "fisso" esiste per targetizzare un dispositivo noto — quando le misure
 *  combaciano lo scale è esattamente 1 e i pixel restano 1:1; ingrandire
 *  sfocherebbe il disegno. Ritorna 1 anche quando le dimensioni non sono
 *  determinabili, cioè nessuna riduzione. */
export function viewerFitScale(
  availWidth: number | undefined,
  availHeight: number | undefined,
  pageWidth: number | undefined,
  pageHeight: number | undefined,
): number {
  if (!availWidth || !availHeight || !pageWidth || !pageHeight) return 1;
  return Math.min(1, availWidth / pageWidth, availHeight / pageHeight);
}

/** Which page id the viewer should open at mount. Prefers `homePageId` when
 *  it's present in `pages` (that list is already server-filtered by the
 *  operator's zones — an id absent from it means "not allowed for this
 *  operator", so this doubles as the zone-fallback logic); otherwise falls
 *  back to the first page in list order (today's behavior). */
export function pickInitialPageId(pages: { id: string }[], homePageId: string | undefined): string {
  if (homePageId && pages.some((p) => p.id === homePageId)) return homePageId;
  return pages[0]?.id ?? "";
}

/** T-52: va dipinto un **foglio** invece di colorare tutto il nodo `<svg>`?
 *
 *  Sta qui e non inline nel canvas perché è una condizione a quattro fattori
 *  con due casi veri per ragioni diverse, e uno dei due si sbaglia in silenzio:
 *  la miniatura delle pagine monta `SvgCanvas` in ramo viewer `ratio` **senza**
 *  passare `background`, quindi guardando il valore dopo il default si
 *  concluderebbe che c'è un colore da dipingere e le si stamperebbe addosso il
 *  `#1a1a2e` del componente — né il colore della pagina né quello del tema.
 *  Per questo il primo parametro è la prop **grezza**, `undefined` compreso.
 *
 *  I due casi veri:
 *  - **editor** (`isEditor`): il foglio si stacca dal tavolo, che è il punto
 *    della richiesta;
 *  - **viewer in `ratio`**: le bande del letterbox prendevano il colore della
 *    pagina, cioè lo stesso difetto in un altro ramo dello stesso componente.
 *
 *  I casi falsi, e perché: `fixed` — il nodo `<svg>` ha già le misure del
 *  foglio, attorno non c'è niente da dipingere; **fluido** (nessuna
 *  `width`/`height`) — non esiste un foglio, quindi non esiste un bordo, che è
 *  la regola unica di tutto T-52; **fill non dipingibile** — un `fill` SVG non
 *  è un `background` CSS e non rende gradienti né `url()`, e in quel caso si
 *  resta al comportamento di prima invece di lasciare il foglio trasparente.
 */
export function pageFillEnabled(
  background: string | undefined,
  pageW: number | undefined,
  pageH: number | undefined,
  isEditor: boolean,
  sizeMode: PageSizeMode,
): boolean {
  if (!pageW || !pageH) return false;
  if (!background || /(gradient|url)\s*\(/i.test(background)) return false;
  return isEditor || sizeMode === "ratio";
}

/** T-52: quanto il puntatore deve superare il bordo pagina perché l'oggetto si
 *  sganci, in pixel **schermo**. Il chiamante divide per lo zoom, così la
 *  sensazione al tatto è la stessa al 25% e al 400%. */
export const PAGE_EDGE_RESIST_PX = 24;

/** T-52 — un asse del limite morbido: il bordo pagina trattiene, ma non
 *  imprigiona.
 *
 *  Sostituisce il vecchio `clampToPage`, che era una gabbia rigida. Ne eredita
 *  due proprietà che vanno conservate: è un **no-op quando la pagina non ha
 *  dimensioni** (modalità fluida — nessun bordo, quindi niente da trattenere,
 *  che è la regola unica di tutto T-52), e il limite superiore è
 *  `pageSize - size`, cioè si trattiene il **lato lontano** dell'oggetto, non
 *  la sua origine.
 *
 *  - `candidate` è la posizione **dopo** lo snap: è quella che si restituisce.
 *  - `pointer` è la posizione grezza sotto il dito, e la soglia si misura su
 *    **questa**: lo snap può spostare il candidato di mezzo passo di griglia,
 *    e misurare lì renderebbe lo sganciamento più facile o più difficile a
 *    seconda di dove cade la griglia.
 *  - `freed` è lo stato del gesto: sganciato resta sganciato fino al rilascio.
 *    Rearmare a metà gesto farebbe comportare la seconda metà del
 *    trascinamento diversamente dalla prima.
 */
export function softEdgeAxis(
  candidate: number,
  pointer: number,
  size: number,
  pageSize: number | undefined,
  resist: number,
  freed: boolean,
): { pos: number; freed: boolean } {
  if (!pageSize || freed) return { pos: candidate, freed };
  const max = Math.max(0, pageSize - size);
  const over = pointer < 0 ? -pointer : pointer > max ? pointer - max : 0;
  if (over > resist) return { pos: candidate, freed: true };
  return { pos: Math.min(Math.max(candidate, 0), max), freed: false };
}

/** T-52 — il limite morbido sui due assi, che sono **indipendenti**: sganciato
 *  in X e trattenuto in Y significa che l'oggetto scivola lungo il bordo
 *  inferiore mentre esce a destra, che è come ci si aspetta si comporti un
 *  foglio. */
export function softClampToPage(
  cand: { x: number; y: number },
  pointer: { x: number; y: number },
  w: number,
  h: number,
  pageW: number | undefined,
  pageH: number | undefined,
  resist: number,
  freed: { x: boolean; y: boolean },
): { x: number; y: number; freed: { x: boolean; y: boolean } } {
  const ax = softEdgeAxis(cand.x, pointer.x, w, pageW, resist, freed.x);
  const ay = softEdgeAxis(cand.y, pointer.y, h, pageH, resist, freed.y);
  return { x: ax.pos, y: ay.pos, freed: { x: ax.freed, y: ay.freed } };
}

// ── T-52: il fuori pagina è un parcheggio ────────────────────────────────────
//
// Un oggetto interamente fuori dal foglio resta nel file ma non viene disegnato
// a runtime: è il modo di togliere qualcosa dalla grafica senza cancellarlo.
// Lo stato non è dichiarato da nessun campo, sta **nelle coordinate** — scelta
// registrata come Q35 in docs/OPEN_QUESTIONS.md, con il suo prezzo scritto lì.
//
// Questa definizione ha un gemello in Rust, `sws-core/src/geometry.rs`, e i due
// devono dire la stessa cosa: la tabella `CASI_FUORI_PAGINA` qui sotto esiste
// in copia identica là, e `scripts/check_off_page.sh` le confronta.

export interface BBox { x1: number; y1: number; x2: number; y2: number }

/** Il minimo che serve per misurare un oggetto. Volutamente non `SynopticObject`
 *  intero: così la funzione si può chiamare anche su un oggetto a metà
 *  costruzione, e si vede a colpo d'occhio quali campi contano. */
export type GeomObj = Pick<SynopticObject, "type" | "x" | "y" | "width" | "height"> & {
  x2?: number; y2?: number; points?: PipePoint[];
  from_obj_id?: string; to_obj_id?: string;
};

/** Il rettangolo di un oggetto in coordinate pagina.
 *
 *  Le linee usano il min/max dei due estremi, le pipe l'inviluppo dei waypoint,
 *  tutto il resto x/y/w/h. **La rotazione non c'entra**: il box è sempre
 *  allineato agli assi sulle coordinate nominali, come è sempre stato da quando
 *  questo codice viveva dentro `SvgCanvas` come closure `objBBox`.
 *
 *  Nota su `width` assente, che è una divergenza dichiarata e non un difetto:
 *  qui vale `?? 0`, mentre il render disegna `?? 100` / `?? 50`. Un oggetto
 *  senza `width` a x = -60 risulta quindi «fuori» pur essendo disegnato a metà
 *  in editor. Editor e runtime restano d'accordo fra loro (grigio *e* nascosto);
 *  la divergenza è solo con l'occhio. Il gemello Rust fa `unwrap_or(0.0)` per la
 *  stessa ragione. */
export function objectBBox(obj: GeomObj): BBox {
  if (obj.type === "line") {
    const lx1 = Math.min(obj.x ?? 0, obj.x2 ?? obj.x ?? 0);
    const ly1 = Math.min(obj.y ?? 0, obj.y2 ?? obj.y ?? 0);
    const lx2 = Math.max(obj.x ?? 0, obj.x2 ?? obj.x ?? 0);
    const ly2 = Math.max(obj.y ?? 0, obj.y2 ?? obj.y ?? 0);
    return { x1: lx1, y1: ly1, x2: lx2, y2: ly2 };
  }
  if (obj.type === "pipe" && obj.points && obj.points.length >= 1) {
    const xs = obj.points.map((p) => p.x);
    const ys = obj.points.map((p) => p.y);
    return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
  }
  const ox = obj.x ?? 0;
  const oy = obj.y ?? 0;
  return { x1: ox, y1: oy, x2: ox + (obj.width ?? 0), y2: oy + (obj.height ?? 0) };
}

/** «Fuori pagina»: la bbox dell'oggetto non tocca **affatto** il rettangolo
 *  pagina. Un oggetto a cavallo del bordo resta attivo — si spegne solo ciò che
 *  è stato portato via del tutto.
 *
 *  Le disuguaglianze sono **larghe** (`<`, non `<=`) di proposito: a intervalli
 *  aperti una bbox di area zero — una linea verticale su x=0, un oggetto senza
 *  `width` — risulterebbe fuori e il runtime la cancellerebbe. «A filo del
 *  bordo» resta dentro, che è anche la lettura conservativa giusta quando si
 *  decide se far sparire qualcosa dal sinottico di qualcun altro.
 *
 *  Pagina fluida (nessuna dimensione) ⇒ nessun bordo ⇒ niente è fuori: è la
 *  regola unica dei tre punti di T-52.
 *
 *  Le pipe **agganciate** sono escluse perché la loro geometria non è dove sono
 *  scritte: una pipe con `points` vuoti e i due capi ancorati vive nel file come
 *  [(0,0),(0,0)] e verrebbe spenta ovunque stiano davvero i suoi estremi. Per
 *  parcheggiarne una si staccano i capi.
 *
 *  TODO(open-question): Q35 — questo stato è implicito nelle coordinate; il
 *  campo `disabled` esplicito è l'alternativa, non ancora decisa. */
export function isOffPage(obj: GeomObj, pageW?: number, pageH?: number): boolean {
  if (!pageW || !pageH) return false;
  if (obj.from_obj_id || obj.to_obj_id) return false;
  const bb = objectBBox(obj);
  return bb.x2 < 0 || bb.y2 < 0 || bb.x1 > pageW || bb.y1 > pageH;
}

/** La tabella di verità del fuori pagina, **duplicata in Rust** in
 *  `sws-core/src/geometry.rs` e tenuta allineata da `scripts/check_off_page.sh`.
 *
 *  È dichiarata come dato estraibile — non come una lista di `expect` — proprio
 *  perché una guardia possa leggerla senza interpretare il linguaggio. La
 *  percorrono i test qui accanto e i `#[test]` del gemello.
 *
 *  Campi: nome, tipo, x, y, w, h, larghezza pagina, altezza pagina, atteso. */
export const CASI_FUORI_PAGINA: [string, string, number, number, number, number, number, number, boolean][] = [
  ["dentro",                    "rect", 100,  100, 120,  80, 1280, 800, false],
  ["a filo del bordo destro",   "rect", 1160, 100, 120,  80, 1280, 800, false],
  ["a cavallo del bordo destro","rect", 1200, 100, 120,  80, 1280, 800, false],
  ["esattamente sul bordo",     "rect", 1280, 100, 120,  80, 1280, 800, false],
  ["un pixel oltre il bordo",   "rect", 1281, 100, 120,  80, 1280, 800, true],
  ["oltre il bordo destro",     "rect", 1400, 100, 120,  80, 1280, 800, true],
  ["oltre il bordo inferiore",  "rect", 100,  900, 120,  80, 1280, 800, true],
  ["tutto a sinistra",          "rect", -300, 100, 120,  80, 1280, 800, true],
  ["a cavallo del bordo sinistro","rect", -60, 100, 120,  80, 1280, 800, false],
  ["area zero sul bordo",       "rect", 0,    0,    0,   0, 1280, 800, false],
  ["area zero fuori",           "rect", -10,  0,    0,   0, 1280, 800, true],
  ["piu grande della pagina",   "rect", -100, -100, 2000, 1200, 1280, 800, false],
  ["pagina fluida",             "rect", 5000, 5000, 120,  80,    0,   0, false],
];

export interface BrokenNavLink {
  pageId: string;
  pageName: string;
  objId: string;
  objName: string;
  targetId: string;
}

/** Scans every `navbutton` object across all pages for a `target_page` that
 *  doesn't match any existing page id. */
export function findBrokenNavLinks(pages: SynopticPage[]): BrokenNavLink[] {
  const pageIds = new Set(pages.map((p) => p.id));
  const out: BrokenNavLink[] = [];
  for (const page of pages) {
    for (const obj of page.objects) {
      if (obj.type === "navbutton" && obj.target_page && !pageIds.has(obj.target_page)) {
        out.push({
          pageId: page.id,
          pageName: page.name,
          objId: obj.id,
          objName: obj.name ?? obj.label ?? obj.id,
          targetId: obj.target_page,
        });
      }
    }
  }
  return out;
}

/** A page is "orphaned" when it isn't the home page and no `navbutton` on any
 *  page targets it. Independent of the kiosk auto-rotate flag (shown as its
 *  own checkbox already). */
export function findOrphanPageIds(pages: SynopticPage[], homePageId: string | undefined): Set<string> {
  const linked = new Set<string>();
  for (const page of pages) {
    for (const obj of page.objects) {
      if (obj.type === "navbutton" && obj.target_page) linked.add(obj.target_page);
    }
  }
  const orphans = new Set<string>();
  for (const page of pages) {
    if (page.id !== homePageId && !linked.has(page.id)) orphans.add(page.id);
  }
  return orphans;
}
