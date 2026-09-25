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
 *  `docs/archive/2026-09-24-configurazione-ad-albero-piano.md`).
 *
 *  Niente JSX e niente import: lo importano sia lo store sia `ConfigView`, e un
 *  modulo di sole dichiarazioni non può creare cicli.
 */

export type RamoConfig = "progetto" | "dati" | "sicurezza" | "istanza" | "ide";

/** Un raggruppamento **dentro** un ramo (25-09-2026). Nasce perché il ramo
 *  Istanza aveva cinque foglie piatte di cui tre parlavano tutte del
 *  dispositivo, e una — il pacchetto runtime — riguarda solo chi sviluppa SWS,
 *  non chi lo usa. */
export type SottoRamo = "device" | "sviluppatore";

export interface SchedaConfig {
  /** L'id della rotta `#config/<id>` e della chiave `config.tabs.<id>`. */
  id: string;
  ramo: RamoConfig;
  /** Il sotto-ramo dentro `ramo`, se la scheda ne sta in uno. Senza, è una
   *  foglia diretta del ramo e si disegna **dopo** i sotto-rami. */
  sottoRamo?: SottoRamo;
  /** Il glifo della foglia nell'albero della Configurazione. */
  icona: string;
  /** Una scheda che non ha un componente suo ma vive dentro un'altra: «types»
   *  sta dentro «tags», perché variabili e tipi condividono bozza, Salva e CSV
   *  (22-09-2026). Nell'albero è una foglia come le altre. */
  ospite?: string;
  /** Ha un elenco di elementi (sorgenti, faceplate, utenti…) che nell'albero
   *  diventano foglie di secondo livello (24-09-2026). */
  elementi?: boolean;
  /** La chiave con cui la scheda registra la sua bozza fra le
   *  `pendingSections` dello store: se c'è, la foglia porta il pallino
   *  «modificato» (25-09-2026). Non sempre è l'id — Protocolli registra
   *  `sources`, Python `global_scripts`. */
  sezione?: string;
  /** Visibile solo all'Admin; un non-admin che ci arriva torna a «tags». */
  soloAdmin: boolean;
  /** Ha senso solo se il runtime gira da un checkout del repo (Q51): senza,
   *  la scheda — e il sotto-ramo che la contiene — non si disegna affatto. */
  richiedeRepo?: boolean;
  /** Porta una bozza del progetto: resta montata una volta vista (`Tenuta`),
   *  così il Salva unico la trova anche a scheda cambiata. */
  portaBozza: boolean;
  /** Inizializza il suo stato da `project`: finché il progetto non è caricato
   *  non si disegna, o un Salva scriverebbe campi vuoti sopra lo YAML pieno. */
  richiedeProgetto: boolean;
}

