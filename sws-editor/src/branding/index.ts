// ── Branding / white-label ────────────────────────────────────────────────
//
// The editor and viewer can be shipped under different company brands. Each
// brand is a folder of static assets under `public/branding/<id>/`
// (logo.svg, favicon.svg, brand.json). The active brand is chosen at runtime
// by `public/branding/active.json` — no rebuild needed to switch, just edit
// that file and reload.
//
// This module runs BEFORE React renders (see admin-main.tsx / main.tsx):
//   const brand = await loadBranding();
//   applyBranding(brand);
//
// `applyBranding` writes the brand palette into CSS custom properties on
// :root (see index.html / index-admin.html for the SWS defaults), sets the
// document title and swaps the favicon. Components read the logo/name via
// `getBrand()`.
//
// Nothing here touches the runtime (Rust) — the brand folder is served as a
// plain static asset out of dist/branding/.

export interface BrandColors {
  bg: string;
  surface: string;
  surface2: string;
  border: string;
  text: string;
  text2: string;
  textMuted: string;
  primary: string;
  primaryHover: string;
  onPrimary: string;
}

export interface DevicePreset {
  label: string;
  width: number;
  height: number;
}

export interface DataPathPreset {
  label: string;
  path: string;
}

export interface Brand {
  id: string;
  name: string;
  shortName: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  colors: BrandColors;
  /** Brand-specific device resolution presets (e.g. Pixsys WP-series panels),
   *  offered alongside the generic standard resolutions in the page-size
   *  picker. Empty for brands with no hardware line of their own. */
  devicePresets: DevicePreset[];
  /** Brand-specific default data-directory paths for the container install
   *  flow (e.g. Pixsys Yocto devices only have /data/user/<user> writable).
   *  Empty for brands with no fixed device convention — custom path only. */
  dataPathPresets: DataPathPreset[];
}

// Hardcoded SWS palette — used when active.json / brand.json can't be loaded
// so the app never renders unstyled. Keep in sync with the :root defaults in
// index.html / index-admin.html and with public/branding/sws/brand.json.
export const SWS_FALLBACK: Brand = {
  id: "sws",
  name: "SWS — SCADA Web Studio",
  shortName: "SWS",
  logoUrl: "/branding/sws/logo.svg",
  faviconUrl: "/branding/sws/favicon.svg",
  colors: {
    bg: "#0f172a",
    surface: "#1e293b",
    surface2: "#334155",
    border: "#475569",
    text: "#e2e8f0",
    text2: "#cbd5e1",
    textMuted: "#94a3b8",
    primary: "#3b82f6",
    primaryHover: "#2563eb",
    onPrimary: "#ffffff",
  },
  devicePresets: [],
  dataPathPresets: [],
};

// colors key → CSS custom property name.
export const CSS_VARS: Record<keyof BrandColors, string> = {
  bg: "--brand-bg",
  surface: "--brand-surface",
  surface2: "--brand-surface-2",
  border: "--brand-border",
  text: "--brand-text",
  text2: "--brand-text-2",
  textMuted: "--brand-text-muted",
  primary: "--brand-primary",
  primaryHover: "--brand-primary-hover",
  onPrimary: "--brand-on-primary",
};

let current: Brand = SWS_FALLBACK;

/** The active brand (cached after loadBranding). */
export function getBrand(): Brand {
  return current;
}

/**
 * Resolve the active brand from public/branding/active.json → the chosen
 * brand's brand.json. Any failure falls back to SWS so the app still boots.
 */
export async function loadBranding(): Promise<Brand> {
  try {
    // no-store: active.json / brand.json are meant to be edited on the deployed
    // tree and picked up on reload, so never serve a cached copy.
    const active = await fetch("/branding/active.json", { cache: "no-store" }).then((r) => {
      if (!r.ok) throw new Error(`active.json ${r.status}`);
      return r.json();
    });
    const id: string = active?.brand || "sws";

    const meta = await fetch(`/branding/${id}/brand.json`, { cache: "no-store" }).then((r) => {
      if (!r.ok) throw new Error(`brand.json ${r.status}`);
      return r.json();
    });

    current = {
      id,
      name: meta.name ?? id,
      shortName: meta.shortName ?? meta.name ?? id,
      logoUrl: meta.logo ? `/branding/${id}/${meta.logo}` : null,
      faviconUrl: meta.favicon ? `/branding/${id}/${meta.favicon}` : null,
      colors: { ...SWS_FALLBACK.colors, ...(meta.colors ?? {}) },
      devicePresets: meta.device_presets ?? [],
      dataPathPresets: meta.data_path_presets ?? [],
    };
  } catch (err) {
    console.warn("[branding] falling back to SWS:", err);
    current = SWS_FALLBACK;
  }
  return current;
}

/**
 * Push the brand into the live document: CSS custom properties on :root,
 * the page title, and the favicon. Safe to call with any Brand.
 */
export function applyBranding(brand: Brand): void {
  current = brand;

  const root = document.documentElement.style;
  for (const key of Object.keys(CSS_VARS) as (keyof BrandColors)[]) {
    root.setProperty(CSS_VARS[key], brand.colors[key]);
  }

  document.title = brand.name;

  if (brand.faviconUrl) {
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.type = "image/svg+xml";
    link.href = brand.faviconUrl;
  }
}
