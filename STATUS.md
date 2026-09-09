# SWS — Current Status

> Session-to-session memory. Leggi all'inizio di ogni sessione, aggiorna alla fine.
>
> Ambienti di test: vedi [docs/TEST_SETUPS.md](docs/TEST_SETUPS.md) (casa, dev server, dispositivi Yocto).
>
> **Pulizia 2026-07-27**: rimossi i task già chiusi e le sezioni di verifica ormai superate; le sessioni mergiate **e** verificate fino al 2026-07-09 sono compresse in «Storico». Il dettaglio integrale resta in `CHANGELOG.md` e nella history git.
>
> **Pulizia 2026-09-06**: le sessioni di luglio e agosto (2026-07-30 → 2026-08-23, comprese le ~76
> voci del blocco «Release 2.1.0») e le sezioni di settembre già superate sono spostate **integrali**
> in [`docs/history/STATUS-2026-07_08.md`](docs/history/STATUS-2026-07_08.md) — una riga ciascuna
> resta in «Storico». Qui vive solo ciò che serve a riprendere il lavoro.

> **⚠️ La storia di git è stata riscritta il 2026-08-31.** Un `git filter-branch` ha
> normalizzato autore e committer di **tutti i 342 commit** precedenti a
> `Mauro Soligo <mauro@soligo.net>` (prima convivevano `pixsysedp <edp@pixsys.net>` e
> `katodo <mauro.soligo@katodo.com>`), e il risultato è stato **force-pushato** su GitHub:
> `main`, i due rami di lavoro e **tutti i tag** portano hash nuovi. I contenuti sono
> byte-identici — verificato con `git diff` fra vecchio e nuovo su commit campione — e la
> coerenza DCO regge (343 commit su 343 con autore e `Signed-off-by` allineati).
>
> Due conseguenze pratiche:
>
> 1. **Ogni hash citato in questo file, in `CHANGELOG.md` e in `docs/` prima del
>    2026-08-31 sera appartiene alla storia vecchia** e non si risolve in un clone fresco.
>    Sono ~76 riferimenti: non sono stati riscritti perché la corrispondenza vecchio→nuovo
>    esiste ancora in `refs/original/` su frodo, e riscriverli tutti a mano introdurrebbe
>    errori peggiori del problema. Le **date** e i **messaggi** restano il modo affidabile di
>    ritrovare un commit.
> 2. 🔴 **Il clone su theobroma è ora una storia divergente.** Ha gli hash vecchi su `main` e
>    su entrambi i rami. Se da lì si pusha qualcosa, la storia vecchia torna su GitHub.
>    Theobroma va trattato come **sola lettura**: per ripartire da quella macchina, ri-clonare.
>
> **Come si rimette in pari una macchina che era ferma da prima** (fatto sull'ufficio il
> 2026-09-02; serve una volta per macchina, e `git pull` da solo **non basta**):
>
> ```bash
> git checkout main
> git log origin/main..main --oneline --stat   # cosa hai solo tu
> ```
>
> Se quel commit aggiunge contenuto che su `origin/main` c'è già — si verifica confrontando
> `git rev-parse main:<file>` con `git rev-parse origin/main:<file>`, e se gli hash coincidono
> è byte per byte lo stesso — è la versione pre-riscrittura dello stesso lavoro e si butta con
> `git reset --hard origin/main`. Se invece è lavoro mai arrivato su origin, **prima**
> `git branch salvataggio-<macchina>-<data>`.
>
> Poi i **tag**, che è la parte che sfugge:
>
> ```bash
> git fetch --tags --force
> ```
>
> Senza `--force` git li **rifiuta** («sovrascriverebbe il tag esistente») e li lascia puntati
> alla storia vecchia: `git describe` e `git show <tag>` mostrerebbero commit che su GitHub non
> esistono più. All'ufficio erano undici. I tag nuovi (`2.4.0` e successivi) passano senza
> `--force`, perché non hanno un omonimo locale — quindi il problema si vede solo sui vecchi, ed
> è facile crederlo risolto.
>
> Restano da guardare, su quella macchina, i rami di lavoro anteriori al 2026-08-31: non danno
> fastidio finché nessuno li tocca, ma un push o un merge da lì rimetterebbe dentro dei doppioni.

## ▶ Da fare nella prossima sessione

### 🌙 Dove riprendere (2026-09-08 sera)

**Il lavoro sta su due rami, `main` è pulito e allineato a origin.** La 2.6.5 è
taggata e pushata; tutto quello che è venuto dopo **non è ancora su origin**.

```bash
git checkout fix/relay-ws-dispositivo     # f30d2ba — 7 commit
git checkout fix/testo-riquadro           # 5b59b41 — 1 commit
```

| Ramo | Cosa contiene | Come si prova |
|---|---|---|
| `fix/relay-ws-dispositivo` | WebSocket sulla porta di gestione, relay che si arrende, i tre difetti del pannello LVGL, la variabile che spariva, HOWTO §10 | serve una **nuova immagine** sul WP630 per la parte LVGL; il resto si prova con l'editor locale |
| `fix/testo-riquadro` | il testo che compariva fuori dal suo riquadro | solo editor, nessun dispositivo |

`cargo check --workspace`, `pnpm build`, `pnpm test` (189) e le 13 guardie
statiche sono verdi su entrambi. **Nessuno dei due è confermato dal maintainer**:
è il passo che manca prima del merge su `main` e di una 2.6.6.

#### Le prove che aspettano

1. **La variabile che spariva** — ricaricare forzando la pagina (il bundle è
   cambiato), aggiungere una variabile, salvare le **Sorgenti**, tornare alle
   variabili: la riga deve esserci ancora, con la barra gialla che chiede cosa
   fare. Prima spariva in silenzio.
2. **Il pannello LVGL** — deploy di un'immagine costruita dal ramo con un
   progetto LVGL attivo: il companion deve **ripartire da solo** e mostrare il
   progetto NUOVO. La procedura per costruire una sola immagine senza pubblicare
   è in [`docs/HOWTO.md` §10](docs/HOWTO.md).
3. **Il testo nel riquadro** — trascinare una maniglia su un testo: diventa un
   riquadro vero e le lettere ci stanno dentro.
4. **Sandokan / MQTT** — solo a casa, il progetto è rimasto rotto apposta.
5. **Q38** (materializzazione ratio) e **Q37** (cornice del pannello).

#### Lo stato del WP630, che non è pulito

Ci ho lavorato in SSH con il permesso del maintainer. Sul pannello adesso:

- runtime `localhost/sws-runtime:2.6.5-arm64` (build da `main`, installazione
  **pulita**: progetti, configurazione e storico azzerati);
- `sws-lvgl-viewer` **riavviato a mano** alle 17:15 — prima girava ancora
  sull'immagine di due ore prima. Le correzioni che lo riguardano **non sono
  ancora sul dispositivo**: servono una nuova immagine e un nuovo deploy;
- il progetto caricato ha una pagina con **un solo oggetto testo**, quindi lo
  schermo è quasi vuoto anche quando funziona. Resta da confermare se il nero
  visto era il congelamento o se c'è dell'altro fra LVGL e Weston.

Ambiente del pannello, misurato: `desktop.target` attivo, Weston con
`xwayland=true`, il viewer connesso davvero a Xwayland (4 socket X11),
`card1-LVDS-1` a 1920×1080 — coerente con la geometria SDL2. Il browser
disabilitato è corretto: è la funzione nuova di PixsysOS 2.1.0 per i progetti
LVGL. **Le unit sono `systemctl --user` dell'utente `user`**: interrogate da
root rispondono «No entries» e sembrano assenti — ci si perde mezz'ora.

### 🎯 Rilasciata la 2.6.5 — pronta da compilare e installare (2026-09-08)

`main` contiene tutto: il lavoro notturno (`fix/mqtt-topic-vuoto`, squash) più
l'allineamento SSH descritto sotto. Tag annotato `2.6.5`, pushato.

**Le prove che restano al maintainer**, in ordine di valore:

1. **WP630 appena resettato (ufficio)** — è il banco di prova della modifica SSH. Dopo il
   factory reset il deploy **deve** fermarsi con l'avviso e il pulsante «Dimentica la vecchia
   chiave e riprova»; il pulsante toglie la chiave vecchia ma **non installa** quella nuova,
   quindi serve comunque `ssh-copy-id`. Poi: il pannello deve mostrare SWS e non Cockpit.
2. **Sandokan / MQTT — solo a casa.** Il progetto è rimasto rotto apposta: apri Sorgenti,
   salva (la potatura toglie la riga senza topic), ridistribuisci, e verifica che `mqtt-casa`
   si colleghi e **resti su**.
3. **Q38** (materializzazione ratio) e **Q37** (cornice del pannello, sul dispositivo).

**Rami**: in locale è rimasto solo `main`. `feat/lvgl-gap`, `fix/sws-display-path-loop` e
`test/validazione-2026-09-06` erano già dentro `main` **per contenuto** — verificato file per
file, non per ancestry — e mergiarli avrebbe fatto tornare indietro il repo (il ramo di
validazione dichiarava ancora `2.5.0`). Cancellati in locale; su origin lo erano già.
**Resta da cancellare su origin `fix/mqtt-topic-vuoto`**, quando vuoi.

### 🔐 La specifica SSH, e il punto in cui non la rispettavamo (2026-09-08)

Tre regole dichiarate dal maintainer: `user` sono le credenziali **limitate** dell'utente
finale (`user`/`123456` è solo di prova, il cliente definirà le sue); `pixsys` è l'accesso
**privilegiato**, utile solo ora in test, e nessun comando di produzione può presupporlo; la
chiave SSH **non si cancella mai da sola** — se cambia dopo un factory reset la connessione
deve fallire, e l'utente si agevola con un pulsante, non si scavalca.

