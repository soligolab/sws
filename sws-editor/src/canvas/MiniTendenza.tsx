// ── La mini tendenza di kpi e sparkline (09-11-2026, piano «viewer leggero» §5) ──
//
// Sostituisce `SparklineWidget`, che teneva un campione per cambio di valore e
// rifaceva tutto a ogni render. Qui i campioni finiscono in una `MiniSerie` a
// secchielli (`miniSerie.ts`): al massimo quattro punti per colonna di pixel,
// e il costo non cresce col tempo.
//
// Tre regole, tutte decise col piano:
// - **riceve solo lo stato del suo tag**, non la mappa intera, ed è `memo`:
//   un messaggio che non lo riguarda non la ridisegna;
// - **un orologio solo, quello del server**: il dato vivo usa il suo
//   `timestamp_ms`, e «adesso» è l'ora del server stimata dalla connessione
//   (`oraDelServer` in `ws/coalescenza.ts`). Prima il seme aveva il tempo del
//   server e il dato vivo quello del browser, e con due orologi diversi il
//   seme si perdeva. La stima è una sola per tutta la pagina, fatta quando i
//   valori arrivano e non dentro un effetto: lì avrebbe contato anche il
//   tempo del disegno, e una pagina lenta al montaggio rifaceva la serie due
//   volte;
// - **un orologio proprio**: la linea scorre al confine di ogni secchiello
//   anche a valore fermo. Prima scorreva solo perché altri tag facevano
//   ridisegnare la pagina.

