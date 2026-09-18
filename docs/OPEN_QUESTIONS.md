# SWS — Open Architectural Questions

> Decisions that came up during development but are **not for Claude Code to settle in a vibecode session**. The maintainer reviews and decides these out-of-band.
>
> When Claude Code encounters one of these, it should: pick the documented PoC default, add a `// TODO(open-question):` comment in code referencing the question number here, and continue.
>
> **Dal 2026-09-06 questo file contiene solo le questioni vive.** Quelle decise, realizzate e
> **verificate sul codice** stanno in [`docs/history/OPEN_QUESTIONS-chiuse.md`](history/OPEN_QUESTIONS-chiuse.md),
> indicizzate in coda a questo file. I numeri **non si riusano mai**: una scheda nuova prende il
> numero successivo all'ultimo assegnato, archivio compreso (`check_documenti.sh` fa i conti).
>
> **Dal 2026-09-12, una scheda ancora viva può avere il testo spostato in un piano** sotto
> `docs/plans/` invece di restare qui per intero — non è una chiusura: la domanda resta aperta,
> il numero resta suo, solo il contenuto integrale vive altrove (il piano lo riporta parola per
> parola, sotto «Testo originale della scheda»). Qui resta il titolo, il rimando e lo stato in
> una riga. Non tutte le schede vive sono così: solo quelle per cui è stato preparato un piano.
>
> **Dal 2026-09-18 questo file è congelato.** Decisione del maintainer: una domanda nuova non
> diventa più una scheda qui, diventa un **file di piano sintetico** in `docs/plans/` — l'idea, le
> misure di quel momento, e l'indicazione che quando il lavoro comincerà servirà una sessione di
> plan approfondita. I numeri già assegnati restano, ogni scheda rimasta rimanda al piano che ne
> tiene il testo, e `check_documenti.sh` continua a verificare che nessun numero sparisca. Qui non
> nascono più Q-numeri.

---

## Q13 — Come arrivano davvero gli sfondi di boot su un pannello Pixsys reale?

Contenuto spostato in [`docs/plans/2026-09-18-immagine-di-boot.md`](plans/2026-09-18-immagine-di-boot.md) il 18-09-2026 — più l'idea nuova del maintainer: disegnare lo splash nell'IDE e installarlo al deploy via D-Bus.
**Decided:** not yet — la decisione si prende nel piano.

---

## Q16 — Widget `image` su LVGL: nessun decoder raster compilato, e il catalogo bundle è SVG

Contenuto spostato in [`docs/plans/2026-09-12-q16-decoder-raster-image.md`](plans/2026-09-12-q16-decoder-raster-image.md) il 2026-09-12. **Decided:** parzialmente decisa (metà SVG fatta, metà raster no).

---

## Q23 — Collegare lo SCADA a un robot ROS 2

Contenuto spostato in [`docs/plans/2026-09-18-ros2-robot-come-sorgente.md`](plans/2026-09-18-ros2-robot-come-sorgente.md) il 18-09-2026.
**Decided:** not yet — la decisione si prende nel piano.

---

## Q26 — Un server MCP per far editare il progetto all'IA

Contenuto spostato in [`docs/plans/2026-09-18-mcp-editing-con-ia.md`](plans/2026-09-18-mcp-editing-con-ia.md) il 18-09-2026.
**Decided:** not yet — la decisione si prende nel piano.

---

## Q43 — Traduzione automatica dei contenuti di progetto (Google Translate)

Contenuto spostato in [`docs/plans/2026-09-18-multilingua-residuo.md`](plans/2026-09-18-multilingua-residuo.md) il 18-09-2026 — insieme a Q57: restano il fornitore giusto per un allarme e il prezzo della segmentazione.
**Decided:** not yet — la decisione si prende nel piano.

---

## Q44 — Ospitare l'editor come servizio, con aziende, utenti e quote

Contenuto spostato in [`docs/plans/2026-09-18-identita-utenti-istanze.md`](plans/2026-09-18-identita-utenti-istanze.md) il 18-09-2026 — insieme a Q54 e Q56, che sono la stessa domanda vista da tre punti.
**Decided:** not yet — la decisione si prende nel piano.

---

