// Where the images of the project are used, and how a rename follows them
// (plan docs/archive/2026-11-19-libreria-immagini.md, session B). A generic
// search of the strings equal to the image's URL — `src`, `bg_image`,
// `sfondo_immagine`, the cells of a grid, a static binding — with or without
// the `?v=` that a re-upload adds: a new field that holds an image is covered
// without touching this file.

import type { DescrizioneSimbolo, FaceplateDef, SynopticPage } from "@/types";

const PREFIX = "/api/project/images/";

/** The name of a project image in a URL, or `null`. */
export function imageNameOf(value: string): string | null {
  if (!value.startsWith(PREFIX)) return null;
  const name = value.slice(PREFIX.length).split(/[?#]/)[0];
  try {
    return name ? decodeURIComponent(name) : null;
  } catch {
    return name || null;
  }
}

/** One place that uses an image: a page or a popup, and the object (none for
 *  the page itself, its background). */
export interface ImageUse {
  pageId: string; pageName: string; objectId?: string; faceplate?: boolean;
  /** A photo inside a project symbol (plan 2026-11-21-simboli-fase-3-foto):
   *  `pageName` is the symbol's label, `pageId` its slug. */
  symbol?: boolean;
}

/** The photos a project symbol uses: its images and the ones its signal
 *  entries swap in. They are plain names, not URLs. */
export function symbolPhotos(d: DescrizioneSimbolo): string[] {
  const out = new Set<string>();
  for (const op of d.ops as Record<string, unknown>[]) {
    if (op.op === "image" && typeof op.src === "string") out.add(op.src);
    if (op.op === "parte") {
      const entries = (op.geo as { entries?: { image?: unknown }[] } | undefined)?.entries ?? [];
      for (const e of entries) if (typeof e.image === "string") out.add(e.image);
    }
  }
  return [...out];
}

/** `d` with photo `from` called `to`; the same object when it doesn't use it. */
export function renameSymbolPhoto(d: DescrizioneSimbolo, from: string, to: string): DescrizioneSimbolo {
  if (!symbolPhotos(d).includes(from)) return d;
  const ops = (d.ops as Record<string, unknown>[]).map((op) => {
    if (op.op === "image" && op.src === from) return { ...op, src: to };
    if (op.op === "parte") {
      const geo = op.geo as { entries?: { image?: string }[] } | undefined;
      if (geo?.entries?.some((e) => e.image === from)) {
        return { ...op, geo: { ...geo, entries: geo.entries.map((e) => (e.image === from ? { ...e, image: to } : e)) } };
      }
    }
    return op;
  });
  return { ...d, ops };
}

function walk(value: unknown, found: (name: string) => void): void {
  if (typeof value === "string") {
    const n = imageNameOf(value);
    if (n) found(n);
  } else if (Array.isArray(value)) {
    for (const v of value) walk(v, found);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) walk(v, found);
  }
}

/** Every use of every project image, by name. */
export function imageUses(
  pages: readonly SynopticPage[],
  faceplates: readonly FaceplateDef[] = [],
  symbols: readonly DescrizioneSimbolo[] = [],
): Map<string, ImageUse[]> {
  const out = new Map<string, ImageUse[]>();
  const add = (name: string, use: ImageUse) => {
    const l = out.get(name) ?? [];
    l.push(use);
    out.set(name, l);
  };
  const scan = (id: string, name: string, objects: readonly { id: string }[] | undefined, rest: Record<string, unknown>, faceplate?: boolean) => {
    for (const o of objects ?? []) walk(o, (n) => add(n, { pageId: id, pageName: name, objectId: o.id, faceplate }));
    walk(rest, (n) => add(n, { pageId: id, pageName: name, faceplate }));
  };
  for (const p of pages) {
    const { objects, ...rest } = p;
    scan(p.id, p.name, objects, rest);
  }
  for (const f of faceplates) {
    const { objects, ...rest } = f;
    scan(f.id, f.label || f.id, objects, rest, true);
  }
  for (const d of symbols) {
    for (const n of symbolPhotos(d)) add(n, { pageId: d.slug, pageName: d.it || d.slug, symbol: true });
  }
  return out;
}

/** `value` with every URL of image `from` turned into one of `to` (the `?v=`
 *  dropped: the file is a new one). The same object when nothing changes. */
export function renameImageRefs<T>(value: T, from: string, to: string): T {
  if (typeof value === "string") {
    return (imageNameOf(value) === from ? `${PREFIX}${to}` : value) as T;
  }
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((v) => {
      const w = renameImageRefs(v, from, to);
      if (w !== v) changed = true;
      return w;
    });
    return (changed ? out : value) as T;
  }
  if (value && typeof value === "object") {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const w = renameImageRefs(v, from, to);
      if (w !== v) changed = true;
      out[k] = w;
    }
    return (changed ? out : value) as T;
  }
  return value;
}
