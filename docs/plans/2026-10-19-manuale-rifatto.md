# Piano — il manuale rifatto, e un capitolo nuovo su container e comunicazione

> 19-10-2026. Dal seme [`2026-09-19-screenshot-del-manuale.md`](../archive/2026-09-19-screenshot-del-manuale.md)
> (rimandato «a progetto stabilizzato»): il maintainer avvia il lavoro sulla documentazione e chiede in più «un
> capitolo molto esaustivo su come è organizzato il container runtime, e tutto quello che riguarda la comunicazione».

## Decisioni del maintainer (19-10-2026)

- **Perimetro del capitolo nuovo**: l'immagine `sws-runtime` **ovunque** — com'è fatta, e i suoi tre ruoli: sul
  pannello, come gateway del cloud, come container di progetto nel cloud.
- **Comunicazione**: **tutto, dal browser al campo** — porte e listener, API e WebSocket, autenticazione, IDE ↔
  dispositivo, cloud ↔ pannello (tunnel), gateway ↔ container, TLS e fiducia nei certificati, mDNS, aggiornamenti
  dal registry; i protocolli di campo con un rimando al capitolo 06.
- **Pubblico**: **integratore e chi installa** — cosa gira dove, quali porte aprire, cosa passa sulla rete, come si
  diagnostica. Schemi e tabelle; i file di codice solo come riferimento in fondo alle sezioni.
- **Ordine**: prima il capitolo nuovo, poi ogni capitolo riletto contro il codice (uno per ramo, con l'elenco di
  cosa è cambiato), infine le schermate (prima l'elenco delle inquadrature da approvare, poi lo scatto).

## Ramo 1 — capitolo 18 «Container e comunicazione»

Misure da fare sul codice, non sulla memoria: Containerfile (base, pacchetti, utente, cartelle, etichette,
healthcheck, entrypoint), quadlet del pannello e del VPS, `install-container.sh`, `immagini.sh`; `gateway/` (container
per progetto, inoltro, identità, chiave di ritorno); `tunnel/` (WebSocket uscente, multiplexing); `remote.rs` e
`remote_relay.rs`; listener e porte in `sws-runtime/src/main.rs`; certificati; mDNS; aggiornamento e conferma.

Schemi in Mermaid (GitHub li disegna): l'immagine e i suoi tre ruoli; le porte; i flussi (operatore → pannello,
IDE → pannello in LAN, IDE nel cloud → pannello via tunnel, deploy, aggiornamento). Tabelle: porte, canali WebSocket,
intestazioni e token, cartelle e volumi, variabili d'ambiente. Una sezione di diagnosi («non si collega» → cosa
guardare).

## Ramo 2 — revisione dei capitoli 01–17

Uno per ramo, contro il codice. Per ognuno: cosa è cambiato, cosa manca, cosa togliere. `MAIN.md` (dice ancora
«versione documentata 2026.7.0») e il capitolo 03 vanno allineati al 18.

### La misura, fatta il 19-10-2026

Tutti i capitoli riletti contro il codice di `origin/main`. Lo stato:

| Stato | Capitoli |
|---|---|
| aggiornati | 07, 08, 15, 16, 17 (con un rimando rotto), 18 (un percorso sbagliato) |
| quasi | 14 |
| parziali | 04, 05, 06, 10, 11 |
| vecchi | MAIN, 01, 02, 03, 09, 12, 13 |

**Le tre bugie più gravi**, se si dovesse toccare una riga sola:

1. **Il capitolo 09 dice il contrario della verità su chi può entrare.** «L'autenticazione è opzionale», «no-auth
   mode (default del PoC)». Dal 06-10 (`9591acaf`) e dall'11-10 (`d9c6418e`) un runtime senza utenti è **chiuso** e
   mostra un codice di abbinamento (`sws-runtime/crates/sws-web/src/abbinamento.rs:4-10`);
   `--senza-autenticazione` si rifiuta di partire se non è su loopback
   (`sws-runtime/crates/sws-runtime/src/main.rs:1139-1147`). La stessa falsità è ripetuta in MAIN, 01, 02, 03 e 13.
2. **Tre rotte del capitolo 13 non esistono con quel nome** — e nei tre casi il `curl` d'esempio lì sotto usa già
   quello giusto: `/api/cert` → `/cert` (`router.rs:1110`), `/api/log` → `/api/logs` (`router.rs:607`),
   `/api/projects/open` → `/api/projects/:azienda/:nome/open` (`router.rs:1363`).
3. **I conteggi dei simboli sono sbagliati in quattro punti di due capitoli**: 22 o 40 contro i **138** SVG di
   `sws-editor/public/symbols/lib/`, e la distinzione «29 disegnati ricolorabili / 11 importati» non esiste più da
   `77cd50f6`.