## Q53 — Due immagini aarch64 (SDK Pixsys e generica): tenerle entrambe, o convergere su una?

Contenuto spostato in [`docs/archive/2026-09-12-q53-misura-rimozione-sdk-qemu.md`](archive/2026-09-12-q53-misura-rimozione-sdk-qemu.md) il 2026-09-12, archiviato il 2026-09-14. **Decided:** decisa e realizzata il 2026-09-10; fase due chiusa il 2026-09-14 — misura sul WP630 confermata e percorsi SDK/QEMU rimossi, alias `-arm64-generic` mantenuti.

---

## Q54 — Un dispositivo che crea utenti propri: cosa succede al deploy successivo?

Contenuto spostato in [`docs/plans/2026-09-18-identita-utenti-istanze.md`](plans/2026-09-18-identita-utenti-istanze.md) il 18-09-2026 — insieme a Q44 e Q56, che sono la stessa domanda vista da tre punti.
**Decided:** not yet — la decisione si prende nel piano.

---

## Q55 — `reqwest` via `rt_handle.spawn()` si blocca per sempre nel viewer LVGL, solo per una POST che riceve 200

Contenuto spostato in [`docs/plans/2026-09-18-post-bloccata-viewer-lvgl.md`](plans/2026-09-18-post-bloccata-viewer-lvgl.md) il 18-09-2026.
**Decided:** not yet — la decisione si prende nel piano.

---

## Q56 — Un IDE non si autentica più: `users.yaml` governa il dispositivo, non l'editor

Contenuto spostato in [`docs/plans/2026-09-18-identita-utenti-istanze.md`](plans/2026-09-18-identita-utenti-istanze.md) il 18-09-2026 — insieme a Q44 e Q54, che sono la stessa domanda vista da tre punti.
**Decided:** not yet — la decisione si prende nel piano.

---

## Q57 — Una notifica non ha uno schermo: in che lingua parla, e a chi?

Contenuto spostato in [`docs/plans/2026-09-18-multilingua-residuo.md`](plans/2026-09-18-multilingua-residuo.md) il 18-09-2026 — insieme a Q43: resta la lingua per destinatario.
**Decided:** not yet — la decisione si prende nel piano.

---

## Q58 — Un template porta gli indirizzi e le credenziali dell'impianto in cui è nato

*Aperta il 2026-09-16, emersa realizzando il piano multilingua. Nessuna decisione presa.*

**Come si è vista.** Il maintainer ha creato un progetto da un template e si è ritrovato 1950
righe su 2000 di `connection refused` nel log in pochi minuti. Il template
`nebulizzatore-sandokan` dichiara `host: 192.168.1.6` — il broker MQTT **di casa sua**. Chiunque
crei un progetto da quel template si porta dietro un indirizzo che sulla sua rete non esiste, e
il runtime ci si ostina contro per sempre.

Il rumore è stato mitigato (backoff 5→60s, motivo scritto una volta su dieci: commit
`413fb8eb`), ma quello era il sintomo. Il problema è che **un template è un esempio, e un
esempio non dovrebbe contenere un pezzo di rete vera**.

E non si ferma agli indirizzi: un template può portare, con la stessa naturalezza, un token
Telegram, una password MQTT o le credenziali di un dispositivo — perché *«i segreti viaggiano col
progetto»* è una decisione presa e giusta per un progetto, ma un template non è un progetto: è
qualcosa che si distribuisce a chi non c'entra niente con l'impianto originale.

### Le vie possibili

1. **Una regola scritta e una guardia** — nessun template dichiara host/porta di una rete reale;
   si usano segnaposto (`mqtt.example.invalid`) o un `kind: simulato`. La guardia
   (`check_templates.sh` esiste già) lo verifica a ogni giro. Costa poco; non impedisce di
   sbagliare, lo **fa notare**.
2. **Le sorgenti non viaggiano nei template** — un template porta sinottici, allarmi e tag, e le
   sorgenti si configurano all'apertura, con una schermata che le chiede. È la via pulita, ed è
   anche quella che fa più lavoro: molti template oggi *sono* il loro impianto.
