// Quando il testo che digiti diventa una voce della tabella lingue, e con che
// nome (Fase 3 del piano multilingua, 15-09-2026).
//
// La decisione del maintainer: **la chiave è un id opaco** (`t0001`) e il testo
// digitato diventa il valore nella lingua principale. La tabella si legge dalla
// colonna, non dalla chiave.
//
// Il motivo è un difetto vero che si vede oggi nei template: con le chiavi
// ricavate dal testo, `casa-locale` ha davvero una chiave che si chiama
// `aggiornare_shelly_id_in_project_yaml_con`. E soprattutto: appena cambi il
// testo, una chiave-che-descrive-il-testo comincia a mentire, e nessuno la
// rinomina mai perché rinominarla vuol dire cercarla in tutti i sinottici.
//
// Qui non c'è niente di React: sono decisioni pure, provate in
// `tests/chiaviAutomatiche.test.ts`.

import type { LangEntry, LanguageTable } from "@/types";

/** Un segnaposto di formato: `{value}`, `{value:.1f}`, `{tag}`… Non è testo da
 *  tradurre, ed è la cosa che rompe un pannello se la si tocca (Q43, punto 3). */
const SEGNAPOSTO = /\{[a-z_]+(?::[^}]*)?\}/gi;
/** Un riferimento alla tabella lingue già scritto: `{{chiave}}`. */
const TOKEN_INTERO = /^\s*\{\{\s*[^}\s]+\s*\}\}\s*$/;

export type Decisione =
  /** Il testo non va nella tabella: vuoto, già un token, solo un segnaposto,
   *  o un numero. Il campo si scrive tale e quale. */
  | { azione: "lascia" }
  /** Esiste già una voce con questo stesso testo nella lingua principale. Si
   *  **propone** — non si impone: due «Avvio» identici in italiano possono
   *  diventare parole diverse in tedesco a seconda di cosa avviano. */
  | { azione: "proponi-riuso"; key: string; usiEsistenti: number }
  /** Voce nuova. */
  | { azione: "crea"; key: string }
  /** Il campo **aveva già** una voce sua, e quella voce non la usa nessun
   *  altro: si aggiorna il testo lì dentro invece di coniare una chiave nuova.
   *
   *  È il difetto trovato dal maintainer il 17-09-2026: aprendo un progetto da
   *  `homeassistant-pro` e cambiando «TAPPARELLE» in «TAPPARELLE 🌀», il campo
   *  smetteva di puntare a `t0043` — tradotta in tre lingue — e puntava a una
   *  `t0173` nuova e vuota. Le traduzioni non erano andate perse: erano
   *  rimaste attaccate a una chiave che non guardava più nessuno. */
  | { azione: "aggiorna"; key: string }
  /** Il campo aveva già una voce sua, ma quella voce è usata **anche altrove**:
   *  cambiarla cambierebbe pure gli altri punti, e non è detto che sia ciò che
   *  l'autore vuole. Si chiede. */
  | { azione: "proponi-scissione"; key: string; altriUsi: number; nuova: string };

/** La prossima chiave libera, nella forma `tNNNN`.
 *
 *  Scandisce le chiavi esistenti invece di contare le voci: una tabella da cui
 *  qualcuno ha cancellato righe riuserebbe una chiave ancora citata nei
 *  sinottici, e quel sinottico comincerebbe a mostrare un testo che non è il
 *  suo — un difetto che si vede mesi dopo e non si spiega. */
export function prossimaChiave(tabella?: LanguageTable | null): string {
  const usate = new Set((tabella?.entries ?? []).map((e) => e.key));
  for (let n = 1; n < 100000; n++) {
    const k = `t${String(n).padStart(4, "0")}`;
    if (!usate.has(k)) return k;
  }
  // Centomila stringhe in un progetto non è un caso da gestire: è un caso da
  // dichiarare. Meglio un nome improbabile che una chiave duplicata.
  return `t${Date.now()}`;
}

/** Quante volte una chiave è già usata, contando le occorrenze `{{chiave}}`
 *  nel testo passato (di norma il YAML dei sinottici serializzato). Serve a
 *  dire *dove* si riuserebbe, invece di chiedere al buio. */
export function contaUsi(key: string, dove: string): number {
  return dove.split(`{{${key}}}`).length - 1;
}

/** Il testo è qualcosa che ha senso tradurre? */
function traducibile(testo: string): boolean {
  const t = testo.trim();
  if (!t) return false;
  // Già un riferimento alla tabella: rifarlo creerebbe `{{t0002}}` con dentro
  // `{{t0001}}`. L'idempotenza qui non è un vezzo — il campo viene riscritto a
  // ogni battuta di tasto.
  if (TOKEN_INTERO.test(t)) return false;
  // Un numero non si traduce. Né un numero con unità: quello sì (`10 bar` in
  // una lingua che scrive l'unità prima cambia ordine), quindi si guarda solo
  // il caso del numero nudo.
  if (/^[-+]?[\d.,\s]+$/.test(t)) return false;
  // Solo segnaposto, senza una parola attorno: non c'è niente da tradurre.
  if (!t.replace(SEGNAPOSTO, "").trim()) return false;
  return true;
}

/** Cosa fare del testo appena digitato in un campo visibile all'operatore.
 *
 *  `linguaPrincipale` è `tabella.default`: il confronto per il riuso si fa
 *  **su quella colonna**, perché è l'unica in cui l'autore scrive davvero. */
