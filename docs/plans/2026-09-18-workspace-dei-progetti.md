# I workspace: dove vivono i progetti, e chi lo decide

> **Come si legge questo piano.** Nasce da una o più schede di
> `docs/OPEN_QUESTIONS.md`, spostate qui il 18-09-2026 per decisione del maintainer: le domande
> non vivono più in un elenco, diventano file di piano. **Il testo delle schede è riportato
> integralmente più sotto**, non riassunto — è la misura fatta quando la domanda è nata, e
> riassumerla vorrebbe dire rifare il lavoro a naso.
>
> ⚠️ **Quando si prenderà in mano questo lavoro, la prima cosa da fare è una sessione di plan
> approfondita.** Quello che segue è materiale, non un piano d'esecuzione: le misure hanno la
> data che hanno, il codice si è mosso, e alcune opzioni potrebbero non avere più senso.

## Perché questo file esiste

Il maintainer, il 18-09-2026: «la gestione dei workspace merita un plan dedicato per strutturarla
a dovere». La richiesta originale è del 17:

> «Alla prima apertura del progetto serve definire dove salvare i progetti come fanno molti
> ambienti che definiscono il workspace (e spesso possono avere più workspace in base al
> progetto)»

**La prima metà è già fatta** (`d3d84e89`): `start_editor.sh` è la corsa di produzione e non
impone più una radice dentro il checkout, `start_editor_develop.sh` fa quella di sviluppo. Quello
che resta è il concetto di workspace.

## Sta in coda con l'altro lavoro grosso

Il maintainer ha messo questo insieme a Q44/Q54/Q56
([identità, utenti e istanze](2026-09-18-identita-utenti-istanze.md)) come «il lavoro più
corposo, da fare dopo aver chiuso gli altri punti». Le due cose si condizionano: se l'editor
diventa un servizio multi-azienda, «dove vivono i progetti» cambia natura.


---

## Dalla scheda Q60 — La gestione dei workspace

*Aperta il 18-09-2026 su indicazione del maintainer: «la gestione dei workspace merita un plan
dedicato per strutturarla a dovere». Nasce dalla seconda metà di **Q59**, che con questa scheda
si esaurisce — la prima metà (`start_editor.sh` come corsa di produzione) è realizzata.*

**La richiesta, sue parole (17-09-2026).**

> «Alla prima apertura del progetto serve definire dove salvare i progetti come fanno molti
> ambienti che definiscono il workspace (e spesso possono avere più workspace in base al
> progetto)»

### Cosa c'è già, misurato il 17/18-09-2026

Più di quanto sembri, ed è la ragione per cui questa scheda esiste invece di un piano scritto a
naso.

- **`ProjectRegistry`** (`sws-web/src/project_registry.rs`) tiene già
  `<config_dir>/known_projects.json`: `nome → { path assoluto, last_opened_ms }`, aggiornato a
  ogni create/open riuscito, usato dalla WelcomeScreen per i recenti. È **metà del meccanismo già
  costruita — ma un livello sotto**: tiene i *progetti*, non le radici.
- **`.active-project`**, un marker dentro la radice col percorso dell'ultimo progetto aperto,
  riletto all'avvio (`main.rs:487`). È **assoluto**: copiare una cartella di progetti fa riaprire
  l'originale.
- **`<config_dir>`** ospita già `instance_id`, `display-target`, `ai.yaml`,
  `known_projects.json`: c'è un posto dove una scelta d'istanza può vivere, e un precedente.
- **La radice oggi arriva da tre canali**: `--projects-root`, `SWS_PROJECTS_ROOT`, default
  `~/sws_projects`. Dal 18-09 `start_editor.sh` non ne aggiunge un quarto — passa il flag solo se
  la variabile c'è — e stampa all'avvio la radice **e da dove viene**.

### La contraddizione che il piano dovrà sciogliere

Il commento in testa a `project_registry.rs` dichiara di coprire «progetti *esterni*, creati in
una cartella scelta dal maintainer (la sua cartella Documenti, una condivisione di backup)». **Da
Q46 (09-09) non è più possibile**: `dentro_radice`/`dentro_radice_nuovo` (`projects.rs:213`)
confinano il selettore di cartelle *e* `parent_path` dentro la radice, con `canonicalize` prima
del confronto, collaudato dal vivo il 12-09 contro path assoluti, risalite e link simbolici.

Quindi il registro **sa rappresentare** progetti sparsi e il resto del sistema **non permette
più** di crearli. Un workspace multiplo riapre quella decisione, che è di sicurezza: non la si
tocca di straforo, e se si tocca va detto cosa cambia. Con N radici il confinamento non sparisce,
cambia forma — vale su *ognuna* invece che su una.

### Le tre forme possibili

1. **N radici registrate, una attiva** — la WelcomeScreen le elenca e si commuta. È quella che
   corrisponde alla richiesta. Ogni punto che oggi dice `projects_root` deve dire «la radice
   attiva», e `.active-project` diventa per-workspace o nomina il workspace.
2. **Una radice alla volta, cambiabile** — il workspace *è* `projects_root`. Q46 resta identica,
   cambia solo dove la radice viene decisa. Passo piccolo, non copre i «più workspace».
3. **Nessuna radice, solo progetti** — il registro tiene già percorsi qualsiasi, Q46 si allenta a
   «si sfoglia solo dentro le cartelle già registrate». È come funziona un editor di codice, ed è
   la più invasiva sulla decisione di sicurezza.

### Quello che il maintainer ha già deciso

- **Alla prima apertura la scelta è *proposta*, non bloccante** (18-09-2026): si parte dal
  default e una banda nella WelcomeScreen dice dove sei e come cambiarlo. Chi vuole solo guardare
  non trova un muro, e chi ha un'idea diversa la applica subito. È anche coerente con Q58, dove
  le sorgenti da rivedere avvisano invece di bloccare.
- **Vale solo per l'IDE.** Su un dispositivo la radice la decide chi installa e non c'è nessuno
  davanti allo schermo al primo avvio: qualunque cosa si faccia va dietro `ide_only`, come già la
  traduzione automatica e le sorgenti in sola lettura.

### Il rischio da dichiarare, qualunque forma si scelga

Se la scelta si persiste in un file, la radice arriva da **quattro** canali. Serve una precedenza
scritta — la proposta ovvia è `--projects-root` > `SWS_PROJECTS_ROOT` > file > default — **e** un
punto dell'interfaccia che dica da quale dei quattro viene quella in uso. Senza, «perché i miei
progetti sono lì?» non ha una risposta breve, che è esattamente il difetto da cui è partito tutto.

**Decided:** not yet.
