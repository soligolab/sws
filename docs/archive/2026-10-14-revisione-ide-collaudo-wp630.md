# Revisione IDE — tre difetti del collaudo del 14-10-2026

## Contesto

Il maintainer, provando l'IDE nel cloud col WP630, ha segnalato tre cose. Nessuna si corregge
adesso: c'è un altro ramo di sviluppo aperto. Questo è il piano da cui partire dopo.

Scelta del maintainer (14-10): **due rami**, i due circoscritti prima, la tendina a parte.

Tutte e tre le diagnosi qui sotto sono **misurate o lette nel codice**, non ipotizzate. Dove resta
un dubbio è detto.

---

# Ramo 1 — `fix/dispositivi-e-deploy`

> **Fatto il 17-10-2026**: 1a (campi controllati, password sempre visibile, Connect sempre abilitato, niente utente
> vuoto in `RT_USER_KEY`) e 1b (`setPages` segna «non salvato» se la normalizzazione cambia qualcosa — scelta del
> maintainer, anche per i progetti nuovi da template). I punti «da guardare anche» restano aperti. Da collaudare sul
> TC620.

## 1a. Dai «dispositivi registrati» non ci si connette

**Sintomo**: «Find runtime» → «+ Devices» aggiunge il dispositivo; premendo Connect arriva
*«… ha i suoi utenti: inserisci utente e password»* anche con le credenziali che funzionano nella
sezione «Remote runtime connection».

**La catena, per intero** (`sws-editor/src/config/schede/DevicesTab.tsx` salvo dove indicato):

1. `dispositivoDaRuntime` / `dispositivoDaRete` (`src/config/dispositiviRegistrati.ts:69-79`)
   creano il dispositivo con **`user: ""`**.
2. `mancaPassword = !!d.user && passwords[d.url] === undefined` (`:347`) → **false**, perché
   l'utente è vuoto.
3. Il campo password della riga è dentro `{mancaPassword && (…)}` (`:389`): **non viene
   disegnato**. Non c'è nessun posto dove mettere la password.
4. Connect è `disabled={mancaPassword || …}` (`:407`) → **abilitato**: sembra pronto.
5. `handleConnect` manda `device.user || undefined` (`:265`) → `JSON.stringify` lo omette → il
   Rust legge `username = ""` e risponde con quel messaggio
   (`sws-runtime/crates/sws-web/src/remote.rs:169-185`; la condizione guarda **solo**
   `username.is_empty()`, la password nemmeno).

E se si scrive l'utente a mano non va molto meglio: i due campi della riga sono **non
controllati** — l'utente si committa su `onBlur` (`:362`) e quello stesso handler **cancella la
password in memoria** (`:369`); la password si committa **solo premendo Invio** (`:392`), quindi
digitarla e cliccare Connect non manda niente.

**Effetto collaterale che rompe anche quello che funzionava**: `handleConnect` scrive
`localStorage.setItem(RT_USER_KEY, device.user)` (`:256`) con la stringa vuota, e al mount
successivo `RuntimeConnectionTab` (`:75`) si ritrova l'utente cancellato.

**Correzione.** Rendere la riga come la sezione che funziona — `RuntimeConnectionTab.tsx:712-720`
tiene `targetUser`/`targetPass` in stato **controllato**, aggiornato a ogni tasto:

- i due input della riga diventano controllati (`value` + `onChange`), niente commit su
  blur/Invio;
- il campo password si mostra **sempre**, non solo quando un utente c'è già: oggi il caso
  «utente vuoto» è proprio quello che nasce da «+ Devices», cioè il normale;
- Connect non si disabilita per `mancaPassword`: se mancano le credenziali lo dice il server, e
  un pannello senza utenti si connette senza;
- non scrivere `RT_USER_KEY` con una stringa vuota.

## 1b. «Invia ora» a volte spedisce la versione vecchia

**Misurato sul WP630 e sul VPS**, confrontando i file:

| | |
|---|---|
| tre pagine su quattro | identiche, stesso md5 |
| `SystemInfo.yaml` (quella del trend `mv82meunfrekl`) | **diversa**: 2862 byte sul pannello, 3000 sul VPS |
| scritta sul pannello | 14:17:10 CEST (il deploy) |
| salvata sul VPS | **14:20:30 CEST** (3 minuti dopo) |
| nel backup delle 12:10 | 2375 byte — una terza versione |

Nel sorgente il trend ha `label: core.cpu0` nei `trend_tags`; sul pannello quella riga non c'è.