3. **Sorgenti disarmate all'apertura da template** — il progetto nasce con le sorgenti presenti
   ma disabilitate, e l'autore le accende dopo averle riviste. Più economica della 2 e copre sia
   il rumore sia le credenziali, ma lascia i valori scritti dentro il file.

### Cosa è stato fatto, e cosa resta da timbrare (17-09-2026)

**La via 1 è realizzata**: la regola **R5** del parco template
(`examples/templates/README.md`) vieta indirizzi di reti reali e credenziali, nel `project.yaml`
e nei `.md` che lo accompagnano, ed è verificata da `check_templates.sh`. I quattro template che
portavano la rete di casa dell'autore sono stati corretti.

**La via 3 è realizzata in una forma più economica di quella immaginata qui.** Il maintainer ha
scelto il flag **per progetto** invece che per sorgente: `Project::sorgenti_da_rivedere`, acceso
dalla creazione da template e spento dal salvataggio della scheda Sorgenti. Finché è acceso
`apply_loaded_project` non avvia le sorgenti e scrive nel log perché.

La granularità per-sorgente (un `enabled` in ognuna delle otto strutture di configurazione) è
stata scartata con la ragione già scritta nel commit `413fb8eb`: «otto punti sono otto occasioni
di dimenticarne uno il giorno che se ne aggiunge un nono». E la granularità che conta non è la
singola sorgente: è «questo progetto viene da un template e nessuno ha ancora guardato gli
indirizzi».

**La via 2** — le sorgenti non viaggiano affatto nei template — resta scartata: romperebbe i
quattro banchi di prova di protocollo, il cui senso è avere una sorgente già pronta da puntare al
proprio PLC.

**Collaudato dal vivo dal maintainer il 17-09-2026**, su un progetto creato da `s7-demo`:
confermato che il runtime non si collega finché le sorgenti non sono state riviste, e che si
collega dopo la conferma dalla scheda.

**Resta solo il timbro.** Non tocco io il campo `Decided` (regola 3 di `CLAUDE.md`) — la
decisione è del maintainer, il codice c'è, i test ci sono e la prova a schermo è fatta: manca
soltanto che qualcuno scriva che è chiusa.

**Nota di contesto.** Il maintainer ha già detto (16-09) che vuole **definire delle regole prima**
di rimettere mano ai template: rapporto 16:10 a 1280×800, almeno tre lingue (it/en/es), template
semplici, un tipo di risorsa più casi d'uso realistici. Questa sarebbe la quinta regola, ed è
l'unica delle cinque che ha a che fare con la sicurezza invece che con la forma — per questo è
qui e non solo in `STATUS.md`.

**Decided:** not yet.

---

## Q59 — La cartella dei progetti: il default c'è, ma chi lavora nel repo non lo vede mai

*Aperta il 17-09-2026, notata dal maintainer creando un progetto: «mi presenta
`/home/ut1/sws/.run-editor/projects`, mi pareva avessimo definito di usare una path esterna a
`sws` e configurabile».*

**Aveva ragione, ed era già fatto — per il binario.** `--projects-root` / `SWS_PROJECTS_ROOT`
esiste dal 2026-09-09, il default è **`~/sws_projects`, fuori dal repo** («così un clone pulito
non porta con sé i progetti di qualcuno e un `git clean` non li cancella», `main.rs`), e da **Q46**
il selettore di cartelle e `parent_path` non escono da quella radice — collaudato dal vivo il
12-09 contro path assoluti, risalite e link simbolici.

**Quello che il maintainer vede è lo script di sviluppo.** Sia `start_editor.sh` sia
`start_runtime.sh` fanno `PROJECTS_ROOT="${SWS_PROJECTS_ROOT:-$RUN_DIR/projects}"`, cioè
`.run-editor/projects` **dentro il checkout**, e lo passano esplicito al binario. Il default buono
non entra mai in gioco su questa macchina. È comodo per lo sviluppo — i progetti di prova stanno
accanto al codice, si cancellano con la cartella `.run-*` — ma è anche il motivo per cui una
decisione presa a settembre sembra non essere stata presa.

### Le due domande, che sono separate

**1. Gli script di sviluppo devono continuare a scavalcare il default?**

