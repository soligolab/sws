# scripts/

Helper locali per il PoC SWS. Non necessari in produzione o CI.

## Architettura dei due script

```
DISPOSITIVO (panel, server):         PC SVILUPPATORE:
  ./scripts/start_runtime.sh           ./scripts/start_editor.sh
  ├─ 8080  HTTP cert-acceptance         ├─ 8090  HTTP cert-acceptance
  ├─ 8443  viewer operatori             └─ 8460  IDE locale
  └─ 8444  IDE/admin remoto                  ↕ "Connetti runtime"
        (sui dispositivi spediti: solo
         gestione remota, nessun IDE —
         `--no-admin`, vedi sotto)

  progetto in .run/projects/           progetto in .run-editor/projects/
  ── quello in servizio ──             ── una copia, separata ──
```

I due script usano range di porte separati per poter girare sulla **stessa
macchina** senza conflitti (es. dev locale con runtime + editor in parallelo).

### Su quale progetto si scrive, che non è la stessa cosa nei due casi

È lo **stesso binario** in entrambi i casi: l'unica differenza è che
`start_editor.sh` non passa `--viewer-port` (vedi
`docs/adr/0003-editor-runtime-same-binary.md`). Ne segue una cosa che vale la pena
sapere prima di premere Salva:

- **IDE sulla 8444 di un dispositivo** → si modifica il progetto **dell'impianto in
  servizio**, sul filesystem del dispositivo, e il salvataggio ne ricarica sorgenti
  e allarmi *senza riavvio e senza conferma*. L'IDE lo segnala con un marcatore in
  testata.
- **IDE sulla 8460 del PC** → si modifica una cartella locale. Il dispositivo ne ha
  una copia, che si aggiorna solo col **Deploy** (bundle intero); nessun endpoint
  scrive un singolo file di progetto sul dispositivo.

In entrambi i casi il motore gira per intero: anche l'editor sul PC apre le
sorgenti del progetto che carica, valuta gli allarmi e manda le notifiche. Non è un
«editor spento» — vedi `OPEN_QUESTIONS.md` Q8.

## `start_runtime.sh` — runtime sul dispositivo

Avvia il binario Rust con **tutte e tre** le porte:
- `8080` — HTTP (no TLS): pagina di aiuto per accettare il certificato self-signed
- `8443` — viewer per operatori e kiosk (accesso anonimo)
- `8444` — IDE/admin remoto (accesso autenticato, Supervisor/Admin)

**Attenzione a una differenza fra questo script e i dispositivi.** Dal 2026-09-02
i deploy (yocto, generic-linux, container) partono con **`--no-admin`**: la porta
8444 resta e serve solo la gestione remota che l'editor chiama — deploy, pull,
backup, utenti, datastore, tutto autenticato — e **non serve nessun IDE**. Qui il
default resta l'IDE completo, perché lo stack di sviluppo serve anche a lavorare
su quello; per provare la postura vera:

```sh
./scripts/start_runtime.sh --no-admin
```

La guardia `./scripts/check_no_admin.sh` confronta le due modalità sullo stesso
binario e verifica entrambi i versi: che l'IDE non ci sia, e che il deploy ci sia
ancora.

Auto-apre il progetto `default` se esiste in `.run/projects/default/`.

```sh
./scripts/start_runtime.sh                # instance 1: 8443/8444, dati .run/
./scripts/start_runtime.sh --instance 2   # instance 2: 8445/8446, dati .run-2/
```

### Dove vive lo stato

```
.run/
├── config/    # tls.crt + tls.key (solo se il TLS è stato attivato dall'IDE)
├── projects/  # progetti (uno per sottodirectory)
│   └── default/
│       ├── project.yaml
│       ├── synoptics/
│       └── users.yaml
└── logs/      # file JSONL ruotati per data
```

L'albero `.run/` è in `.gitignore`. Per ripartire da zero:

```sh
rm -rf .run && ./scripts/start_runtime.sh
```

### Certificato TLS (opzionale)

Il runtime parte in **HTTP plain** di default: nessun certificato, nessuna pagina di
accettazione, primo accesso diretto su `http://localhost:8444`. `localhost` è sempre un
"secure context" nei browser moderni, quindi l'IDE funziona senza TLS.