### Decisioni del maintainer (19-10-2026)

- **Granularità**: **un ramo per capitolo**, diciassette. «Uno per ramo» resta alla lettera.
- **Profondità**: **verità ovunque, riscrittura solo dove serve**. Riscrittura piena: **09, 12, 13**. Riscrittura di
  due sezioni: **03**. Tutti gli altri: passata di verità.
- **Struttura**: barra di navigazione e timbro di verifica si sistemano **dentro il ramo di ogni capitolo**, non in
  un ramo a parte.
- **Confine col ramo 3**: 01–17 restano **capitoli di consultazione** — cosa esiste, com'è fatto, quali opzioni ci
  sono. Le procedure guidate vanno nel tutorial. Il **02 si accorcia** a «installa, entra, abbina».

### Cosa si fa in ogni ramo, sempre

1. **Timbro di verifica** in testa, nella forma già usata da 17 e 18: un blockquote che dice per chi è il capitolo e
   `Misurato sul codice il GG-MM-AAAA`. Oggi ce l'hanno solo 17 e 18.
2. **Barra di navigazione** in testa e in coda, nella forma dei capitoli 01–15. Oggi **16, 17 e 18 non ce l'hanno** e
   la catena si interrompe: dal 15 non si arriva da nessuna parte.
3. **Niente schermate**: si rifanno nel ramo 4.
4. **Ogni affermazione nuova letta nel codice**, con il file che la prova citato — in riga, o in una tabella
   «riferimenti» in fondo alla sezione, come fa il 18.

**La guardia da non far diventare rossa.** `scripts/check_manuale_widget.sh` è l'unica che legge il manuale:
pretende che ogni tipo di `SUPPORTED_TYPES` compaia in `docs/manual/05_widget_reference.md` **fra backtick**, e ha
quel percorso cablato (righe 33 e 54). Quindi il capitolo 05 non si rinomina, non si sposta, e i widget si citano in
`` `backtick` `` e non in grassetto. Nient'altro è protetto: indice, barra di navigazione, link, àncore e immagini si
rompono in silenzio e vanno verificati a mano prima di ogni squash merge.

### L'ordine, e cosa c'è da fare in ciascuno

Prima i capitoli che **mentono**, poi quelli **parziali**, infine quelli già a posto.

**1. `fix/manuale-09-autenticazione`** — riscrittura. Il modello di accesso di oggi ha tre piani che il capitolo non
nomina: l'abbinamento del pannello (`abbinamento.rs`; `/api/abbinamento`, `/rivendica`, `/nome` —
`router.rs:1115-1119`), gli utenti del dispositivo (`utenti_dispositivo.yaml`, oggi citato una volta sola in tutto il
manuale, nel 18) e gli utenti dell'installazione con i ruoli `Sviluppatore`/`Amministratore` più
`amministratore_piattaforma` (`sws-identita/src/lib.rs:70-73,196`). Da togliere: il paragrafo «No-auth mode» (11-22),
le righe 171, 206, 215, 217-220, e l'impostazione inventata `optional_auth: false` (179) — `optional_auth` è il nome
di un middleware (`router.rs:2351`), non una voce di configurazione. Sistemare il rimando di `17_sicurezza.md:31`.

**2. `fix/manuale-13-api`** — riscrittura, rigenerando l'elenco da `router.rs`. Le tre rotte false; manca metà delle
API di oggi: `/api/cornici` (`router.rs:851-856`), `/api/abbinamento*`, `/api/projects/:azienda/:nome/*` con
`archive`/`unarchive`, `/api/remote/*`, `/ws/remote/:sub`, `/api/datastores/*`, `/api/update/*`,
`/api/security/frame-origins`, `/api/pannelli`. Via la premessa «in no-auth mode tutte le route sono aperte» (8-9).

**3. `fix/manuale-03-architettura`** — due sezioni riscritte, il resto passata di verità. **18 crate, non 15**:
`sws-plugin-api` non esiste più, mancano `sws-banco`, `sws-identita`, `sws-lvgl-viewer`, `sws-plugin-host`. La
sezione «dual-port» va riscritta: le due porte restano vere sul pannello ma non sono più tutto, col rimando al 18 per
gateway, container di progetto e tunnel. Nella pianta del progetto manca `cornici/` (`sws-web/src/cornici.rs:6`;
esempio in `examples/templates/tc620-sistema/cornici/testata.yaml`). PyO3 è 0.29, non 0.23.

