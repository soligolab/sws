/** Le schede della Configurazione, dichiarate **una volta sola**.
 *
 *  ## Perché esiste
 *
 *  Fino al 24-09-2026 l'elenco delle schede era scritto in quattro posti che
 *  nessuno teneva allineati: il tipo `AppConfigTab` nello store, la sua copia
 *  letterale `ConfigTab` in `ConfigView`, le due varianti admin/non-admin di
 *  `visibleTabs` (con tre `useEffect` di rimbalzo e una condizione
 *  `projectLoading` che elencava a mano le schede «indipendenti»), e
 *  `VALID_TABS` in `App.tsx` per il deep link `#config/<tab>`. Quest'ultimo ne
 *  conteneva sette su sedici: `#config/faceplates` apriva la scheda precedente,
 *  e nessuno se n'era accorto — che è esattamente il difetto di un elenco in più.
 *
 *  Da qui derivano tutti e quattro. È anche il registro da cui l'albero della
 *  Configurazione prenderà rami e foglie (piano
 *  `docs/plans/2026-09-24-configurazione-ad-albero-piano.md`).
 *
 *  Niente JSX e niente import: lo importano sia lo store sia `ConfigView`, e un
 *  modulo di sole dichiarazioni non può creare cicli.
 */

export type RamoConfig = "progetto" | "dati" | "sicurezza" | "istanza" | "ide";

export interface SchedaConfig {
  /** L'id della rotta `#config/<id>` e della chiave `config.tabs.<id>`. */
  id: string;
  ramo: RamoConfig;
  /** Visibile solo all'Admin; un non-admin che ci arriva torna a «tags». */
  soloAdmin: boolean;
  /** Porta una bozza del progetto: resta montata una volta vista (`Tenuta`),
   *  così il Salva unico la trova anche a scheda cambiata. */
  portaBozza: boolean;
  /** Inizializza il suo stato da `project`: finché il progetto non è caricato
   *  non si disegna, o un Salva scriverebbe campi vuoti sopra lo YAML pieno. */
  richiedeProgetto: boolean;
}

/** In ordine di barra. */
export const SCHEDE = [
  { id: "tags",          ramo: "progetto",  soloAdmin: false, portaBozza: true,  richiedeProgetto: true  },
  { id: "protocols",     ramo: "progetto",  soloAdmin: false, portaBozza: true,  richiedeProgetto: true  },
  { id: "alarms",        ramo: "progetto",  soloAdmin: false, portaBozza: true,  richiedeProgetto: true  },
  { id: "scripts",       ramo: "progetto",  soloAdmin: false, portaBozza: true,  richiedeProgetto: false },
  { id: "faceplates",    ramo: "progetto",  soloAdmin: false, portaBozza: true,  richiedeProgetto: false },
  { id: "recipes",       ramo: "progetto",  soloAdmin: false, portaBozza: true,  richiedeProgetto: false },
  { id: "notifications", ramo: "progetto",  soloAdmin: false, portaBozza: true,  richiedeProgetto: false },
  { id: "languages",     ramo: "progetto",  soloAdmin: false, portaBozza: true,  richiedeProgetto: true  },
  { id: "datastores",    ramo: "dati",      soloAdmin: true,  portaBozza: true,  richiedeProgetto: false },
  { id: "users",         ramo: "sicurezza", soloAdmin: true,  portaBozza: false, richiedeProgetto: false },
  { id: "resources",     ramo: "istanza",   soloAdmin: false, portaBozza: false, richiedeProgetto: false },
  { id: "backups",       ramo: "istanza",   soloAdmin: true,  portaBozza: false, richiedeProgetto: false },
  { id: "system",        ramo: "istanza",   soloAdmin: false, portaBozza: false, richiedeProgetto: false },
  { id: "devices",       ramo: "istanza",   soloAdmin: true,  portaBozza: false, richiedeProgetto: false },
  { id: "runtime",       ramo: "istanza",   soloAdmin: true,  portaBozza: false, richiedeProgetto: false },
  { id: "ide",           ramo: "ide",       soloAdmin: false, portaBozza: false, richiedeProgetto: false },
] as const satisfies readonly SchedaConfig[];

export type IdScheda = (typeof SCHEDE)[number]["id"];

/** «types» non è più una scheda: i tipi vivono dentro «tags», in una
 *  sottoscheda (22-09-2026). Resta accettato perché un vecchio valore salvato
 *  in `localStorage`, o un link, non deve lasciare il pannello vuoto. */
export type AppConfigTab = IdScheda | "types";

export const normalizzaScheda = (x: AppConfigTab): IdScheda => (x === "types" ? "tags" : x);

export const eSchedaValida = (x: string): x is AppConfigTab =>
  x === "types" || SCHEDE.some((s) => s.id === x);

export const schedeVisibili = (isAdmin: boolean) =>
  SCHEDE.filter((s) => isAdmin || !s.soloAdmin);

export const schedaDa = (id: IdScheda) => SCHEDE.find((s) => s.id === id)!;