Il TLS si attiva **su richiesta** dall'IDE: **Configurazione → Stato → Certificato TLS**:
- **Genera self-signed** — crea `config/tls.crt`+`tls.key` e riavvia in HTTPS.
- **Carica cert+key** — carica un certificato firmato (es. CA aziendale), validato lato server.
- **Disabilita TLS** — rimuove i file e torna in HTTP.

La modalità è determinata dalla **presenza** di `config/tls.crt` all'avvio (gli script passano
`--http-port` solo quando il cert esiste). Quando il TLS è attivo, accetta il self-signed così:

```sh
curl -k https://localhost:8443/cert -o sws.crt   # scarica il cert per i trusted del browser
curl -k https://<ip>:8443/cert -o sws.crt         # da un altro PC sulla LAN
```

### Verifica che sia vivo

```sh
curl -k https://localhost:8443/health   # → "ok"
curl -k https://localhost:8444/health   # → "ok"
curl -k https://localhost:8443/api/tags
```

### End-to-end tests (Playwright)

Il suite Playwright si trova in `sws-editor/e2e/`. Avviare il runtime prima:

```sh
# Terminal A
./scripts/start_runtime.sh

# Terminal B (prima volta — scarica Chromium ~150 MB)
cd sws-editor && npx playwright install chromium

# Terminal B (ogni run)
cd sws-editor && pnpm test:e2e        # headless
cd sws-editor && pnpm test:e2e:ui     # debug UI
```

### `check_viewer_layout.sh` — barre di scorrimento sul pannello

Verifica che il viewer non produca barre di scorrimento su un pannello 1280×800
(il WP620), con e senza la barra superiore. Si avvia da solo: crea un runtime
temporaneo, un progetto da template con le pagine portate a 1280×800, e misura
col browser di Playwright.

```sh
pnpm --dir sws-editor build     # serve la dist compilata
cargo build -p sws-runtime
./scripts/check_viewer_layout.sh
```

Esce 0 solo se non c'è nessuna barra in **nessuna** delle quattro configurazioni
(chrome visibile, chrome nascosto, finestra più piccola della pagina, finestra
più grande). Esiste perché le tre barre che si vedevano sul dispositivo avevano
tre cause indipendenti e "pochi pixel di troppo" non si notano a occhio:
misurare è l'unico modo di sapere se sono tornate.

### `check_spa_autoreload.sh` — il pannello prende la SPA nuova?

Verifica che il viewer si ricarichi da solo quando sul dispositivo arriva un
frontend aggiornato (cioè dopo un `install-container.sh --pull` che porta
un'immagine con la SPA nuova; fino al 2026-07-30 era `--www-only`, quando la
SPA viaggiava a parte). Simula il deploy rinominando il chunk di entry con un
hash diverso — lo stesso segnale che Vite produce a ogni build — e controlla
che la pagina si ricarichi servendo il bundle nuovo.

```sh
pnpm --dir sws-editor build
cargo build -p sws-runtime
./scripts/check_spa_autoreload.sh     # dura ~45 s: l'intervallo del watcher è 30 s
```

Esiste perché sul WP620 il pannello ha continuato a mostrare la versione vecchia
dopo un aggiornamento, e lì non c'è nessuno che possa premere ricarica: "il
deploy è andato" non significa "il pannello sta mostrando la versione nuova".

### `check_discover.sh` — "Cerca runtime" dice la verità?

Avvia due runtime in sequenza, uno dichiarato in container e uno nativo, e
controlla su `GET /api/discover` tre cose: che la proprietà `container` valga
quello che deve, che il runtime compaia **una volta sola**, e che l'indirizzo
offerto non sia `127.0.0.1`.

```sh
cargo build -p sws-runtime
./scripts/check_discover.sh          # 3 giri, ~30 s
GIRI=10 ./scripts/check_discover.sh  # più giri quando si tocca discover.rs
```

I giri multipli non sono zelo: il difetto dell'indirizzo era intermittente e con
una sola esecuzione passava comunque due volte su tre. In sequenza e non in
parallelo perché l'istanza mDNS prende il nome dall'hostname — due runtime sulla
stessa macchina si annuncerebbero con lo stesso nome.

---

## `session_start.sh` — la prima cosa, prima di riprendere il lavoro