/** In ordine di barra. */
export const SCHEDE = [
  { id: "tags",          ramo: "progetto",  icona: "🏷", soloAdmin: false, portaBozza: true,  richiedeProgetto: true, sezione: "tags"  },
  { id: "types",         ramo: "progetto",  icona: "🧬", soloAdmin: false, portaBozza: true,  richiedeProgetto: true,  ospite: "tags", sezione: "types" },
  { id: "protocols",     ramo: "progetto",  icona: "🔌", soloAdmin: false, portaBozza: true,  richiedeProgetto: true,  elementi: true, sezione: "sources" },
  { id: "alarms",        ramo: "progetto",  icona: "🔔", soloAdmin: false, portaBozza: true,  richiedeProgetto: true, sezione: "alarms"  },
  { id: "scripts",       ramo: "progetto",  icona: "🐍", soloAdmin: false, portaBozza: true,  richiedeProgetto: false, elementi: true, sezione: "global_scripts" },
  { id: "faceplates",    ramo: "progetto",  icona: "🧩", soloAdmin: false, portaBozza: true,  richiedeProgetto: false, elementi: true, sezione: "faceplates" },
  { id: "recipes",       ramo: "progetto",  icona: "📋", soloAdmin: false, portaBozza: true,  richiedeProgetto: false, elementi: true, sezione: "recipes" },
  { id: "notifications", ramo: "progetto",  icona: "✉", soloAdmin: false, portaBozza: true,  richiedeProgetto: false, sezione: "notifications" },
  { id: "languages",     ramo: "progetto",  icona: "🌐", soloAdmin: false, portaBozza: true,  richiedeProgetto: true, sezione: "languages"  },
  { id: "datastores",    ramo: "dati",      icona: "🗄", soloAdmin: true,  portaBozza: true,  richiedeProgetto: false, elementi: true, sezione: "datastores" },
  { id: "users",         ramo: "sicurezza", icona: "👤", soloAdmin: true,  portaBozza: false, richiedeProgetto: false, elementi: true },
  { id: "resources",     ramo: "istanza",   icona: "📦", soloAdmin: false, portaBozza: false, richiedeProgetto: false },
  { id: "backups",       ramo: "istanza",   icona: "💾", soloAdmin: true,  portaBozza: false, richiedeProgetto: false },
  { id: "system",        ramo: "istanza",   icona: "📊", soloAdmin: false, portaBozza: false, richiedeProgetto: false, sottoRamo: "device" },
  { id: "devices",       ramo: "istanza",   icona: "📇", soloAdmin: true,  portaBozza: false, richiedeProgetto: false, sottoRamo: "device" },
  { id: "runtime",       ramo: "istanza",   icona: "🔗", soloAdmin: true,  portaBozza: false, richiedeProgetto: false, sottoRamo: "device" },
  { id: "install",       ramo: "istanza",   icona: "⬇", soloAdmin: true,  portaBozza: false, richiedeProgetto: false, sottoRamo: "device" },
  { id: "container",     ramo: "istanza",   icona: "🧱", soloAdmin: true,  portaBozza: false, richiedeProgetto: false, sottoRamo: "device" },
  { id: "devpackage",    ramo: "istanza",   icona: "🏗", soloAdmin: true,  portaBozza: false, richiedeProgetto: false, sottoRamo: "sviluppatore", richiedeRepo: true },
  { id: "ide",           ramo: "ide",       icona: "🎛", soloAdmin: false, portaBozza: false, richiedeProgetto: false },
] as const satisfies readonly SchedaConfig[];

export type IdScheda = (typeof SCHEDE)[number]["id"];

export type AppConfigTab = IdScheda;

export const eSchedaValida = (x: string): x is AppConfigTab => SCHEDE.some((s) => s.id === x);

/** `repo` non ha un default di proposito: il 25-09-2026 il default `false` ha
 *  fatto sì che `ConfigView` non montasse la scheda di sviluppo mentre
 *  l'albero la disegnava — la foglia si apriva su un pannello vuoto. Chi
 *  chiede le schede visibili deve dire se il repo c'è. */
export const schedeVisibili = (isAdmin: boolean, repo: boolean) =>
  SCHEDE.filter((s) => (isAdmin || !s.soloAdmin) && (repo || !("richiedeRepo" in s && s.richiedeRepo)));

/** Un id sconosciuto (un valore salvato da una versione con schede diverse)
 *  ricade sulle variabili invece di lasciare il pannello vuoto. */
export const schedaDa = (id: string): SchedaConfig =>
  SCHEDE.find((s) => s.id === id) ?? SCHEDE[0];

/** I sotto-rami, nell'ordine in cui compaiono **dentro** il loro ramo. Le
 *  foglie dirette del ramo vengono dopo: Device si apre tutti i giorni,
 *  Risorse e Backup si toccano di rado (scelta del maintainer, 25-09-2026).
 *  Un sotto-ramo senza foglie visibili non si disegna, come i rami vuoti. */
export const SOTTORAMI: readonly { id: SottoRamo; ramo: RamoConfig; icona: string }[] = [
  { id: "device",       ramo: "istanza", icona: "📟" },
  { id: "sviluppatore", ramo: "istanza", icona: "🧪" },
];

/** I rami dell'albero, nell'ordine in cui compaiono. */
export const RAMI: readonly { id: RamoConfig; icona: string }[] = [
  { id: "progetto",  icona: "📁" },
  { id: "dati",      icona: "🗃" },
  { id: "sicurezza", icona: "🔐" },
  { id: "istanza",   icona: "🖥" },
  { id: "ide",       icona: "🛠" },
];
