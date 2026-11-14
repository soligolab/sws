// La barra di attività (31-10-2026, piano docs/archive/2026-10-31-ide-stile-vscode.md):
// la colonna di icone della disposizione «Stile VS Code», la stessa per i due
// lati. Ogni icona apre la sua colonna; un clic sull'icona attiva la chiude e
// il canvas si allarga, come in VS Code. Al passaggio del mouse, o col fuoco
// da tastiera, un riquadro accanto dice cosa c'è dietro: un `title` arriva
// tardi e col tocco non si vede.
import { useRef, useState } from "react";
import { useAppStore } from "@/store";
import { ICONE_ATTIVITA, varAttivita } from "./iconeAttivita";

export interface VoceAttivita {
  id: string;
  /** La chiave in `ICONE_ATTIVITA` e in `COLORI_ATTIVITA`; di solito `id`. */
  icona?: string;
  titolo: string;
  spiegazione: string;
  /** Le voci con lo stesso gruppo stanno insieme; fra due gruppi c'è una riga. */
  gruppo?: string;
  /** In fondo alla barra, come impostazioni e account in VS Code. */
  inFondo?: boolean;
}

/** Larghezza della barra, in px: il doppio dell'icona. Le icone seguono la
 *  «Dimensione icone» delle preferenze (16–28 px, predefinita 24 → barra da 48):
 *  prima erano fisse a 24, e su un monitor touch o ad alta risoluzione non
 *  crescevano (collaudo della 2.25.1, 05-11-2026). */
export const larghezzaBarra = (icona: number) => icona * 2;
/** Altezza di una voce: l'icona più il margine (44 con l'icona da 24). */
const altezzaVoce = (icona: number) => icona + 20;
/** Quanto aspetta il pop-up col mouse: passando sopra la barra non lampeggia. */
const ATTESA_POPUP_MS = 250;

