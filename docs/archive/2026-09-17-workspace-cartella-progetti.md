# Dove vivono i progetti: workspace, e `start_editor.sh` che è produzione

> **Stato: PARTE 1 FATTA (18-09-2026), PARTE 2 in attesa di decisione.**
>
> Il punto 1 — `start_editor.sh` è produzione — è realizzato: lo script non impone più una radice
> dentro il checkout, passa `--projects-root` solo se `SWS_PROJECTS_ROOT` c'è, stampa la radice e
> **da dove viene**, e `start_editor_develop.sh` fa la corsa di sviluppo con una variabile e un
> `exec`. Resta il punto 2, il workspace, che vuole D1-D4.
>
> **Stato originale: SEME DI PIANO, da riprendere a freddo.** Scritto il 17-09-2026 su richiesta del
> maintainer, che riprende da casa. Contiene: cosa ha detto lui, cosa c'è già nel codice
> (misurato oggi, non ricordato), le contraddizioni da sciogliere e le domande da decidere
> **prima** di scrivere una riga. Non è ancora un piano di implementazione.
>
> Scheda collegata: **Q59** in `docs/OPEN_QUESTIONS.md`.

## Quello che ha detto il maintainer (17-09-2026, testuale)

> «start_editor.sh io l'ho sempre inteso come run di produzione (come fossi il cliente), se serve
> duplichiamolo in start_editor_develop.sh per sviluppare.
>
> Poi alla prima apertura del progetto serve definire dove salvare i progetti come fanno molti
> ambienti che definiscono il workspace (e spesso possono avere più workspace in base al
> progetto)»

E prima, che è ciò che ha fatto emergere tutto:

> «Creando un progetto mi presenta "Scegli una cartella /home/ut1/sws/.run-editor/projects".
> Mi pareva avessimo definito di usare una path esterna a sws e configurabile.»

## Due cose distinte, e conviene tenerle distinte

1. **Uno script di produzione non deve comportarsi da script di sviluppo.** È un equivoco, non
   una funzione mancante, e si chiude in mezz'ora.
2. **Il concetto di workspace non esiste** e va progettato. È la parte vera.

---

## 1. `start_editor.sh` è produzione

### Il fatto

`scripts/start_editor.sh:53` e `scripts/start_runtime.sh:60` fanno, tutti e due:

```sh
PROJECTS_ROOT="${SWS_PROJECTS_ROOT:-$RUN_DIR/projects}"
```

cioè `.run-editor/projects` **dentro il checkout di SWS**, e lo passano esplicito al binario con
`--projects-root`. Il default del binario — `~/sws_projects`, **fuori dal repo** — su questa
macchina non entra mai in gioco.

Il default buono esiste da `main.rs` (flag `--projects-root`, variabile `SWS_PROJECTS_ROOT`) e il
commento lì dichiara proprio la ragione che il maintainer aveva in mente: *«fuori dal repo, così
un clone pulito non porta con sé i progetti di qualcuno e un `git clean` non li cancella»*.

### Fatto il 18-09-2026

Realizzato esattamente così, e con una scelta in più che vale la pena registrare: **lo script di
produzione non calcola la radice**, passa `--projects-root` *solo* quando `SWS_PROJECTS_ROOT` è
impostata. Se non c'è, il flag non viene passato affatto e decide il runtime. Così la radice ha
un posto solo da cui venire invece di due che possono divergere — l'unica copia del default fuori
dal Rust è nel messaggio d'avvio, ed è dichiarata nel commento.

`start_runtime.sh` **non** è stato toccato: quello script simula un dispositivo, dove la radice la
decide chi installa, ed è una decisione a sé.

### Com'era stato proposto

- **`start_editor.sh`** — produzione. Non impone `--projects-root`: lascia decidere al binario
  (`~/sws_projects`) o a `SWS_PROJECTS_ROOT` se l'utente l'ha messa. Stampa all'avvio **dove**
  stanno i progetti, perché un percorso implicito è la metà di questo problema.
- **`start_editor_develop.sh`** — sviluppo. Tiene `.run-editor/projects` dentro il checkout, e
  **lo dice** all'avvio: «radice di sviluppo, non il default `~/sws_projects`».

Stessa cosa per `start_runtime.sh`? Probabilmente sì, con lo stesso ragionamento, ma è una
decisione a sé: quello script simula un **dispositivo**, dove la radice la decide chi installa.

> ⚠️ **`scripts/` ha una regola**: mai editare uno script mentre è in esecuzione — bash legge per
> offset e un edit a metà file ha già ucciso una build di 51 minuti. `pgrep -f start_editor`
> prima di toccarlo.

Cosa NON rompere: la duplicazione non deve diventare due copie che divergono. Le due varianti
differiscono per **una riga** (la radice) più il messaggio d'avvio: o una chiama l'altra passando
un ambiente, oppure la parte comune va in un file sorgente in comune.

---

## 2. Il workspace

### Cosa c'è già, misurato il 17-09-2026

Più di quanto sembri, ed è la cosa utile di questo documento.

