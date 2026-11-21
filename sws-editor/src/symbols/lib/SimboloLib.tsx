// Il disegno di un simbolo di libreria sul canvas SVG, con le parti vive.
//
// Ogni strato è un `<g>` di React che ne contiene il markup: così il livello e
// la rotazione stanno sugli involucri (che React aggiorna senza ricreare il
// contenuto) e un cambio di colore del corpo riscrive solo lo strato `body`.
// È la stessa divisione che il pannello LVGL fa con un'immagine per strato.

import { useId, useMemo, type CSSProperties } from "react";
import type React from "react";
import type { SimboloLib } from "./manifest";
import { blinkKeyframes, pulseKeyframes, spinKeyframes, vibrateKeyframes } from "./keyframes";
import { levelWindow, slideOffset } from "./behaviour";
import { angoliLeva, preparaSimbolo, prefissoIstanza, stileDelDisegno, useSimboloLib, valoriParti, type SimboloPreparato, type ValoreParte } from "./libreria";
import type { ParteLegata } from "@/types";
import { stileEffettivo, useStileProgetto, type SovrascrittureSimbolo, type StileSimboliProgetto } from "@/symbols/stileProgetto";
import type { ManifestLib } from "./manifest";
import { useHrefImmagini } from "@/canvas/ImmagineSvg";

export interface ValoriParti {
  /** Colore del corpo (di stato); `null` = colore del materiale. */
  corpo: string | null;
  /** 0..1; `undefined` = livello come disegnato (pieno). */
  livello?: number;
  /** Rotori che girano, e in quanti secondi per giro. */
  gira: boolean;
  periodoS: number;
  /** Lancetta, leva, spie: vedi `valoriParti`. */
  parti?: Record<string, ValoreParte>;
  /** Transizione del livello, in ms (0 = a scatto). */
  livelloMs?: number;
  /** The timed pieces move: rotors bound per part, vibration, pulse, the
   *  blink of a signal (plan 2026-11-19-animazioni-dei-simboli). Off by
   *  default, so thumbnails stay still; the canvas turns it on outside the
   *  editor or with «Anteprima effetti». What follows a value (a slide, a
   *  level, the colour of a signal) is always shown. */
  animate?: boolean;
  /** The blink period of a signal entry, in ms (the symbol's blink). */
  blinkMs?: number;
}

/** The markup of a layer with another colour on its first line (the layer's
 *  own `fill`, which the shapes without a material take). */
function withLayerFill(markup: string, colour: string): string {
  const nl = markup.indexOf("\n");
  const head = nl < 0 ? markup : markup.slice(0, nl);
  return head.replace(/ fill="[^"]*"/, ` fill="${colour}"`) + (nl < 0 ? "" : markup.slice(nl));
}

/** Where a photo of a symbol is (plan 2026-11-21-simboli-fase-3-foto). */
export function photoUrl(name: string): string {
  return `/api/project/images/${name}`;
}

/** A line with an `<image …>`, pointing at `href` (any `href` it had taken out). */
function setHref(line: string, href: string): string {
  const i = line.indexOf("<image");
  if (i < 0) return line;
  const head = line.slice(0, i + 6);
  const rest = line.slice(i + 6).replace(/ href="[^"]*"/, "");
  return `${head} href="${href.replace(/"/g, "%22")}"${rest}`;
}

/** The markup with every `<image data-src="N">` pointing at photo N. The
 *  compiler writes one element per line; a photo not loaded yet stays without
 *  `href` and draws nothing. Twin of `con_foto` in `simbolo_lib.rs`. */
export function withPhotos(markup: string, photos: Record<string, string>): string {
  if (!markup.includes("<image")) return markup;
  return markup.split("\n").map((line) => {
    const m = /<image data-src="([^"]+)"/.exec(line);
    const href = m ? photos[m[1]] : undefined;
    return href ? setHref(line, href) : line;
  }).join("\n");
}

/** A layer whose photos all show `href` instead: a signal entry with a photo.
 *  Twin of `con_foto_al_posto` in `simbolo_lib.rs`. */
