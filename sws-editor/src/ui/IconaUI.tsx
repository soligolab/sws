import { ICONE_UI } from "@/ui/iconeInterfaccia";

/** Un'icona dell'interfaccia. Gemella di `editor/IconaStrumento`, e tenuta
 *  separata per la stessa ragione per cui lo sono le due tabelle: la guardia
 *  `check_icone_strumenti.sh` accoppia quelle degli strumenti alla palette.
 *
 *  `titolo` serve quando l'icona è **sola dentro un pulsante**: senza, chi usa
 *  un lettore di schermo sente «pulsante» e basta. Quando accanto c'è già del
 *  testo si lascia vuoto e l'icona resta decorativa. */
export function IconaUI({
  nome, px = 16, colore, titolo,
}: { nome: string; px?: number; colore?: string; titolo?: string }) {
  return (
    <svg
      role={titolo ? "img" : undefined}
      aria-hidden={titolo ? undefined : "true"}
      aria-label={titolo}
      width={px} height={px} viewBox="0 0 24 24"
      fill="none" stroke="currentColor"
      strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"
      style={{ color: colore, flexShrink: 0, display: "block" }}
      // Contenuto nostro, costante: nessun dato dell'utente passa di qui.
      dangerouslySetInnerHTML={{ __html: ICONE_UI[nome] ?? "" }}
    />
  );
}