export function BarraAttivita({ voci, attiva, aperta, lato, onScegli, etichetta }: {
  voci: VoceAttivita[];
  /** La voce scelta; resta evidenziata anche a colonna chiusa. */
  attiva: string | null;
  /** La colonna è aperta. */
  aperta: boolean;
  lato: "left" | "right";
  /** Un clic su `id`: chi tiene lo stato decide se aprire, cambiare o chiudere. */
  onScegli: (id: string) => void;
  etichetta: string;
}) {
  const icona = useAppStore((s) => s.misuraIcone);
  const larghezza = larghezzaBarra(icona);
  const [popup, setPopup] = useState<{ voce: VoceAttivita; y: number; x: number } | null>(null);
  const attesa = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bottoni = useRef<(HTMLButtonElement | null)[]>([]);

  const mostra = (voce: VoceAttivita, el: HTMLElement, subito: boolean) => {
    if (attesa.current) clearTimeout(attesa.current);
    const r = el.getBoundingClientRect();
    // A destra la distanza si misura dal bordo destro della finestra: con
    // `left` vicino al bordo il riquadro si stringeva a una parola per riga.
    const posa = () => setPopup({ voce, y: r.top + r.height / 2, x: lato === "left" ? r.right + 6 : window.innerWidth - r.left + 6 });
    if (subito) posa(); else attesa.current = setTimeout(posa, ATTESA_POPUP_MS);
  };
  const nascondi = () => {
    if (attesa.current) clearTimeout(attesa.current);
    attesa.current = null;
    setPopup(null);
  };

  const tasto = (e: React.KeyboardEvent, i: number) => {
    const n = e.key === "ArrowDown" ? i + 1 : e.key === "ArrowUp" ? i - 1 : null;
    if (n === null) return;
    e.preventDefault();
    bottoni.current[(n + voci.length) % voci.length]?.focus();
  };

  return (
    <nav aria-label={etichetta} data-barra-attivita={lato}
      style={{
        width: larghezza, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center",
        gap: 2, paddingTop: 6, background: "var(--brand-bg, #0f172a)",
        [lato === "left" ? "borderRight" : "borderLeft"]: "1px solid var(--brand-surface-2, #334155)",
      }}>
      <div role="tablist" aria-orientation="vertical" aria-label={etichetta}
        style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, paddingBottom: 6 }}>
        {voci.map((v, i) => {
          const scelta = v.id === attiva;
          const chiave = v.icona ?? v.id;
          const prima = voci[i - 1];
          // In fondo: uno spazio che spinge giù il resto. Altrimenti, al cambio
          // di gruppo, una riga sottile.
          const stacco = v.inFondo && !prima?.inFondo
            ? <div key={`spazio-${v.id}`} aria-hidden="true" style={{ flex: 1 }} />
            : prima && v.gruppo !== prima.gruppo
              ? <div key={`riga-${v.id}`} aria-hidden="true" data-separatore
                  style={{ height: 1, margin: "4px 10px", background: "var(--brand-surface-2, #334155)" }} />
              : null;
          return [stacco,
            <button key={v.id} type="button" role="tab" ref={(el) => { bottoni.current[i] = el; }}
              data-testid={`attivita-${v.id}`}
              aria-selected={scelta && aperta} aria-label={v.titolo}
              tabIndex={scelta || (attiva === null && i === 0) ? 0 : -1}
              onClick={() => { nascondi(); onScegli(v.id); }}
              onKeyDown={(e) => tasto(e, i)}
              onMouseEnter={(e) => mostra(v, e.currentTarget, false)}
              onMouseLeave={nascondi}
              onFocus={(e) => mostra(v, e.currentTarget, true)}
              onBlur={nascondi}
              style={{
                position: "relative", width: larghezza, height: altezzaVoce(icona), display: "flex", alignItems: "center",
                justifyContent: "center", background: "transparent", border: "none", cursor: "pointer", padding: 0,
                // Sober style: the active item takes the accent (`--sws-att-attiva`, unset otherwise).
                color: scelta && aperta
                  ? `var(--sws-att-attiva, var(${varAttivita(chiave)}, var(--brand-text, #e2e8f0)))`
                  : `var(${varAttivita(chiave)}, var(--brand-text, #e2e8f0))`,
                opacity: scelta && aperta ? 1 : 0.7,
              }}>
              {scelta && aperta && (
                <span aria-hidden="true" style={{
                  position: "absolute", top: 6, bottom: 6, width: 2, borderRadius: 1, background: "currentColor",
                  [lato === "left" ? "left" : "right"]: 0,
                }} />
              )}
              {/* `pointerEvents: none`: il bersaglio del clic è sempre il bottone.
                  Senza, il `mousedown` cadeva su un <path>, il fuoco faceva
                  comparire il pop-up, il ridisegno rimetteva il contenuto
                  dell'SVG, e il `mouseup` finiva su un elemento nuovo: il
                  browser non genera il click. Il primo clic andava perso
                  (visto dal vivo il 31-10-2026; `fireEvent` non lo vede). */}
              <svg aria-hidden="true" width={icona} height={icona} viewBox="0 0 24 24" fill="none" stroke="currentColor"
                style={{ pointerEvents: "none" }}
                strokeWidth={scelta && aperta ? 2 : 1.75} strokeLinecap="round" strokeLinejoin="round"
                // Contenuto nostro, costante: nessun dato dell'utente passa di qui.
                dangerouslySetInnerHTML={{ __html: ICONE_ATTIVITA[chiave] ?? "" }} />
            </button>,
          ];
        })}
      </div>
      {popup && (
        <div role="tooltip" data-testid="attivita-popup"
          style={{
            position: "fixed", top: popup.y, [lato === "left" ? "left" : "right"]: popup.x, zIndex: 1000, pointerEvents: "none",
            transform: "translateY(-50%)", width: "max-content",
            maxWidth: 260, padding: "6px 10px", borderRadius: 5,
            background: "var(--brand-surface-2, #334155)", color: "var(--brand-text, #e2e8f0)",
            border: "1px solid var(--brand-border, #475569)", boxShadow: "var(--brand-ombra-card)",
          }}>
          <div style={{ fontSize: 12, fontWeight: 600 }}>{popup.voce.titolo}</div>
          <div style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", marginTop: 2, lineHeight: 1.4 }}>
            {popup.voce.spiegazione}
          </div>
        </div>
      )}
    </nav>
  );
}

/** Lo stato di una barra: la voce scelta e se la colonna è aperta, ricordati
 *  in `chiave`. Un clic sull'attiva aperta chiude; su un'altra apre quella. */
export function useAttivita(chiave: string, predefinita: string) {
  const leggi = (): { voce: string; aperta: boolean } => {
    try {
      const v = JSON.parse(localStorage.getItem(chiave) ?? "null") as { voce?: unknown; aperta?: unknown } | null;
      if (v && typeof v.voce === "string") return { voce: v.voce, aperta: v.aperta !== false };
    } catch { /* storage non disponibile o valore vecchio */ }
    return { voce: predefinita, aperta: true };
  };
  const [stato, setStato] = useState(leggi);
  const scegli = (id: string) => {
    const nuovo = id === stato.voce ? { voce: id, aperta: !stato.aperta } : { voce: id, aperta: true };
    setStato(nuovo);
    try { localStorage.setItem(chiave, JSON.stringify(nuovo)); } catch { /* storage non disponibile */ }
  };
  return { ...stato, scegli };
}
