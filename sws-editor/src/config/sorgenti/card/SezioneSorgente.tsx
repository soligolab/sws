import { useState, type ReactNode } from "react";

/** Una sezione dentro la card di una sorgente: BROKER, AUTENTICAZIONE,
 *  DISPONIBILITÀ, MAPPATURA, AVANZATE (29-10-2026, piano
 *  `docs/archive/2026-10-29-card-delle-sorgenti.md`).
 *
 *  **Il titolo ha il colore del testo pieno**, non quello attenuato. Prima i
 *  titoli di sezione e le etichette dei campi avevano lo stesso identico
 *  colore (`--brand-text-subtle`): leggibili tutti e due (6,6:1), ma senza
 *  gerarchia, e la card sembrava un unico elenco di campi. Osservazione del
 *  maintainer: «i titoli delle sezioni hanno poco contrasto con i campi».
 *
 *  `apribile` fa una sezione che si chiude, con un `riepilogo` di cosa c'è
 *  dentro quando è chiusa: «connessione · TLS · last will» dice a chi legge
 *  se vale la pena aprirla. */
export function SezioneSorgente({
  titolo,
  destra,
  apribile = false,
  chiusaDiPartenza = false,
  riepilogo,
  testid,
  children,
}: {
  titolo: ReactNode;
  destra?: ReactNode;
  apribile?: boolean;
  chiusaDiPartenza?: boolean;
  riepilogo?: ReactNode;
  testid?: string;
  children?: ReactNode;
}) {
  const [aperta, setAperta] = useState(!chiusaDiPartenza);
  const mostra = !apribile || aperta;
  return (
    <div data-testid={testid}>
      <div
        role={apribile ? "button" : undefined}
        aria-expanded={apribile ? aperta : undefined}
        onClick={apribile ? () => setAperta((v) => !v) : undefined}
        style={{
          display: "flex", alignItems: "center", gap: 10,
          margin: "16px 0 10px",
          fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase",
          color: "var(--brand-text, #e2e8f0)",
          cursor: apribile ? "pointer" : undefined,
          userSelect: apribile ? "none" : undefined,
        }}
      >
        <span style={{ whiteSpace: "nowrap" }}>{apribile ? (aperta ? "▾ " : "▸ ") : ""}{titolo}</span>
        {apribile && !aperta && riepilogo && (
          <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, fontSize: 12, color: "var(--brand-text-subtle, #94a3b8)", whiteSpace: "nowrap" }}>
            {riepilogo}
          </span>
        )}
        <span aria-hidden style={{ flex: 1, height: 1, background: "var(--brand-border, #475569)", opacity: 0.6 }} />
        {destra && (
          // Lo stato o un interruttore di modo: testo normale, non maiuscolo.
          <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400, fontSize: 12 }}
            onClick={(e) => e.stopPropagation()}>
            {destra}
          </span>
        )}
      </div>
      {mostra && children}
    </div>
  );
}

/** Un sottotitolo dentro una sezione (CONNESSIONE, TLS, LAST WILL dentro
 *  AVANZATE): un gradino sotto il titolo di sezione, uno sopra le etichette. */
export function SottoTitolo({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--brand-text-2, #cbd5e1)", margin: "12px 0 6px" }}>
      {children}
    </div>
  );
}