```bash
./scripts/session_start.sh        # riporta, e chiede una conferma per caso
./scripts/session_start.sh -y     # accetta tutto ciò che avrebbe proposto
./scripts/session_start.sh --no-fetch   # senza rete
```

Confronta la macchina con origin e propone il rimedio giusto per ciascun caso
comune, poi chiude dicendo da dove si riprende (la prima sezione di `STATUS.md`
sotto «Da fare nella prossima sessione»). Nato dal 2026-09-02, quando la ripresa
è andata storta due volte nella stessa sessione in due modi che `git pull` non sa
raccontare — vedi la nota sulla riscrittura della storia in `STATUS.md`:

- **`main` divergente con un commit locale che non aggiunge niente**: la versione
  pre-riscrittura di lavoro già su origin. `git pull` si ferma e chiede come
  riconciliare, e nessuna delle tre risposte che suggerisce è quella giusta —
  merge e rebase porterebbero dentro il doppione.
- **tag rifiutati**: `git fetch --tags` senza `--force` li lascia puntati alla
  storia vecchia, quindi `git describe` mente. Si vede solo sui tag vecchi:
  quelli nuovi passano, ed è facile crederlo risolto.

**Cosa non fa, e sono garanzie non omissioni:** non pusha (la regola 1 di
`CLAUDE.md` vuole un'istruzione esplicita, e una conferma in un `[y/N]` non è
un'istruzione), non cancella rami, non tocca l'albero se è sporco, e **non fa
`reset --hard` se i commit locali portano contenuto che origin non ha** — in quel
caso offre solo un ramo di salvataggio e dice perché. `-y` non allarga cosa
propone: la prova sull'albero resta condizione necessaria.

La distinzione fra i due casi divergenti è `git diff --quiet <upstream> <ramo>`:
alberi identici significa che quei commit non aggiungono contenuto. È la sola
cosa che autorizza il reset, e `check_session_start.sh` la difende fabbricando
sette stati in un repo temporaneo — il caso che conta è il quinto, che verifica
che del lavoro vero **non** venga resettato.

## `check_static.sh` — le guardie che girano su file fermi

Una parte gira su file fermi (YAML, sorgenti, tabelle, unit systemd, e un repo
git in una directory temporanea) e finisce in pochi secondi; le altre vogliono un
runtime in ascolto, podman o un dispositivo.

> I numeri in questa pagina invecchiano a ogni guardia nuova, e sono già stati
> sbagliati **due** volte — la seconda proprio qui, dove il titolo diceva nove e
> l'elenco ne portava otto. Per questo non ce ne sono più: il conto vero lo fa
> lo script: i suoi due elenchi devono
> coprire **tutti** i `check_*.sh` presenti, e se ne compare uno non classificato
> `check_static.sh` **fallisce**. Se questa riga e lo script non concordano,
> ha ragione lo script.

```bash
./scripts/check_static.sh     # esce != 0 se una qualsiasi fallisce
```

Da lanciare a ogni fine sessione, insieme a `cargo test` e `pnpm build`. Nessuno
le lanciava tutte: a fine giornata se ne ricordavano sei, per nome, a memoria —
e una guardia che non viene lanciata è codice morto che dà l'illusione di una
rete di sicurezza.

Quelle che girano su file fermi:

| Guardia | Cosa impedisce |
|---|---|
| `check_lvgl_symbols.sh` | la tabella dei simboli vendored del viewer diverge da quella dell'editor (7 nomi file su 11 **non** coincidono con l'id) |
| `check_lvgl_types.sh` | il badge «L» della palette mente sui tipi che il pannello disegna |
| `check_lvgl_parity.sh` | campi dichiarati nel modello e mai disegnati dal motore |
| `check_vendor_patches.sh` | le patch al sorgente C vendored spariscono a un aggiornamento |
| `check_templates.sh` | i template restano indietro rispetto al runtime |
| `check_demo_templates.sh` | i due gemelli "Demo Items" divergono fra loro |
| `check_systemd_units.sh` | trappole note nelle unit che spediamo: condizioni di livello che fanno ciclare una unit, `.path` verso unit inesistenti, `ExecStart=` relativi |
| `check_synoptic_schema.sh` | `synoptic_schema.rs` resta indietro rispetto alle sue quattro fonti, e l'assistente IA riceve un vocabolario che non è più quello vero |
| `check_session_start.sh` | `session_start.sh` perde lavoro: reset su commit locali che origin non ha, tag lasciati sulla storia vecchia, avanzamenti ad albero sporco |
| `check_off_page.sh` | «fuori pagina» diventa due definizioni diverse: la tabella di casi di `sws-core/src/geometry.rs` e quella di `sws-editor/src/pageLayout.ts` devono coincidere, e i due crate devono chiamare `is_off_page` invece di riscriverlo |
| `check_versione_progetto.sh` | client e server non sono d'accordo su chi riscrive `project.yaml`: una sezione senza `If-Match` (due schede si cancellano a vicenda), o una rotta che riscrive senza che il client incassi la versione nuova — e allora il salvataggio dopo prende un 409 «qualcun altro ha modificato il progetto» dove il qualcun altro è lui stesso |

