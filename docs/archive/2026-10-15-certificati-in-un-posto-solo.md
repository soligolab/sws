# I certificati in un posto solo — le decisioni, dopo la sessione di plan

> **FATTO il 25-10-2026, archiviato.** Le otto decisioni sono tutte costruite tranne la 6, che è un
> protocollo a sé e vive nel seme [`2026-10-23-rinnovo-del-certificato-firmato.md`](../plans/2026-10-23-rinnovo-del-certificato-firmato.md).
> L'ultimo pezzo è la vista (decisioni 3, 4 e 8): Sicurezza → Certificati, ramo `feat/vista-certificati`.
> Da collaudare sul pannello col quadlet 7.

> **Era un seme, dal 22-10-2026 porta le decisioni.** La sessione di plan che il seme chiedeva è
> stata fatta quella notte, misurando il codice. Qui c'è quello che serve a decidere; le misure
> vecchie del seme (15-10 e 21-10) sono in coda, con le correzioni.
>
> Domanda d'origine del maintainer, 15-10-2026: «la gestione dei certificati ha senso gestirla in
> un menù dedicato… qualcosa ispirato a CODESYS Security Agent?».

## Tre cose che la misura ha cambiato

**1. «Serve una dipendenza nuova che parsi i certificati» — falso.** Un parser X.509 completo,
`x509-cert 0.2.5`, è **già compilato dentro il binario**: ci arriva da `async-opcua-crypto`, con le
feature `pem` e `std` attive. Metterlo fra le dipendenze dirette di `sws-web` è **una riga** di
Cargo.toml e **zero crate nuovi da compilare**. E `sws-web` ha già `rustls-pemfile` per passare da
PEM a DER, e `sws_core::pin_tls::impronta_sha256` per l'impronta. Era la frase che faceva sembrare
questo lavoro grande il doppio.

**2. Il trust store OPC-UA non funziona.** Le tre rotte leggono `trusted/certs` e `rejected/certs`;
la libreria — e il nostro stesso plugin — usano `trusted/` e `rejected/`, senza quel livello.
L'elenco è **sempre vuoto**, «Fidati» risponde 204 senza fare niente, «Elimina» risponde 404. E il
messaggio di errore della fiducia al primo contatto dice «fidati del nuovo dal trust store della
sorgente», cioè manda l'utente in una tabella che non può funzionare.

