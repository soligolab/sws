/** Il nome del pannello collegato, per chi deve **scriverlo** (28-10-2026).
 *
 *  Due posti lo chiedono, e per la stessa ragione: le scoperte le esegue il
 *  pannello (`config/sorgenti/EseguitoDa.tsx`), e il deploy ci manda il
 *  progetto (la barra in alto). In mezzo c'è un'ora persa a cercare un difetto
 *  che non c'era, perché l'IDE era collegato a un pannello e il maintainer ne
 *  guardava un altro.
 *
 *  Sta in un modulo suo, senza React intorno e senza componenti, perché la
 *  barra e un modale di configurazione non si devono importare a vicenda. */
import { useAppStore } from "@/store";
import { etichettaDispositivo } from "@/ws/remoteLogStream";

/** Il nome del pannello collegato, o `null` se non ce n'è uno. */
export function usaPannelloCollegato(): string | null {
  const remoteConnected = useAppStore((s) => s.remoteConnected);
  const remoteUrl = useAppStore((s) => s.remoteUrl);
  if (!remoteConnected) return null;
  // Senza l'elenco dei dispositivi registrati il nome lo dà l'URL, che nel
  // cloud è `…/dev/<pannello>`: è lo stesso che fa la pagina Prestazioni.
  return etichettaDispositivo(remoteUrl, []);
}