- *(a)* Sì, ma **dicendolo**: lo script stampa all'avvio «progetti in `<path>` (radice di
  sviluppo, non il default `~/sws_projects`)». Costa una riga e toglie la sorpresa.
- *(b)* No: anche in sviluppo si usa `~/sws_projects`, e chi vuole l'isolamento passa
  `SWS_PROJECTS_ROOT`. Più coerente, ma i progetti di prova sopravvivono a un `rm -rf .run-*` e
  due checkout paralleli condividono la stessa radice.
- *(c)* Sì e basta, com'è oggi.

**2. Va chiesta alla prima apertura dell'IDE, se non è configurata?**

Questa **non è pianificata da nessuna parte**: non esiste nessun meccanismo di primo avvio
nell'IDE — né una schermata, né un posto dove scrivere la scelta. Oggi la radice è un argomento
del processo, quindi «configurarla dall'IDE» vuol dire deciderne la persistenza:

- *(a)* Un file di configurazione dell'**istanza** (accanto ai certificati in `config/`), che il
  runtime legge all'avvio se il flag non è passato. La schermata di benvenuto la chiede la prima
  volta e la si può cambiare dopo dalla scheda IDE.
- *(b)* Solo un avviso: la WelcomeScreen dice dove stanno i progetti e come cambiarlo, senza
  chiedere niente. Costa poco e non introduce un terzo posto da cui la radice può arrivare.
- *(c)* Niente: resta un argomento di avvio, come per un pannello — dove la radice la decide chi
  installa, non chi guarda lo schermo.

### Direzione data dal maintainer il 17-09-2026, poche ore dopo

Due cose, che spostano la domanda 1 e allargano la 2:

> «`start_editor.sh` io l'ho sempre inteso come run di produzione (come fossi il cliente), se
> serve duplichiamolo in `start_editor_develop.sh` per sviluppare. Poi alla prima apertura del
> progetto serve definire dove salvare i progetti come fanno molti ambienti che definiscono il
> **workspace** (e spesso possono avere più workspace in base al progetto)»

Quindi la **domanda 1 non è più una scelta fra tre vie**: lo script di produzione non deve
imporre una radice dentro il checkout, e lo sviluppo si fa con un secondo script. E la domanda 2
non è più «chiedere o no la radice», ma «progettare il concetto di workspace», che è
sostanzialmente più grande.

Il seguito sta in [`docs/archive/2026-09-17-workspace-cartella-progetti.md`](archive/2026-09-17-workspace-cartella-progetti.md),
con le misure di oggi — fra cui una contraddizione che questa scheda non conosceva:
`ProjectRegistry` dichiara di coprire progetti «esterni, in una cartella scelta dal maintainer»,
ma da **Q46** non è più possibile crearli. Un workspace multiplo richiede di riaprire quella
decisione, che è di sicurezza ed è stata collaudata dal vivo.