`check_static.sh` **fallisce anche** se in `scripts/` compare un `check_*.sh` che
non è in nessuno dei suoi due elenchi: una guardia nuova non può restare fuori in
silenzio, chi la scrive deve dire se serve o no uno stack. (Ha funzionato: il
2026-08-31, aggiungendo `check_synoptic_schema.sh`, la prima cosa che è successa
è stato `check_static.sh` che si rifiutava di partire.)

### `gen_synoptic_schema.py` — il vocabolario dell'assistente

Genera `sws-web/src/synoptic_schema.rs` da quattro fonti: i 238 campi di
`sws-web/src/synoptic.rs` con la loro documentazione, i tipi di oggetto dalla
union TypeScript, il modello delle sorgenti in `sws-core/src/project.rs`, e —
per ogni tipo — i campi visti nei template più un esempio YAML reale.

L'ultimo pezzo merita una parola: «quali campi valgono per un `button`» non è
scritto da nessuna parte (il modello dati è piatto), ma «quali campi ha un button
nei progetti che funzionano» si misura, e si mantiene da sé.

    ./scripts/gen_synoptic_schema.py            riscrive il file
    ./scripts/gen_synoptic_schema.py --stdout   lo stampa (lo usa la guardia)

## `start_editor.sh` — IDE locale sul PC sviluppatore

Avvia il binario Rust con **solo** la porta IDE (nessun viewer).
Permette di creare e modificare progetti localmente, anche senza un runtime attivo.

- `8090` — HTTP (no TLS): pagina di aiuto per accettare il certificato self-signed
- `8460` — IDE/admin locale

```sh
./scripts/start_editor.sh                # IDE su 8460, HTTP su 8090, dati .run/
./scripts/start_editor.sh --instance 2   # IDE su 8462, HTTP su 8091, dati .run-2/
```

Per connettere un runtime remoto: apri l'IDE → **ConfigView → Runtime →
"Connetti"** → inserisci URL, utente e password del runtime (es. `https://192.168.1.50:8444`).
La connessione abilita sia il **deploy del progetto** sia la **visualizzazione live di tag e allarmi**
in real-time tramite relay WebSocket (il token remoto rimane nel processo locale, mai nel browser).

### Primo accesso (accettazione certificato)

Apri `http://localhost:8090/` nel browser. La pagina guida all'accettazione
del certificato self-signed senza uscire dall'applicazione.

### La SPA la costruiscono gli script

Non serve ricordarsene: `start_runtime.sh` e `start_editor.sh` chiamano
`scripts/build_spa_if_needed.sh` prima di avviare il binario, e ricostruiscono
`sws-editor/dist/` **solo se serve**. Con `--no-spa` non la toccano, per quando
si lavora solo sul Rust e i dieci secondi di vite danno fastidio.

Quando «serve»: manca uno degli entry point in `dist/`, oppure è più recente
della dist qualcosa fra `src/`, gli `index*.html`, `vite.config.ts`,
`tsconfig*.json`, `package.json`, `pnpm-lock.yaml` e `public/` (escluso
`public/branding`, che gli script sincronizzano senza ricostruire). Gli entry
point si scoprono con un glob invece di essere elencati, così aggiungerne uno
non richiede di ricordarsi di quello script.