import { memo, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { api } from "@/api/client";
import type { TagState } from "@/types";
import { epocaOrologio, oraDelServer } from "@/ws/coalescenza";
import { MiniSerie } from "./miniSerie";

/** Il margine del disegno, su tutti i lati (lo stesso di prima). */
const MARGINE = 2;

/** Sotto questo scarto d'orologio la serie non si rifà: un errore di un
 *  secondo non sposta niente di visibile, e la latenza della rete lo vale. */
const SCARTO_TOLLERATO_MS = 1000;

/** Di quanto l'orologio del server è avanti su quello del browser, secondo la
 *  connessione. */
function sfasamento(): number {
  const a = Date.now();
  return oraDelServer(a) - a;
}

export interface MiniTendenzaProps {
  tag: string;
  windowS: number;
  width: number;
  height: number;
  color: string;
  strokeWidth: number;
  fill: boolean;
  fillOpacity: number;
  showLast: boolean;
  yMin?: number;
  yMax?: number;
  /** Il corpo dell'ultimo valore (25-10-2026). */
  corpo?: number;
  /** Lo stato del suo tag, e basta. */
  valore?: TagState;
}

/** Quanto deve restare ferma la larghezza prima di rifare la serie. */
const LARGHEZZA_FERMA_MS = 300;

/** Tag, finestra o larghezza nuovi: una serie nuova, seme compreso. */
export const MiniTendenza = memo(function MiniTendenza(p: MiniTendenzaProps) {
  // Mentre l'editor ridimensiona l'oggetto la serie di prima si allarga o si
  // stringe; quella nuova, con la sua richiesta, nasce quando la larghezza si
  // ferma. Altrimenti sarebbe una richiesta e un lampo vuoto per ogni pixel.
  const colonneOra = Math.max(1, Math.floor(p.width - MARGINE * 2));
  const [colonne, setColonne] = useState(colonneOra);
  useEffect(() => {
    if (colonne === colonneOra) return;
    const id = setTimeout(() => setColonne(colonneOra), LARGHEZZA_FERMA_MS);
    return () => clearTimeout(id);
  }, [colonne, colonneOra]);
  return <Tendenza key={`${p.tag}|${p.windowS}|${colonne}`} {...p} colonne={colonne} />;
});

function Tendenza({
  tag, windowS, width, height, color, strokeWidth, fill, fillOpacity, showLast,
  yMin, yMax, corpo = 9, valore, colonne,
}: MiniTendenzaProps & { colonne: number }) {
  const finestraMs = windowS * 1000;
  const [serie, setSerie] = useState(() => new MiniSerie(finestraMs, colonne));
  const [, ridisegna] = useReducer((n: number) => n + 1, 0);
  // Si ridisegna solo se il disegno è cambiato davvero: un valore uguale nello
  // stesso secchiello non costa niente.
  const muta = (s: MiniSerie, fai: () => void) => {
    const v = s.versione;
    fai();
    if (s.versione !== v) ridisegna();
  };
  // L'orologio con cui la serie è nata. Se la stima cambia di più di un
  // secchiello e di un secondo, o l'orologio del browser salta, finestra e
  // seme sono nel posto sbagliato: la serie si rifà, col suo seme.
  const nataCon = useRef({ sfasamento: sfasamento(), epoca: epocaOrologio() });
  const adesso = () => oraDelServer();
  /** Rifà la serie se l'orologio è cambiato; vero se l'ha rifatta. */
  const rifaiSeServe = (s: MiniSerie, valoreNuovo?: TagState): boolean => {
    const nata = nataCon.current;
    const sf = sfasamento();
    const ep = epocaOrologio();
    const tolleranza = Math.max(SCARTO_TOLLERATO_MS, s.secchielloMs);
    if (ep === nata.epoca && Math.abs(sf - nata.sfasamento) <= tolleranza) return false;
    nataCon.current = { sfasamento: sf, epoca: ep };
    const nuova = new MiniSerie(finestraMs, colonne);
    nuova.avanza(adesso());
    // Con lo stesso orologio i secchielli di prima restano giusti, e la linea
    // non si svuota mentre arriva il seme. Dopo un salto no: hanno il tempo
    // dell'orologio di prima.
    if (ep === nata.epoca) nuova.ricopia(s);
    if (valoreNuovo) nuova.aggiungi(valoreNuovo.timestamp_ms, Number(valoreNuovo.value));
    setSerie(nuova);
    return true;
  };

  // Il seme, una richiesta per serie: al montaggio e quando cambiano tag,
  // finestra o larghezza (la `key` sopra), o l'orologio (sotto). Mai a
  // intervalli: in edit come in runtime, niente polling.
  useEffect(() => {
    if (!tag) return;
    let annullata = false;
    const ora = adesso();
    api.getHistoryBuckets(tag, {
      fromMs: serie.inizioFinestra(ora), toMs: ora, bucketMs: serie.secchielloMs, ancora: true,
    })
      .then((secchielli) => {
        if (annullata) return;
        muta(serie, () => {
          serie.avanza(adesso());
          serie.semina(secchielli);
        });
      })
      .catch(() => { /* storico non disponibile: si parte dal dato vivo */ });
    return () => { annullata = true; };
  }, [tag, serie]);

  // Il dato vivo, col tempo del server.
  useEffect(() => {
    if (!valore) return;
    if (rifaiSeServe(serie, valore)) return;
    muta(serie, () => {
      serie.avanza(adesso());
      serie.aggiungi(valore.timestamp_ms, Number(valore.value));
    });
  }, [valore]);

  // L'orologio proprio: al prossimo confine di secchiello la testa scorre.
  // Per una kpi di un'ora larga 144 px vuol dire ogni 25 s.
  useEffect(() => {
    let id: ReturnType<typeof setTimeout> | undefined;
    const pianifica = () => {
      const ora = adesso();
      const attesa = Math.min(serie.secchielloMs, Math.max(1, serie.prossimoConfine(ora) - ora));
      id = setTimeout(() => {
        // La serie nuova ha il suo orologio: questo si ferma qui.
        if (rifaiSeServe(serie)) return;
        muta(serie, () => serie.avanza(adesso()));
        pianifica();
      }, attesa);
    };
    pianifica();
    return () => clearTimeout(id);
  }, [serie]);

  // `versione` cresce a ogni cambio del disegno, anche quando scorre la testa.
  const versione = serie.versione;
  const d = useMemo(
    () => serie.disegno({ larghezza: width, altezza: height, margine: MARGINE, yMin, yMax }),
    [serie, versione, width, height, yMin, yMax],
  );

  const pad = MARGINE;
  if (d.punti < 2) {
    const ph = height - pad * 2;
    return (
      <div style={{ width, height, background: "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width={width} height={height}>
          <line x1={pad} y1={ph / 2 + pad} x2={width - pad} y2={ph / 2 + pad} stroke={color} strokeWidth={strokeWidth} opacity={0.3} />
          {showLast && d.ultimo !== null && (
            <text x={width - pad} y={pad + corpo + 1} textAnchor="end" fill={color} fontSize={corpo}>{d.ultimo.toFixed(1)}</text>
          )}
        </svg>
      </div>
    );
  }

  return (
    <div style={{ width, height, background: "transparent" }}>
      <svg width={width} height={height} style={{ overflow: "visible" }}>
        {fill && <path d={d.area} fill={color} fillOpacity={fillOpacity} />}
        <polyline points={d.linea} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
        {showLast && d.ultimo !== null && (
          <text x={width - pad} y={pad + corpo + 1} textAnchor="end" fill={color} fontSize={corpo}>{d.ultimo.toFixed(1)}</text>
        )}
      </svg>
    </div>
  );
}
