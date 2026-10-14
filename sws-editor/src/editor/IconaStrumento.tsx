// Un'icona degli strumenti (14-10-2026): il disegno sta in `iconeStrumenti.ts`,
// la misura la sceglie chi usa l'IDE (Configurazione → IDE).
import { ICONE_STRUMENTI } from "@/editor/iconeStrumenti";

export function IconaStrumento({ tipo, px, colore }: { tipo: string; px: number; colore?: string }) {
  return (
    <svg aria-hidden="true" width={px} height={px} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"
      style={{ color: colore, flexShrink: 0, display: "block" }}
      // Contenuto nostro, costante: nessun dato dell'utente passa di qui.
      dangerouslySetInnerHTML={{ __html: ICONE_STRUMENTI[tipo] ?? "" }} />
  );
}