**Non è «manca il salvataggio prima del deploy»**: quel passaggio **c'è**, in tutti e tre i
bottoni — `flushBeforeDeploy` (`DevicesTab.tsx:35`), `deployOra` (`src/store/index.ts:2487`),
`RuntimeConnectionTab.tsx:379` — e il commento a `DevicesTab.tsx:25-33` descrive già questo
sintomo.

Il buco è che **`selectIsDirty` può essere falso mentre la memoria differisce dal disco**
(`src/store/index.ts:820`). Il candidato più forte, ed è specifico dei trend:

> `setPages` (`src/store/index.ts:1223-1264`) applica `normalizeTrendObjects`,
> `normalizzaColoriOggetti` e `riempiPredefinitiOggetti` — che convertono il trend legacy
> (`tag`/`extra_tags`/`trend_series_styles` → `trend_tags[]`) e scrivono i predefiniti che il file
> non dichiara — **e subito dopo azzerano `pagesRev` e `savedPagesRev`**, cioè dichiarano il
> progetto pulito. Da quel momento l'IDE mostra una cosa e il disco ne contiene un'altra, e un
> deploy spedisce il disco.

Due meccanismi minori, da tenere d'occhio ma non da inseguire adesso:

- `markPagesSaved` (`:2600`) azzera sulla revisione **corrente**: una modifica fatta mentre i PUT
  sono in volo viene dichiarata salvata senza essere stata scritta;
- `interactionDepth` (`:886`, `SvgCanvas.tsx:798-806`) non ha pulizia allo smontaggio: se il
  canvas si smonta a gesto aperto, **niente rende più sporco il progetto** finché non si ricarica
  la pagina. È l'unico meccanismo che spiega un «a volte» che poi persiste.

**`trend-rekl` non esiste nel repo**: è una pagina di un progetto del maintainer, quindi non c'è
nessun fixture da ispezionare. L'unico modo di distinguere fra le cause è guardare il file vero.

**Il primo passo non è correggere, è riprodurre.** In ordine:

1. aprire il progetto, **senza toccare niente** guardare se l'indicatore «modifiche non salvate»
   è spento, poi confrontare `synoptics/SystemInfo.yaml` su disco con ciò che l'IDE mostra
   (se il file è ancora nella forma legacy, è il punto sopra, confermato);
2. premere «Invia ora» e verificare che nel registro **non** compaia «salvo le modifiche in
   sospeso»;
3. Ctrl+S esplicito, poi «Invia ora»: se adesso arriva, la diagnosi è chiusa.

**Correzione proposta**: dopo la normalizzazione in `setPages`, confrontare prima/dopo e marcare
il progetto **sporco** se qualcosa è cambiato, invece di dichiararlo pulito d'ufficio. Così
l'indicatore lo dice, e qualunque deploy salva prima. L'alternativa — riscrivere subito su disco
al caricamento — tocca il progetto senza che nessuno l'abbia chiesto e fa scattare il watcher.

**Da guardare anche** — **fatti il 17-10-2026** (pagina illeggibile che ferma il deploy, segnale dopo lo ZIP, `no-cache` sui file di progetto, impronta con faceplate/ricette/immagini) — (lette nel codice, non misurate, e tutte già causa di «il pannello mostra
la versione vecchia»):

- `load_all_synoptics` (`router.rs:5945-5950`) **salta in silenzio** una pagina malformata: finisce
  solo in un `warn!` del server, non nel registro del deploy, e siccome `synoptics/` sul
  dispositivo viene svuotata prima, la pagina **sparisce dal pannello**;
- `upload_project_zip` non chiama `signal_project_changed`: oggi il segnale arriva solo perché
  `remote_deploy` fa l'`open` subito dopo — se quello fallisce, i file sono nuovi e nessuno avvisa
  i viewer. È già annotato in `STATUS.md:1067-1073`;
- i file di progetto escono **senza `Cache-Control`** (`cache.rs:51`) e il viewer web non usa
  `no-store`: una strada reale perché il viewer mostri il vecchio anche con i file giusti;
- il fingerprint del viewer (`router.rs:8618`) copre `project.yaml`, `synoptics/` e `boot/` ma
  **non** `faceplates/`, `recipes/`, `images/`.

---

# Ramo 2 — `fix/tendina-dei-tag-fuori-dal-flusso`