**4. `fix/manuale-indice`** — MAIN.md, più il percorso sbagliato del 18. La riga «Versione documentata: 2026.7.0»
**si toglie**, non si aggiorna: nessuna guardia la tiene allineata (`check_release_coerente.sh` controlla quattro
file e MAIN non è fra quelli), ed è per questo che è sopravvissuta; al suo posto il timbro per capitolo. Rust ≥ 1.88
(`sws-runtime/Cargo.toml:28`), non 1.75. Via il riquadro «autenticazione opzionale (PoC)». Porte e prerequisiti si
accorciano a un rimando al 18. E in `18_container_e_comunicazione.md:535`, `sws-runtime/src/main.rs` →
`sws-runtime/crates/sws-runtime/src/main.rs`.

**5. `fix/manuale-01-panoramica`** — 22 simboli → 138; no-auth; rumqttc 0.25, PyO3 0.29. Le due misure dei bundle
(597/874 kB) contraddicono il 03 (24/310 kB): si rimisura una volta sola. La riga «Proof of Concept — non per uso in
produzione» (199) è contraddetta dal 17, che dichiara un fabbricante, cinque anni di supporto e la procedura art. 14
CRA: da riformulare, non da cancellare.

**6. `fix/manuale-02-quickstart`** — verità **e accorciamento**: resta «installa, entra, abbina», il resto rimanda al
ramo 3. Via la nota PoC/no-auth in testa, via `2026.7.0` nella risposta d'esempio (152), Rust 1.88.

**7. `fix/manuale-12-gitops`** — riscrittura; ultimo tocco 20-06-2026. Tutti i percorsi UI sono cambiati:
«Configurazione → Runtime → GitOps» non esiste, Git è una foglia del ramo Progetto
(`sws-editor/src/config/schede.ts:86`); «Configurazione → Device» è «Istanza → Device» (`schede.ts:91-95`). Manca
tutto quello che è stato aggiunto: ramo di prova (`router.rs:443-445`), fork (`:448`), chiave SSH **di progetto**
(`:501`, `ChiaveProgetto.tsx`), tag (`:505-506`), git nel cloud (`9260a9b4`).

**8. `fix/manuale-04-editor`** — le parti nuove non si toccano (cornici 350-371, risoluzione 393-408, archivio
468-477, scorciatoie 479-497). Da correggere: il menu ≡ (43 e 521) — i simboli personalizzati sono in
**Configurazione → Istanza → Risorse** (`ResourcesTab.tsx:67`); la palette non ha cinque categorie ma **dieci
gruppi** (`sws-editor/src/i18n/it.json:249-260`, `ff9d07c1`); i conteggi dei simboli (149 e 513). Da aggiungere
**«Salva come…»** (`MainMenu.tsx:122-136`), assente da tutto il manuale, e la proposta automatica di cornice alla
prima pagina (`sws-editor/src/cornici/PropostaCornice.tsx`). Le scorciatoie riservate sono dieci
(`sws-editor/src/scorciatoie/registro.ts:50`), non cinque.

**9. `fix/manuale-05-widget`** — attenzione alla guardia. Il riquadro sui simboli (735-750) da rifare da zero. Il
pulsante (145-155) ha solo `label/tag/write_value/on_press_fn/button_action` e gli mancano **`button_mode`**
(`write|momentary|toggle|set|reset|increment|decrement`) e **`assegnazioni`**
(`sws-editor/src/types/index.ts:411-416`). Da aggiungere il **simbolo che comanda** (`SvgCanvas.tsx:6145-6223`).
Font (109-129) e `clock` (560-580) sono perfetti.

**10. `fix/manuale-06-protocolli`** — un buco solo ma grosso: la sezione OPC-UA (270-320) non dice che
`trust_all_certs` è passato a `false`, con fiducia al primo contatto e trust store (15-10). È il capitolo dove uno va
a leggere.

**11. `fix/manuale-10-deployment`** — via i nomi `sws-2026.7.0-*` (`scripts/package.sh:35-39` compone il nome da
`cargo metadata`); da aggiungere il **quarto percorso**, il cloud, come rimando al 18.

**12. `fix/manuale-11-package`** — solo i nomi dei tarball con la versione vecchia.

**13. `fix/manuale-14-test`** — gli spec E2E sono sei, non tre (`sws-editor/e2e/`); «viewer anonimo senza auth» va
riletto alla luce dell'abbinamento.

**14-17. `fix/manuale-07-allarmi`, `-08-historian`, `-15-multilingua`, `-16-prestazioni`** — niente di smentito:
rilettura mirata, timbro, barra. Per il **15** resta il rilievo di `STATUS.md:3274` (dichiara una conformità IT/EN
che tre template non hanno): o si corregge il testo, o si correggono i template — e quello è codice, che qui non si
fa.

**17-bis. `fix/manuale-17-sicurezza`** — solo barra e il rimando corretto al 09. Si può accodare al ramo del 09: è
l'unico accorpamento che ha senso.

### Una guardia da valutare — proposta, non decisa