Sui primi due punti eravamo a posto, ed è stato verificato: `123456` non compare come
credenziale da nessuna parte, `pixsys@` non è cablato in nessun comando eseguito (solo nella
documentazione e nella riga d'uso di `scripts/yocto/deploy.sh`), e il percorso di produzione —
il container — non esegue **un solo `sudo`**.

Sul terzo **no**. Il pulsante era stato scritto il 2026-09-07, ma
`StrictHostKeyChecking=no` era rimasto in **sedici** invocazioni. E quell'opzione non fa
quello che sembra: da `ssh_config(5)`, con `no` una chiave *cambiata* lascia proseguire la
connessione disabilitando password e keyboard-interactive — **non** la chiave pubblica. Su un
dispositivo con `ssh-copy-id` già fatto, il deploy verso un host che aveva cambiato identità
sarebbe passato in silenzio, e il pulsante non sarebbe mai comparso. Il 2026-09-07 il guasto
si è visto **solo** perché il reset aveva cancellato anche `authorized_keys`.

Ora è `accept-new` ovunque: primo contatto invariato, chiave cambiata rifiutata.
`check_chiave_host.sh` ha una regola che lo sorveglia, **provata rossa** su un'invocazione
vera — la prima prova era un falso negativo perché `sed` aveva colpito la citazione in un
commento invece del codice.

### ⚠️ Due controlli della CI sono rossi, e non da oggi

Trovati durante il collaudo di questa sessione, in file che **né io né il lavoro notturno**
abbiamo toccato:

- `cargo fmt --check` fallisce su **~70 file** — praticamente tutto il workspace. La CI lo
  esegue (`ci.yml:38`).
- `cargo clippy -- -D warnings` fallisce con due lint in `sws-core`:
  `type_complexity` (`alarm.rs:312`) e `too_many_arguments` (`geometry.rs:53`).

Non li ho corretti: sono fuori dallo scopo di questa release e `cargo fmt` produrrebbe un
diff di settanta file in mezzo a un rilascio. Da sapere: la CI usa la toolchain **1.75**
mentre qui c'è la **1.94**, e solo la stable è installata — non ho potuto verificare se sulla
1.75 i due lint scattino davvero. Da decidere in una sessione dedicata: correggere, o
dichiarare gli `allow` con il perché accanto.

### 🔒 «Connetti» a un pannello senza utenti chiudeva fuori dall'editor (2026-09-08)

Segnalato con schermata: pannello con un progetto **senza utenti**, credenziali rimaste nel
modulo, e all'atto di connettersi comparivano **insieme** «✗ unauthorized» e il modale
«Sessione scaduta — inserisci la password per continuare come admin / Password errata». Due
vicoli ciechi in uno: la sessione locale era viva, e quella password non poteva funzionare.

Catena: `connect_remote` rispondeva **401** quando il login sul dispositivo falliva; `request()`
in `client.ts` tratta *qualunque* 401 come scadenza della propria sessione e apre l'overlay.
Ma la UI controllava `result.ok` — cioè era progettata per un **200 con `ok:false`**, e quel
ramo non veniva mai raggiunto perché `request()` lanciava prima.

Tre correzioni:
1. **`connect_remote` non usa più lo stato HTTP per gli esiti remoti**: tutto nel corpo
   (`ok`/`error`/`nota`), che è ciò che la schermata sa già leggere.
2. **Il 401 di un altro runtime non è il nostro**: in `client.ts` le rotte `/api/remote/*` non
   scatenano più `sws:session-expired` (lista dichiarata, nello stile di `PATH_RIPORTANO_VERSIONE`).
3. **Il no-auth si riconosce**: se il login remoto dà 401, si sonda `GET /api/auth/whoami` senza
   token — 200 significa «nessun utente» — e allora ci si connette **senza** credenziali,
   dicendolo nella nota. Con credenziali davvero sbagliate il messaggio nomina utente e URL.

Scoperto strada facendo e utile saperlo: **gli utenti appartengono al progetto** (aprirne uno
scambia lo user store), quindi un runtime senza progetto è per forza in no-auth — è il motivo
per cui la guardia deve seminare un progetto per avere un admin.

Prove: `check_connessione_remota.sh` (25ª con stack) con **due runtime veri**, uno con utenti e
uno senza, 7 controlli sul caso esatto della segnalazione; **provata rossa** ripristinando il 401.

### 📺 Il pannello mostrava Cockpit dopo il deploy — e lo Stato non diceva niente

Due segnalazioni del maintainer del 2026-09-07 sera, stesso ramo.

**Il browser del pannello — due difetti, non uno.** Misurato sul dispositivo: `GetUrl`
rispondeva `http://127.0.0.1:9443`, cioè il **valore di fabbrica** — quindi il `SetUrl`
dell'installer *non era mai andato a buon fine*, e il blocco non aveva un ramo `else`: una
chiamata rifiutata si leggeva come un successo. Inoltre stava **dentro** il ramo «/health ha
risposto», quindi qualunque intoppo nell'attesa se lo portava via. Ora il `SetUrl` sta prima
dell'attesa, indipendente, e **stampa l'errore** col comando da rifare a mano.
Secondo difetto, sotto: `chromium-start main-app` legge l'URL **solo all'avvio**: col browser
già in esecuzione — dopo un factory reset lo è, sulla pagina di configurazione, che è il valore
di fabbrica — l'installazione riusciva e lo schermo non cambiava. Ora l'installer riavvia
`chromium@main-app.service` dopo il `SetUrl`, **solo se era già attivo** (con STOP premuto il
launcher tiene Cockpit su `wp-control` e non avvia main-app: avviarlo noi coprirebbe la via di
fuga). Copre anche il caso dell'aggiornamento: una SPA già caricata resta quella finché il
browser non riparte. Tre regole nuove in `check_systemd_units.sh` (riavvio presente, condizionato a
`is-active`, e `SetUrl` che riporta il fallimento), **tutte provate rosse** — e la prima
versione di una era un falso negativo, perché trovava la stringa dentro un `echo` di aiuto
invece del comando eseguito. Corretto anche il controllo `/health`, che provava solo HTTP:
su un aggiornamento sopra una config con TLS avrebbe dichiarato «il runtime non risponde»
a installazione riuscita.

**Lo Stato della Gestione container.** Filtrava i container sul nome esatto `sws-runtime`:
niente companion LVGL, e su una macchina pulita l'intestazione nuda di `podman ps`, che si
legge come un guasto. Ora elenca container SWS ed estranei, immagini (le 10 più recenti),
stato del companion, e dice «nessuno» a parole; in testa dichiara **dove** ha guardato
(questa macchina, oppure `utente@host:porta`). Il test che sorveglia quel comando ora
verifica anche l'escaping delle graffe del template Go — `format!` le dimezza, e con
`{.Names}` podman stamperebbe righe vuote.

### 🔑 Il factory reset che bloccava il deploy — stesso ramo `fix/mqtt-topic-vuoto`

Inciampato due volte nello stesso giorno dal maintainer: dopo il factory reset del TC620, il
deploy container si fermava con «ERROR: ssh fallito (exit 255)» e la riga utile (la chiave host
cambiata) era sepolta nello stderr di ssh. Il `known_hosts` di questa macchina è già stato
ripulito a mano (3 voci stantie: ECDSA, ED25519, RSA — backup in `known_hosts.old`).

Ora è gestito dall'editor: `run_ssh_cmd_stdin` riconosce le due righe di OpenSSH e manda alla UI
un marcatore, il pannello Container mostra un avviso che nomina il factory reset e un pulsante
«Dimentica la vecchia chiave e riprova» → `POST /api/device/hostkey/forget` (Admin, audit,
`ssh-keygen -R` sul `known_hosts` di **questo PC**, anche nella forma `[host]:porta`).

**Scelta deliberata**: la chiave non si toglie mai da sola e `StrictHostKeyChecking=no` non entra
nel codice — spegnerebbe la protezione per sempre; così la si spegne una volta, per un host, con
un gesto umano.

Prove: 2 unit test (le righe vere di OpenSSH; la validazione dell'host, che finisce in
`ssh-keygen -R`), guardia `check_chiave_host.sh` (24ª con stack, gira con una **HOME finta**:
non tocca il `known_hosts` di chi la lancia) con 12 controlli, **provata rossa** su due fronti.

### 🐛 La riga MQTT vuota che uccideva la sorgente — `fix/mqtt-topic-vuoto` (2026-09-07)

Segnalato dal maintainer: `mqtt-casa` di Sandokan in loop di riconnessione ogni 5 s con
«Broken pipe». **Non era il container, né la rete, né il broker.**

Diagnosi (fatta dai file, senza SSH sul dispositivo): il client che flappava era il runtime
**dell'editor di questa macchina** — `.run-editor/config/instance_id` = `1778ef` combacia col
client_id del log (`sws-mtkk4cm8g33iz-1778ef`), e `topics: 28` combacia con la copia editor di
Sandokan (quella in `.run/` ne ha 25). Causa: la **prima riga di `mqtt-casa` ha `topic: ''`** —
filtro a lunghezza zero, errore di protocollo MQTT 3.1.1 §4.7.3, il broker chiude appena riceve
la SUBSCRIBE. Non muore la riga: muore l'intera sorgente, e infatti i tag di casa erano fermi
mentre `mqtt-sandokan` (6 topic, pulita) funzionava — da cui «il dispositivo sembra funzionare».

**Escluso** il difetto di client_id che aveva morso questo stesso dispositivo due volte in
agosto (archivio `STATUS-2026-07_08.md`): tutti e cinque i punti che riavviano le sorgenti
chiamano `resolve_mqtt_client_ids`, e le tre sorgenti hanno `random_client_id` attivo.

Tre strati, perché ognuno copre un caso che gli altri non coprono:
1. **runtime** (`sws-plugin-mqtt`): salta le righe senza topic con un WARN che dice cosa fare →
   *un progetto già installato riparte senza toccarlo*; e non crea più il tag con id vuoto a
   ogni retry (`db.ingest("")`, succedeva davvero);
2. **salvataggio** (`PUT /api/project/sources` + `ConfigView`): le righe vuote non arrivano al
   disco → *e quindi non finiscono nel deploy*. Si potano invece di rifiutare con 400 (come si
   fa per gli id duplicati) perché una riga vuota non contiene lavoro da perdere;
3. **validatore**: errore sulla riga senza topic (col perché), avviso su quella senza tag.

Prove: 2 unit test nel plugin, 4 vitest, guardia `check_mqtt_topic_vuoto.sh` (23ª con stack)
**provata rossa**. 452 test Rust, 181 vitest, clippy 0, 13 statiche verdi.

**Da fare col maintainer**: il progetto è rimasto rotto apposta — apri Sorgenti, salva, ridistribuisci
sul dispositivo (dopo il factory reset + 2.1.1) e verifica che `mqtt-casa` si colleghi e resti su.


### 🧪 `test/validazione-2026-09-06` — il ramo da provare, poi merge su main + push

**Tutto pushato su origin il 2026-09-07** (main con la revisione documenti, i sei rami Q,
`fix/revisione-documenti` e questo ramo): da qualunque macchina, `git fetch` e
`git checkout test/validazione-2026-09-06` bastano per il collaudo.

Contiene **tutte e sette le questioni chiuse il 2026-09-06** (la pila è lineare, la cima
contiene tutto): Q27 tipo, Q42 scaling script, Q17 ricette, Q35 (solo docs), Q38 ratio,
Q37 cornice, Q41 risorse chat. Verificato sul ramo: 450 test workspace, 172 vitest, clippy 0,
13 statiche + 8 guardie con stack dell'area toccata, tutte verdi.

**Collaudo a mano (in ordine di valore):**

1. ✅ **Q41 — confermata dal maintainer il 2026-09-07.** La riga ◔ coi token compare e cresce
   a ogni risposta con la chiave vera. Niente da rifare.
2. **Q38** — apri un progetto in «solo proporzioni» con pagine senza misure (o creane una
   nuova): la pagina mostra subito bordo/riempimento T-52, il progetto risulta da salvare,
   e dopo il salvataggio le misure stanno nel file.
3. ✅ **Q27 — verde il 2026-09-07** con `./scripts/check_tipo_scrittura.sh` (10 controlli su 10,
   compreso il difetto storico: `"true"` ora arriva come booleano, non come stringa).

   > **Il testo di prima mandava su una strada senza uscita**: diceva di scrivere «abc» in un
   > setpoint, ma quel widget filtra già a monte (`<input type="number">` sul web,
   > `lv_textarea_set_accepted_chars` su LVGL) e non è nessuno dei quattro percorsi che Q27
   > protegge (`PUT /api/tags/:id`, WebSocket, ricette, script Python). Per provarlo a mano serve
   > un `button` con `write_value: abc`, uno script, o una ricetta — e un progetto che **dichiari**
   > i tag: su un progetto senza tag il tipo è ignoto e per disegno non vincola.
4. ✅ **Q17 — verde il 2026-09-07** con `./scripts/check_ricette.sh` (8 controlli su 8: il 403
   nomina il tag vietato, l'all-or-nothing regge, e l'audit firma l'utente autenticato).
5. **Q37** — sul TC620 (quando capita): pagina più piccola dello schermo → cornice neutra
   scura uniforme, non spazzatura video.

Dopo il tuo ok: squash merge su `main` (un merge per ramo, nomi già in questa sezione) e push
— **su tua istruzione**, come da regola.


### ✅ Q41 + Q37 + Q38 — il terzo giro di questioni, sui rami impilati (2026-09-06, sera)

- **Q41 — la chat mostra token e credito** (`feat/Q41-risorse-chat`): frame `risorse` dopo ogni
  turno (il dato era già in `Risposta.usage`, zero chiamate extra) sommati per conversazione;
  frame `saldo` all'apertura, solo per chi lo espone (Kimi ha `/v1/users/me/balance`; Anthropic
  non espone il saldo con la chiave d'uso — verificato). Riga presente di default, nascondibile
  col ◔ (preferenza per-utente nel browser); vale anche per la finestra staccata.
  **Da provare con la chiave vera**: `SWS_AI_FAKE` non produce `usage`.
- **Q37 — la cornice attorno al foglio sul pannello è deliberata** (`fix/Q37-cornice-lvgl`):
  il neutro delle bande web (#0f172a) — `fill_rect` condizionale su SDL2, `riempi()` una volta
  su DRM. Il taglio resta dichiarato. **Prova visiva da pannello vero.**
- **Q38 — in `ratio` le misure si scrivono nel file** (`fix/Q38-ratio-materializza`): `addPage`
  semina la risoluzione di riferimento, `useMaterializzaRatio` sana i progetti vecchi
  all'apertura (marcandoli sporchi: modifica vera, salvataggio esplicito).

Stato: 450 test workspace, 172 vitest, clippy 0, build verdi. **14 vive + 28 archiviate = Q1..Q42.**

### ✅ Q35 — chiusa senza codice: l'esplicito esisteva già (`visible`)

Il maintainer aveva scelto l'opzione 2 (campo `disabled` esplicito); la verifica pre-implementazione
ha scoperto che **è già realizzata sotto il nome `visible`** — campo statico + `visible_tag`
dinamico in tutti e tre gli specchi, checkbox nel pannello, fantasma 0.35 in editor, applicazione
live su LVGL, voci nel manuale. Aggiungere `disabled` avrebbe violato la regola UI n. 2 (mai due
punti del pannello per lo stesso dato). Deciso su queste premesse: si chiude constatando la
coesistenza — fuori-pagina e visibilità in OR, parcheggio esente dal validatore, `visible: false`
ancora validato e resuscitabile da tag. La semantica completa è nella scheda archiviata.
Zero righe di codice: il valore della sessione è la scoperta, registrata prima che qualcuno
implementasse un doppione. 17 vive + 25 archiviate = Q1..Q42.

### ✅ Q17 — la soglia per-tag vale anche per le ricette, su `fix/Q17-ricette-soglia` (impilato su Q42)

Terza della famiglia dei confini di scrittura (Q27 il tipo, Q42 lo scaling, Q17 il **chi**).
Opzione 1 scelta dal maintainer, con semantica **all-or-nothing**: un setpoint sopra il ruolo
→ 403 con l'elenco, niente applicato. In più l'apply ora firma l'audit hash-chained
(`recipe.apply` / `recipe.apply_denied` con l'utente autenticato — prima era l'unico percorso
di scrittura senza traccia, e lo storico si fidava dell'`applied_by` autodichiarato).
Guardia nuova `check_ricette.sh` (21ª con stack, si porta il suo progetto perché nessun
template ha ricette né `write_min_role`), 8 controlli, **provata rossa**. 209 test sws-web,
clippy 0. Scheda archiviata: 18 vive + 24 archiviate = Q1..Q42.

### ✅ Q42 — gli script scrivono in unità ingegneristiche, su `fix/Q42-scaling-script` (impilato su Q27)

La scoperta collaterale di Q27, chiusa il giorno stesso col giro «proponi → decidi → implementa
→ archivia». `tags.write` era l'unico dei quattro percorsi senza `scale_to_raw`: uno script che
scriveva un tag scalato posseduto da un plugin consegnava al PLC l'eng come raw. Prima di
toccare il motore si è misurato il rischio della doppia compensazione (nessun template del repo
definisce scaling; il maintainer ha confermato per i progetti reali). Fix di una riga speculare
a `write_tag`, contratto nel docstring, unit test 4-20 mA (eng 50 → raw 12 sul bus, eng 50 nel
fallback virtuale) **provato rosso e verde**. 450 test workspace, clippy 0. Scheda archiviata:
19 vive + 23 archiviate = Q1..Q42.

### ✅ Q27 — il `data_type` è un contratto, su `fix/Q27-tipo-in-scrittura` (da confermare e mergiare)

Prima questione chiusa col nuovo giro «proponi → decidi → implementa → archivia». Politica
scelta dal maintainer: **coercizione senza perdita** (Int→float, Float intero→int,
`"true"`/`"false"` e stringhe numeriche; il resto 400 col motivo). Un solo punto di verità —
`TagDb::coerce_for_write` + mappa `data_types` in `sws-core` — chiamato da PUT, WebSocket,
ricette e script Python; l'editor mostra già gli errori (toast F3.7), zero modifiche client.
Prove: 2 unit test nuovi (449 totali workspace), guardia `check_tipo_scrittura.sh` (20ª con
stack) **provata rossa** spegnendo la coercizione — vede anche il difetto originale, la stringa
`"true"` conservata su un tag bool. Scheda archiviata con la decisione; **scoperta collaterale
Q42**: gli script scrivono senza `scale_to_raw`, unico percorso dei quattro — aperta, non decisa.

Verifica rapida a mano, con lo stack su:
```bash
curl -s -X PUT localhost:8444/api/tags/demo.cmd.enable -H 'Content-Type: application/json' -d '{"value":"abc"}'
# → 400 {"error":"il tag «demo.cmd.enable» è dichiarato bool, ricevuto string («abc»)"}
```

### 🧹 Revisione dei documenti — fatta il 2026-09-06, su `fix/revisione-documenti`

Cinque mesi di pianificazione rimessi a dire il vero, col piano approvato in
[`docs/plans/2026-09-06-revisione-documenti.md`](docs/plans/2026-09-06-revisione-documenti.md):

- **`docs/OPEN_QUESTIONS.md` 3476 → 1366 righe**: 21 schede decise-e-realizzate, **ognuna
  verificata sul codice prima di archiviarla** (l'artefatto che dichiara, non la prosa),
  spostate integrali in [`docs/history/OPEN_QUESTIONS-chiuse.md`](docs/history/OPEN_QUESTIONS-chiuse.md)
  col timbro e la prova. Le cinque schede che si contraddicevano (testa «Decided», coda «not yet»)
  risolte **con un fatto**, non con una decisione. Restano vive 20 schede.
- **`STATUS.md` 4022 → ~810 righe**: luglio e agosto integrali in
  [`docs/history/STATUS-2026-07_08.md`](docs/history/STATUS-2026-07_08.md); le ~76 voci del log
  piatto «Release 2.1.0» hanno finalmente intestazioni markdown. Una riga per gruppo in «Storico».
- **`docs/plans/README.md`** (nuovo): 20 piani, ognuno con esito verificato ed evidenza; riga di
  stato in testa ai 14 fatti. `global-scripts-template-snippets.md` è **segnalato come falso**
  (punta a un file mai esistito) ma la rimozione è una chiamata del maintainer.
- **`docs/CONTEXT.md` §3** riscritta contro il codice di oggi (era «as of June 2026»).
- **Guardia nuova `scripts/check_documenti.sh`** (fra le statiche, provata rossa in due modi):
  vivo + archivio = Q1..Q41 senza buchi né doppioni, ogni `Q<n>` citato in STATUS / TESTING_GUIDE /
  CONTEXT / codice si risolve, ogni scheda archiviata porta il timbro.
- Quattro affermazioni stantie corrette qui dentro con la data (push fatti, comando `--delete`
  riscritto, ramo T-51 inesistente, punto F9c superato dai seguiti di Q14).

**Da decidere dal maintainer** (il report è il prodotto della revisione): le 20 questioni vive —
elenco corto consegnato a fine sessione. In sospeso anche: i **5 rami su origin** ancora da
cancellare col comando corretto (vedi sotto), e la scheda Q16 «riverificata: metà è fatta».

### ✅ T-52 e il fix Q30 — mergiati in `main` il 2026-09-05 (pushati il 2026-09-06)

Confermati a schermo dal maintainer, poi due squash merge distinti su `main`
(`27f19ac` T-52, `c3099cd` il fix). L'albero di `main` è **byte per byte identico** al ramo di
prova su cui la conferma è avvenuta. I rami di lavoro sono stati chiusi; il maintainer ha
pushato tutto il 2026-09-06 (`4ddacc5..b0e0e6c`, coi tag).

**T-52 — il limite della pagina è morbido.** Il colore si ferma al bordo (con il tavolo neutro
attorno, e le bande del letterbox nel viewer `ratio`); il bordo trattiene con ~24 px schermo di
resistenza ma lascia uscire chi trascina con decisione; un oggetto portato interamente fuori dal
foglio è **parcheggiato** — resta nel file, si vede grigio in editor, e non viene disegnato né nel
browser né sul pannello né controllato dal validatore. Il piano è
`docs/plans/2026-09-04-limite-pagina-morbido.md`, le nove correzioni che l'analisi gli ha fatto
sono in `docs/plans/2026-09-05-T-52-sessioni-B-E.md`.

**Fix Q30 — «Aggiorna progetto» rifiutava ogni salvataggio successivo.** Trovato dal maintainer
*mentre* provava T-52. `/api/project/migrate` riscrive `project.yaml` e la sua risposta porta
l'ETag nuovo; il client lo buttava, e da lì ogni salvataggio prendeva un 409 con scritto «qualcun
altro ha modificato il progetto» — dove il qualcun altro era lui stesso. Corretto anche il gemello
sulla rinomina del progetto aperto, che nessuno aveva ancora colpito.

**Due guardie nuove**, entrambe provate anche rosse, che sono la parte che sopravvive:

- `check_off_page.sh` — la tabella di casi del «fuori pagina» è dichiarata come **dato** in Rust e
  in TypeScript, e la guardia le confronta riga per riga; più il controllo che i due crate
  **chiamino** `is_off_page` invece di riscriverlo.
- `check_versione_progetto.sh` — legge il **corpo** di ogni handler che scrive un file di progetto,
  lo classifica (confronta `If-Match` / riporta la versione / scrive da sé) e pretende che il
  client lo copra nel modo giusto. Una rotta nuova non classificata la fa fallire. Esiste perché il
  difetto Q30 era nato da una frase in prosa — «se cambia lì, cambia qui» — che ha mentito per due
  settimane senza che niente lo dicesse.
- `check_soft_edge.sh` — il limite morbido misurato col mouse vero: fra la funzione pura e
  l'oggetto che si muove ci sono la gabbia della presa, gli offset, lo zoom e la cascata di snap, e
  nessun unit test vede quel tratto.

Stato al merge: 164 test editor, `cargo test --workspace` 441 passati, **11 guardie statiche**
verdi, `check_lvgl_parity` verde a 238 campi.

#### 🔜 Da fare, in ordine di costo

1. ~~Il push di `main`~~ — **fatto dal maintainer il 2026-09-06**.
2. **`check_f7.sh` ha un rosso preesistente e ha torto lei.** Misura il colore del testo di un
   oggetto e lo confronta con `var(--brand-text)`, il token del **tema dell'app**; ma Q18 ha
   deciso che quel colore viene dallo **sfondo della pagina**, via `--synoptic-text`. Sono due cose
   diverse per costruzione, e la guardia passa solo quando tema e sfondo pagina hanno per caso la
   stessa polarità. Verificato che non c'entra T-52: `--synoptic-text` non compare nel diff.
   Correzione: una riga nel measure, sondare `--synoptic-text` dentro il canvas.
3. **Le schermate del manuale mostrano il canvas di prima di T-52** —
   `docs/manual/screenshots/02_editor_main.png` e le vicine. Da rifare dalla macchina che ha il
   progetto `demo-manual` coi suoi 109 oggetti: rifarle su un progetto diverso darebbe schermate
   sbagliate in un altro modo.
4. **`check_viewer_layout.sh` non può passare in nessun checkout**: crea un progetto dal template
   `demo-items`, che non esiste più (ci sono `demo-items-lvgl` e `demo-items-web`). E la stessa
   guardia esce `7` **senza una riga di output** quando manca `LD_LIBRARY_PATH` a libpython — lo
   stesso difetto già corretto in `check_project_write_safety.sh`, stessa toppa.

### ✅ Tutto mergiato in `main` il 2026-09-06 — **e pushato** (`4ddacc5..b0e0e6c`)

`main` è a `e89a830`, **quattro commit sopra origin**, albero pulito. Confermato a schermo dal
maintainer (T-52, i tre difetti minori, e il tema chiaro provato commutando l'IDE).

| Commit | Cosa |
|---|---|
| `27f19ac` | T-52 — il limite della pagina è morbido |
| `c3099cd` | Q30 — «Aggiorna progetto» rifiutava ogni salvataggio successivo |
| `af657f9` | manutenzione: guardie rotte, il blocco del pannello, il tema chiaro |
| `e89a830` | tre corse in `ponte.test.ts`: la suite era intermittente |

#### I rami: cosa ne è stato

**Verificato prima di cancellare**, perché il progetto usa lo squash merge e un ramo già mergiato
risulta comunque «non mergiato» per ascendenza — la parentela non dice niente, conta il contenuto.

| Ramo | Esito |
|---|---|
| `fix/manutenzione-notturna` | mergiato in `af657f9`; albero di `main` **byte per byte identico** al ramo |
| `fix/editor-pannello-minori` | contenuto dentro il precedente (verificato con `merge-base --is-ancestor`) |
| `feat/T-50-chat-ai` | **già in `main`**: 5 righe caratteristiche su 5 presenti |
| `origin/feat/lvgl-gap`, `origin/feat/editor-runtime-chiarezza` | **già in `main`**: 5 su 5 |
| `origin/feat/chat-staccata-e-python` | **già in `main`**: 4 su 5 |
| `origin/fix/sws-display-path-loop` | **già in `main`**: i tre file di codice sono byte per byte identici, e il `PathExists=` che il fix toglieva non c'è più |
| `feat/scada-f6`, `feat/scada-f7` | **pre-riscrittura**, del 23 agosto. Solo 1 riga su 8 ritrovata in `main` — ma quel codice è stato riscritto da T-46 in poi, quindi la misura non prova niente in nessuna direzione |

I due pre-riscrittura non esistevano su origin: cancellarli sarebbe stato irreversibile, quindi
prima sono stati **archiviati con un tag** — `archivio/scada-f6` e `archivio/scada-f7`, locali e non
pushati. Se un giorno servisse qualcosa da lì, i commit ci sono ancora.

Tutti i rami locali sono spariti: resta **solo `main`**.

#### 🔜 Cosa resta

1. **Il push**, quando lo si vuole: `git push origin main` (quattro commit) e i tag di archivio
   `git push origin archivio/scada-f6 archivio/scada-f7` se li si vuole al sicuro anche su GitHub.
2. **I rami su origin non sono stati toccati** — cancellarli è un push, e serve un'istruzione
   esplicita:
   Il primo tentativo (2026-09-06) è fallito **in blocco**: conteneva
   `feat/T-52-limite-pagina-morbido`, che su origin non c'era più, e git rifiuta tutto il push se
   un riferimento non esiste. I cinque rami sono quindi ancora là:
   ```bash
   git push origin --delete feat/T-50-chat-ai feat/lvgl-gap \
       feat/editor-runtime-chiarezza feat/chat-staccata-e-python fix/sws-display-path-loop
   ```
3. **Le schermate del manuale** mostrano ancora il canvas di prima di T-52: vanno rifatte dalla
   macchina che ha il progetto `demo-manual`.
4. **F2 non è mai stato provato sul vetro**: vuole un avvio `--backend drm` con pagina e display di
   misura diversa. La matematica ha sei casi provati, il comportamento no.

### ▶ Cose rimaste in sospeso da prima di T-52

#### 👁 T-51 / fase 3 «gli occhi» — in `main` (`5af3be4`), da provare con un modello

L'assistente ha lo strumento `istantanea_pagina`: restituisce un'immagine di come **LVGL** disegna
una pagina, così può verificare invece di dichiarare fatto.

> Il maintainer ha detto che **T-51 lo sta definendo un'altra sessione**: questo ramo è la fase 3
> del piano della chat, presa nel frattempo. Non toccare `docs/CONTEXT.md` per il numero.

Il pezzo di disegno che conta: **un banco di prova**, non il runtime che gira. Il viewer LVGL vuole
una porta *viewer*, e l'IDE dove si chatta gira sull'editor, che non ne ha — e sul dispositivo,
dalla 2.4.0, l'IDE non c'è più. Quindi si avvia un runtime usa e getta su una copia del progetto in
una directory temporanea.

**Il banco di prova non si collega al campo**: il progetto copiato perde sorgenti, script globali,
notifiche e datastore. Senza, ogni fotografia avrebbe aperto Modbus e OPC-UA, si sarebbe presentata
al broker MQTT con lo stesso client id del runtime vero (l'incidente del 2026-08-21) e avrebbe
mandato email e Telegram. Ne segue che **i tag valgono il valore iniziale**: l'immagine dice com'è
fatta la pagina, non cosa mostra l'impianto adesso.

Verificato: `./scripts/check_istantanea.sh` (guardia nuova, fra le CON_STACK) prova la catena intera
e riapre il PNG per contare i pixel del rettangolo — 18784 su 20000 teorici. Provata anche rossa.
14 test: la lettura del PPM, il PNG, il filtro delle note, la sterilizzazione (sulla funzione **e**
sulla copia, perché una funzione giusta che nessuno invoca non protegge niente) e la forma del
blocco immagine, che è l'unica parte del percorso verso il modello provabile senza un modello.

**Da provare con un modello vero**: che l'assistente chiami lo strumento e *usi* l'immagine. Il
percorso HTTP e il blocco immagine sono scritti ma nessun modello li ha ancora esercitati — è la
stessa cosa che manca alla chat staccata.

Nota: `sws-lvgl-viewer` non è nell'immagine container **x86_64**, solo nell'arm64. Là lo strumento
dice perché non può.

#### Le due prove sul dispositivo che restano da fare

1. **Q34** — nell'IDE, uno script globale con `*/5 * * * *`: deve partire, e il campo cron deve
   mostrare il suggerimento con le forme ammesse passandoci sopra col mouse. **Questa si collauda
   a mano davvero.**
2. **Q30** — nel browser guarda le **regressioni**, non la corsa: che i salvataggi vadano, che
   backup/restore/import funzionino, che niente si pianti. La corsa in sé **non è riproducibile a
   mano** — la finestra è di millisecondi, due salvataggi da due schede sono lontani secondi — e la
   prova sta nel caso 6 di `./scripts/check_project_write_safety.sh` (10/10, e rosso disattivando
   il lock).

E le tre che nessuna guardia prova: il **Deploy completo** verso un dispositivo vero attraverso la
porta stretta `--no-admin`; la **chat staccata** con una proposta di modello vera;
`e2e/chat-ai.spec.ts`.

#### Cosa si potrebbe prendere in mano adesso

Nessuna di queste è iniziata, e ognuna sta in una sessione:

- **Q33** — lo «Stop» dell'acquisizione viene annullato in silenzio da un salvataggio delle
  Sorgenti: fermi l'impianto per lavorare in sicurezza e un salvataggio lo riavvia. Tre opzioni in
  scheda, **serve la tua scelta** prima di partire (l'opzione 1 — un `armed` esplicito nel
  supervisore — è 2-3h e prepara Q8-E).
- **La spia mancante nell'IDE** per uno script globale non schedulato: l'errore del cron va nel log
  e nel validatore, ma chi non guarda il log non lo scopre (addendum a Q34).
- **Q30, il pezzo che resta**: due schede che salvano la *stessa* sezione. Nessun lock lo risolve,
  serve un controllo ottimistico — e `calcola_impronta` è la granularità sbagliata (darebbe 409 a
  chi salva un tag perché un altro ha mosso un rettangolo). Serve un'impronta del solo
  `project.yaml` o un contatore di versione, che ora è facile: c'è un punto solo dove incrementarlo.
- **Il video della demo**, unico residuo di Fase 5 — task tuo, fuori dallo scope di Claude Code.

# x86_64, nessun SDK richiesto
./scripts/build_container_x86_64.sh --push
# aarch64 generico (Raspberry Pi, VM arm64): nessun SDK, tutto sotto QEMU
./scripts/build_container_aarch64_generic.sh --push
# aarch64 Pixsys: richiede l'SDK Yocto in /usr/local/oecore-x86_64/
./scripts/build_container.sh --push
```

Poi sul dispositivo: `./deploy/container/install-container.sh --pull`.

**Il primo dispositivo aggiornato è anche il primo collaudo del giro di deploy attraverso la
porta stretta** — la guardia dimostra che le rotte ci sono e rispondono, non che `remote_deploy`
arrivi in fondo. Se qualcosa non torna, la via di recupero è togliere il `#` dalla riga `Exec=`
in `~/.config/containers/systemd/sws-runtime.container` e
`systemctl --user daemon-reload && systemctl --user restart sws-runtime`: quella riga è già
scritta là dentro di proposito, perché `Exec=` sovrascrive il comando dell'immagine per intero e
ricomporlo a memoria su un dispositivo in campo vuol dire sbagliarne un pezzo.

**Cosa c'è dentro** (i sette commit sono nella history del ramo, con il dettaglio):

1. la chat dell'assistente si stacca in una finestra propria — l'ultimo pezzo del piano di T-50;
2. `POST /api/script/check` compila Python **senza eseguirlo**, più `controlla_python`,
   `leggi_script`, `schema_python`;
3. le regole del validatore sugli script globali, e il `child` delle celle di griglia che prima
   non veniva validato;
4. il diff dell'assistente ora **vede il Python**, riga per riga;
5. `--no-admin` diventa il default sui deploy, nella forma «porta stretta» invece che «porta
   assente»;
6. il passo AST nel controllo Python — vedi sotto, è la storia più istruttiva della sessione;
7. la riga `Exec=` pronta nel quadlet.

**Tre difetti vivi trovati strada facendo**, e due erano peggio di quel che stavo aggiungendo: il
cron che non capisce `*/5` e **non parte mai** in silenzio (**Q34**, registrata, non risolta); il
diff che mostrava «nessuna modifica» su una proposta che riscriveva una funzione; un bottone
dentro una cella di griglia che puntava al nulla senza che niente lo dicesse.

**La storia da ricordare**: il maintainer ha installato RestrictedPython su richiesta, e il ramo
del test sul sandbox — che prima si **saltava**, quindi non l'aveva mai eseguito nessuno — è
fallito subito, scoprendo un difetto nel disegno: `compile_restricted` compila `import os` e
`open(...)` senza obiettare, perché non sono costrutti proibiti ma nomi che a esecuzione non
esistono. Serviva il passo AST. Un test che si salta in silenzio è verde e cieco proprio sul
comportamento per cui esiste.

**Non provato, e va provato sul dispositivo:**

- il **giro completo del Deploy** verso un dispositivo in `--no-admin`;
- la **chat staccata con una proposta vera** dal modello (serve la chiave);
- la prova end-to-end della chat (`e2e/chat-ai.spec.ts`), che non è mai girata.

**Nota per i test Rust**: servono `LD_LIBRARY_PATH` verso la libpython di pyenv, altrimenti il
binario di test non parte. `export LD_LIBRARY_PATH=$(python3 -c 'import sysconfig;print(sysconfig.get_config_var("LIBDIR"))')`.

**Domande aperte accumulate in questa sessione**: **Q32** (quale delle due porte è la via normale
per modificare un progetto), **Q33** (`system/stop` annullato dal Salva delle Sorgenti), **Q34**
(il cron). Q8 ha ora un `Decided` del maintainer per l'opzione A.

---

### 0. Lo stato reale dopo il trasloco su frodo (2026-08-31, sera)

Il lavoro del **2026-08-31** è **su `main`**: i due rami (`fix/sws-display-path-loop`,
`feat/lvgl-gap`) sono stati squash-mergiati, pushati e rilasciati come **2.3.4**. I rami
esistono ancora su locale e su `origin` — verificato dalla sessione su theobroma che **non
contengono nulla di assente da `main`** (unica differenza: due righe di testo che main ha già
corretto). La cancellazione resta decisione del maintainer.

**Il lavoro è ripreso su `frodo`** (`pixsys@frodo`, `/home/pixsys/sws`), theobroma era al 99%
di disco. Verificato sulla macchina nuova, il 2026-08-31:

| | Esito su frodo |
|---|---|
| `cargo check --workspace --all-targets` | ✅ verde, 14 crate compreso `sws-lvgl-viewer` (clang 19 + SDL2 2.32 di Debian 13 vanno bene) |
| `cargo test --workspace` | ✅ **318 passati, 0 falliti** |
| `pnpm build` | ✅ verde (da lanciare **dentro `sws-editor/`**: fuori, `pnpm` non esiste) |
| `./scripts/check_static.sh` | ✅ **7 guardie statiche verdi** (le altre 13 vogliono uno stack in ascolto) |
| Prerequisiti di sistema | ✅ clang/libclang, SDL2, freetype, python3-yaml, qemu-user-static, binfmt, uidmap, podman 5.4.2. Mancano `rsync`, `skopeo`, `fuse-overlayfs` (nessuno indispensabile) |
| SDK Yocto | ✅ `/usr/local/oecore-x86_64/` (Pixsys 1.8.0, sysroot con libpython3.12, SDL2, libdrm) |
| Rete verso il WP630 | ✅ `192.168.1.120` risponde (la `/23` di `ens18` copre 192.168.1.x) |

Trappole di frodo, imparate durante il trasloco:

- **`pnpm` arriva da corepack**, che legge `packageManager` dal `package.json`: funziona solo
  dentro `sws-editor/`. Da altrove, `command not found`.
- **`python3` è pyenv 3.11.2** (`~/.bashrc` fa `pyenv init`), il Python di sistema è 3.13.5. Un
  controllo lanciato con `sudo` o da shell non interattiva usa un Python diverso da quello del
  maintainer, e può **passare per il motivo sbagliato**.
- **`rsync` non c'è**: per i trasferimenti, `tar cf - dir | ssh host 'tar xf -'`.
- **Il percorso dell'SDK è cablato in tre script** (`build_container.sh:66`,
  `build_containers_all.sh:68`, `yocto/build.sh:41`): deve stare in `/usr/local/oecore-x86_64/`.
- Identità git **locale al repo** (`Mauro Soligo <mauro@soligo.net>`), non globale.

**Il referto integrale del trasloco è in `docs/plans/2026-08-31-trasloco-frodo.md`** — sta solo
su theobroma e va ancora portato qui.

### 0-bis. `--istantanea`: si può guardare il pannello senza il pannello

La cosa più utile della giornata, e non era nel piano. Il viewer disegna una
pagina, salva un'immagine PPM ed esce; `--tocca "x,y;x,y"` tocca lo schermo
prima di fotografare e **dice quali comandi il tocco ha prodotto**.

```
sws-lvgl-viewer --base-url http://… --page "Indicatori" --istantanea /tmp/p.ppm
convert /tmp/p.ppm /tmp/p.png
```

Costa **+21 KB** sul binario ARM (misurati), perché il rendering di LVGL era già
interamente software: SDL2 e DRM servono solo a *mostrare* il buffer.

Nelle prime ore di vita ha trovato **otto** difetti, sei dei quali silenziosi:

| Difetto | Da quanto c'era |
|---|---|
| `LV_COLOR_SCREEN_TRANSP 0`: un oggetto semitrasparente **non veniva disegnato** invece di sbiadire | da sempre |
| Le pipe che salgono venivano tagliate (origine dal primo punto invece che dall'angolo) | da sempre |
| Le celle della griglia della demo erano vuote — **anche nel browser** (`objects:` non è un campo di `GridCell`) | mesi |
| La `setpoint` era una scheda bianca con le barre di scorrimento e il valore tagliato | da sempre |
| Widget catturati a (0,0) prima del calcolo di layout — **lo stesso difetto del 2026-08-24**, ripetuto scrivendo il movimento | ripetuto |
| `o_anchor_rule` della demo: intendeva una riga verticale, i due motori ne disegnavano una orizzontale | da sempre |
| Il percorso del movimento disegnato con `points` su una `line`, che nessun motore legge | introdotto oggi |
| `lv_msgbox_create` conserva il puntatore all'array dei pulsanti: array locale → **segfault** | introdotto oggi |

Il quinto merita una riga a parte: il 24 agosto quel difetto l'aveva trovato il
maintainer davanti al pannello, in una sessione. Il 31 l'ho ritrovato in due
minuti.


# se binario e SPA sono già costruiti, aggiungere --no-rust --no-spa: salta ~10 min
```

Sul dispositivo è rimasto il progetto **`ProvaDemoWeb`**, che è del 25 agosto e
contiene un `import math` che la sandbox blocca: fa errori ogni secondo. Non è un
difetto del template — quello è sano — ma di quel progetto. **Va ricreato dal
modello e rideployato.**

### 2. I test mai fatti sul dispositivo

> 🔴 **Prima di collegarti: il WP630 è rimasto in modalità configurazione.** Misurato su
> theobroma il 2026-08-31 alle 16: uptime 442 minuti (nessun riavvio in giornata),
> `chromium@wp-control.service` attivo, `desktop.target` **inactive**. In quello stato
> `sws-display-apply.sh` si rifiuta — correttamente — di toccare lo schermo, quindi **qualunque
> prova di commutazione fallirà per il motivo sbagliato**. Serve un riavvio normale (senza
> premere STOP). Le unit della commutazione, dopo la correzione della 2.3.4, sono sane
> (`sws-display.path` active, non failed).
>
> ⚠️ **Contraddizione da sciogliere**: a metà giornata il maintainer ha detto «il test al
> riavvio funziona», ma sul WP630 non risulta alcun riavvio. Forse era un altro dispositivo.
> Il test 13 resta da rifare su un device di cui si conosce lo stato.

| | Cosa | Esito |
|---|---|---|
| 10 | **Riavvio tenendo premuto STOP** (angolo in alto a **destra**, oltre 10 s) | ✅ **2026-08-29**: compare la login di Cockpit; nel manager podman `sws-lvgl-viewer` fermo, `sws-runtime` attivo |
| 11 | Il runtime non si ferma | ✅ `/health` 200, admin 200, Cockpit 200 |
| 12 | Il log dice perché | ✅ «il launcher è in modalità configurazione (chromium@wp-control.service attivo)» |
| 13 | Ritorno alla normalità | 🔲 riavvio senza toccare nulla → il pannello torna sul motore del progetto |
| 14 | Deploy **senza riavviare il runtime** | 🔲 lo schermo commuta da solo entro una decina di secondi — **richiede la 2.3.4 sul device** |
| 15 | Progetto da `enip-demo` creato **sul dispositivo** | 🔲 si apre e mostra la pagina di partenza — **richiede la 2.3.4 sul device** |

**Il passo 10 è superato.** Era il pezzo con meno certezza: fino al 2026-08-29
era stato provato solo *simulando* la modalità configurazione (avviando a mano
`chromium@wp-control`), mai col gesto vero all'avvio. Ora è confermato che il
meccanismo del launcher Pixsys e il nostro si rispettano, e che la via di fuga
del pannello resta aperta anche con SWS installato.

Misurato in modalità configurazione: `desktop.target` **inactive** — è il
discriminante su cui si regge `sws-display-apply.sh`, e regge.

### 5. Cosa aspetta ancora una conferma a schermo

Da tre sessioni: il **pull del progetto dall'IDE**, la **sezione Python unificata**, il **colore
del testo derivato dallo sfondo pagina**. Sono lavori finiti che nessuno ha mai guardato.

### 6. Il divario che resta fra web e LVGL

`model.rs` dichiara 238 campi. Erano **112 mai disegnati**; con `feat/lvgl-gap`
sono **71** — misurato di nuovo su `main` il 2026-08-31, non a memoria (confronto
dei nomi fra `model.rs` e `lvgl_render.rs` + `effects.rs`; il comando è nel referto del
trasloco). Le prime stesure di questa sezione dicevano 84: era il conto a metà del piano, prima
dei passi 9-10.

Chiusi il 2026-08-31: `opacity`, `z_index`, tutto il gruppo `blink_*`,
`stale_after_s`, `bad_value_style`, `show_alarm_state`, `quality_dot*`,
`text_wrap`/`text_valign`/`line_height`, `symbol_spin*`, `symbol_states`,
`motion_*`, `from_obj_id`/`to_obj_id` e le porte, `require_confirm`/
`confirm_message`/`critical`, più il gauge che segue le soglie dal vivo.

Restano, per ordine di conseguenza:

- **`require_reason` e la ri-autenticazione di `critical`** — il motivo di una
  scrittura critica non finisce nell'audit se il comando parte dal pannello.
  Servirebbe una tastiera e una sessione autenticata nel viewer.
- **`pipe_flow`** (tratteggio in movimento) e i marcatori delle pipe.
- **Grafici**: `bar_mode` (impilate/affiancate), legende, soglie,
  `pie_show_labels`, raggruppamento delle fette sotto soglia — 13 campi.
- **Trend**: il gruppo `trend_dt_*` sul formato di data e ora, i marcatori di
  allarme, la scala logaritmica.
- **`alarm_bell_sound*`** — il pannello non ha un suono.
- Il resto è editor-only (`locked`, `group_id`) o UX (`min_role`, dichiarato
  tale in `sws-core/src/project.rs`).

---

### Difetti trovati strada facendo

- **Nessun campo opzionale del progetto poteva essere cancellato** (2026-08-27).
  `merge_preserved` in `patch_project` ricopia le chiavi di primo livello che il file ha e la
  serializzazione non contiene — serve a non perdere ciò che una versione più nuova ha scritto.
  Ma azzerare un campo opzionale lo fa sparire dalla serializzazione: la conservazione lo
  scambiava per "chiave che non conosco" e **rimetteva il valore vecchio**.
  `PUT /api/project/page-layout` con corpo `null` rispondeva 204 e non cancellava niente, mentre il
  commento dell'endpoint dice che lo fa. Valeva per **ogni** campo opzionale di primo livello, non
  solo `page_layout`.
  Corretto confrontando con le chiavi che la struttura produceva *prima* della modifica — dedotte
  serializzando, non da un elenco a mano: un elenco si disallinea al primo campo nuovo, e quel
  campo diventerebbe silenziosamente incancellabile.
  Trovato **per caso**, ripristinando il device dopo una prova. Provato end-to-end sul WP630: set →
  presente, `null` → sparito, resto del progetto intatto.


- **Il riempimento `end-to-start` era rotto sul web**: partiva dal capo
  sbagliato e a livello pieno spariva del tutto. Trovato solo riscrivendo la
  stessa cosa per LVGL — due implementazioni della stessa regola si controllano
  a vicenda.
- **Il logo della demo era rotto anche sul web**: `src: logo.svg` si risolve
  alla radice del runtime, dove non c'è nulla (il logo sta sotto
  `/branding/<marchio>/`). Corretto in entrambe le varianti.
- **Q24 (nuova): il font del pannello non ha le lettere accentate.** Montserrat
  di LVGL copre solo l'ASCII, e ciò che manca non si disegna affatto. Su
  `demo-items-lvgl` mancano `—` (32 volte), `→` e `ù`. Il terzo è quello che
  conta: l'interfaccia è in italiano. I template **non** sono stati riscritti
  per aggirarlo — sarebbe nascondere il difetto.
- **Q23 (nuova): driver ROS 2**, chiesta dal maintainer. Portata ridotta da lui
  stesso: servono dati semplici agganciati a gauge/led/trend/button, non la
  rappresentazione del robot. Resta quindi solo la questione del *source*.

### Guardie nuove

`scripts/check_lvgl_symbols.sh` — la tabella dei simboli vendored del viewer
contro quella dell'editor, più l'esistenza dei file. Serve perché 7 nomi file su
11 **non** coincidono con l'id (`battery` → `battery-charging-high.svg`): chi si
fidasse della convenzione otterrebbe 7 simboli muti su 11. Provata in entrambi i
versi.

`check_demo_templates.sh` ha fatto il suo lavoro da solo: appena `image` è
diventato un tipo supportato da LVGL ha segnalato che palette, elenco solo-web e
template erano rimasti indietro.

**Aggiunte il 2026-08-31** (sui due rami in attesa di merge):

| Guardia | Cosa impedisce |
|---|---|
| `check_lvgl_types.sh` | il badge «L» della palette mente sui tipi che il pannello disegna |
| `check_systemd_units.sh` | condizioni di livello che fanno ciclare una unit, `.path` verso unit inesistenti, `ExecStart=` relativi |
| `check_static.sh` | **le altre non venivano lanciate**: a fine sessione se ne ricordavano sei, per nome, a memoria. Le lancia tutte, e fallisce se in `scripts/` compare un `check_*.sh` non classificato |

E dentro `check_templates.sh`: ancoraggi delle pipe verso oggetti inesistenti,
porte sconosciute, celle di griglia che non disegnano niente, `points` su una
`line`, `write_value` di un tipo diverso da quello del tag.

Tutte provate **anche nel verso rotto**. Una guardia che non si è vista fallire
non è una guardia.


> **SUPERATO** — vale fino alla 2.1.1; da allora sono uscite 2.2.0, 2.3.0, 2.3.1,
> 2.3.2 e 2.3.3. Tenuto perché la trappola del `[patch.crates-io]` fuori dalla
> radice del workspace vale ancora, ed è la ragione di
> `scripts/check_vendor_patches.sh`.
>
> **2.1.1 rilasciata; immagine arm64 RIPUBBLICATA il 2026-08-26.** Il pannello può
> essere aggiornato: `./install-container.sh --pull` prende `latest-arm64`.
>
> ⚠️ **Se hai aggiornato un dispositivo il 25 agosto, rifai il pull.** La prima
> immagine pubblicata sotto quel tag conteneva LVGL senza la correzione del crash
> (`[patch.crates-io]` va nella radice del workspace, e c'era finito nel manifest
> del crate — cargo lo ignora). Verificato sul WP630: quella usciva con SIGSEGV in
> 20 s sulla pagina dei grafici, questa regge 75 s. Il tag git `2.1.1` è stato
> spostato sul commit che corregge.

### 1. Il WP630 è aggiornato alla 2.1.1

Fatto il 2026-08-26 con `./install-container.sh --pull`, dal percorso documentato.
`/health` ha risposto dopo 2 s.

| | |
|---|---|
| Runtime | 2.1.0 → **2.1.1** |
| Progetto | `DemoItemsLVGL` intatto, 23 tag, 4 pagine |
| Storico | **773.861 campioni conservati** |
| Viewer | dall'immagine — **nessun binario montato a mano** |
| Pagina "Grafici e tabelle" | 20 widget, nessun crash |
| Ricarica automatica (Q20) | funziona: salvata una pagina dall'IDE, il pannello si ridisegna da solo |

Per aggiornare un altro dispositivo servono `install-container.sh` e
`sws-runtime.container` da `deploy/container/` — sul WP630 non c'erano e li ho
copiati in `/data/user/sws-container/`.

### 2. Immagini pubblicate, e quella che manca

| Tag | Stato |
|---|---|
| `2.1.1-arm64`, `9afcb27-arm64`, `latest-arm64` | ✅ **è quello dei pannelli Pixsys** |
| `2.1.1-arm64-generic`, `9afcb27-arm64-generic`, `latest-arm64-generic` | ✅ aggiornata il 26/08 |
| `2.1.1-amd64`, `9afcb27-amd64`, `latest-amd64` | ✅ pubblicata |

Tutte e tre allineate al commit `9afcb27` di `main`, verificate interrogando il
registry con token anonimo — non dal log della build.

Provate sul WP630 sulla pagina "Grafici e tabelle", quella che senza la
correzione di Q22 fa uscire il viewer con SIGSEGV in 20 secondi:

| Immagine | Esito |
|---|---|
| `2.1.1-arm64` | 75 s stabile, 0 errori |
| `2.1.1-arm64-generic` | 60 s stabile, 0 errori, 20 widget creati |

L'immagine `amd64` non contiene il viewer LVGL (verificato: solo `sws-runtime`),
quindi non era interessata dal difetto.

L'immagine **aarch64-generica non l'ho potuta fare**: quel percorso richiede
`sudo` con password, e non c'eri. Serve lanciare a mano:

```
./scripts/build_container_aarch64_generic.sh --push
```

Non è quella che usano i pannelli Pixsys (loro prendono `latest-arm64`), quindi
non blocca niente di immediato.

### 3. Da provare — le cose che non ho visto confermate da te

| Cosa | Dove |
|---|---|
| **Riaprire nell'IDE il progetto del dispositivo** | Configurazione → Runtime, sotto Deploy |
| **La sezione Python unica** | Configurazione → Python |
| **Il testo che segue lo sfondo pagina** | una pagina con sfondo scuro e tema app chiaro |

Il resto l'ho verificato dal vivo sul WP630.

### 4. Il programma: cosa resta

**E — F9c: ✅ fatto il 2026-08-26.** Il modello del pannello dichiara tutti i 238
campi del mirror autorevole; prima ne conosceva 101 e gli altri 137 sparivano in
silenzio. `scripts/check_lvgl_parity.sh` confronta le due struct e fallisce se il
web ne aggiunge uno e il pannello resta indietro — provato in entrambi i versi.

⚠️ **Dichiarato non vuol dire disegnato**, ed è la distinzione da non perdere:

- *conosciuto* — il valore attraversa il modello e sopravvive al round-trip di un
  progetto. È quello che è stato chiuso adesso, e chiude la categoria dei difetti
  **muti**;
- *reso* — esiste il codice nel `render_*`. Qui resta lavoro: rifiniture di forma
  (raggio, sfumature, zone del gauge), table/bar/pie, simboli e animazioni F6.
  Ora però è un elenco visibile, non un buco.

Il modo giusto di attaccarlo è il banco di prova: aprire le stesse pagine dei
template gemelli sui due motori e annotare le differenze, dal più vistoso al più
sottile.

**D2 — rasterizzazione SVG**: ✅ fatto e rilasciato nella 2.3.0. Simboli vendored,
simboli custom e widget `image` si disegnano con `resvg`. Misure prese prima di
cablare: binario +1,26 MB, sul WP630 10,68 MB di RAM su 2,08 GB.

### 5. Stato del WP630

> Sezione superata. Lo stato corrente è in cima al file: **2.3.2 installata
> pulita dall'IDE il 2026-08-28** dopo un factory reset, nessun binario montato
> a mano. Quanto segue descriveva la 2.1.0 ed è conservato solo per la storia.

### 6. Due trappole degli script Python, imparate a caro prezzo

Scritte nei commenti dello script del template, dove le legge chi ne scriverà un
altro:

- **niente `import`** — gli script girano in RestrictedPython con `safe_builtins`.
  Insidioso perché sul PC di sviluppo RestrictedPython di solito non è installato
  e il runtime ricade sull'esecuzione non ristretta: lì l'import passa, e si
  scopre tutto solo sul pannello;
- **una funzione non vede le costanti definite fuori** — il runtime esegue con
  `exec(codice, globals, {})`, e le assegnazioni di primo livello finiscono in un
  dizionario locale usa-e-getta.

---

## ▶ Da fare, dalle sessioni precedenti

1. ~~**Riaprire nell'IDE il progetto che sta sul runtime (pull)**~~ — **fatto**, squashato su
   `main` il 2026-08-25 (`feat(ide): riaprire nell'IDE il progetto che gira sul dispositivo`).
   Resta solo la **conferma a schermo**, elencata in cima al file: è uno dei tre lavori finiti
   che nessuno ha mai guardato.

2. **Ruolo minimo degli oggetti (sezione SICUREZZA): inefficace in modalità no-auth, e l'editor
   non lo dice** — segnalato il 2026-08-24: ruolo minimo **Admin** su un pulsante e su un trend,
   ma nel runtime i due oggetti funzionano comunque.
   > **Nota di freschezza (2026-09-06)**: il punto **(c)** — dichiarare il limite — è fatto:
   > la scheda **Q36** esiste, `model.rs` porta il commento «gap dichiarato» accanto a
   > `min_role`, e `project.rs:79` dice che l'enforcement vero è `write_min_role` sul server.
   > Restano da fare (a) la misura col `whoami` e (b) l'avviso nell'editor.

   **Causa quasi certa, letta nel codice: non è il gating rotto, è il no-auth.** `optional_auth`
   inietta un **Admin sintetico** quando non ci sono utenti definiti (`router.rs:758`), quindi
   il viewer *è* Admin e `isRoleAllowed("Admin","Admin")` è vero (`SvgCanvas.tsx:444`, ranghi
   Viewer 0 → Admin 3). Il gating esiste ed è applicato a **tutti** i tipi dal wrapper
   (`SvgCanvas.tsx:1502`): `hide` rimuove l'oggetto, `disable` (default) lo lascia visibile con
   `pointerEvents: none`.
   Da fare, in quest'ordine: **(a)** *misurare* — `curl -sk .../api/auth/whoami` sul runtime: se
   risponde Admin sintetico l'ipotesi è confermata e non c'è niente da correggere nel gating;
   **(b)** decidere l'avviso nell'editor (senza utenti definiti ogni visitatore è Admin e il
   ruolo minimo non avrà effetto — rimando al tab Utenti), perché così sembra rotto;
   **(c)** dichiarare il limite: `min_role` sugli oggetti è **solo client-side**, un affordance
   dell'interfaccia e non un confine di sicurezza — il controllo vero sulle scritture è
   `TagDef.write_min_role`, verificato dal server (`tag_write_allowed`).

3. **F9c — lotto di parità LVGL.**
   > **Nota di freschezza (2026-09-06)**: questo punto è dell'agosto e in gran parte **superato**
   > dai «seguiti» di Q14 (in archivio): `trend_tags[]` e `alarm_history` **esistono** oggi in
   > `model.rs`/`lvgl_render.rs`, i tipi supportati sono 35, `check_lvgl_parity.sh` dichiara
   > «nessun campo del web ignorato» a 238 campi, e il check di coerenza col badge «L» chiesto in
   > fondo **esiste** (`check_lvgl_types.sh`). Restano veri: **il motore non è più stato provato
   > dal vivo** dopo i merge, i **13 simboli** della serie valvole/processo non esistono sul
   > pannello (Q15), e il widget `image` non decodifica i raster (Q16). Il testo qui sotto resta
   > come fu scritto, per capire da dove si è partiti. `model.rs` / `lvgl_render.rs` /
   `LVGL_SUPPORTED_TYPES` non conoscono nulla di quanto aggiunto nelle fasi F6-F8:
   `trend_tags[]` (quindi **i trend su LVGL sono vuoti**, deciso e accettato), le rifiniture
   F7.6 (raggio/tratteggio/sfumatura, zone e tacche del gauge, forme del led, gap della
   griglia), table/bar/pie/testo di F7.1-F7.4, e i tipi nuovi (`alarm_history`). Verificato
   che intanto **non rompa**: in `model.rs` il tipo oggetto è `Option<String>`, quindi un tipo
   sconosciuto viene ignorato e la pagina regge. **Il motore LVGL non è più stato provato dal
   vivo dopo l'ultimo merge**: questo lotto vuole il TC620 sotto mano (vedi
   `docs/TEST_SETUPS.md`), non è da infilare in coda a un'altra sessione.
   Da fare anche il check di coerenza generato fra `LVGL_SUPPORTED_TYPES` e il badge «L»
   della palette (`LeftPanel.tsx`), oggi disallineabile in silenzio.
4. **F5.3x — XY plot multi-coppia + curva di riferimento**: unico residuo della fase F5.
5. **F7 residui minori** dal debito d'inventario, non ancora affrontati: bordi **per-cella**
   nella griglia (gap e padding sono fatti), e il commento sull'ACK dentro l'`AlarmEvent`
   dello storico invece che nel solo journal di audit (vuole una migrazione dello schema
   eventi — oggi il motivo è nel journal, interrogabile da `/api/audit`).
6. ~~**Q18 aperta**~~ — **decisa e implementata il 2026-08-25** (opzione 1: il colore
   predefinito del testo si deriva dallo sfondo della pagina). Resta solo la conferma a
   schermo, elencata più in alto.
7. **Pagine demo CasaMauro**: sono ferme alle feature F2-F6. Nessun oggetto esercita
   table 2.0, barre negative/impilate, pie raggruppato, testo multiriga, storico allarmi,
   suono. Da arricchire quando servirà una demo.

## Storico (sessioni chiuse: mergiate e verificate — dettaglio in `CHANGELOG.md` e `git log`)
**Sessioni di luglio-settembre spostate in [`docs/history/STATUS-2026-07_08.md`](docs/history/STATUS-2026-07_08.md) il 2026-09-06** — una riga ciascuna:

- 2026-09-02 · Release **2.4.0** (superata dalla 2.5.0) e divisione editor/runtime (`e98138b`, ADR 0003)
- 2026-09-01 · T-50 chat IA mergiato; chiusure delle sessioni notturne del 31/08-01/09
- 2026-08-31 · trasloco su frodo; immagini 2.3.4 pubblicate; `--istantanea`
- 2026-08-28 · lavoro sui template chiuso; `sudo` chiesto all'inizio (2.3.3)
- 2026-08-23 · Release **2.1.0** — F6 (faceplate 2.0, simboli N-stati, animazioni), F7 (table/bar/pie/allarmi 2.0), F8 (strumenti di layout), editor coerente. ~76 voci di sessione dal 2026-08-07 al 2026-08-23, integrali nell'archivio
- 2026-08-07/08 · motore LVGL fasi 1-3 (branch `feature/lvgl*`)
- 2026-08-05/06 · MQTT: client_id, riconnessione col watchdog, timeout su poll; T-41…T-45; boot con `--project`
- 2026-08-02/03 · container aarch64 generico; sorgente MQTT che moriva per sempre
- 2026-07-30/31 · Release **2026.7.0**; container x86_64 e installazione dal registry; riconciliazione dei branch


- **2026-07-09** — fix tema chiaro: righelli canvas + pannello LOG, colori hardcoded → `var(--brand-*)` (`71fb0d9`). Confermato in browser.
- **2026-07-08** — **T-38 brand Pixsys** white-label (`cfee5f1`): `public/branding/pixsys/` (brand.json 10 token, logo, favicon), `active.json` → `pixsys`.
- **2026-07-07** — **T-37 build pacchetti** (`2a991e9`): `scripts/build_deploy.sh` → 4 tarball editor/runtime × x86_64/aarch64; installer `deploy/{editor,yocto,generic-linux}`; fix `--viewer-port` mancante nei launcher.
- **2026-07-06** — **T-35 infrastruttura white-label**: `public/branding/` + loader `applyBranding()` (CSS var `--brand-*`, title, favicon); ~977 colori di chrome portati a `var(--brand-*)`.
- **2026-06-20** — **GitHub issue #2** (import progetto: `<input type=file>` smontato alla chiusura del menu → `onChange` mai eseguito), regression test `e2e/import-tags.spec.ts`; bugfix grid paste/cut in sub-celle, riscrittura `TagInput`, valore live in Variabili, auto-deploy al salvataggio.
- **T-34** — runtime mono-progetto (marker `.active-project`), versionamento progetto (`saved_by`, `POST /api/project/migrate`), no-auth mode. Verificato da `scripts/test_t34.sh` (18/18 verdi).
- **WebSocket remote bridge + no-auth + deploy relay** — `POST/DELETE /api/remote/connect`, `GET /api/remote/status`, `/ws/remote/{tags,alarms,logs}`, `POST /api/remote/deploy` (nessun fetch diretto browser→device).
- **TLS opzionale** — HTTP plain di default, HTTPS se `config/tls.crt` è presente all'avvio; endpoint admin genera self-signed / carica cert+key / disabilita, con reboot.
- **Split `dev.sh`** → `start_runtime.sh` (viewer 8443 + IDE 8444 + companion HTTP 8080) e `start_editor.sh` (IDE 8460 + companion 8090).
- **T-29…T-33** — widget canvas Bar Chart, Pie/Donut, Sparkline, Text List, Alarm Viewer inline.
- **T-28** — IDE package builder + deploy SSH su device. **T-27** — packaging generic Linux (`package.sh` + installer systemd). **T-26** — git commit/push dall'IDE. **T-25** — remote log viewer. **T-24** — project fingerprint SHA256 + dashboard Device.

**Branch**: `main` = `c4d8e62`, allineato a `origin/main`. Pulizia branch del 2026-07-27: eliminati i branch già assorbiti in `main` (`feat/T-37-build-deploy`, `fix/light-theme-ruler-log`, `feat/T-39-ide-i18n`, `feat/T-40-project-i18n`, `fix/T-40-regressions`). Aperto e **non mergiato**: `feat/project-location-and-brand-presets` (da testare in browser). Tenuti apposta: `archive/office-line-2026-05-21`, `backup/friday-phase-a1`.

---

## Remaining tasks

> Unica traccia del lavoro ancora aperto. Aggiorna man mano che gli item si chiudono.

> **Piano "migliorie editor" (2026-07-27)**: 4 blocchi decisi col maintainer — (1) stato "non salvato" ✅, `feat/dirty-state-and-save`; (2) zoom + toolbar contestuale ✅, `feat/editor-zoom-toolbar`; (3) header a due livelli ✅, `feat/slim-app-header`; (4) creazione cartelle nel picker + copia progetto sul PC ✅ fatto, branch `feat/fs-mkdir` sopra `feat/project-location-and-brand-presets`. Tutti e 4 mergiati in `main` il 2026-07-27 dopo validazione in browser.

**Validazioni in sospeso (browser / runtime reale)**

- [ ] **Audit log + `--no-admin`** (2026-07-26): vista Audit in Configurazione → Sistema; `--no-admin` su un device reale (richiede `--viewer-port`).
- [ ] **Telegram** (2026-07-26): rebuild+restart runtime per attivare allarmi Telegram e `send_telegram` negli script; validare l'uniformazione del tasto Salva.
- [ ] **MQTT** (2026-07-24): riavvio runtime per il cap browse a 120 s; hard-refresh per palette su progetto vuoto e "Estrai da JSON".
- [ ] **Multilingua T-39/T-40** (2026-07-13/21): switch lingua UI, tab Lingue (2 selettori + filtro/ordinamento), `lang_selector` in un template, anteprima canvas in lingua Editor.
- [ ] **Branding** (T-35/T-38, entrambi in `main`): logo/palette/titolo/favicon Pixsys in tema **chiaro e scuro**, IDE (8460/8444) e viewer (8443); switch brand via `public/branding/active.json`.
- [ ] **Pacchetti T-37 su device reale**: `sws-runtime-*-linux-aarch64.tar.gz` su un Pixsys (`sudo ./install.sh` → `/data/user/sws`), viewer `:8443` + IDE `:8444`; su PC `sws-editor-*` + `./run-editor.sh`.
- [ ] **Verifica manuale T-27** — packaging tarball + installer generic Linux. Comandi sotto.
- [ ] **Verifica manuale T-24/T-25/T-26** — fingerprint/device dashboard, remote logs, git commit/push. Comandi sotto.

**Debito tecnico noto (non bloccante)**

- [x] **`sws-kiosk` non rispetta `--viewer-port`** — **risolto 2026-08-13**: lo spawn passava
  `https://localhost:8443` a mano invece della variabile `vport` già disponibile nella stessa
  funzione (branch `fix/mdns-interfaces-kiosk-viewerport`, non ancora mergiato).
- [ ] **`stop_existing()` in `scripts/start_runtime.sh` usa `fuser`** — su macOS o sistemi senza `fuser` non funziona. Non prioritario (sviluppo su Linux).
- [ ] **mDNS**: in container serve `--host-network` (la rete bridge di podman non passa il multicast). Verificato che attraversa `192.168.0.x` ↔ `192.168.1.x` su questa LAN, quindi il vecchio appunto "non attraversa subnet" era sbagliato. Il punto sotto ("un device con più interfacce compare più volte") **verificato 2026-08-13 già risolto** dalla dedup per `fullname` esistente in `discover.rs` (`seen: HashMap`, con promozione dell'indirizzo su risposte migliori) — nessun cambio necessario, la nota era superata.
- [x] **T-49 — mDNS annuncia anche sulle interfacce veth di podman/docker, l'editor sceglie quella sbagliata** — **risolto 2026-08-13** (branch `fix/mdns-interfaces-kiosk-viewerport`, non ancora mergiato): `announce_mdns()` ora annuncia solo l'indirizzo di `detect_lan_ip()` (già esistente nello stesso file) invece di chiamare `enable_addr_auto()`, che pubblicava un indirizzo per ogni interfaccia — comprese le veth link-local. Ripiego sul vecchio comportamento se `detect_lan_ip()` fallisce.
- [ ] **Q8 C/E/F** — reload granulare, split processi runtime/IDE, python out-of-process. Vedi `docs/OPEN_QUESTIONS.md`.

### Verifica manuale T-27 da fare

```bash
# Build tarball completo (richiede ~5 min per cargo + pnpm)
./scripts/package.sh

# Verifica struttura
tar tzf dist/sws-0.1.0-dev-linux-x86_64.tar.gz | head -10

# Test installer in locale (o su VM)
tar xzf dist/sws-0.1.0-dev-linux-x86_64.tar.gz
sudo ./sws-0.1.0-dev-linux-x86_64/install.sh
# → apri https://localhost:8443 e https://localhost:8444
```

### Verifica manuale T-24/T-25/T-26 da fare

```bash
# Avviare runtime locale (viewer 8443 + IDE/admin 8444)
./scripts/start_runtime.sh

# T-26: Configurazione → Runtime → connettiti → sezione "GitOps"
# → "💾 Commit" → scrivi messaggio → Salva
# → "↑ Push (N)" → confirm → mostra output git push

# T-24: Configurazione → tab "Device"
# → aggiungi device (URL del runtime locale: https://localhost:8444, admin/admin)
# → "Aggiorna" → mostra stato online + firma SHA256
# → "Connetti" → l'IDE si connette a quel runtime

# T-25: Configurazione → Runtime → connettiti
# → sezione "Log remoti" → "Aggiorna" → lista log
# → "● Live" → aggiornamento automatico ogni 5 s

# Smoke fingerprint:
TOKEN=$(curl -sk -X POST https://localhost:8444/api/auth/login \
  -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin"}' | jq -r .token)
curl -sk -H "Authorization: Bearer $TOKEN" https://localhost:8444/api/project/fingerprint
# → {"sha256":"...","computed_at_ms":...}
```

---

## Feature set consegnato (PoC completo T-01…T-40)

| Area | Funzionalità |
|------|-------------|
| **Protocolli** | Modbus TCP+RTU, MQTT+Sparkplug B, OPC-UA client+server, HomeAssistant WS, Siemens S7, EtherNet/IP |
| **Editor canvas** | Tutti i widget, symbol picker (22 built-in + custom), faceplate, grid, undo/redo 200 step, gestione pagine (dimensionamento, riordino, miniature, lock, home) |
| **Auth/RBAC** | Argon2id, 4 ruoli, ABAC zone, session TTL configurabile per utente, audit log hash-chain |
| **Allarmi** | ISA-18.2 state machine, multi-condizione, delay, inhibit, shelving, webhook, SMTP escalation, Telegram |
| **Historian** | Ring-buffer + SQLite per-progetto, CSV export, trend interattivo |
| **Deploy** | Dual-port 8443/8444, `--instance N`, `--no-admin` (operator-only), mDNS discovery, deploy remoto via SCP/systemd, GitOps (pull/rollback/commit/push) |
| **Observability** | Project fingerprint SHA256, device dashboard multi-runtime, remote log viewer live, audit log verificabile |
| **Canvas** | Pipe/tubazione multi-waypoint (flat/tube/wire), SVG path animato, drag waypoint |
| **Widget avanzati** | Bar Chart, Pie/Donut, Sparkline, Text List, Alarm Viewer inline |
| **Multilingua** | UI IT/EN (react-i18next, ~667 chiavi) + tabella lingue di progetto (`{{token}}`, CSV, `lang_selector`) |
| **Branding** | White-label via `public/branding/` (brand.json + logo + favicon + 10 token colore); brand Pixsys |
| **Packaging** | `scripts/build_deploy.sh` → tarball editor/runtime x86_64+aarch64; installer systemd generic-linux e Yocto |
| **IDE deploy** | Build tarball + deploy SSH su device direttamente da Configurazione → Runtime |
| **PWA** | Service worker, manifest, auto-rotate kiosk, mobile layout |
| **Infra** | Yocto cross-compile (aarch64), Prometheus `/metrics`, log JSONL rotato, backup auto |

---

## Open questions

Vedi `docs/OPEN_QUESTIONS.md` — Q1…Q7 decise. **Q8** (isolamento runtime↔IDE): A/B/D fatti, **C/E/F aperti**.
