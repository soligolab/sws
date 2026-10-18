// I font di SWS, uguali nel browser e sul pannello LVGL (18-10-2026, gruppo 2
// del programma delle funzioni utente).
//
// **La fonte è `tests/fixtures/font.json`**: questa tabella ne è la copia per
// il browser, e `tests/fontElenco.test.ts` controlla che coincidano. Il pannello
// legge la fixture direttamente (`lvgl_font.rs`, `include_str!`).
//
// `font_family` vale un id dell'elenco. I nomi scritti a mano prima (alias:
// `monospace`, `Arial`…) si riconducono all'elenco all'apertura; un nome
// sconosciuto resta com'è, vale solo nel browser e il validatore lo dice.

import type { SynopticObject } from "@/types";

export interface Famiglia {
  id: string;
  css: string;
  file: { regolare: string; grassetto: string | null };
  sistema: boolean;
}

export const FONT_PREDEFINITA = "sans";

export const FAMIGLIE: readonly Famiglia[] = [
  { id: "sans", css: "SWS Sans", file: { regolare: "DejaVuSans", grassetto: "DejaVuSans-Bold" }, sistema: true },
  { id: "mono", css: "SWS Mono", file: { regolare: "DejaVuSansMono", grassetto: "DejaVuSansMono-Bold" }, sistema: true },
  { id: "serif", css: "SWS Serif", file: { regolare: "DejaVuSerif", grassetto: "DejaVuSerif-Bold" }, sistema: true },
  { id: "segmenti7", css: "SWS Segmenti 7", file: { regolare: "DSEG7Classic-Regular", grassetto: "DSEG7Classic-Bold" }, sistema: false },
  { id: "segmenti14", css: "SWS Segmenti 14", file: { regolare: "DSEG14Classic-Regular", grassetto: "DSEG14Classic-Bold" }, sistema: false },
  { id: "matrice", css: "SWS Matrice", file: { regolare: "DotGothic16-Regular", grassetto: null }, sistema: false },
];

export const ALIAS_FONT: Readonly<Record<string, string>> = {
  "system-ui": "sans",
  "sans-serif": "sans",
  "arial": "sans",
  "helvetica": "sans",
  "dejavu sans": "sans",
  "monospace": "mono",
  "courier": "mono",
  "courier new": "mono",
  "dejavu sans mono": "mono",
  "consolas": "mono",
  "serif": "serif",
  "times": "serif",
  "times new roman": "serif",
  "georgia": "serif",
  "dejavu serif": "serif",
};

/** L'id della famiglia per un `font_family` del progetto: un id, un alias o il
 *  primo nome di una pila CSS. `undefined` per un nome sconosciuto o vuoto. */
export function famigliaDi(v: string | undefined | null): string | undefined {
  if (!v || !v.trim()) return undefined;
  const primo = v.split(",")[0].trim().replace(/^['"]|['"]$/g, "").toLowerCase();
  if (FAMIGLIE.some((f) => f.id === primo)) return primo;
  return ALIAS_FONT[primo];
}

/** Il `font-family` CSS da disegnare. Un id dell'elenco diventa la sua famiglia
 *  con Sans e le emoji come riserva (le accentate che i segmenti non hanno);
 *  un nome sconosciuto passa com'è; vuoto resta vuoto (eredita). */
export function cssFamiglia(v: string | undefined | null): string | undefined {
  if (!v || !v.trim()) return undefined;
  const id = famigliaDi(v);
  const f = id ? FAMIGLIE.find((x) => x.id === id) : undefined;
  if (!f) return v;
  return f.id === FONT_PREDEFINITA ? `"SWS Sans", "SWS Emoji"` : `"${f.css}", "SWS Sans", "SWS Emoji"`;
}

/** Un nome scritto a mano che corrisponde a una famiglia diventa il suo id. Stesso
 *  array se non cambia niente (lo store lo usa per sapere se la pagina è pulita). */
export function normalizzaFontOggetti(objs: SynopticObject[]): SynopticObject[] {
  let cambiato = false;
  const out = objs.map((o) => {
    if (!o.font_family) return o;
    const id = famigliaDi(o.font_family);
    if (!id || id === o.font_family) return o;
    cambiato = true;
    return { ...o, font_family: id };
  });
  return cambiato ? out : objs;
}