**Ma correggere il percorso non basta**, e questa è la parte che lo scettico ha trovato: il client
`async-opcua` valida e archivia il certificato del server **solo** se la policy non è `None` — e
`None` è il default in **tre posti indipendenti** (il serde di `sws-core`, la sorgente vuota che
crea l'IDE, il template `opcua-demo`). Quindi il ramo corto non è un refuso di quattro righe: è
una domanda sul default della policy.

**3. C'è un sesto archivio che nessuno ha dichiarato.** Il server OPC-UA non ha identità (vero),
ma un trust store ce l'ha: `ServerBuilder::new()` mette `pki_dir = <cwd>/pki` e lo **crea**. In un
container senza `WORKDIR` quella è la radice. Un reset di fabbrica non saprebbe cancellarlo.

## Gli archivi, misurati il 22-10-2026

| Uso | Dove | Interfaccia oggi |
|---|---|---|
| Certificato del server web | `<config>/tls.crt` + chiave | Istanza → Device → Stato → Certificato TLS |
| IDE → dispositivi (TOFU) | `<config>/dispositivi_conosciuti.yaml` | solo «dimentica», dentro un messaggio d'errore |
| Broker MQTT (TOFU) | `<config>/mqtt_broker_conosciuti.yaml` | nessuna |
| OPC-UA client, per sorgente | `<progetto>/opcua-pki/<sorgente>/` | **rotta rotta** (vedi sopra) |
| Viewer LVGL (TOFU) | `/var/sws/viewer/lvgl_tls_conosciuti.yaml` | nessuna, **e il runtime non la vede**: è in un altro container |
| *(sesto, non dichiarato)* | `<cwd>/pki` del server OPC-UA | nessuna |

Più **due archivi di chiavi SSH** che il seme non nominava: `~/.ssh/known_hosts` (col «dimentica»
già fatto) e le chiavi di progetto in `<progetto>/.git/sws-ssh/`.

**Nove rotte** toccano certificati o impronte. `GET /api/system/tls` restituisce **un booleano**:
nessuna rotta, da nessuna parte, dà soggetto, emittente o validità. `ImprontaStore` non sa nemmeno
elencare — manca il metodo, sono quattro righe.

**Su sei operazioni che cambiano un certificato, cinque non finiscono nell'audit.**

---

## Il disegno della vista — sessione di plan del 25-10-2026

> Le decisioni 3, 4 e 8 si scrivono sul ramo `feat/vista-certificati`. Questo è il disegno
> approvato dal maintainer.

### Context

Piano di riferimento: questo file.

- **Già fatte**: le decisioni 1, 2, 5 e 7.
- **La 6** (rinnovo firmato) è un seme a parte.
- **Restano, decise dal maintainer il 23-10 e non scritte**:
  - **3**: una scheda, due colonne, «questa istanza» e «dispositivo connesso»;
  - **4**: l'archivio del viewer LVGL montato in sola lettura nel runtime, quadlet 6 → 7;
  - **8**: le righe morte del pinning si mostrano, col loro «dimentica».

Il maintainer (25-10-2026) ha scelto di farla adesso, prima della build del lavoro di oggi.

### Cosa c'è (esplorazione del 25-10)

### Gli archivi

| Archivio | Dove | API oggi |
|---|---|---|
| TLS del server web | `<config>/tls.crt` | `GET /api/system/tls` → solo `{enabled}`; genera, carica e rimuovi, locali e remote |
| IDE → dispositivi (TOFU) | `<config>/dispositivi_conosciuti.yaml` | solo `POST /api/device/cert/forget {host}` (`remote.rs:3599`) |
| Broker MQTT (TOFU) | `<config>/mqtt_broker_conosciuti.yaml` | nessuna; lo store vive nel supervisore (`source_supervisor.rs:47`) |
| Client OPC-UA, per sorgente | `<progetto>/opcua-pki/<id>/{trusted,rejected}/*.der` | list, trust e delete (`router.rs:8885-8990`), con remote e porta di gestione; solo nome file e dimensione |
| Viewer LVGL (TOFU) | `/data/user/sws/viewer/lvgl_tls_conosciuti.yaml` | nessuna; il runtime non lo vede |
| Server OPC-UA | `<cwd>/pki` (`run_server` senza `pki_dir`) | nessuna |
| SSH | `~/.ssh/known_hosts`, `<progetto>/.git/sws-ssh/` | solo «dimentica» della chiave host |

### Gli strumenti

- **`ImprontaStore`** (`sws-core/src/pin_tls.rs`): YAML `host:porta → {impronta, visto_il_ms}`. Non sa elencare:
  `carica()` è privato.
- **`x509-cert` 0.2.5** è già nel lock (lo porta `async-opcua-crypto`): si aggiunge come dipendenza diretta di
  `sws-web`, senza compilare niente di nuovo. Oggi nessun codice legge soggetto o validità di un certificato.
- **Il quadlet**: la versione sta in `Description=… [quadlet N]`, oggi 6 su tutti e tre. Cambiarlo vuol dire:
  - alzare N sui tre file;
  - `scripts/check_quadlet.sh --aggiorna`;
  - aggiornare l'etichetta `net.soligo.sws.quadlet` dell'immagine.

  L'aggiornamento porta il quadlet nuovo da solo (`quadlet.rs`, `aggiorna`).
- **Inoltri**:
  - `inoltra_al_pannello` (`remote.rs:876`), con audit `remote.impianto`;
  - `proxy_get_json`;
  - la guardia di parità vuole il letterale `"{base}/api/…"` in remote.rs e la rotta in `deploy_only_app`.
- **Interfaccia**:
  - una foglia è una riga in `config/schede.ts` (`SCHEDE`, ramo `sicurezza`, `soloAdmin`) più il componente in
    `ConfigView.tsx` (`COMPONENTI`);
  - le due colonne esistono già in `SystemTab.tsx:84-88` (`gridTemplateColumns: "1fr 1fr"`);
  - le tabelle si fanno con `S.table/S.th/S.td`;
  - la card TLS è `TlsSection` (`SystemTab.tsx:239`); la lista dei certificati OPC-UA sta in
    `OpcUaSourceCard.tsx:270-312`.

### Il ramo

`feat/vista-certificati`, annidato su `feat/corpi-e-parita-lvgl` (un ramo alla volta, opzione 2).

### Il lavoro

### 1. Server — l'inventario

- `ImprontaStore::elenco() -> BTreeMap<String, Voce>` in `pin_tls.rs`, con test.
- **`certificati::inventario(s)`** in `sws-web/src/certificati.rs` restituisce un `Inventario` con:
  - **`tls`**: presente, soggetto, emittente, nomi (SAN), validità dal/al, impronta. Si legge `tls.crt` con
    `x509-cert` (PEM → DER con `rustls-pemfile`).
  - **`dispositivi`** e **`mqtt`**: righe `{chiave, impronta, visto_il_ms}`. Lo store MQTT si apre con
    `ImprontaStore::in_config(config, "mqtt_broker_conosciuti.yaml")`, lo stesso file del supervisore.
  - **`viewer_lvgl`**: `{disponibile, righe}` da `$SWS_VIEWER_DATA` o `/var/sws/viewer`. Sola lettura (decisione
    4).
  - **`opcua_client`**: per ogni sorgente OPC-UA del progetto aperto, i `.der` di `trusted` e `rejected` con
    soggetto, scadenza e impronta.
  - **`opcua_server`**: il certificato proprio e i fidati e rifiutati di `<cwd>/pki`, se esiste. Sola lettura,
    con la nota che vive nel container (fino a una scelta che il piano lascia aperta).
  - **`ssh`**: le righe di `known_hosts` (host, o «nascosto» se l'host è sotto hash) e la chiave di progetto
    (presente e impronta della pubblica). Sola lettura.
- **Una funzione pura `leggi_certificato(der) -> Dettagli`**, con un test su un certificato generato da
  `rcgen`: soggetto, nomi, validità.
- **Rotte**:
  - `GET /api/certificati` (Admin) sul router `build` e in `deploy_only_app`.
  - `POST /api/certificati/dimentica {archivio: "dispositivi"|"mqtt", chiave}` (Admin), audit
    `cert.forget`. La riga morta della decisione 8 si toglie da lì.
  - **Remote**: `GET /api/remote/certificati` e `POST /api/remote/certificati/dimentica`, con i commenti
    `"{base}/api/certificati…"` per la guardia di parità.
  - `check_audit_attore.sh` impara l'evento nuovo.

### 2. Il quadlet 6 → 7 (decisione 4)

- `deploy/container/sws-runtime.container`: `Volume=/data/user/sws/viewer:/var/sws/viewer:ro` ed
  `Environment=SWS_VIEWER_DATA=/var/sws/viewer`.
- `[quadlet 7]` sui tre file, `check_quadlet.sh --aggiorna`, etichetta dell'immagine.
- **Rischio da chiudere prima**: un `Volume=` su una cartella che non c'è ferma l'avvio del runtime. Va
  verificato, ed eventualmente aggiunto, che `install-container.sh` crei sempre `<dati>/viewer`, anche senza LVGL.
  Va controllato anche che l'aggiornamento del quadlet la crei sui pannelli già installati.

### 3. L'interfaccia — Sicurezza → Certificati

- La foglia `certificati` (🔏, `soloAdmin`) in `schede.ts`, il componente in `ConfigView.tsx`, l'etichetta
  i18n it/en.
- **`CertificatiTab.tsx`**: due colonne con lo stesso componente `ColonnaCertificati remoto={false|true}`. La
  seconda c'è solo con un pannello collegato. Per archivio, una sezione:
  - **TLS**: la card che c'è (`TlsSection`), con una prop `remoto`, più soggetto, nomi e scadenza
    dall'inventario.
  - **Dispositivi fidati** e **broker MQTT**: tabella chiave, impronta abbreviata, «visto il» e **Dimentica**
    (decisione 8: le righe di porte vecchie si vedono e si tolgono).
  - **Viewer LVGL**: in sola lettura; «non disponibile» se il runtime non vede la cartella (quadlet 6).
  - **Client OPC-UA**, per sorgente: file, stato, soggetto, scadenza, Fidati ed Elimina. Le funzioni sono
    esplicite, locale `/api/sources/…` e remota `/api/remote/sources/…`, non `suImpianto`, perché ogni colonna
    parla col suo lato.
  - **Server OPC-UA** e **SSH**: in sola lettura.
- **«Una sezione per dato»**:
  - la card TLS **esce** da Istanza → Stato (`SystemTab`), e al suo posto resta una riga col collegamento a
    Certificati;
  - la lista dei certificati OPC-UA esce dalla card della sorgente, che porta una riga col collegamento;
  - la guardia `la_card_tls_segue_il_dispositivo_connesso` (`router.rs`) si sposta sul file nuovo;
  - il «Dimentica certificato» nel messaggio d'errore di Connessione resta: è il gesto contestuale, non una
    seconda vista.

### 4. Documenti e test

- **Rust**:
  - `elenco`;
  - `leggi_certificato`;
  - l'inventario su una cartella temporanea con tls, due store, una pki OPC-UA finta;
  - la guardia delle rotte (Admin, parità).
- **Vitest**:
  - `CertificatiTab` con una colonna e con due;
  - «Dimentica» chiama la funzione locale o remota secondo la colonna;
  - la foglia invisibile al non-Admin (`pannelloSinistro.test.tsx`);
  - l'inventario del pannello proprietà se cambia.
- **Testi**:
  - nel piano dei certificati, 3, 4 e 8 → FATTE, e il piano in archivio se resta solo il seme 6;
  - il capitolo 17 del manuale (Sicurezza): la vista;
  - CHANGELOG, NOVITA (it/en), compreso il cambio di quadlet.

### Verifica

- `cargo test`, `pnpm exec vitest run`, `pnpm build`, `check_static.sh` (compresi `check_quadlet` e
  `check_audit_attore`).
- **Dal vivo**, con la build unica che il maintainer ha chiesto alla fine:
  - **sul TC620**: quadlet 7 applicato dall'avviso, colonna «dispositivo connesso» con il certificato del
    dispositivo (soggetto e scadenza veri), l'archivio LVGL visibile;
  - **in locale**: dimenticare una riga morta di `dispositivi_conosciuti.yaml` e vederla sparire.


## Le decisioni — tutte e otto prese il 23-10-2026

| | Scelta |
|---|---|
| **1. Il trust store OPC-UA rotto** | **Tutti e due adesso**: il percorso `trusted/certs` → `trusted` **e** il default della policy di sicurezza |
| **2. La card TLS a dispositivo remoto** | **Si aggiungono le rotte remote** (`/api/remote/system/tls`), perché è il presupposto di C4 |
| **3. Il perimetro della vista** | **Una scheda, due colonne**: «questa istanza» e «dispositivo connesso» |
| **4. L'archivio del viewer LVGL** | **Si monta in sola lettura** nel runtime: quadlet 6 → 7 |
| **5-6. Il certificato del pannello** | **Nome vero e scadenza breve**, con avviso e rinnovo |
| **7. Ruoli e audit** | **Tutto Admin**, e i cinque eventi di audit mancanti si aggiungono qui |
| **8. Le righe morte del pinning** | **Si mostrano**, col loro «dimentica» |

### Cosa discende dalle tre

**«Tutti e due adesso» è la scelta coraggiosa, e va fatta sapendo cosa tocca.** Il default
`security_policy: None` sta in **tre posti indipendenti**: il `serde(default)` di `sws-core`, la
sorgente vuota che crea l'IDE, e il template `opcua-demo`. Cambiarlo non rompe una sorgente che
dichiara `None` di proposito — quella continua a dichiararlo — ma cambia il comportamento di ogni
sorgente che **non lo dichiara**, e quelle sono le più vecchie. Serve la stessa regola di
compatibilità che la Fase 3 ha scritto per Modbus: **un progetto che non ha mai scelto si comporta
come prima**, e solo una scelta esplicita attiva il nuovo. Altrimenti il primo aggiornamento
stacca le sorgenti OPC-UA di chi non ha fatto niente di male.

**Le rotte remote e le due colonne sono la stessa cosa vista due volte.** La decisione 2 chiede
`/api/remote/system/tls`; la decisione 3 chiede `/api/remote/certificati/*`. Conviene disegnarle
insieme: la prima è un caso particolare della seconda, e farle in due giri vuol dire scrivere due
volte lo stesso proxy.

**Il buco della colonna «dispositivo connesso» si chiude con una riga**: l'archivio del viewer
LVGL si monta in sola lettura nel runtime, quadlet 6 → 7, e l'aggiornamento se lo porta dietro da
solo — lo stesso meccanismo appena usato per il journal.

**La scadenza breve è la decisione che fa più lavoro, e non è lavoro della vista.** Oggi il
certificato non scade (1975 → 4096) e nessuno legge una validità, nemmeno al caricamento di un
certificato esterno. Portarlo a uno o due anni vuol dire costruire **avviso e rinnovo**, e decidere
**dove si vede** l'avviso: barra dell'IDE, allarme di sistema, email. È materia di C4, e va
disegnata nella stessa sessione.

**E c'è una domanda che il nome vero si porta dietro**: i certificati già generati non cambiano
finché non li si rigenera, e rigenerare **rompe la fiducia di chi si era già fidato
dell'impronta**. Va deciso se la vista offre «rigenera» e cosa dice a chi lo preme.

**«Tutto Admin» è un cambio di comportamento**: l'elenco dei certificati OPC-UA oggi è Supervisor.
Va in `NOVITA.yaml`. Con lui si chiudono i cinque eventi di audit mancanti — su sei operazioni che
cambiano un certificato, oggi cinque non lasciano traccia.

## Le decisioni, una per una

### 1. Il trust store OPC-UA rotto — **DECISA e FATTA il 23-10-2026**

> Ramo `fix/certificati-1-trust-opcua`. Il percorso corretto, e i nomi delle due cartelle portati
> **in un posto solo** — nel plugin, che possiede la disposizione della PKI: era proprio la
> riscrittura a mano in quattro punti ad aver prodotto `trusted/certs`.
>
> Sulla policy, «tutti e due adesso» è stato realizzato **rispettando la compatibilità**: una
> sorgente **nuova** parte con `Basic256Sha256`, il default di **lettura** resta `None` perché chi
> non ha mai scelto non deve ritrovarsi le sorgenti staccate dopo un aggiornamento. E dove prima
> c'era una tabella vuota e muta, adesso c'è scritto **perché**.

Non è il refuso che sembrava. Le opzioni:

- **a** — ramo corto ora, **e** la domanda sul default della policy. Senza quella, correggere il
  percorso non riempie nessuna tabella.
- **b** — dentro il ramo della vista unica, all'onda 3. Resta rotto per settimane, e la sessione
  dell'onda 3 partirebbe da un'interfaccia che non ha mai funzionato.
- **c** — insieme alla card TLS remota (decisione 2): sono due difetti della stessa famiglia.

### 2. La card «Certificato TLS» a dispositivo remoto — **DECISA e FATTA il 23-10-2026**

> Ramo `fix/certificati-2-tls-remoto`. Le quattro rotte `/api/remote/system/tls*` ci sono, e con
> loro le quattro locali **sulla porta di gestione del dispositivo**, che il TLS non lo nominava
> affatto: senza quelle il proxy avrebbe preso 404 su ogni pannello in container.
>
> La card dice **di chi** è il certificato che mostra, e sul dispositivo dice anche le tre cose
> che succedono premendo: il pannello riparte, l'**impronta cambia** (e quella memorizzata resta
> la vecchia, quindi al prossimo collegamento il pinning rifiuta e compare «Dimentica
> certificato» in Connessione), e cambia lo **schema** dell'indirizzo salvato.
>
> **Il «dimentica» non si fa da qui**, ed è una scelta: non è mai automatico — è la regola già
> scritta sul gemello `/api/device/hostkey/forget` — e la domanda che il piano lascia aperta
> sotto la decisione 5 («cosa succede a chi si era già fidato dell'impronta vecchia») resta
> aperta. Qui si dice soltanto che succederà, prima di premere.
>
> Guardia: `la_card_tls_segue_il_dispositivo_connesso` in `router.rs`, provata rossa.


Oggi mostra e modifica **l'istanza locale**, anche con un pannello connesso. Il resto della scheda
usa la variante remota; per il TLS quella rotta non esiste.

- **a** — aggiungere `/api/remote/system/tls` (~80 righe), come già esiste per system, backup,
  database e ritenzione. **È il presupposto di C4**: TLS acceso di default con installer e «Connetti».
- **b** — nascondere la card quando c'è un remoto, e dire «si gestisce dalla vista Certificati».
- **c** — lasciarla e scriverlo nell'etichetta.

### 3. Il perimetro della vista — **DECISA: una scheda, due colonne — FATTA il 25-10-2026**

Il problema è reale e misurato: `tls.crt` e `dispositivi_conosciuti.yaml` stanno nella cartella di
configurazione **di chi gira**. Lo stesso schermo mostra archivi diversi a seconda dell'istanza.

- **a** — una scheda, due colonne: «questa istanza» e «dispositivo connesso». Serve una famiglia
  `/api/remote/certificati/*`.
- **b** — solo l'istanza locale; per il pannello ci si collega al pannello.
- **c** — due foglie sotto Sicurezza: Certificati (IDE) e Certificati (Dispositivo).

### 4. L'archivio del viewer LVGL — **DECISA: si monta in sola lettura — FATTA il 25-10-2026 (quadlet 7)**

Il runtime **non lo vede**: è montato solo nel container del viewer.

- **a** — una riga nel quadlet del runtime (`Volume=…/viewer:…:ro`), quadlet 6 → 7, e
  l'aggiornamento se la porta dietro da solo. Tutti gli archivi nella vista, e il reset di fabbrica
  sa cosa cancellare.
- **b** — resta fuori, e la vista nasce incompleta proprio sull'archivio che protegge il pannello.
- **c** — lo espone il viewer con un endpoint: un protocollo nuovo fra due container, per un file
  di poche righe.

### 5. Il nome del certificato del pannello — **DECISA e FATTA il 23-10-2026**

> Ramo `feat/c4-certificato-con-un-nome`. Il soggetto è il **nome del pannello**, lo stesso che
> mostrano la schermata di abbinamento e l'annuncio mDNS (`abbinamento::nome_proposto`). E i nomi
> coperti sono tre invece di uno: `localhost`, il nome, `<nome>.local` — prima un pannello
> raggiunto al suo nome presentava un certificato che quel nome non lo nominava.
>
> **I due generatori gemelli sono diventati uno.** Erano identici, uno nel runtime e uno in
> `sws-web`: la scadenza della decisione 6 si cambierà in un posto, non in due. Guardia:
> `il_certificato_si_genera_in_un_posto_solo`.
>
> **La domanda che restava — «cosa succede a chi si era già fidato dell'impronta vecchia» — non
> si è posta**: i certificati già generati non cambiano finché non li si rigenera. Si porrà con
> la decisione 6, perché una scadenza breve costringe a rigenerare, ed è lì che va risolta.


Oggi è **«CN=rcgen self signed cert»**, uguale su ogni pannello: nessuno imposta il
`distinguished_name`. Una colonna «soggetto» mostrerebbe quella stringa a tutti.

- **a** — si lascia.
- **b** — il nome del pannello o l'`instance_id` quando si genera: due righe. Ma i certificati già
  generati non cambiano finché non li si rigenera, e allora va deciso **cosa succede a chi si era
  già fidato dell'impronta vecchia**.

### 6. La scadenza — **SCIOLTA il 23-10-2026: due anni con rinnovo automatico**

> Il maintainer ha scelto l'opzione che **evita** il giro del «dimentica» a ogni rinnovo: il
> pannello annuncia l'impronta nuova **firmandola con la vecchia**, e chi si era fidato la
> accetta da solo. Avviso in tre posti: barra dell'IDE, allarme di sistema, email.
>
> **Non si scrive qui**: è un protocollo di fiducia, e il punto duro è che l'archivio tiene solo
> `sha256:<hex>` — da un'impronta non si verifica una firma. Seme dedicato:
> [`2026-10-23-rinnovo-del-certificato-firmato.md`](../plans/2026-10-23-rinnovo-del-certificato-firmato.md),
> con le misure e i quattro punti duri. **La scadenza si mette dopo che il rinnovo esiste**:
> metterla prima vuol dire un parco di pannelli che fra due anni scade senza che niente li
> rinnovi.


Il self-signed **non scade mai** (rcgen: 1975 → 4096, e nessuno lo cambia). Nemmeno
`upload_tls_cert` legge la validità di quello che gli si carica.

- **a** — si lascia: «avvisi di scadenza» resta una riga di documentazione, non una funzione.
- **b** — uno o due anni, con avviso e rinnovo. È lavoro di C4, non della vista, e va deciso anche
  **dove si vede** l'avviso: barra dell'IDE, allarme di sistema, email.

### 7. Ruoli e audit — **DECISA e FATTA il 23-10-2026**

> Ramo `fix/certificati-7-ruoli-e-audit`. L'elenco dei certificati OPC-UA è passato da Supervisor
> a **Admin**: la mezza misura non reggeva, perché chi vede l'elenco vede le impronte dei server
> a cui il progetto si collega. È un cambio di comportamento ed è in `NOVITA.yaml`; un Supervisor
> legge una riga che lo spiega invece di prendere un 403.
>
> I cinque eventi mancanti ci sono (`tls.generate`, `tls.upload`, `tls.remove`,
> `opcua.cert_trust`, `opcua.cert_delete`), più le tre remote nate con la decisione 2. Il
> `tls.upload` si scrive **dopo** la validazione — un PEM rifiutato non ha cambiato niente, e una
> voce per ogni incollata sbagliata sommerge quelle che contano — e `opcua.cert_trust` **solo se
> lo spostamento è avvenuto davvero**, altrimenti racconterebbe una fiducia mai data.
>
> `check_audit_attore.sh` è stata estesa: verifica tutte e nove, provata rossa.


- Ruoli: tutta Admin (coerente con le rotte di oggi), oppure due livelli come adesso — l'elenco dei
  certificati OPC-UA è Supervisor, le scritture Admin. **Portare quella rotta a Admin è un cambio
  di comportamento e va in `NOVITA.yaml`.**
- Audit: i cinque eventi mancanti (`tls.generate`, `tls.upload`, `tls.remove`,
  `opcua.cert_trust`, `opcua.cert_delete`) sono **~15 righe**, e chiudono il requisito CRA di
  tracciabilità insieme alla vista invece di lasciarlo aperto nel fascicolo.

### 8. Le righe morte del pinning — **DECISA: si mostrano, col loro «dimentica» — FATTA il 25-10-2026**

La chiave del pinning è `host:porta`, quindi per lo stesso pannello ci sono due righe. Il gesto che
le toglie tutte esiste già (`dimentica_host`): manca solo chi lo chiama.

- **a** — si lasciano e si mostrano, col loro «dimentica». Zero codice fuori dalla vista.
- **b** — si puliscono quando scatta il ripiego di porta.
- **c** — un «pulisci le porte non più in uso» dentro la vista.

---

## Quanto costa, quando si parte

- **Il difetto OPC-UA da solo**: mezza sessione — *se* la decisione 1 non apre la domanda sulla
  policy.
- **La vista intera**: ~1 500-2 000 righe su 12-18 file. Due o tre rami annidati, due o tre
  sessioni. Il ramo Sicurezza nell'albero di Configurazione **esiste già**, con una foglia sola
  (`users`): aggiungerne una è una riga più il componente.

**Quando.** Il seme proponeva di progettarlo nella sessione dell'onda 3 (TLS di default + 2FA/LDAP),
e quella proposta regge: C4 cambia proprio il primo archivio e il modo in cui l'IDE si fida del
pannello. Le onde 1 e 2 sono chiuse; C4 e C5 non sono iniziati.

---

## Le misure vecchie del seme (15-10 e 21-10), con le correzioni

Il seme diceva «gli archivi sono cinque, non sei», togliendo il server OPC-UA perché non ha
identità. Sull'identità aveva ragione; sul trust store no — ce l'ha, in `<cwd>/pki`, e nessuno lo
ha mai dichiarato. **Sono sei, ma non quelli che pensava il testo del 15-10.**

Reggono: il doppio modello impronte-contro-PKI; il fatto che il cambio di porte non tocchi il
certificato ma tocchi il pinning; e che non ci fosse un sottoinsieme veloce — quello cade con
`x509-cert`.
