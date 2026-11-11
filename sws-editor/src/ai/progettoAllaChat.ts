// L'editor dice alla chat staccata quale progetto è aperto, ogni volta che cambia.
//
// Fino all'11-11-2026 lo diceva solo in risposta al `ciao` con cui la chat si
// presenta. Dalla rc.12 la chat sopravvive a un'uscita e a un nuovo accesso
// (`aiStream.ts`), e il giro tipico è: esci, rientri, riapri il progetto. La
// chat aveva chiesto quando il progetto non c'era, aveva sentito «nessun
// progetto», e nessuno le diceva che era tornato: restava su «No project open in
// the editor», col compositore spento, finché non la si ricaricava (collaudo
// della rc.12 sul WP630).

import type { Ponte } from "@/ai/ponte";
import { useAppStore } from "@/store";

type StatoApp = ReturnType<typeof useAppStore.getState>;

/** Il progetto aperto, per la chat. Un'uscita non svuota lo store: mette
 *  `noActiveProject` e lascia lì il progetto di prima. Guardando solo il nome,
 *  la chat restava «legata a specchio-prova» davanti all'elenco dei progetti, e
 *  riaprendo lo stesso progetto non cambiava niente da annunciare. */
export function progettoAperto(st: StatoApp): string | null {
  return st.noActiveProject ? null : st.project?.meta.name ?? null;
}

/** Manda `stato` a ognuna delle chat in `chat()` quando il progetto aperto
 *  cambia (aperto, chiuso, un altro, uscita). Un salvataggio dello stesso
 *  progetto non è un cambio. Restituisce la funzione che smette di seguire. */
export function annunciaProgettoAllaChat(
  ponte: Pick<Ponte, "manda">,
  chat: () => Iterable<string>,
): () => void {
  return useAppStore.subscribe((st, pr) => {
    const ora = progettoAperto(st);
    if (ora === progettoAperto(pr)) return;
    for (const a of chat()) ponte.manda({ t: "stato", a, progetto: ora });
  });
}
