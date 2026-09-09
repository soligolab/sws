// ── Simboli custom multi-stato (F6.9, piano SCADA-widgets) ──────────────────
//
// Un CustomSymbol con `svg` inline viene renderizzato dentro il canvas con
// gli elementi `colorable_ids` ricolorati per stato — a differenza degli SVG
// via `url` (immagini statiche, solo badge). Il markup arriva dall'IDE del
// maintainer (stesso livello di fiducia delle immagini di progetto), ma viene
// comunque ripulito da script e handler inline: finisce in una pagina servita
// anche al viewer anonimo.

// ── Sanificazione ────────────────────────────────────────────────────────────
//
// La prima versione era cinque regex: `<script…</script>`, `<foreignObject…>`,
// `on*="…"`, `on*='…'`, `href="javascript:…"`. Le regex su un linguaggio a
// tag sono una gara persa, e la revisione del 2026-09-09 ne ha elencato le
// scappatoie senza sforzo: `onload=alert(1)` senza virgolette, `xlink:href`,
// `href='javascript:…'` con l'apice, `<script src=x>` senza tag di chiusura,
// `<animate attributeName="href" values="javascript:…">`, `<use href="data:…">`.
// E il pannello dei simboli in ConfigView non la chiamava affatto.
//
// Ora si passa dal DOM: si analizza il markup come SVG e si tiene solo ciò che
// sta in una lista di elementi e attributi **ammessi**. Tutto il resto cade, in
// silenzio — un simbolo è grafica, non ha bisogno di eseguire niente. Le regex
// restano come ripiego per gli ambienti senza `DOMParser` (test senza jsdom,
// SSR), dove comunque nessun browser eseguirà il risultato.

/** Elementi SVG che un simbolo ha motivo di contenere. Niente `script`,
 *  `foreignObject`, `iframe`, `embed`, `object`, `set`, `animate*` (possono
 *  animare `href` verso `javascript:`), né `style` (CSS con `url()` esfiltra). */
const ELEMENTI_AMMESSI = new Set([
  "svg", "g", "defs", "symbol", "use", "title", "desc", "metadata",
  "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "text", "tspan", "textPath",
  "linearGradient", "radialGradient", "stop", "pattern", "mask", "clipPath",
  "filter", "feBlend", "feColorMatrix", "feComponentTransfer", "feComposite",
  "feConvolveMatrix", "feDiffuseLighting", "feDisplacementMap", "feDropShadow",
  "feFlood", "feFuncA", "feFuncB", "feFuncG", "feFuncR", "feGaussianBlur",
  "feImage", "feMerge", "feMergeNode", "feMorphology", "feOffset",
  "feSpecularLighting", "feTile", "feTurbulence", "feDistantLight",
  "fePointLight", "feSpotLight", "marker", "image",
]);

/** Attributi che portano un URL e quindi vanno controllati nel valore. */
const ATTRIBUTI_URL = new Set(["href", "xlink:href", "src"]);

function attributoAmmesso(nome: string, valore: string): boolean {
  const n = nome.toLowerCase();
  if (n.startsWith("on")) return false;                 // ogni handler
  if (n === "style" && /url\s*\(|expression\s*\(|javascript:/i.test(valore)) return false;
  if (ATTRIBUTI_URL.has(n)) {
    const v = valore.trim().toLowerCase().replace(/[\u0000-\u0020]/g, "");
    // Riferimenti interni (#id) e immagini in data: sono grafica; tutto ciò che
    // è uno schema eseguibile o un documento no.
    if (v.startsWith("#")) return true;
    if (v.startsWith("data:image/") && !v.startsWith("data:image/svg")) return true;
    return false;
  }
  return true;
}

function sanificaConDom(svg: string): string | null {
  if (typeof DOMParser === "undefined") return null;
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  } catch {
    return null;
  }
  // Un errore di parsing produce un documento <parsererror>: meglio il ripiego
  // che iniettare qualcosa di cui non si capisce la forma.
  if (doc.getElementsByTagName("parsererror").length > 0) return null;
  const radice = doc.documentElement;
  if (!radice) return null;
  const pulisci = (el: Element): void => {
    for (const figlio of Array.from(el.children)) {
      if (!ELEMENTI_AMMESSI.has(figlio.localName)) { figlio.remove(); continue; }
      for (const a of Array.from(figlio.attributes)) {
        if (!attributoAmmesso(a.name, a.value)) figlio.removeAttribute(a.name);
      }
      pulisci(figlio);
    }
  };
  for (const a of Array.from(radice.attributes)) {
    if (!attributoAmmesso(a.name, a.value)) radice.removeAttribute(a.name);
  }
  pulisci(radice);
  return new XMLSerializer().serializeToString(radice);
}

function sanificaConRegex(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?(<\/script\s*>|$)/gi, "")
    .replace(/<(foreignObject|iframe|embed|object|style|set|animate\w*)\b[\s\S]*?(<\/\1\s*>|\/>|$)/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    // Nel ripiego gli attributi URL restano solo se puntano a un #id o a
    // un'immagine data: — stessa regola di `attributoAmmesso`, riscritta a regex.
    .replace(/\s((?:xlink:)?href|src)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (tutto, _nome: string, valore: string) => {
      const v = valore.replace(/^["']|["']$/g, "").trim().toLowerCase();
      if (v.startsWith("#")) return tutto;
      if (v.startsWith("data:image/") && !v.startsWith("data:image/svg")) return tutto;
      return "";
    });
}

/** Toglie da un SVG tutto ciò che può eseguire codice o caricare risorse
 *  esterne. Il risultato è solo grafica. */
export function sanitizeSvg(svg: string): string {
  return sanificaConDom(svg) ?? sanificaConRegex(svg);
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
