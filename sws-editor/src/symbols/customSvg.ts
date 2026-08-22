// ── Simboli custom multi-stato (F6.9, piano SCADA-widgets) ──────────────────
//
// Un CustomSymbol con `svg` inline viene renderizzato dentro il canvas con
// gli elementi `colorable_ids` ricolorati per stato — a differenza degli SVG
// via `url` (immagini statiche, solo badge). Il markup arriva dall'IDE del
// maintainer (stesso livello di fiducia delle immagini di progetto), ma viene
// comunque ripulito da script e handler inline: finisce in una pagina servita
// anche al viewer anonimo.

/** Rimuove <script>, <foreignObject>, handler on* e href javascript:. */
export function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/href\s*=\s*"javascript:[^"]*"/gi, 'href=""');
}

/** Estrae viewBox e contenuto interno dal markup <svg>…</svg>.
 *  Senza tag <svg> il testo è trattato come contenuto nudo (viewBox default). */
export function parseSvg(svg: string): { viewBox: string; inner: string } {
  const m = /<svg([^>]*)>([\s\S]*)<\/svg>/i.exec(svg);
  if (!m) return { viewBox: "0 0 100 100", inner: svg };
  const vb = /viewBox\s*=\s*"([^"]+)"/i.exec(m[1]);
  // Fallback: width/height come viewBox quando manca.
  let viewBox = vb?.[1] ?? "";
  if (!viewBox) {
    const w = /width\s*=\s*"([\d.]+)/i.exec(m[1])?.[1];
    const h = /height\s*=\s*"([\d.]+)/i.exec(m[1])?.[1];
    viewBox = w && h ? `0 0 ${w} ${h}` : "0 0 100 100";
  }
  return { viewBox, inner: m[2] };
}

/** Id degli elementi presenti nel markup (per la checklist "colorabili"). */
export function listSvgIds(svg: string): string[] {
  const ids = new Set<string>();
  const re = /\bid\s*=\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg)) !== null) ids.add(m[1]);
  return [...ids];
}

/** Ricolora gli elementi con id in `colorableIds`: sostituisce il fill
 *  esistente o lo inietta se assente. Trasformazione testuale — niente DOM,
 *  funziona anche fuori dal browser (test). */
export function applyStateColor(inner: string, colorableIds: string[], color: string): string {
  let out = inner;
  for (const id of colorableIds) {
    // Elemento con quell'id: <tag …id="x"…> — su quel TAG sostituisci/inietta fill.
    out = out.replace(
      new RegExp(`<([a-zA-Z]+)([^>]*\\bid\\s*=\\s*"${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*)>`, "g"),
      (_full, tag: string, attrs: string) => {
        const cleaned = attrs.replace(/\bfill\s*=\s*"[^"]*"/g, "");
        return `<${tag}${cleaned} fill="${color}">`;
      },
    );
  }
  return out;
}
