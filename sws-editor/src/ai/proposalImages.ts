// The images a proposal of the assistant brings into `images/` of the project
// (plan docs/archive/2026-11-10-assistente-secondo-giro.md, G2).
//
// Until G2 they were only the generated backgrounds, JPEG in base64. The
// drawing of a floor plan is an SVG, and travels as text: the same list, one
// more shape. Who draws or uploads them asks here instead of assuming a JPEG.

/** `jpg` (base64) or `svg` (text): one of the two. */
export interface ProposalImage {
  file: string;
  jpg?: string;
  svg?: string;
}

/** The image as a data URI, to draw it before the server has the file. */
export function imageDataUri(f: { jpg?: string; svg?: string }): string {
  return f.svg !== undefined
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(f.svg)}`
    : `data:image/jpeg;base64,${f.jpg ?? ""}`;
}

/** The image as the file to upload. */
export function imageBlob(f: { jpg?: string; svg?: string }): Blob {
  if (f.svg !== undefined) return new Blob([f.svg], { type: "image/svg+xml" });
  const bytes = Uint8Array.from(atob(f.jpg ?? ""), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: "image/jpeg" });
}
