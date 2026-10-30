/** Lo slider disegnato in SVG (revisione dello slider, fase 2, 30-10-2026 —
 *  `docs/plans/2026-10-30-revisione-slider.md`). Sostituisce l'input nativo, che
 *  accettava un colore solo e decideva da sé spessore e cursore.
 *
 *  Lo stile «classico» è quello del pannello LVGL: traccia di 16 px arrotondata,
 *  cursore tondo che sborda di 5 px, valore sotto e centrato. La geometria sta
 *  in `geometria.ts`, gemella di quella LVGL.
 *
 *  Il componente tiene lo stato del gesto — la bozza mentre si trascina, il
 *  valore in attesa dopo una scrittura — e chiama `scrivi` per scrivere: le
 *  regole di sicurezza (conferma, password) restano a `guardedWrite`. */
import { useEffect, useRef, useState } from "react";
import { useTrascinamento } from "@/canvas/puntatore";
import { altezzaValore } from "@/canvas/geometriaTesto";
import {
  centroCursore, frazioneDaPunto, frazioneDaValore, fumettoCursore, geometriaSlider, valoreDaFrazione, valoreDaTasto,
  type PosizioneValore,
} from "./geometria";

/** L'area di tocco minima: anche un riquadro basso si prende col dito. */
const TOCCO_MINIMO = 44;
/** Quanto si aspetta il tag prima di tornare al suo valore. */
const ATTESA_MS = 3000;

export interface PropsSlider {
  x: number;
  y: number;
  w: number;
  h: number;
  verticale: boolean;
  min: number;
  max: number;
  step?: number;
  /** Il valore del tag, `null` se non è un numero. */
  valoreTag: number | null;
  /** Colore dell'indicatore e del cursore. */
  colore: string;
  /** Colore della parte vuota; assente = `colore` al 20 %. */
  coloreTraccia?: string;
  spessore?: number;
  posizioneValore?: PosizioneValore;
  etichetta?: string;
  corpoEtichetta: number;
  corpoValore: number;
  mostraValore: boolean;
  formatta: (v: number) => string;
  sola: boolean;
  /** In edit: lo stesso disegno, inerte (WYSIWYG). */
  inEdit: boolean;
  scriviAlRilascio: boolean;
  deadband?: number;
  /** Scrive; vero se la scrittura è partita (falso = annullata dall'operatore). */
  scrivi: (v: number) => boolean;
  /** Per i lettori di schermo. */
  nome?: string;
}