**Il rischio da dichiarare per (2a)**: la radice diventerebbe configurabile da **tre** posti
(flag, variabile d'ambiente, file), e quando una cosa arriva da tre posti la domanda «perché i
miei progetti sono lì?» non ha più una risposta breve. Se si fa, serve una precedenza scritta e
un punto dell'interfaccia che dica *da dove* viene quella in uso.

**Decided:** not yet.

---

## Q60 — La gestione dei workspace

Contenuto spostato in [`docs/plans/2026-09-18-workspace-dei-progetti.md`](plans/2026-09-18-workspace-dei-progetti.md) il 18-09-2026.
**Decided:** not yet — la decisione si prende nel piano.

---

## Adding new questions

When Claude Code adds a new question, follow the format above:
1. **Context** — why this came up.
2. **Options** — at least 2, briefly described.
3. **Default for PoC** — what we're doing for now.
4. **Decided** — left as `not yet` until the maintainer fills it in.

## Archivio — decise, realizzate e verificate

Le schede qui sotto sono state **spostate intere** in
[`docs/history/OPEN_QUESTIONS-chiuse.md`](history/OPEN_QUESTIONS-chiuse.md) il 2026-09-06, dopo
una verifica sul codice di ciò che ognuna dichiara. I numeri **non si riusano**: una scheda nuova
prende il numero successivo all'ultimo mai assegnato, archivio compreso.

| # | Questione | Decisa |
|---|---|---|
| Q1 | Python embedding strategy | bootstrap |
| Q2 | Sparkplug B implementation | T-08 |
| Q3 | Plugin ABI strategy | bootstrap |
| Q4 | Frontend state management | 2026-05 (ADR 0001) |
| Q5 | i18n scaffolding | bootstrap |
| Q6 | Symbol library packaging | 2026-08-11 |
| Q7 | LICENSE file content | 2026-05-12 |
| Q8 | Isolamento runtime ↔ IDE | 2026-07-26 e 2026-09-02 |
| Q9 | Le `PUT /api/project/*` accettano e scartano in silenzio i campi sconosciuti | 2026-08-21 |
| Q10 | Una sorgente non parsabile viene scartata in silenzio, e il salvataggio successivo la cancella | 2026-08-21 |
| Q11 | Estendere `BrandColors` con `secondary`/`accent`, o tenerli solo nell'artwork? | 2026-08-21 |
| Q12 | I neutri di `theme.ts` restano condivisi fra tutti i brand, o diventano override per-brand? | 2026-08-21 |
| Q14 | Binding Rust↔LVGL e sequenza dei backend di output | 2026-08 (15 seguiti) |
| Q15 | Simboli SVG (`symbol`) su LVGL: nessun renderer SVG disponibile | 2026-08-11 |
| Q17 | `apply_recipe` scrive i tag senza contesto utente | 2026-09-06 |
| Q18 | Colori del testo dai token di tema su pagine con sfondo scelto a mano | 2026-08-25 |
| Q19 | Il backend DRM del viewer LVGL apre i device a mano, mentre PixsysOS li distribuisce con `seatd` | 2026-08-25 |
| Q20 | Il viewer LVGL non si accorge che il progetto è cambiato | 2026-08-25 |
| Q21 | Due superfici Python nel progetto, in due punti lontani dell'interfaccia | 2026-08-25 |
| Q22 | La `sparkline` fa crashare il viewer LVGL quando la pagina ha altri widget | 2026-08-25 |
| Q24 | Il font del viewer LVGL non ha le lettere accentate | 2026-08-27 |
| Q25 | Installare web e LVGL insieme, e far scegliere al sistema quale mostrare | 2026-08-27 |
| Q27 | Il server non fa rispettare il `data_type` dei tag in scrittura | 2026-09-06 |
| Q30 | `patch_project` è un leggi-modifica-scrivi senza lock | 2026-09-03/04 |
| Q32 | Dove deve vivere il progetto che si sta modificando? | 2026-09-12 |
| Q33 | `POST /api/system/stop` viene annullato in silenzio dal salvataggio delle Sorgenti | 2026-09-04 |
| Q34 | Il cron degli script globali non capisce `*/5`, e non parte in silenzio | 2026-09-03/04 |
| Q35 | «fuori pagina» implicito nelle coordinate o campo esplicito? | 2026-09-06 |
| Q37 | Cosa c'è attorno alla pagina sul pannello, e se il foglio non ci sta | 2026-09-06 |
| Q38 | `size_mode: ratio` senza dimensioni esplicite: il bordo non arriva al canvas | 2026-09-06 |
| Q39 | Il validatore deve aprire la famiglia dei rilievi geometrici? | 2026-09-12 |
| Q41 | La chat IA deve mostrare consumo di token e credito residuo? | 2026-09-06 |
| Q42 | Gli script Python scrivono i tag senza lo scaling inverso | 2026-09-06 |
| Q47 | `/api/script/exec` esegue codice arbitrario e nessuno lo chiama più | 2026-09-09 |
| Q48 | `/api/deploy/remote` scarica un binario che non esiste, e duplica il deploy | 2026-09-09 |
| Q50 | I dispositivi registrati: dal browser al server, e popolati dal discovery mDNS | 2026-09-10 |
| Q51 | «Pacchetto runtime» e il deploy binario sono strumenti di sviluppo: nascosti quando il repo non c'è | 2026-09-09 |
| Q52 | «Installa su dispositivo»: container per primo, campi dal dispositivo connesso, e un discovery che trova **qualunque** macchina in rete | 2026-09-09 |