export function decidiChiave(
  testo: string,
  tabella?: LanguageTable | null,
  usiDi?: (key: string) => number,
  /** La chiave che il campo contiene **adesso**, se ne contiene una. Senza
   *  questa, modificare un testo già tradotto non si distingue dallo scriverne
   *  uno nuovo, e l'unico esito possibile è coniare una chiave. */
  chiaveCorrente?: string | null,
): Decisione {
  if (!traducibile(testo)) return { azione: "lascia" };
  const principale = tabella?.default ?? "";
  const atteso = testo.trim();
  const gemella = (tabella?.entries ?? []).find(
    (e) => (e.values[principale] ?? "").trim() === atteso,
  );
  if (gemella && gemella.key !== chiaveCorrente) {
    return {
      azione: "proponi-riuso",
      key: gemella.key,
      usiEsistenti: usiDi ? usiDi(gemella.key) : 0,
    };
  }
  if (chiaveCorrente && (tabella?.entries ?? []).some((e) => e.key === chiaveCorrente)) {
    // Un uso è questo campo stesso: «altrove» vuol dire dal secondo in poi.
    const altriUsi = Math.max(0, (usiDi ? usiDi(chiaveCorrente) : 1) - 1);
    return altriUsi === 0
      ? { azione: "aggiorna", key: chiaveCorrente }
      : { azione: "proponi-scissione", key: chiaveCorrente, altriUsi, nuova: prossimaChiave(tabella) };
  }
  return { azione: "crea", key: prossimaChiave(tabella) };
}

/** La chiave dentro un valore di campo, se quel valore è **solo** un token.
 *  `"{{t0043}}"` → `"t0043"`; `"Ciao {{t1}}"` → `null`, perché lì il token è un
 *  pezzo di una frase e non l'identità del campo. */
export function chiaveDi(valore: string | undefined): string | null {
  const m = (valore ?? "").trim().match(/^\{\{\s*([^}\s]+)\s*\}\}$/);
  return m ? m[1] : null;
}

/** Il testo da mostrare nel pannello proprietà per un campo che può contenere
 *  un token: l'autore deve vedere e scrivere **il testo**, non `{{t0001}}`.
 *
 *  Un token sconosciuto resta visibile com'è, graffe comprese: nasconderlo
 *  dietro una stringa vuota farebbe sparire il problema dagli occhi di chi
 *  potrebbe risolverlo. */
export function testoSorgente(valore: string | undefined, tabella?: LanguageTable | null): string {
  if (!valore) return "";
  const m = valore.trim().match(/^\{\{\s*([^}\s]+)\s*\}\}$/);
  if (!m) return valore;
  const entry = (tabella?.entries ?? []).find((e) => e.key === m[1]);
  if (!entry) return valore;
  return entry.values[tabella?.default ?? ""] ?? valore;
}

/** La tabella aggiornata dopo che l'autore ha scritto `testo` sotto `key`.
 *  Non tocca le altre lingue: chi crea una voce nuova non ha traduzioni da
 *  perdere, e chi ne riusa una sta dicendo che il testo è lo stesso.
 *
 *  Per il caso in cui il testo **sorgente cambia** su una voce già tradotta
 *  c'è `conSorgenteCambiata`: lì le altre lingue non si possono lasciare come
 *  sono, perché tradurrebbero una frase che non esiste più. */
export function conTesto(
  tabella: LanguageTable | null | undefined,
  key: string,
  testo: string,
): LanguageTable {
  const base: LanguageTable = tabella
    ? { ...tabella, entries: [...tabella.entries] }
    : { default: "it", langs: ["it"], entries: [] };
  if (!base.default) base.default = base.langs[0] ?? "it";
  if (!base.langs.includes(base.default)) base.langs = [...base.langs, base.default];
  const i = base.entries.findIndex((e) => e.key === key);
  const voce: LangEntry =
    i >= 0
      ? { ...base.entries[i], values: { ...base.entries[i].values, [base.default]: testo } }
      : { key, values: { [base.default]: testo } };
  if (i >= 0) base.entries[i] = voce;
  else base.entries.push(voce);
  return base;
}

/** Il testo sorgente di una voce **già tradotta** è cambiato.
 *
 *  Le traduzioni nelle altre lingue non si buttano e non si tengono per buone:
 *  diventano **proposte**, cioè la cella rossa «da approvare» che la scheda
 *  Lingue sa già mostrare. Il motivo è che una traduzione è la traduzione di
 *  *quel* testo: se il testo cambia, nessuno ha più verificato niente —
 *  «TAPPARELLE 🌀» con «ROLLER SHUTTERS» accanto non è sbagliato, ma non è
 *  nemmeno vero, e a dirlo dev'essere una persona.
 *
 *  Approvare è un clic per cella, ed è un clic che sa cosa sta approvando;
 *  perdere le traduzioni, o tenerle senza dire niente, non lo è. */
export function conSorgenteCambiata(
  tabella: LanguageTable | null | undefined,
  key: string,
  testo: string,
): LanguageTable {
  const base = conTesto(tabella, key, testo);
  const i = base.entries.findIndex((e) => e.key === key);
  if (i < 0) return base;
  const voce = base.entries[i];
  const proposte = { ...(voce.proposte ?? {}) };
  const values: Record<string, string> = { [base.default]: testo };
  for (const [lang, v] of Object.entries(voce.values)) {
    if (lang === base.default || !v) continue;
    proposte[lang] = v;
  }
  base.entries[i] = {
    ...voce,
    values,
    // Le lingue tornate proposte non sono più «riempite dalla macchina»:
    // lasciarle in `auto` farebbe credere a «ritraduci tutto» di poterle rifare
    // quando invece aspettano una persona.
    auto: (voce.auto ?? []).filter((l) => !(l in proposte)),
    proposte,
  };
  return base;
}