export function withPhoto(markup: string, href: string): string {
  return markup.split("\n").map((line) => (line.includes("<image ") ? setHref(line, href) : line)).join("\n");
}

export function SimboloLibSvg({ sim, svg, manifesto, prefisso, x, y, w, h, valori, dataAnim, progetto, sovrascritture }: {
  sim: SimboloLib;
  svg: string;
  manifesto: ManifestLib;
  prefisso: string;
  x: number; y: number; w: number; h: number;
  valori: ValoriParti;
  dataAnim?: boolean;
  /** Lo stile del progetto e quello dell'oggetto (Fase 4): senza, il disegno com'è. */
  progetto?: StileSimboliProgetto;
  sovrascritture?: SovrascrittureSimbolo;
}) {
  const ov = sovrascritture ?? {};
  const prep: SimboloPreparato = useMemo(
    () => preparaSimbolo(svg, prefisso, progetto || sovrascritture
      ? stileEffettivo(manifesto.materials, sim.body, progetto, ov, valori.corpo)
      : stileDelDisegno(manifesto, valori.corpo)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [svg, prefisso, manifesto, sim.body, valori.corpo, progetto, ov.symbol_body_color, ov.symbol_content_color,
      ov.symbol_volume, ov.symbol_outline_color, ov.symbol_outline_width],
  );
  // Gli oggetti `{ __html }` con la stessa identità finché il disegno non
  // cambia: React 19 confronta l'oggetto, non la stringa, e un oggetto nuovo a
  // ogni render riscriveva l'`innerHTML` di defs e strati decine di volte al
  // secondo per ogni simbolo — misurato col tutorial T08, 03-11-2026: ~1100
  // nodi rimossi al secondo per un serbatoio e una pompa, e campi dell'editor
  // che si staccavano dal DOM mentre ci si scriveva.
  // The photos (plan 2026-11-21-simboli-fase-3-foto), fetched with the
  // session like every image of the project.
  const photoUrls = useMemo(() => (sim.images ?? []).map(photoUrl), [sim.images]);
  const loaded = useHrefImmagini(photoUrls);
  const photosKey = (sim.images ?? []).map((n) => `${n}=${loaded[photoUrl(n)] ?? ""}`).join("|");
  const photos = useMemo(() => {
    const out: Record<string, string> = {};
    for (const n of sim.images ?? []) {
      const h = loaded[photoUrl(n)];
      if (h) out[n] = h;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photosKey]);
  const html = useMemo(
    () => ({ defs: { __html: prep.defs }, strati: prep.strati.map((s) => ({ __html: withPhotos(s.markup, photos) })) }),
    [prep, photos],
  );
  // A signal in another colour or photo than drawn: its layer's markup
  // rewritten, once per entry (a new `{ __html }` at every render would
  // rewrite the DOM).
  const signalLooks = sim.parts.map((p) => {
    if (p.kind !== "signal") return "";
    const v = valori.parti?.[p.id];
    const e = v && "entry" in v && v.entry !== null ? p.entries?.[v.entry] : undefined;
    const photo = e?.image ? photos[e.image] ?? "" : "";
    return `${e?.color ?? ""}\t${photo}`;
  }).join("|");
  const strati = useMemo(() => prep.strati.map((s, i) => {
    const p = sim.parts.find((x) => x.id === s.id);
    if (p?.kind !== "signal") return html.strati[i];
    const [c, photo] = signalLooks.split("|")[sim.parts.indexOf(p)].split("\t");
    if (!c && !photo) return html.strati[i];
    let markup = withPhotos(s.markup, photos);
    if (c) markup = withLayerFill(markup, c);
    if (photo) markup = withPhoto(markup, photo);
    return { __html: markup };
  }), [prep, html, sim.parts, signalLooks, photos]);
  const livello = valori.livello === undefined ? 1 : Math.max(0, Math.min(1, valori.livello));
  const idClip = (pid: string) => `${prefisso}-clip-${pid}`;
  return (
    <svg x={x} y={y} width={w} height={h} viewBox={prep.viewBox} preserveAspectRatio="xMidYMid meet"
      style={{ pointerEvents: "none" }} data-anim={dataAnim ? "1" : undefined} data-simbolo-lib={sim.id}>
      <defs dangerouslySetInnerHTML={html.defs} />
      <defs>
        {/* The glows' filters (plan 2026-11-21-simboli-fase-8-effetti): the
            halo under the shapes, over the whole drawing like the panel's
            (`svg_alone` in simbolo_lib.rs). */}
        {sim.parts.map((p) => {
          if (p.kind !== "glow") return null;
          const r = p.radius ?? 4;
          const [vw, vh] = sim.viewBox;
          return (
            <filter key={`glow-${p.id}`} id={`${prefisso}-glow-${p.id}`} filterUnits="userSpaceOnUse" x={0} y={0} width={vw} height={vh}>
              {p.color ? (
                <>
                  <feGaussianBlur in="SourceAlpha" stdDeviation={r} result="b" />
                  <feFlood floodColor={p.color} result="f" />
                  <feComposite in="f" in2="b" operator="in" result="g" />
                </>
              ) : (
                <feGaussianBlur in="SourceGraphic" stdDeviation={r} result="g" />
              )}
              <feMerge><feMergeNode in="g" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          );
        })}
      </defs>
      <defs>
        {sim.parts.map((p) => {
          if (p.kind !== "level") return null;
          // A level bound per part has its own fraction (`null` = as drawn,
          // full); otherwise the symbol's.
          const v = valori.parti?.[p.id];
          const f = v && "frazione" in v ? v.frazione ?? 1 : livello;
          const [wx, wy, ww, wh] = levelWindow(p.dir, [p.x, p.y, p.w, p.h], f);
          const ms = valori.livelloMs;
          return (
            <clipPath key={p.id} id={idClip(p.id)}>
              <rect x={wx} y={wy} width={ww} height={wh}
                style={ms ? { transition: `x ${ms}ms ease-out, y ${ms}ms ease-out, width ${ms}ms ease-out, height ${ms}ms ease-out` } : undefined} />
            </clipPath>
          );
        })}
      </defs>
      {prep.strati.map((s, i) => {
        const parte = sim.parts.find((p) => p.id === s.id);
        const v = valori.parti?.[s.id];
        const active = v && "active" in v ? v.active === true : undefined;
        // A rotor bound per part turns with its input (and only with the
        // timed effects on); otherwise with the symbol's Rotazione.
        const gira = parte?.kind === "rotor" && (active === undefined ? valori.gira : active && !!valori.animate);
        let style: CSSProperties | undefined;
        let opacita: number | undefined;
        let visibility: "hidden" | undefined;
        let anim = gira;
        if (parte?.kind === "rotor" && gira) {
          style = { transformOrigin: `${parte.cx}px ${parte.cy}px`, transformBox: "view-box",
            animation: `${spinKeyframes()} ${valori.periodoS}s linear infinite${parte.ccw ? " reverse" : ""}` };
        } else if (parte?.kind === "slide") {
          const f = v && "frazione" in v ? v.frazione ?? 0 : 0;
          const [dx, dy] = slideOffset(f, parte.dx, parte.dy);
          style = { transform: `translate(${dx}px, ${dy}px)`, transition: `transform ${parte.transition_ms ?? 300}ms linear` };
        } else if (parte?.kind === "vibrate" && active && valori.animate) {
          anim = true;
          style = { animation: `${vibrateKeyframes(parte.axis ?? "x", parte.amplitude ?? 1)} ${Math.max(200, parte.period_ms ?? 200)}ms step-end infinite` };
        } else if (parte?.kind === "pulse" && active && valori.animate) {
          anim = true;
          style = { animation: `${pulseKeyframes(parte.depth ?? 0.6)} ${Math.max(200, parte.period_ms ?? 1000)}ms linear infinite` };
        } else if (parte?.kind === "signal") {
          const e = v && "entry" in v && v.entry !== null ? parte.entries?.[v.entry] : undefined;
          if (e?.hidden) visibility = "hidden";
          else if (e?.blink && valori.animate) {
            anim = true;
            style = { animation: `${blinkKeyframes()} ${valori.blinkMs ?? 800}ms step-start infinite` };
          }
        } else if (parte?.kind === "needle" || parte?.kind === "lever") {
          let gradi = 0;
          if (parte.kind === "needle" && v && "frazione" in v && v.frazione !== null) {
            gradi = parte.a0 + (parte.a1 - parte.a0) * v.frazione;
          }
          if (parte.kind === "lever" && v && "aperta" in v && v.aperta !== null) {
            gradi = v.aperta ? parte.open : parte.closed;
          }
          if (parte.kind === "lever" && v && "posizione" in v && v.posizione !== null) {
            gradi = angoliLeva(parte)[v.posizione] ?? 0;
          }
          style = { transformOrigin: `${parte.cx}px ${parte.cy}px`, transformBox: "view-box",
            transform: `rotate(${gradi}deg)`, transition: "transform 300ms ease-out" };
        } else if (parte?.kind === "lamp" && v && "accesa" in v && v.accesa === false) {
          opacita = 0;
        }
        const glow = parte?.kind === "glow" && active === true;
        return (
          <g key={s.id} data-strato={s.id} style={style} data-anim={anim ? "1" : undefined} opacity={opacita}
            visibility={visibility} filter={glow ? `url(#${prefisso}-glow-${s.id})` : undefined}
            clipPath={parte?.kind === "level" ? `url(#${idClip(parte.id)})` : undefined}
            dangerouslySetInnerHTML={strati[i]} />
        );
      })}
    </svg>
  );
}

/** Il simbolo `lib:` di un oggetto: chiede manifesto e SVG, e finché non ci
 *  sono non disegna niente. Un id che il manifesto non conosce (progetto fatto
 *  con una versione più nuova) mostra il segnaposto, come i builtin ignoti. */
export function OggettoLib({ symbolId, objId, x, y, w, h, valori, legami, valoreTag, dataAnim, segnaposto, sovrascritture, ripiego }: {
  symbolId: string;
  objId: string;
  x: number; y: number; w: number; h: number;
  valori: ValoriParti;
  /** `symbol_parts` dell'oggetto, e come leggere un tag. */
  legami?: Record<string, ParteLegata>;
  valoreTag: (tag: string) => unknown;
  dataAnim?: boolean;
  segnaposto: React.ReactNode;
  sovrascritture?: SovrascrittureSimbolo;
  /** Per un id builtin: cosa disegnare finché il manifesto non c'è, o se nessun
   *  disegno della libreria lo sostituisce. */
  ripiego?: React.ReactNode;
}) {
  const { sim, svg, manifesto } = useSimboloLib(symbolId);
  const progetto = useStileProgetto();
  // Lo stesso oggetto si disegna più volte nella stessa pagina HTML — la
  // miniatura della pagina nell'albero e il canvas, una finestra sopra il suo
  // sinottico — e gli id dei `clipPath` e dei gradienti devono essere unici:
  // `url(#…)` prende il **primo** del documento. Col solo id dell'oggetto il
  // livello del serbatoio sul canvas seguiva il ritaglio della miniatura, e
  // restava pieno (03-11-2026, tutorial T08).
  const istanza = useId().replace(/[^A-Za-z0-9_-]/g, "");
  if (ripiego !== undefined && (!manifesto || !sim)) return <>{ripiego}</>;
  if (manifesto && !sim) return <>{segnaposto}</>;
  if (!sim || !svg || !manifesto) return null;
  const parti = valoriParti(sim.parts, legami, valoreTag);
  return (
    <SimboloLibSvg sim={sim} svg={svg} manifesto={manifesto} prefisso={`${prefissoIstanza(objId)}-${istanza}`}
      x={x} y={y} w={w} h={h} valori={{ ...valori, parti }} dataAnim={dataAnim}
      progetto={progetto} sovrascritture={sovrascritture} />
  );
}
