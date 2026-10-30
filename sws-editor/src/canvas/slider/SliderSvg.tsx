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
import { corpoSecondario } from "@/canvas/geometriaTesto";
import {
  COLORI_BANDE, COLORI_ISA, CURSORE_PILLOLA, STRISCIA_BANDE, TACCA_MAGGIORE, TACCA_MINORE, altezzaZonaTacche, aspettoStile,
  bande, centroCursore, frazioneDaPunto, frazioneDaValore, fumettoCursore, fuoriDaiLimiti, geometriaSlider, passoEffettivo,
  puntiPv, tacche, valoreDaFrazione, valoreDaTasto, type Limiti, type PosizioneValore, type StileSlider,
} from "./geometria";
import { ICONE_SLIDER } from "./icone";

/** L'area di tocco minima: anche un riquadro basso si prende col dito. */
const TOCCO_MINIMO = 44;
/** La molla (fase 6): una scrittura ogni 200 ms al massimo, 150 ms per tornare. */
const INTERVALLO_MOLLA_MS = 200;
const RITORNO_MOLLA_MS = 150;
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
  /** Fase 3: lo stile, l'icona della piastra, l'opacità della traccia vuota (0-100). */
  stile?: StileSlider;
  icona?: string;
  opacitaTraccia?: number;
  /** Fase 4: tacche nelle unità del valore, i loro numeri, l'aggancio, le bande. */
  taccaMaggiore?: number;
  taccaMinore?: number;
  numeriTacche?: boolean;
  agganciaTacche?: boolean;
  modoBande?: "sempre" | "in_allarme" | "mai";
  limiti?: Limiti;
  /** Fase 6: il ritorno a molla. Mentre si tiene scrive al massimo 5 volte al
   *  secondo; al rilascio torna qui in 150 ms e scrive questo valore una volta. */
  riposo?: number;
  /** Fase 5: l'origine del riempimento (bipolare). */
  origine?: number;
  /** Fase 5: il valore misurato. `undefined` = nessun PV; `null` = PV non numerico. */
  valorePv?: number | null;
  colorePv?: string;
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
  // Fase 6: quando è partita l'ultima scrittura della molla, e l'animazione del ritorno.
  const ultimaMolla = useRef(0);
  const ritorno = useRef<number | null>(null);
  useEffect(() => () => { if (ritorno.current !== null) cancelAnimationFrame(ritorno.current); }, []);
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
  // Fase 4: tacche e bande, mai sulla piastra. Le bande si prendono il loro
  // spazio anche quando «in allarme» non le mostra: la traccia non deve saltare.
  const piastra = p.stile === "piastra";
  const conTacche = !piastra && !!(p.taccaMaggiore || p.taccaMinore);
  const conNumeri = conTacche && (p.numeriTacche ?? !!p.taccaMaggiore);
  const listaBande = !piastra && p.modoBande && p.modoBande !== "mai" ? bande(p.min, p.max, p.limiti ?? {}) : [];
  const corpoNumeri = corpoSecondario(p.corpoValore);
  const altoTacche = altezzaZonaTacche(conTacche, conNumeri, listaBande.length > 0, corpoNumeri);
  const step = passoEffettivo(p.step, !!p.agganciaTacche && conTacche, p.taccaMaggiore, p.taccaMinore);
  const icona = p.stile === "piastra" && p.icona ? ICONE_SLIDER[p.icona] : undefined;
  const g = geometriaSlider({
    verticale: p.verticale, w: p.w, h: p.h, altoEtichetta, altoValore,
    spessore: p.spessore, posizione: p.posizioneValore, stile: p.stile, conIcona: !!icona, altoTacche,
  });
  const aspetto = aspettoStile(p.stile);
  const isa = p.stile === "isa";
  const opacitaVuota = Math.min(100, Math.max(0, p.opacitaTraccia ?? 100)) / 100;
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
  const molla = p.riposo !== undefined;
  const cambia = (v: number) => {
    if (ritorno.current !== null) { cancelAnimationFrame(ritorno.current); ritorno.current = null; }
    setBozza(v);
    if (molla) {
      // Mentre si tiene: al massimo una scrittura ogni 200 ms.
      const ora = Date.now();
      if (v !== bozza && ora - ultimaMolla.current >= INTERVALLO_MOLLA_MS && p.scrivi(v)) ultimaMolla.current = ora;
      return;
    }
    if (!p.scriviAlRilascio && v !== bozza) scrivi(v);
  };
  const concludi = (v: number | null) => {
    if (molla) {
      // Al rilascio: torna al riposo in 150 ms, e scrive il riposo una volta.
      const riposo = p.riposo!;
      const da = v ?? riposo;
      const inizio = performance.now();
      const passo = (t: number) => {
        const k = Math.min(1, (t - inizio) / RITORNO_MOLLA_MS);
        setBozza(da + (riposo - da) * k);
        if (k < 1) ritorno.current = requestAnimationFrame(passo);
        else { ritorno.current = null; setBozza(null); }
      };
      ritorno.current = requestAnimationFrame(passo);
      if (p.scrivi(riposo)) { ultimoScritto.current = riposo; setInAttesa(riposo); }
      return;
    }
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
      cambia(valoreDaFrazione(frazioneDaPunto(g, x, y), p.min, p.max, step));
    },
    fine: (annullato) => {
      setTrascina(false);
      concludi(annullato ? null : ultimaBozza.current);
    },
  });

  const tasto = (e: React.KeyboardEvent) => {
    if (!interattivo) return;
    const v = valoreDaTasto(e.key, bozza ?? mostrato, p.min, p.max, step);
    if (v === null) return;
    e.preventDefault();
    cambia(v);
  };
  const tastoSu = () => {
    if (interattivo && bozza !== null) concludi(bozza);
  };

  const testoSolo = p.valoreTag === null && bozza === null && inAttesa === null ? "—" : p.formatta(mostrato);
  // Fase 5: il PV accanto al valore, «62 % · PV 58 %».
  const testo = p.valorePv === undefined ? testoSolo : `${testoSolo} · PV ${p.valorePv === null ? "—" : p.formatta(p.valorePv)}`;
  // L'origine del riempimento: il minimo, o `origine` se è dentro l'intervallo.
  const fo = p.origine !== undefined && p.origine > p.min && p.origine < p.max ? frazioneDaValore(p.origine, p.min, p.max) : null;
  const da = fo === null ? 0 : Math.min(fo, f);
  const a = fo === null ? f : Math.max(fo, f);
  const fPv = typeof p.valorePv === "number" ? frazioneDaValore(p.valorePv, p.min, p.max) : null;
  // Abbreviato per il disegno delle bande, che lo legge due volte per banda.
  const v = p.verticale;
  const bandeVisibili = listaBande.length > 0 && (p.modoBande === "sempre" || fuoriDaiLimiti(mostrato, p.limiti ?? {}));
  const zona = g.inizioTacche;
  const inizioTacche = zona + (listaBande.length > 0 ? STRISCIA_BANDE + 1 : 0);
  const elencoTacche = conTacche ? tacche(p.min, p.max, p.taccaMaggiore, p.taccaMinore, conNumeri) : [];
  const fumetto = p.mostraValore && p.posizioneValore === "cursore" && p.stile !== "piastra" && (trascina || inAttesa !== null);
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
      <rect x={t.x} y={t.y} width={t.w} height={t.h} rx={g.raggioTraccia}
        fill={isa ? COLORI_ISA.traccia : p.coloreTraccia ?? p.colore}
        fillOpacity={(isa || p.coloreTraccia ? 1 : 0.2) * opacitaVuota}
        stroke={inAttesa !== null && aspetto.cursore === "nessuno" ? "var(--synoptic-text, var(--brand-text, #e2e8f0))" : undefined}
        strokeWidth={inAttesa !== null && aspetto.cursore === "nessuno" ? 2 : undefined}
        strokeDasharray={inAttesa !== null && aspetto.cursore === "nessuno" ? "4 3" : undefined}
        pointerEvents="none" data-slider-traccia="" />
      <rect
        x={p.verticale ? t.x : t.x + t.w * da}
        y={p.verticale ? t.y + t.h * (1 - a) : t.y}
        width={p.verticale ? t.w : t.w * (a - da)}
        height={p.verticale ? t.h * (a - da) : t.h}
        rx={g.raggioTraccia} fill={isa ? COLORI_ISA.indicatore : p.colore} pointerEvents="none" data-slider-indicatore="" />
      {fo !== null && (
        p.verticale
          ? <rect x={t.x - 3} y={t.y + t.h * (1 - fo) - 1} width={t.w + 6} height={2} fill="var(--synoptic-text, #e2e8f0)"
              fillOpacity={0.6} pointerEvents="none" data-slider-origine="" />
          : <rect x={t.x + t.w * fo - 1} y={t.y - 3} width={2} height={t.h + 6} fill="var(--synoptic-text, #e2e8f0)"
              fillOpacity={0.6} pointerEvents="none" data-slider-origine="" />
      )}
      {bandeVisibili && listaBande.map((b, k) => (
        v
          ? <rect key={`b${k}`} x={zona} y={t.y + t.h * (1 - b.a)} width={STRISCIA_BANDE} height={t.h * (b.a - b.da)}
              fill={COLORI_BANDE[b.tipo]} pointerEvents="none" data-slider-banda={b.tipo} />
          : <rect key={`b${k}`} x={t.x + t.w * b.da} y={zona} width={t.w * (b.a - b.da)} height={STRISCIA_BANDE}
              fill={COLORI_BANDE[b.tipo]} pointerEvents="none" data-slider-banda={b.tipo} />
      ))}
      {elencoTacche.map((tc, k) => {
        const lungo = tc.maggiore ? TACCA_MAGGIORE : TACCA_MINORE;
        const colore = "var(--synoptic-subtle, var(--brand-text-subtle, #64748b))";
        if (p.verticale) {
          const y = t.y + t.h * (1 - tc.f);
          return (
            <g key={`t${k}`} pointerEvents="none">
              <line x1={inizioTacche} x2={inizioTacche + lungo} y1={y} y2={y} stroke={colore} strokeWidth={1} data-slider-tacca="" />
              {tc.testo && <text x={inizioTacche + TACCA_MAGGIORE + 3} y={y} dominantBaseline="central" fontSize={corpoNumeri} fill={colore}>{tc.testo}</text>}
            </g>
          );
        }
        const x = t.x + t.w * tc.f;
        return (
          <g key={`t${k}`} pointerEvents="none">
            <line x1={x} x2={x} y1={inizioTacche} y2={inizioTacche + lungo} stroke={colore} strokeWidth={1} data-slider-tacca="" />
            {tc.testo && <text x={x} y={inizioTacche + TACCA_MAGGIORE + 1 + Math.ceil(corpoNumeri * 1.3) / 2} textAnchor="middle"
              dominantBaseline="central" fontSize={corpoNumeri} fill={colore}>{tc.testo}</text>}
          </g>
        );
      })}
      {icona && g.icona && (
        <g transform={`translate(${g.icona.cx - g.icona.lato / 2} ${g.icona.cy - g.icona.lato / 2}) scale(${g.icona.lato / 24})`}
          fill="none" stroke="var(--synoptic-text, var(--brand-text, #e2e8f0))" strokeWidth={2}
          strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" data-slider-icona=""
          dangerouslySetInnerHTML={{ __html: icona.replace(/currentColor/g, "") }} />
      )}
      {aspetto.cursore === "rettangolo" ? (
        <rect x={c.cx - g.cursore.w / 2} y={c.cy - g.cursore.h / 2} width={g.cursore.w} height={g.cursore.h} rx={2}
          fill={COLORI_ISA.cursore} stroke={inAttesa !== null ? "var(--synoptic-text, #e2e8f0)" : COLORI_ISA.bordo}
          strokeWidth={inAttesa !== null ? 2 : 1} strokeDasharray={inAttesa !== null ? "3 2" : undefined}
          pointerEvents="none" data-slider-in-attesa={inAttesa !== null ? "" : undefined} />
      ) : aspetto.cursore !== "nessuno" ? (
        <circle cx={c.cx} cy={c.cy} r={r} fill={aspetto.cursore === "dentro" ? CURSORE_PILLOLA : p.colore} pointerEvents="none"
          stroke={inAttesa !== null ? "var(--synoptic-text, var(--brand-text, #e2e8f0))" : undefined}
          strokeWidth={inAttesa !== null ? 2 : undefined}
          strokeDasharray={inAttesa !== null ? "3 2" : undefined}
          data-slider-in-attesa={inAttesa !== null ? "" : undefined} />
      ) : inAttesa !== null ? <g data-slider-in-attesa="" /> : null}
      {fPv !== null && (
        <polygon pointerEvents="none" data-slider-pv=""
          fill={p.colorePv ?? "var(--synoptic-text, var(--brand-text, #e2e8f0))"}
          points={puntiPv(g.verticale, t, fPv).map(([x, y]) => `${x},${y}`).join(" ")} />
      )}
      {/* Dopo la traccia: sulla piastra l'etichetta sta sopra il riempimento. */}
      {p.etichetta && g.etichetta && (
        <text x={g.etichetta.cx} y={g.etichetta.cy} textAnchor={g.allinea} dominantBaseline="central"
          fontSize={p.corpoEtichetta}
          fill={p.stile === "piastra" ? "var(--synoptic-text, var(--brand-text, #e2e8f0))" : "var(--brand-text-muted, #94a3b8)"} pointerEvents="none">
          {p.etichetta}
        </text>
      )}
      {p.mostraValore && g.valore && (
        <text x={g.valore.cx} y={g.valore.cy} textAnchor={g.allinea} dominantBaseline="central"
          fontSize={p.corpoValore} fontWeight={p.stile === "piastra" ? 600 : undefined} fill="var(--synoptic-text, var(--brand-text, #e2e8f0))" pointerEvents="none">
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