Niente oggi si accorge che l'indice di `MAIN.md` non cita un capitolo, che la catena «Successivo →» si interrompe
(sta succedendo adesso, dal 15 in poi), che un link o un'àncora non risolvono, o che un'immagine citata non c'è. Un
`scripts/check_manuale.sh` che verifica queste quattro cose costerebbe poco. Non è deciso: è codice nuovo in un
lavoro di documentazione.

### Verifica, per ogni ramo

- `cargo check`, `pnpm build`, `./scripts/check_static.sh` verdi.
- A mano prima dello squash merge: barra di navigazione corretta, indice di `MAIN.md` allineato, link e àncore
  esistenti, nessuna immagine nuova.
- Conferma del maintainer sul testo, capitolo per capitolo: è la parte che nessuno script può fare, ed è il motivo
  per cui i rami sono diciassette.

## Ramo 3 — Parte II, il tutorial (aggiunto il 19-10-2026)

Richiesta del maintainer: «una sezione stile tutorial che un capitolo alla volta spieghi come creare un progetto
vuoto, creare tag e type, mappare i protocolli (sarebbe bello un esempio OpenPLC con cui comunicare per ogni
protocollo), il deploy e l'abbinamento del dispositivo».

Decisioni (19-10-2026):
- **Dove**: una **Parte II — Tutorial** del manuale, capitoli `T01…` in `docs/manual/`, nell'indice di `MAIN.md`; i
  capitoli di riferimento rimandano ai passi del tutorial.
- **Laboratorio**: **OpenPLC Runtime v4** con un solo programma (un piccolo impianto simulato: pompa, serbatoio,
  allarme) esposto in **Modbus TCP, S7 e OPC UA**, più **Mosquitto** per MQTT; tutto in container podman, con uno
  script che lo avvia e lo ferma. EtherNet/IP con OpenPLC v3 come capitolo facoltativo; Home Assistant e Modbus RTU
  solo descritti.
- **Filo**: **un impianto unico** che cresce capitolo dopo capitolo, con il progetto finale scaricabile.
- **Verifica**: **ogni passo eseguito davvero** contro il laboratorio, con le schermate prese durante l'esecuzione
  (Playwright).

Capitoli proposti (da confermare all'inizio del ramo):

| | Capitolo |
|---|---|
| T01 | Il laboratorio: avviare OpenPLC e Mosquitto, caricare il programma dell'impianto |
| T02 | Un progetto vuoto, la risoluzione, le lingue |
| T03 | Tag e type: le variabili dell'impianto, un type «pompa» riusato |
| T04 | Modbus TCP verso OpenPLC: lettura, scrittura, catalogo |
| T05 | OPC UA verso OpenPLC: certificati e fiducia al primo contatto |
| T06 | S7 verso OpenPLC |
| T07 | MQTT con Mosquitto: OpenPLC non parla MQTT, quindi un ponte o un publisher di prova |
| T08 | Le pagine: cornice, simboli, tubi, una finestra di dettaglio con parametri |
| T09 | Allarmi e storico: soglie, banner, trend |
| T10 | Utenti e ruoli |
| T11 | Il pannello: deploy in rete locale e abbinamento col codice |
| T12 | Il pannello dal cloud: abbinamento, tunnel, deploy remoto |
| T13 | Aggiornare il pannello |
| T14 | (facoltativo) EtherNet/IP con OpenPLC v3 |

Da misurare all'inizio del ramo: come si installa OpenPLC Runtime v4 in container (immagine pronta o build), quali
indirizzi espone per ogni protocollo, e se il programma si carica senza l'editor grafico.

## Ramo 4 — le schermate

Prima l'elenco delle inquadrature, capitolo per capitolo, da approvare; poi lo scatto con
`sws-editor/e2e/screenshots.spec.ts` (`./scripts/check_e2e.sh --screenshots`). Oggi dieci schermate, quattro non
citate da nessun capitolo.

## Stato

- **19-10-2026 — ramo 1 fatto**: `docs/manual/18_container_e_comunicazione.md` (540 righe), nell'indice di `MAIN.md`.
  Verificato contro il codice punto per punto; corretti in rilettura il limite dei login (falliti, per nome utente),
  i permessi di `/ws/logs` e il trust store di OPC UA. Da rileggere dal maintainer.
- **19-10-2026 — ramo 2 pianificato**: tutti i capitoli misurati contro il codice, stato e lavoro per ciascuno qui
  sopra; decise granularità (un ramo per capitolo), profondità (verità ovunque, riscrittura per 09, 12, 13) e il
  confine col tutorial.
- Prossimo: i diciassette rami del ramo 2, nell'ordine indicato; poi il ramo 3 (tutorial) e il 4 (schermate dei
  capitoli di riferimento, che potranno riusare quelle del tutorial).
