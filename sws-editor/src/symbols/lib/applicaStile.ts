// «Applica stile»: lo stile effettivo di un simbolo di libreria, scritto dentro
// il suo SVG prima di disegnarlo.
//
// Ha un gemello in Rust, `sws-core/src/stile_simboli.rs`, che il pannello LVGL
// usa prima di rasterizzare. Devono dare **lo stesso testo**, byte per byte: i
// casi stanno in `tests/fixtures/stile-simboli.json` e li verificano entrambi
// (`tests/stileSimboli.test.ts` qui, il test del modulo di là). Stesso schema di
// `colori-predefiniti.json`.
//
// Lavora sul formato che esce da `scripts/simboli/genera.py` — un tag per riga,
// attributi fra virgolette doppie — e tocca solo gli attributi:
//   - `data-mat="m"`        → `fill` = colore del materiale m
//   - `data-mat-stroke="m"` → `stroke` = colore del materiale m
//   - `data-shade`          → `opacity` = volume / 100 (il velo che dà la luce)
//   - `data-layer`          → `stroke` = colore del contorno
//   - `stroke-width`        → moltiplicato per il fattore del contorno
//   - `id="body"`           → `fill` = colore del corpo, se dato (lo stato vince)
// Tutto il resto passa com'è.

export interface StileSimbolo {
  /** Colore per materiale; i materiali assenti restano quelli del disegno. */
  materials: Record<string, string>;
  /** 0 = piatto, 100 = il volume del disegno. */
  volume: number;
  outline: { color: string; width: number };
  /** Colore del corpo (di stato o scelto sull'oggetto); null = quello del materiale. */
  body?: string | null;
}

/** Numero → testo: tre decimali al più, niente zeri in coda. Uguale in Rust. */
export function numeroStile(x: number): string {
  const n = Math.round(x * 1000);
  const intero = Math.trunc(n / 1000);
  const resto = Math.abs(n % 1000);
  if (resto === 0) return String(intero);
  const segno = n < 0 && intero === 0 ? "-" : "";
  return `${segno}${intero}.${String(resto).padStart(3, "0").replace(/0+$/, "")}`;
}

const TAG = /<([a-zA-Z][\w:-]*)((?:\s+[^\s=/>]+="[^"]*")*)\s*(\/?)>/g;
const ATTR = /\s+([^\s=/>]+)="([^"]*)"/g;

export function applicaStile(svg: string, stile: StileSimbolo): string {
  const opacita = numeroStile(Math.min(100, Math.max(0, stile.volume)) / 100);
  return svg.replace(TAG, (_tutto, nome: string, corpo: string, chiuso: string) => {
    const attr: [string, string][] = [];
    for (const m of corpo.matchAll(ATTR)) attr.push([m[1], m[2]]);
    const val = (k: string) => attr.find(([n]) => n === k)?.[1];
    const metti = (k: string, v: string) => {
      const i = attr.findIndex(([n]) => n === k);
      if (i >= 0) attr[i] = [k, v];
      else attr.push([k, v]);
    };
    const mat = val("data-mat");
    if (mat && stile.materials[mat]) metti("fill", stile.materials[mat]);
    const matTratto = val("data-mat-stroke");
    if (matTratto && stile.materials[matTratto]) metti("stroke", stile.materials[matTratto]);
    if (val("data-shade") !== undefined) metti("opacity", opacita);
    if (val("data-layer") !== undefined) metti("stroke", stile.outline.color);
    const sw = val("stroke-width");
    if (sw !== undefined && Number.isFinite(Number(sw))) metti("stroke-width", numeroStile(Number(sw) * stile.outline.width));
    if (val("id") === "body" && stile.body) metti("fill", stile.body);
    return `<${nome}${attr.map(([k, v]) => ` ${k}="${v}"`).join("")}${chiuso ? "/>" : ">"}`;
  });
}