**`ProjectRegistry`** (`sws-web/src/project_registry.rs`) tiene già
`<config_dir>/known_projects.json`, una mappa `nome → { path assoluto, last_opened_ms }`,
aggiornata a ogni create/open riuscito e usata dalla WelcomeScreen per la lista dei recenti. **È
metà di un workspace già costruita**: c'è la persistenza, c'è il percorso assoluto, c'è la
ricorrenza.

**`.active-project`** — un marker dentro la radice progetti con il percorso dell'ultimo progetto
aperto, riletto all'avvio (`main.rs:487`). ⚠️ È **assoluto**: copiare una cartella di progetti fa
riaprire l'originale, e va riscritto prima di avviare.

**`<config_dir>`** — accanto ai certificati TLS ci sono già `instance_id`, `display-target`,
`ai.yaml`, `known_projects.json`. Esiste quindi un posto dove una scelta d'istanza può vivere, e
un precedente per metterci roba.

### La contraddizione da sciogliere, e non è piccola

Il commento in testa a `project_registry.rs` dichiara di coprire

> «"external" ones created at a custom parent path chosen by the maintainer (e.g. their Documents
> folder, a backup share)»

ma **da Q46 (09-09) non è più possibile**: `dentro_radice`/`dentro_radice_nuovo`
(`projects.rs:213`) confinano il selettore di cartelle *e* `parent_path` dentro la radice, con
`canonicalize` prima del confronto, per non lasciare che la WelcomeScreen sfogli tutto il disco.
Collaudato dal vivo il 12-09 contro path assoluti, risalite e link simbolici.

Quindi oggi il registro sa rappresentare progetti sparsi, e il resto del sistema non permette più
di crearli. **Un workspace multiplo richiede di riaprire quella decisione**: o le radici
diventano N (e il confinamento vale su *ognuna*), o restano una sola e «workspace» vuol dire
«cambiare quella».

### Le domande da decidere prima di scrivere codice

**D1 — Cos'è un workspace, qui?**
- *(a)* **Una radice alla volta**, cambiabile: il workspace *è* `projects_root`, e l'IDE permette
  di sceglierla e ricordarla. Il confinamento di Q46 resta identico, cambia solo il punto in cui
  la radice viene decisa. È il passo piccolo.
- *(b)* **N radici registrate**, una attiva: la WelcomeScreen elenca i workspace e si commuta. Il
  confinamento vale sulla radice attiva. Costa di più: ogni punto che oggi dice `projects_root`
  deve dire «la radice attiva», e il marker `.active-project` deve diventare per-workspace.
- *(c)* **Nessuna radice, solo progetti**: il registro sa già tenere percorsi assoluti qualsiasi,
  e Q46 si allenta a «si può sfogliare solo dentro le cartelle già registrate». La più vicina a
  come funziona un editor di codice, e la più lontana da com'è fatto oggi.

**D2 — Dove si scrive la scelta?** Un file in `<config_dir>` è il posto naturale (c'è già
`known_projects.json`), ma introduce un **terzo** canale da cui la radice può arrivare, dopo il
flag e la variabile d'ambiente. Serve una precedenza scritta — la proposta ovvia è
`--projects-root` > `SWS_PROJECTS_ROOT` > file di configurazione > default — **e** un punto
dell'interfaccia che dica *da quale dei quattro* viene quella in uso. Senza quello, «perché i
miei progetti sono lì?» non ha una risposta breve, che è esattamente il difetto da cui è partito
tutto.

**D3 — Cosa succede alla prima apertura?** Il maintainer ha detto «serve definire dove salvare i
progetti». Da decidere se è **bloccante** (non si va avanti finché non scegli, come certi IDE) o
**proposto** (si parte dal default e una banda dice dove sei e come cambiarlo). Bloccante è più
esplicito; proposto non mette un muro davanti a chi vuole solo guardare.

**D4 — E il pannello?** Su un dispositivo la radice la decide chi installa, e non c'è nessuno
davanti allo schermo al primo avvio. Qualunque cosa si faccia deve valere **solo per l'IDE**
(`ide_only`), come già per la traduzione automatica e per le sorgenti in sola lettura.

## Come verificarlo, quando si farà

Il punto che conta non è il file di configurazione: è che **la radice in uso sia una sola e si
sappia da dove viene**. Una guardia che lo inchioda varrebbe più del codice — sulla falsariga di
`check_release_coerente.sh`: dati i quattro canali, il runtime deve sceglierne uno secondo la
precedenza dichiarata, e `/api/system/info` (o la scheda IDE) deve **dirlo**.

E il collaudo a mano che smaschera gli equivoci: avviare `start_editor.sh` su una macchina pulita,
senza variabili, e guardare dove propone di creare un progetto. Se non è `~/sws_projects`, il
punto 1 non è chiuso.

## Rischi dichiarati

- **La duplicazione degli script invecchia.** Due file che differiscono per una riga divergono in
  un mese. Va costruita in modo che la parte comune sia una sola.
- **Il workspace multiplo tocca Q46**, che è una decisione di sicurezza presa e collaudata. Non
  la si riapre di straforo: se serve, si riapre esplicitamente e si dice cosa cambia.
- **`.active-project` è assoluto** e oggi vive dentro la radice: con N workspace diventa
  ambiguo, e va deciso se ce n'è uno per radice o uno globale che nomina anche il workspace.
