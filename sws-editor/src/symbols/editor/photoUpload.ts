// The photos that arrive inside something — an imported SVG, a `.swsym` file —
// go to the project's images before the symbol uses them (plan
// docs/plans/2026-11-21-simboli-fase-3-foto.md): a symbol only ever names a
// file in `images/`.

import { api } from "@/api/client";
import type { Op } from "./model";

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/** The bytes and the type of a `data:` URI. Decoded by hand: the runtime's
 *  Content Security Policy doesn't let `fetch` read a `data:` address. */
export function dataUriBytes(uri: string): { type: string; bytes: Uint8Array } | null {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([\s\S]*)$/i.exec(uri);
  if (!m) return null;
  try {
    const bin = atob(m[2].replace(/\s+/g, ""));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { type: m[1].toLowerCase(), bytes };
  } catch {
    return null;
  }
}

/** A name that depends only on the content: the same photo imported twice is
 *  one file. FNV-1a, 64 bits as two halves — not for security, for names. */
export function contentName(bytes: Uint8Array, ext: string, prefix = "photo"): string {
  let a = 0x811c9dc5, b = 0x01000193 ^ bytes.length;
  for (let i = 0; i < bytes.length; i++) {
    a = Math.imul(a ^ bytes[i], 0x01000193) >>> 0;
    b = Math.imul(b ^ bytes[i] ^ (i & 0xff), 0x01000193) >>> 0;
  }
  return `${prefix}-${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}.${ext}`;
}

/** Every photo of `ops` written as a `data:` URI uploaded to the project and
 *  named instead. A photo that can't be uploaded is left out; how many are
 *  in `lost`. */
export async function uploadEmbeddedPhotos(ops: Op[], prefix = "photo"): Promise<{ ops: Op[]; lost: number }> {
  const done = new Map<string, string | null>();
  let lost = 0;
  const out: Op[] = [];
  for (const op of ops) {
    if (op.op !== "image" || typeof op.src !== "string" || !op.src.startsWith("data:")) {
      out.push(op);
      continue;
    }
    let name = done.get(op.src);
    if (name === undefined) {
      const d = dataUriBytes(op.src);
      name = null;
      if (d) {
        const n = contentName(d.bytes, EXT[d.type], prefix);
        try {
          await api.uploadProjectImage(n, new Blob([d.bytes as BlobPart], { type: d.type }), { replace: true });
          name = n;
        } catch {
          name = null;
        }
      }
      done.set(op.src, name);
    }
    if (name) out.push({ ...op, src: name });
    else lost++;
  }
  return { ops: out, lost };
}
