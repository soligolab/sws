// Il disegno di un simbolo di libreria sul canvas SVG, con le parti vive.
//
// Ogni strato è un `<g>` di React che ne contiene il markup: così il livello e
// la rotazione stanno sugli involucri (che React aggiorna senza ricreare il
// contenuto) e un cambio di colore del corpo riscrive solo lo strato `body`.
// È la stessa divisione che il pannello LVGL fa con un'immagine per strato.

import { useMemo, type CSSProperties } from "react";
import type React from "react";
import type { SimboloLib } from "./manifest";
import { preparaSimbolo, prefissoIstanza, stileDelDisegno, useSimboloLib, type SimboloPreparato } from "./libreria";
import type { ManifestLib } from "./manifest";

export interface ValoriParti {
  /** Colore del corpo (di stato); `null` = colore del materiale. */
  corpo: string | null;
  /** 0..1; `undefined` = livello come disegnato (pieno). */
  livello?: number;
  /** Rotori che girano, e in quanti secondi per giro. */
  gira: boolean;
  periodoS: number;
}

export function SimboloLibSvg({ sim, svg, manifesto, prefisso, x, y, w, h, valori, dataAnim }: {
  sim: SimboloLib;
  svg: string;
  manifesto: ManifestLib;
  prefisso: string;
  x: number; y: number; w: number; h: number;
  valori: ValoriParti;
  dataAnim?: boolean;
}) {
  const prep: SimboloPreparato = useMemo(
    () => preparaSimbolo(svg, prefisso, stileDelDisegno(manifesto, valori.corpo)),
    [svg, prefisso, manifesto, valori.corpo],
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
            <rect x={p.x} y={p.y + p.h * (1 - livello)} width={p.w} height={p.h * livello} />
          </clipPath>
        ))}
      </defs>
      {prep.strati.map((s) => {
        const parte = sim.parts.find((p) => p.id === s.id);
        const gira = parte?.kind === "rotor" && valori.gira;
        const style: CSSProperties | undefined = parte?.kind === "rotor" && gira
          ? { transformOrigin: `${parte.cx}px ${parte.cy}px`, transformBox: "view-box",
              animation: `sws-spin ${valori.periodoS}s linear infinite` }
          : undefined;
        return (
          <g key={s.id} data-strato={s.id} style={style} data-anim={gira ? "1" : undefined}
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
export function OggettoLib({ symbolId, objId, x, y, w, h, valori, dataAnim, segnaposto }: {
  symbolId: string;
  objId: string;
  x: number; y: number; w: number; h: number;
  valori: ValoriParti;
  dataAnim?: boolean;
  segnaposto: React.ReactNode;
}) {
  const { sim, svg, manifesto } = useSimboloLib(symbolId);
  if (manifesto && !sim) return <>{segnaposto}</>;
  if (!sim || !svg || !manifesto) return null;
  return (
    <SimboloLibSvg sim={sim} svg={svg} manifesto={manifesto} prefisso={prefissoIstanza(objId)}
      x={x} y={y} w={w} h={h} valori={valori} dataAnim={dataAnim} />
  );
}