export function SliderSvg(p: PropsSlider) {
  const [bozza, setBozza] = useState<number | null>(null);
  const [inAttesa, setInAttesa] = useState<number | null>(null);
  const [trascina, setTrascina] = useState(false);
  const [fuoco, setFuoco] = useState(false);
  const ultimoScritto = useRef<number | null>(null);
  const area = useRef<SVGRectElement | null>(null);

  // Dopo una scrittura il cursore resta dov'è finché il tag non riporta quel
  // valore, o per 3 s (fase 1).
  useEffect(() => {
    if (inAttesa === null) return;
    if (p.valoreTag !== null && Math.abs(p.valoreTag - inAttesa) <= (p.step ?? 1) / 2) {
      setInAttesa(null);
      return;
    }
    const id = setTimeout(() => setInAttesa(null), ATTESA_MS);
    return () => clearTimeout(id);
  }, [inAttesa, p.valoreTag, p.step]);

  const altoEtichetta = p.etichetta ? altezzaValore(p.corpoEtichetta) : 0;
  const altoValore = p.mostraValore ? altezzaValore(p.corpoValore) : 0;
  const g = geometriaSlider({
    verticale: p.verticale, w: p.w, h: p.h, altoEtichetta, altoValore,
    spessore: p.spessore, posizione: p.posizioneValore,
  });
  const mostrato = bozza ?? inAttesa ?? p.valoreTag ?? p.min;
  const f = frazioneDaValore(mostrato, p.min, p.max);
  const c = centroCursore(g, f);
  const t = g.traccia;
  const interattivo = !p.sola && !p.inEdit;

  const scrivi = (v: number) => {
    const u = ultimoScritto.current;
    if (p.deadband && u !== null && Math.abs(v - u) < p.deadband) return;
    if (p.scrivi(v)) {
      ultimoScritto.current = v;
      setInAttesa(v);
    }
  };
  const cambia = (v: number) => {
    setBozza(v);
    if (!p.scriviAlRilascio && v !== bozza) scrivi(v);
  };
  const concludi = (v: number | null) => {
    setBozza(null);
    if (v !== null && p.scriviAlRilascio) scrivi(v);
  };

  const ultimaBozza = useRef<number | null>(null);
  ultimaBozza.current = bozza;
  const gesto = useTrascinamento({
    riferimento: () => area.current,
    muovi: ({ x, y }) => {
      setTrascina(true);
      // Il punto è già nelle coordinate del gruppo, cioè del riquadro: l'area
      // sta dentro il `translate`.
      cambia(valoreDaFrazione(frazioneDaPunto(g, x, y), p.min, p.max, p.step));
    },
    fine: (annullato) => {
      setTrascina(false);
      concludi(annullato ? null : ultimaBozza.current);
    },
  });

  const tasto = (e: React.KeyboardEvent) => {
    if (!interattivo) return;
    const v = valoreDaTasto(e.key, bozza ?? mostrato, p.min, p.max, p.step);
    if (v === null) return;
    e.preventDefault();
    cambia(v);
  };
  const tastoSu = () => {
    if (interattivo && bozza !== null) concludi(bozza);
  };

  const testo = p.valoreTag === null && bozza === null && inAttesa === null ? "—" : p.formatta(mostrato);
  const fumetto = p.mostraValore && p.posizioneValore === "cursore" && (trascina || inAttesa !== null);
  const fb = fumetto ? fumettoCursore(g, f, altoValore) : null;
  const larghezzaFumetto = Math.max(28, testo.length * p.corpoValore * 0.62 + 10);
  const r = g.raggioCursore * (trascina ? 1.12 : 1);
  // L'area di tocco: tutto il riquadro, ma mai più sottile di 44 px.
  const toccoW = p.verticale ? Math.max(p.w, TOCCO_MINIMO) : p.w;
  const toccoH = p.verticale ? p.h : Math.max(p.h, TOCCO_MINIMO);

  return (
    <g
      transform={`translate(${p.x} ${p.y})`}
      role="slider"
      aria-label={p.nome ?? p.etichetta}
      aria-valuemin={p.min}
      aria-valuemax={p.max}
      aria-valuenow={mostrato}
      aria-valuetext={testo}
      aria-readonly={p.sola || undefined}
      aria-orientation={p.verticale ? "vertical" : "horizontal"}
      tabIndex={interattivo ? 0 : undefined}
      onKeyDown={tasto}
      onKeyUp={tastoSu}
      onFocus={() => setFuoco(true)}
      onBlur={() => { setFuoco(false); if (bozza !== null) concludi(bozza); }}
      style={{ outline: "none", pointerEvents: p.inEdit ? "none" : undefined }}
      data-slider=""
    >
      {fuoco && (
        <rect x={-2} y={-2} width={p.w + 4} height={p.h + 4} rx={6} fill="none"
          stroke="var(--brand-focus, #60a5fa)" strokeWidth={2} pointerEvents="none" />
      )}
      {p.etichetta && g.etichetta && (
        <text x={g.etichetta.cx} y={g.etichetta.cy} textAnchor="middle" dominantBaseline="central"
          fontSize={p.corpoEtichetta} fill="var(--brand-text-muted, #94a3b8)" pointerEvents="none">
          {p.etichetta}
        </text>
      )}
      <rect x={t.x} y={t.y} width={t.w} height={t.h} rx={Math.min(t.w, t.h) / 2}
        fill={p.coloreTraccia ?? p.colore} fillOpacity={p.coloreTraccia ? 1 : 0.2} pointerEvents="none" />
      <rect
        x={t.x}
        y={p.verticale ? c.cy : t.y}
        width={p.verticale ? t.w : Math.max(0, c.cx - t.x)}
        height={p.verticale ? Math.max(0, t.y + t.h - c.cy) : t.h}
        rx={Math.min(t.w, t.h) / 2} fill={p.colore} pointerEvents="none" data-slider-indicatore="" />
      <circle cx={c.cx} cy={c.cy} r={r} fill={p.colore} pointerEvents="none"
        stroke={inAttesa !== null ? "var(--synoptic-text, var(--brand-text, #e2e8f0))" : undefined}
        strokeWidth={inAttesa !== null ? 2 : undefined}
        strokeDasharray={inAttesa !== null ? "3 2" : undefined}
        data-slider-in-attesa={inAttesa !== null ? "" : undefined} />
      {p.mostraValore && g.valore && (
        <text x={g.valore.cx} y={g.valore.cy} textAnchor="middle" dominantBaseline="central"
          fontSize={p.corpoValore} fill="var(--synoptic-text, var(--brand-text, #e2e8f0))" pointerEvents="none">
          {testo}
        </text>
      )}
      {fb && (
        <g pointerEvents="none">
          <rect x={fb.cx - larghezzaFumetto / 2} y={fb.cy - altoValore / 2} width={larghezzaFumetto} height={altoValore}
            rx={4} fill="var(--brand-surface, #1e293b)" stroke={p.colore} />
          <text x={fb.cx} y={fb.cy} textAnchor="middle" dominantBaseline="central" fontSize={p.corpoValore}
            fill="var(--brand-text, #e2e8f0)">{testo}</text>
        </g>
      )}
      {interattivo && (
        <rect ref={area}
          x={(p.w - toccoW) / 2} y={(p.h - toccoH) / 2} width={toccoW} height={toccoH}
          fill="transparent" style={{ cursor: "pointer", touchAction: "none" }} data-slider-area=""
          {...gesto}
        />
      )}
    </g>
  );
}
