// The images of the project made fit for a panel before they are uploaded
// (plan docs/plans/2026-11-19-libreria-immagini.md, decision 1). A photo from a
// phone is 4000 px and 5 MB: two of them stop a deploy (8 MB in all), and on
// the TY570 one takes almost 2 s to decode at every visit of its page. The
// long side goes to 1920 px at most, photos become JPEG, a picture with
// transparency stays PNG; SVG and GIF are never touched (a GIF may move).

/** The long side of an optimised image. */
export const OPTIMIZE_MAX_SIDE = 1920;
/** Under this, a picture small enough in pixels is left as it is. */
export const OPTIMIZE_MIN_BYTES = 1024 * 1024;
const JPEG_QUALITY = 0.85;

/** The rule of the server (`image_content_type`): letters, digits, `.`, `-`, `_`. */
export function safeImageName(name: string): string {
  const s = name.trim().replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "").replace(/\.{2,}/g, ".");
  return (s || "immagine.png").slice(-128);
}

/** A name not in `taken`: `foto.png`, then `foto-2.png`, `foto-3.png`… */
export function freeImageName(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(name)) return name;
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}${ext}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** The extension of `name` for the type it is written in. */
export function withExtension(name: string, type: "image/jpeg" | "image/png"): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}${type === "image/jpeg" ? ".jpg" : ".png"}`;
}

/** The kinds a browser can redraw: PNG, JPEG, WebP. */
export function optimizable(type: string): boolean {
  return type === "image/png" || type === "image/jpeg" || type === "image/webp";
}

/** Whether a picture is worth optimising: too many pixels, or too many bytes. */
export function shouldOptimize(type: string, bytes: number, w: number, h: number): boolean {
  return optimizable(type) && (Math.max(w, h) > OPTIMIZE_MAX_SIDE || bytes > OPTIMIZE_MIN_BYTES);
}

/** The size of the optimised picture: the long side at most `max`, never larger than it was. */
export function optimizedSize(w: number, h: number, max = OPTIMIZE_MAX_SIDE): [number, number] {
  const k = Math.min(1, max / Math.max(w, h, 1));
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

/** Whether some pixel is not fully opaque (every 4th, enough for a picture). */
export function hasTransparency(rgba: Uint8ClampedArray): boolean {
  for (let i = 3; i < rgba.length; i += 16) if (rgba[i] < 255) return true;
  return false;
}

export interface Optimized { blob: Blob; name: string; width: number; height: number }

/** The size of a picture in pixels, or `null` (SVG, GIF, a browser without
 *  `createImageBitmap`, a file it can't read). */
export async function imageSize(file: Blob): Promise<[number, number] | null> {
  if (typeof createImageBitmap !== "function" || !optimizable(file.type)) return null;
  try {
    const bmp = await createImageBitmap(file);
    const size: [number, number] = [bmp.width, bmp.height];
    bmp.close();
    return size;
  } catch {
    return null;
  }
}

/** The picture redrawn for the panel, or `null` when it can't be (then it goes
 *  up as it is). JPEG unless it has transparency. */
export async function optimizeImage(file: Blob, name: string): Promise<Optimized | null> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined" || !optimizable(file.type)) return null;
  try {
    const bmp = await createImageBitmap(file);
    const shrunk = Math.max(bmp.width, bmp.height) > OPTIMIZE_MAX_SIDE;
    const [w, h] = optimizedSize(bmp.width, bmp.height);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const type = file.type !== "image/jpeg" && hasTransparency(ctx.getImageData(0, 0, w, h).data) ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, type, type === "image/jpeg" ? JPEG_QUALITY : undefined));
    // Same size and not lighter (a small, well-compressed PNG): the original is better.
    if (!blob || (!shrunk && blob.size >= file.size)) return null;
    return { blob, name: withExtension(name, type), width: w, height: h };
  } catch {
    return null;
  }
}

/** A picture as a model reads it: JPEG on white, the long side at most `max`,
 *  in base64 without the `data:` prefix (the AI tab of the symbol editor, plan
 *  docs/plans/2026-11-19-assistente-ia-simboli.md). A phone photo of 5 MB
 *  becomes 100–200 KB; `null` when the browser can't read it. */
export async function pictureForModel(file: Blob, max = 1024): Promise<{ media_type: "image/jpeg"; data: string } | null> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined" || !optimizable(file.type)) return null;
  try {
    const bmp = await createImageBitmap(file);
    const [w, h] = optimizedSize(bmp.width, bmp.height, max);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#fff"; // fixed-colour: what the model sees under a transparent picture
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const url = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    return { media_type: "image/jpeg", data: url.slice(url.indexOf(",") + 1) };
  } catch {
    return null;
  }
}