Prima esisteva `ensure_frontend_built`, duplicata nei due script start_*, con
due buchi che si vedevano: guardava **solo** `src/`, quindi un `index*.html`
nuovo o un `vite.config.ts` toccato non facevano scattare niente e un entry
point poteva mancare dalla dist senza che nessuno lo dicesse; e se `pnpm build`
falliva lo script tirava avanti e stampava «Costruisci con: cd sws-editor &&
pnpm build», cioè suggeriva il rimedio appena fallito. Ora il fallimento si
dichiara e il motivo della ricostruzione si stampa.

```sh
./scripts/build_spa_if_needed.sh           # anche a mano
./scripts/build_spa_if_needed.sh --check   # dice solo se servirebbe (esce 1 se sì)
./scripts/build_spa_if_needed.sh --force
```

## `check_project_write_safety.sh` — un salvataggio non deve peggiorare il file su disco

Sei casi, e vuole uno stack (lo avvia da sé sulla 8581). Dal 2026-09-04 il caso **6** è la prova
di Q30 al livello HTTP: venti giri di due salvataggi paralleli — variabili e sorgenti — e alla fine
sul disco devono esserci i valori dell'**ultimo** giro in entrambe le sezioni.

Due cose imparate scrivendolo, che valgono per chiunque tocchi questa guardia:

- **Guarda il numero d'ordine, non «le sezioni non sono vuote».** La prima stesura controllava che
  `tags` e `sources` fossero popolate, e passava anche col lock disattivato: le sezioni restano
  piene per via dei giri precedenti. Col numero si vede che era sopravvissuto `conc.tag16` mentre
  le sorgenti erano al giro 20 — la corsa c'era, era l'asserzione a non vederla.
- **Il runtime di prova ora si controlla vivo.** Su pyenv partiva senza `LD_LIBRARY_PATH` e moriva
  su `libpython3.11.so.1.0`; la guardia proseguiva e ogni `curl` tornava `000`, quindi il caso 4
  diceva «creazione bloccata: il rifiuto è troppo largo» e il caso 5 dichiarava «salvataggio
  rifiutato (000)» come un **successo**. Cinque verdetti sul comportamento di un runtime mai
  partito. Ora la libreria la trova da sé, e se non risponde si ferma dicendo perché.

Provata nei due versi: 10/10 col lock, e disattivando il lock in `patch_project` il caso 6 diventa
rosso con «SALVATAGGIO PERSO».

## `check_istantanea.sh` — «gli occhi» funzionano?

Prova la catena intera dell'istantanea LVGL: copia del progetto, runtime usa e getta, viewer,
PPM, PNG — e verifica che dentro l'immagine ci sia davvero il rettangolo scritto nel progetto
(18784 pixel su 20000 teorici, il resto è antialiasing dei bordi).

Vuole uno stack solo nel senso che deve **compilare due binari**: `sws-lvgl-viewer` non lo
costruisce `cargo test`, ed è per questo che il test end-to-end è marcato `#[ignore]` e lo lancia
questa guardia. Un test che si salta da sé quando un prerequisito manca è verde e cieco, e in
questo progetto è già capitato.

Provata nei due versi: verde, e rossa alzando la soglia dei pixel a un valore impossibile — con il
motivo vero stampato («il rettangolo non c'è nell'immagine: solo N pixel del suo colore»).

## `riepilogo_immagini.sh` — quali immagini ci sono, quanto pesano, a cosa servono

Gira da sé in coda a `build_containers_all.sh`, e si può richiamare quando si vuole senza
ricostruire niente: legge e stampa.

```bash
./scripts/riepilogo_immagini.sh              # la versione dichiarata in Cargo.toml
./scripts/riepilogo_immagini.sh 2.4.0        # una versione precedente
./scripts/riepilogo_immagini.sh --pubblicate # le tag ghcr sono state pushate davvero
```

Serve perché l'uscita delle tre build è lunga centinaia di righe e finisce con l'ultima delle tre:
chi ha lanciato il comando legge «done. Image: sws-runtime:2.5.0-amd64» e non ha davanti le altre
due, né le dimensioni, né quale immagine copiare su quale pezzo di ferro. È anche il punto in cui
si nota una build **saltata** (SDK Pixsys assente) invece di scoprirlo installando.

