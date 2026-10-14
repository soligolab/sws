// Il disegno di un simbolo di libreria sul canvas SVG, con le parti vive.
//
// Ogni strato è un `<g>` di React che ne contiene il markup: così il livello e
// la rotazione stanno sugli involucri (che React aggiorna senza ricreare il
// contenuto) e un cambio di colore del corpo riscrive solo lo strato `body`.
// È la stessa divisione che il pannello LVGL fa con un'immagine per strato.

import { useMemo, type CSSProperties } from "react";
import type React from "react";
import type { SimboloLib } from "./manifest";
import { preparaSimbolo, prefissoIstanza, stileDelDisegno, useSimboloLib, valoriParti, type SimboloPreparato, type ValoreParte } from "./libreria";
import type { ParteLegata } from "@/types";
import { stileEffettivo, useStileProgetto, type SovrascrittureSimbolo, type StileSimboliProgetto } from "@/symbols/stileProgetto";
import type { ManifestLib } from "./manifest";

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
  const livello = valori.livello === undefined ? 1 : Math.max(0, Math.min(1, valori.livello));
  const idClip = (pid: string) => `${prefisso}-clip-${pid}`;
  return (
    <svg x={x} y={y} width={w} height={h} viewBox={prep.viewBox} preserveAspectRatio="xMidYMid meet"
      style={{ pointerEvents: "none" }} data-anim={dataAnim ? "1" : undefined} data-simbolo-lib={sim.id}>
      <defs dangerouslySetInnerHTML={{ __html: prep.defs }} />
      <defs>
        {sim.parts.map((p) => p.kind === "level" && (
          <clipPath key={p.id} id={idClip(p.id)}>
            <rect x={p.x} y={p.y + p.h * (1 - livello)} width={p.w} height={p.h * livello}
              style={valori.livelloMs ? { transition: `y ${valori.livelloMs}ms ease-out, height ${valori.livelloMs}ms ease-out` } : undefined} />
          </clipPath>
        ))}
      </defs>
      {prep.strati.map((s) => {
        const parte = sim.parts.find((p) => p.id === s.id);
        const gira = parte?.kind === "rotor" && valori.gira;
        const v = valori.parti?.[s.id];
        let style: CSSProperties | undefined;
        let opacita: number | undefined;
        if (parte?.kind === "rotor" && gira) {
          style = { transformOrigin: `${parte.cx}px ${parte.cy}px`, transformBox: "view-box",
            animation: `sws-spin ${valori.periodoS}s linear infinite` };
        } else if (parte?.kind === "needle" || parte?.kind === "lever") {
          let gradi = 0;
          if (parte.kind === "needle" && v && "frazione" in v && v.frazione !== null) {
            gradi = parte.a0 + (parte.a1 - parte.a0) * v.frazione;
          }
          if (parte.kind === "lever" && v && "aperta" in v && v.aperta !== null) {
            gradi = v.aperta ? parte.open : parte.closed;
          }
          style = { transformOrigin: `${parte.cx}px ${parte.cy}px`, transformBox: "view-box",
            transform: `rotate(${gradi}deg)`, transition: "transform 300ms ease-out" };
        } else if (parte?.kind === "lamp" && v && "accesa" in v && v.accesa === false) {
          opacita = 0;
        }
        return (
          <g key={s.id} data-strato={s.id} style={style} data-anim={gira ? "1" : undefined} opacity={opacita}
            clipPath={parte?.kind === "level" ? `url(#${idClip(parte.id)})` : undefined}
            dangerouslySetInnerHTML={{ __html: s.markup }} />
        );
      })}
    </svg>
  );
}

/** Il simbolo `lib:` di un oggetto: chiede manifesto e SVG, e finché non ci
 *  sono non disegna niente. Un id che il manifesto non conosce (progetto fatto
 *  con una versione più nuova) mostra il segnaposto, come i builtin ignoti. */
export function OggettoLib({ symbolId, objId, x, y, w, h, valori, legami, valoreTag, dataAnim, segnaposto, sovrascritture }: {
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
}) {
  const { sim, svg, manifesto } = useSimboloLib(symbolId);
  const progetto = useStileProgetto();
  if (manifesto && !sim) return <>{segnaposto}</>;
  if (!sim || !svg || !manifesto) return null;
  const parti = valoriParti(sim.parts, legami, valoreTag);
  return (
    <SimboloLibSvg sim={sim} svg={svg} manifesto={manifesto} prefisso={prefissoIstanza(objId)}
      x={x} y={y} w={w} h={h} valori={{ ...valori, parti }} dataAnim={dataAnim}
      progetto={progetto} sovrascritture={sovrascritture} />
  );
}
