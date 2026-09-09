// Nessuna password nel browser.
//
// Fino al 2026-09-09 l'IDE salvava in `localStorage`, in chiaro, tre famiglie di
// password: quella del runtime remoto (`sws.runtime.targetPass`), quelle dei
// dispositivi registrati (`sws.saved-devices`, campo `pass`) e quelle SSH del
// modale «Installa runtime» (`sws.deploy.<host>`). Comodo — non le si riscriveva
// — ma `localStorage` è leggibile da qualunque script della stessa origine, resta
// su disco dopo la chiusura del browser e finisce nei backup del profilo.
// Q48 ha tolto la terza famiglia; questa sessione toglie le altre due.
//
// La regola, da qui in avanti: una password vive nello stato del componente
// (o in una mappa in memoria per la durata della pagina) e sparisce al reload.
// Chi ne ha bisogno la richiede. La guardia `scripts/check_password_browser.sh`
// fallisce se ricompare un `localStorage.setItem` con una password.
//
// Questa funzione fa pulizia di ciò che le versioni precedenti hanno lasciato
// nel profilo: senza, un utente che aggiorna l'IDE terrebbe le vecchie password
// su disco per sempre, e la promessa sopra sarebbe vera solo per chi parte da
// zero.

const CHIAVE_PASSWORD_RUNTIME = "sws.runtime.targetPass";
const CHIAVE_DISPOSITIVI = "sws.saved-devices";
const PREFISSO_DEPLOY = "sws.deploy.";

/** Toglie dal `localStorage` le password lasciate dalle versioni precedenti.
 *  Idempotente: alla seconda chiamata non trova niente. Ritorna quante voci ha
 *  toccato, per il test e per il log. */
export function dimenticaPasswordLegacy(storage: Storage = localStorage): number {
  let toccate = 0;
  try {
    if (storage.getItem(CHIAVE_PASSWORD_RUNTIME) !== null) {
      storage.removeItem(CHIAVE_PASSWORD_RUNTIME);
      toccate += 1;
    }
    // I dispositivi restano: si toglie solo il campo `pass` da ciascuno.
    const grezzo = storage.getItem(CHIAVE_DISPOSITIVI);
    if (grezzo !== null) {
      try {
        const lista = JSON.parse(grezzo);
        if (Array.isArray(lista) && lista.some((d) => d && typeof d === "object" && "pass" in d)) {
          const pulita = lista.map((d) => {
            if (!d || typeof d !== "object") return d;
            const { pass: _pass, ...resto } = d as Record<string, unknown>;
            return resto;
          });
          storage.setItem(CHIAVE_DISPOSITIVI, JSON.stringify(pulita));
          toccate += 1;
        }
      } catch { /* non era JSON: non è nostro, non si tocca */ }
    }
    // Le chiavi si raccolgono prima di rimuoverle: cancellare mentre si itera
    // per indice salta una voce ogni due.
    const daTogliere: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(PREFISSO_DEPLOY)) daTogliere.push(k);
    }
    for (const k of daTogliere) storage.removeItem(k);
    toccate += daTogliere.length;
  } catch { /* storage non disponibile (modalità privata, iframe): niente da pulire */ }
  return toccate;
}