**Legge `dist/` e non solo `podman images`**, e non è un dettaglio: le tre immagini non stanno tutte
nello stesso deposito. `arm64-generic` si costruisce con `sudo`, quindi finisce nel deposito di
root, e un `podman images` da utente normale **non la vede** — un riepilogo ingenuo la darebbe per
mancante appena costruita. Gli archivi in `dist/` invece sono tutti là, e sono anche la cosa che si
copia davvero su un dispositivo.

Non chiede mai `sudo`: un riepilogo che chiede una password non è un riepilogo. Se `sudo -n` passa
senza chiedere niente ne approfitta, altrimenti dice *dove* sta l'immagine.

Distingue **etichettata** da **pubblicata**: la presenza di una tag `ghcr.io/...` in locale prova
che `podman tag` è stato fatto, non che il push sia arrivato, e verificare il remoto vorrebbe rete e
login. Con `--pubblicate` (che `build_containers_all.sh` passa quando è stato lanciato con
`--push`) lo dice; senza, dice «etichettata, non necessariamente pushata».

## `clean_disk_space.sh` — libera spazio quando il disco è pieno

`target/debug` (workspace + `sws-kiosk`/`sws-lvgl-viewer`, esclusi dal workspace e mai toccati da
un `cargo clean` sul principale) è il maggior consumatore di spazio del repo e cresce senza
limite — cargo non lo pulisce mai da solo. Nato da un crash reale del linker ("Bus error") con
disco al 100%. Report + conferma, poi cancella solo cose rigenerabili (`target/debug` dei tre
alberi, `node_modules`, immagini podman dangling); `target/release`/`.bak/`/`.run*` restano
intoccati, solo riportati in dimensione. Dettagli: `docs/HOWTO.md` cap. 2.

```sh
./scripts/clean_disk_space.sh          # interattivo
./scripts/clean_disk_space.sh -y       # senza conferma
```

## `demo-sine.py` — driving a Trend with a sine wave

Quick way to put movement on a `trend` object during the demo. Logs in,
then writes `offset + amplitude * sin(2π · t / period)` to a tag every
`--interval` seconds via `PUT /api/tags/:id`. No deps beyond Python's
stdlib.

The dev seed already creates a `sine` tag, so the default invocation
just works:

```sh
./scripts/demo-sine.py
```

To visualize it: in the editor (Editor mode) drop a **Trend** object,
set its **Tag** to `sine`, set the **Finestra** to ~30 s, save the
synoptic, switch to **Runtime** mode. You should see the wave scroll.

Common tweaks:

```sh
./scripts/demo-sine.py --tag flow --period 20 --amplitude 25 --offset 50
./scripts/demo-sine.py --interval 0.05      # 20 Hz, smoother trace
./scripts/demo-sine.py --password mypw      # if you override admin password
```

Stop with Ctrl-C. The script auto-reauthenticates on a 401 (so it
survives a runtime restart) and exits cleanly on Ctrl-C.

## `demo-driver.py` — multi-tag, multi-waveform driver

Superset of `demo-sine.py`. Pass `--gen` once per generator (each is a
comma-separated `key=value` list with at least `tag=NAME`). All
generators share one asyncio loop so they tick together.

```sh
./scripts/demo-driver.py \
  --gen 'tag=sine,wave=sin,period=10,amp=50,offset=50' \
  --gen 'tag=cosine,wave=cos,period=8' \
  --gen 'tag=triangle,wave=tri,period=12,amp=30,offset=20' \
  --gen 'tag=ramp,wave=saw,period=20' \
  --gen 'tag=noise,wave=random,amp=10,offset=50'
```

Waveforms: `sin`, `cos`, `tri`, `saw`, `square` (with optional `duty`),
`random`, `step` (with `step_low`, `step_high`, `step_at`). Other keys:
`period`, `amplitude` / `amp`, `offset`, `interval`, `phase`.

Drop one **Trend** object in the editor, set its **Tag** to `sine`, then
add `cosine`, `triangle`, `ramp`, `noise` to **ALTRI TAG (OVERLAY)** —
five lines on the same axes.

## MQTT write path

A `TopicMapping` now also accepts an optional **Topic out (publish)** in
the ConfigView Protocolli tab. When set, a write to that tag (via
`PUT /api/tags/:id`, an object's `on_press` script, or a button) is
forwarded to the configured topic as a raw string payload
(`true` / `42.5` / etc.). Subscribe and publish topics can be the same
channel or different ones.