> **Fatto il 17-10-2026**: `components/TendinaFluttuante.tsx`, usata dalle due tendine di `TagInput`; provato a
> schermo nel pannello proprietà (nome, descrizione e tipo leggibili, segue lo scorrimento, il clic sceglie).

## La mia correzione del 12-10 ha peggiorato le cose

Il 12-10 avevo fatto crescere le tendine di `TagInput` **verso sinistra**, credendo che il limite
fosse il bordo della finestra. **Il presupposto era sbagliato sul meccanismo.** La tendina è
ritagliata da due antenati del pannello proprietà:

- `EditorShell.tsx:1423` — `overflow: hidden`, `width: larghezza` (220-560 px);
- `EditorShell.tsx:1425` — `overflowY: auto`, e per la specifica CSS se un asse non è `visible`
  **l'altro computa ad `auto`**: quel div ritaglia anche in orizzontale.

Quindi `width: max-content` e `maxWidth: min(520px, 80vw)` **non producono un pixel visibile in
più**: cambiano solo da che parte il testo viene tagliato. Prima si leggeva l'inizio
(`host.Temperat…`), adesso la fine (`nea (A)`) — che è peggio, perché l'inizio è la parte che
distingue i tag fra loro.

Il campo della sezione TRACCE è in una riga a tre (tag | etichetta 90 px | ×,
`EditorShell.tsx:3957-3977`): al tag restano ~125 px.

## La correzione

**Uscire dal flusso**: portal su `document.body` + `position: fixed`, con le coordinate prese da
`getBoundingClientRect` del campo. È l'unica strada che non dipende da chi ritaglia, e nel repo
**c'è già un precedente da cui copiare**: `src/components/AlarmBellPanel.tsx:162-168` e `:224-230`.

Due cose che quel precedente **non** fa e che qui servono, perché il pannello proprietà scorre:

- riagganciare (o chiudere) la tendina su `scroll` e `resize` — con l'ancora congelata resterebbe
  appesa in aria al primo scorrimento;
- ribaltare verso l'alto quando sotto non c'è spazio, e **clampare dentro il viewport** come fa
  già `LeftPanel.tsx:1549-1576` (`Math.min(x, window.innerWidth - W - 6)`).

Si estrae **una volta sola** come componente condiviso e si usa per tutte e due le tendine di
`TagInput` (il completamento da tastiera e il selettore col filtro). Così la correzione arriva da
sola ai **18 punti d'uso in 16 file**: pannello proprietà (`EditorShell.tsx` ×10, più
`BindableInput.tsx:100`), schede di configurazione dentro `S.card` — che ritaglia **anche in
verticale** (`src/config/comuni.tsx:132-138`) — `AlarmsTab`, `RecipesTab`, `GlobalScriptsTab`,
`TabellaRegistriModbus` e sette schede sorgente.

> Niente `position: fixed` senza portal: funzionerebbe per il clipping, ma `QuickCreateTagModal`
> (già figlio di `TagInput`) lo fa e resta figlio di antenati con `overflow: hidden` — un
> precedente da non estendere.

---

## Verifica

**Ramo 1**

- `pnpm test`, `pnpm build`, `cargo check`, `./scripts/check_static.sh` verdi.
- Test nuovi, tutti su funzioni pure o su stato, nessuno ha bisogno di un dispositivo:
  - un `SavedDevice` con `user: ""` deve poter ricevere utente e password **senza** blur né Invio;
  - `handleConnect` non scrive `RT_USER_KEY` quando l'utente è vuoto;
  - dopo `setPages` con una pagina in forma legacy, `selectIsDirty` deve essere **vero**.
- A schermo, con il WP630: «Find runtime» → «+ Devices» → utente e password nella riga → Connect
  riesce; poi la sezione «Remote runtime connection» deve avere ancora il suo utente.
- Per 1b, la riproduzione in tre passi descritta sopra **prima** di scrivere la correzione.

**Ramo 2**

- Nessun test automatico può vedere il ritaglio: jsdom non fa layout. Si può però provare la
  parte pura — il calcolo della posizione (sopra/sotto, clamp nel viewport) estratto in una
  funzione e testato con rettangoli finti.
- A schermo, in tre contesti diversi, perché i clip sono diversi: pannello proprietà **stretto al
  minimo** (tracce del trend), una scheda sorgente dentro `S.card` (clip anche verticale), e la
  tabella registri Modbus (dentro una cella). In tutti: la tendina si legge per intero, segue il
  campo quando si scorre, e non esce dalla finestra.
