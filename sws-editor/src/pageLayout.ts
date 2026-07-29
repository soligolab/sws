// Project-wide page sizing (OPEN_QUESTIONS-adjacent page-management work):
// standard reference resolutions for "Solo proporzioni" mode + a
// brand-extensible device-preset library for "Fisso" mode. Pure data/helpers,
// no React.

import type { PageLayoutConfig, PageSizeMode, SynopticPage } from "@/types";
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

/** Clamp an object's position/size so it stays within [0, pageW] x [0, pageH].
 *  No-op (returns x/y unchanged) when pageW/pageH are falsy (fluid mode / no
 *  page bounds declared). */
export function clampToPage(
  x: number, y: number, w: number, h: number,
  pageW: number | undefined, pageH: number | undefined,
): { x: number; y: number } {
  if (!pageW || !pageH) return { x, y };
  return {
    x: Math.min(Math.max(x, 0), Math.max(0, pageW - w)),
    y: Math.min(Math.max(y, 0), Math.max(0, pageH - h)),
  };
}

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
