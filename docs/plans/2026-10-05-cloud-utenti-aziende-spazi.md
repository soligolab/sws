# Il tronco cloud: utenti, aziende, spazi di lavoro — e la catena fino al pannello

> **Piano d'esecuzione**, scritto il 05-10-2026 nella sessione di plan approfondita che il seme
> [identità, utenti e istanze](2026-09-18-identita-utenti-istanze.md) chiedeva prima di scrivere una
> riga. Quel file resta e non si archivia: tiene le decisioni numerate del 27-09 e del 05-10 e il
> testo integrale di Q44, Q54 e Q56. **Chiude anche Q60**
> ([workspace dei progetti](2026-09-18-workspace-dei-progetti.md)) — vedi Fase 3.

## Contesto

SWS oggi è un programma che si installa accanto a un impianto. Il maintainer vuole mostrarlo a
possibili aziende da un sito web — **`sws.soligo.net`** — e lasciare che ci provino con un account
loro: «è sempre un PoC quindi non mi serve una compliance CRA pesante ma i meccanismi chiave tipo la
registrazione degli utenti, la 2FA e un po' di infrastruttura base mi servono».

Modello di prodotto fissato il 05-10: servizio **solo cloud**, il cliente installa **solo il
runtime**, l'IDE non si distribuisce — ma il self-host resta possibile (decisione 27). Il CRA resta
«un po' sul fondo come linea guida». Perimetro deciso: le aziende provano **con un account loro**
(quindi il gateway non è rimandabile) e la demo arriva **fino al pannello collegato**.

## I fatti che vincolano il disegno (misurati il 05-10-2026)

1. **`senza_autenticazione(ide_only, ha_utenti) = ide_only || !ha_utenti`**
   (`sws-web/src/router.rs:1305`), con due chiamanti — `require_auth:1326` e `optional_auth:1445` —
   che iniettano un **Admin sintetico** inesistente in `users.yaml`. Un'istanza IDE non chiede la
   password **mai**, nemmeno con utenti definiti. È il buco che impedisce di accendere il dominio.
2. **Gli utenti stanno dentro il progetto**: `AuthState.store_path` punta sempre a
   `<project_dir>/users.yaml` (`sws-auth/src/lib.rs:240`, `projects.rs:1069`), e aprire un progetto
   fa `swap_store`, che **invalida tutte le sessioni**. Nessun archivio a livello di installazione.
3. **`AppState` tiene un solo progetto** (`router.rs:70-186`): due utenti sullo stesso processo si
   scambiano il progetto sotto i piedi. ~86 MB RSS e 10 thread per processo (misura del 27-09, build
   debug).
4. **Il gruppo pre-auth è largo**: `project_lifecycle` (`router.rs:860-900`) lascia senza token
   creazione, apertura, cancellazione e upload ZIP dei progetti, più `/api/fs/browse-dirs` e
   `/api/fs/mkdir`. È pre-auth **per necessità** della WelcomeScreen, che chiama prima che un token
   esista. `deploy_only_app` (`router.rs:1062`) dimostra già l'alternativa stretta, con un test
   (`router.rs:10237`) che verifica che ogni chiamata dell'IDE abbia una rotta.
5. **Non esiste niente** di: azienda, tenant, workspace come unità, quota, 2FA, registrazione,
   verifica email, modalità gateway. `instance_id` è un token di 3 byte per i client-id MQTT.
6. **Lo strato remoto è già tutto costruito** e compone `{base}/api/…` da `RemoteTarget.url`
   (`remote.rs:600, 665, 726, 794`, più `inoltra_aggiornamento` per gli aggiornamenti). È il fatto
   che rende economica la decisione 38 — vedi Fase 6.

Materiale pronto da riusare: **`rusqlite`** (bundled) è già dipendenza del workspace, **`lettre`
0.11** è già in `sws-web`, **argon2** e il rate-limit per username sono in `sws-auth`, il registro di
**audit** a catena di hash esiste, **`remote_relay.rs`** fa già da ponte ai WebSocket.

## Decisioni di questa sessione

- **L'archivio dell'identità è un crate nuovo, `sws-identita`, su SQLite** in
  `<config_dir>/identita.db`. Non si estende `sws-auth`: quello è l'elenco degli utenti **del
  progetto**, che viaggia col deploy e protegge l'impianto. Mischiarli è la confusione che il 14-09
  ha chiuso fuori il maintainer dal suo editor. La decisione 22 lo dice già: account cloud e account
  d'impianto separati.
- **`--senza-autenticazione`, flag esplicito di sviluppo**: avviso all'avvio, e **rifiuta di partire
  se il listener non è su loopback**. Il CRA vieta le credenziali predefinite, non un opt-out
  dichiarato — e il verso si inverte, perché oggi l'assenza di password è il default silenzioso.
- **Un container podman per processo IDE** (decisione 25 confermata).
- **Il gateway è lo stesso binario** in modalità `--gateway` (decisione 26, coerente con la decisione
  architetturale congelata «same binary, role chosen by `--viewer-port`»).
- **Niente VPN: un tunnel per dispositivo** (decisione 38, che supera le 7-11). Vedi Fase 6.

## Architettura

```
      sws.soligo.net · tunnel.soligo.net     Traefik :443 instrada per nome host
                     │                 :80 → reindirizzamento, e sfida HTTP-01
       ┌─────────────┴─────────────┐
       ▼                           ▼
 sws-runtime --gateway        tunnel dei pannelli
 login · 2FA · aziende         (connessioni uscenti dai dispositivi)
 quote · instradamento                 │
       │                               │
       │  identita.db (SQLite)         │   un pannello = una sessione,
       │  aziende, utenti, membri,     │   non un indirizzo su una rete
       │  sessioni, inviti,            │
       │  progetti, pannelli           ▼
       ▼                         pannello → localhost:8444
  un container per progetto aperto      users.yaml suo, abbinato con un codice
  (podman rootless, immagine runtime)
  --auth-delegata, monta solo la sua cartella
```

**Tre fonti di autenticazione dichiarate**, al posto del booleano di oggi: `senza_autenticazione`
sparisce e lascia il posto a un enum esplicito.

| Modo | Chi | Da dove vengono gli utenti |
|---|---|---|
| `Progetto` | pannello/dispositivo | `users.yaml` del progetto (come oggi) |
| `Installazione` | IDE in locale o self-host | `identita.db` dell'installazione |
| `Delegata` | container dietro il gateway | intestazione firmata dal gateway, accettata **solo** da socket locale |

`ide_only` resta quello che è (nessuna `--viewer-port`) e continua a governare le altre dieci cose
che governa — sorgenti in sola lettura, niente notifiche, niente riapertura automatica, assistente
IA, niente registratore dei datastore. **Smette solo di decidere l'autenticazione.**

## Le fasi

Un ramo corto per fase (decisione 29: niente rami lunghi, i conflitti di significato git non li
vede). Ogni fase è utile da sola e lascia `main` consegnabile.

### Fase 0 — la prova di raggiungibilità (quasi niente codice)

Con la decisione 38 questa fase si è **sgonfiata**, ed è una buona notizia. Quando il piano prevedeva
OpenVPN, la prova a mano era un cancello: un componente di terzi, un servizio che parte solo al
riavvio, l'`auth-user-pass` obbligatorio, una CA per azienda. Il tunnel è codice nostro su TLS
uscente, quindi non c'è nessun componente da validare prima di progettare.

Resta **una** domanda che vale la pena misurare presto, perché la risposta non si deduce: **una
connessione TLS uscente sulla 443 da un pannello dentro una rete d'impianto regge nel tempo?** NAT
con timeout aggressivi, proxy che intercettano, ispezione TLS. Si misura con una sonda banale — un
WebSocket che manda un keepalive e registra le cadute — lasciata su per qualche giorno.

Non è più un cancello: si può fare in parallelo alla Fase 1.

> **Da `theobroma` non si fa**: questa macchina non raggiunge nessun dispositivo. Serve il maintainer
> a casa (TC620) o una sessione su `frodo` (WP630).

### Fase 1 — l'identità sopra i progetti, e l'IDE che chiede la password ✅ FATTA (06-10-2026)

Il pezzo che serve a tutto il resto, e che si usa **anche senza cloud**.

- Crate nuovo **`sws-runtime/crates/sws-identita`**: schema SQLite (`utenti`, `sessioni`), argon2
  preso da `sws-auth`, sessioni **persistite** — oggi stanno in RAM e un riavvio le butta, e dietro
  un gateway che riavvia i container non reggerebbe.
- `router.rs`: via `senza_autenticazione`, dentro l'enum `FonteAutenticazione`; `require_auth` e
  `optional_auth` smettono di fabbricare l'Admin sintetico quando la fonte è `Installazione`.
- Primo avvio di un'installazione senza utenti: **si crea il primo amministratore**, non si apre
  tutto. (Sul dispositivo il caso equivalente è la Fase 6, col codice di abbinamento.)
- `--senza-autenticazione` come deciso sopra, accanto agli altri flag (`main.rs:46-164`).
- Frontend: via il sentinella **`"no-auth"`** (`App.tsx:470`, `auth/useAccessoSenzaUtenti.ts:27`,
  `viewer/RuntimeViewer.tsx:125`) e la logica di `auth/sessioneScaduta.ts` costruita sopra di esso.

**Verifica**: test di `sws-identita` (creazione, accesso, scadenza, lockout); un test di `router.rs`
che con fonte `Installazione` e nessun token risponda 401 su una rotta che oggi passa; a schermo,
l'IDE su 8460 che chiede le credenziali.

### Fase 2 — la lista bianca delle rotte pre-auth ✅ FATTA (06-10-2026)

Possibile **solo dopo** la Fase 1: oggi `project_lifecycle` è pre-auth perché la WelcomeScreen chiama
prima che un token esista, e con il login dell'installazione quel vincolo cade.

- `project_lifecycle` e `/api/fs/*` dietro `require_auth`; `/metrics` autenticato o solo su loopback.
  Restano aperte `/health`, `/cert`, `/sw.js`, `POST /api/auth/login`.
- **`scripts/check_rotte_preauth.sh`**: la lista bianca è scritta, e la guardia fallisce se una rotta
  nasce fuori da `require_auth`. Sul modello del test di `deploy_only_app` (`router.rs:10237`), che
  fa già questo mestiere dall'altro lato. **Da provare rossa.**

> **Fasi 1 e 2 chiuse il 06-10-2026**, squash `9fc2a391`, collaudate dal maintainer. Quello che è
> stato fatto diversamente da come era scritto qui:
>
> - **`--senza-autenticazione` non rifiuta «fuori da loopback»** ma «se la macchina è raggiungibile
>   da Internet». La regola scritta nel piano non reggeva alla realtà: l'IDE di sviluppo si apre
>   dalla LAN, e su loopback il flag sarebbe stato inutile proprio nel caso per cui esiste.
> - **Il sentinella `"no-auth"` non è stato rimosso**: si disattiva da solo, perché viene impostato
>   solo quando `whoami()` riesce senza token, e ora quella chiamata risponde 401. Toglierlo del
>   tutto tocca anche il viewer e le finestre staccate; resta per quando serviranno davvero.
> - **In più**: il primo accesso con codice monouso (decisione 42), che il piano collocava in Fase 6
>   per i pannelli. Serviva già qui — senza, un'installazione senza utenti non avrebbe nessuno con
>   cui accedere.
>
> Tre difetti trovati al collaudo, due introdotti da questo lavoro, tutti della stessa famiglia: il
> token era usato **di nascosto come segnale di «è cambiato qualcosa»**. Chiudere un progetto
> disconnetteva; le pagine si caricavano solo perché aprire un progetto cambiava il token; la lista
> dei progetti non scorreva. Una sessione che dura ha tolto quel segnale a chi lo usava senza
> dichiararlo — da tenere a mente per le fasi che vengono.

### Fase 3 — aziende, spazi di lavoro, quote  ·  **3a FATTA** (06-10-2026)

- `identita.db` cresce: `aziende` (stato in prova/approvata/sospesa, quote), `membri` (amministratore
  | sviluppatore, decisione 18), `inviti`, `progetti` (azienda → cartella).
- **Lo spazio di lavoro di un'azienda è la sua cartella**: `<projects_root>/<azienda>/<progetto>`.
  Q46 non si tocca — `dentro_radice` (`projects.rs:240`) continua a valere, su ogni cartella
  d'azienda invece che su una sola. **Questo chiude Q60** per il cloud: il workspace non lo sceglie
  l'utente, lo assegna la piattaforma; la forma «una radice alla volta» resta per il self-host.
- Quote per azienda: progetti, pannelli, spazio (decisione 23). **Al superamento si blocca solo ciò
  che crea** (decisione 24): un deploy e un pannello in servizio non si fermano mai.
- Amministratore di piattaforma: approva le aziende (decisione 17).

### Fase 3c — i ruoli governano qualcosa, e l'amministratore vede solo la sua azienda

Richiesta del maintainer il 07-10-2026: «una configurazione dei ruoli degli utenti, per esempio
potrei voler definire per una azienda un amministratore che vede solo la sua azienda e può
approvare nuovi utenti».

**Oggi i due ruoli esistono nei dati e non governano niente**: `membri.ruolo` è
`amministratore | sviluppatore` (decisione 18), ma la console è accessibile **solo**
all'amministratore di piattaforma e mostra tutto. Il pezzo che manca non è il ruolo — è il
**confinamento**: la stessa console, aperta da un amministratore d'azienda, deve vedere la sua
azienda e nient'altro.

**Perché dopo la 3b e non prima.** Confinare significa rispondere «di quale azienda è questa
cosa?» per ogni oggetto che la console mostra. Finché i progetti non appartengono a un'azienda —
cioè fino alla 3b — quella domanda non ha risposta per metà del contenuto, e si finirebbe a
confinare gli utenti e non i progetti: un confinamento a metà è peggio di nessuno, perché sembra
esserci.

**L'approvazione dei nuovi utenti** che il maintainer nomina si incastra invece con la
**registrazione** (Fase 5): è lì che nascono utenti da approvare. Il ruolo si confina in 3c, il
pulsante «approva» compare in 5.

### Fase 4 — il gateway

- `sws-runtime --gateway`: serve la SPA pubblica, accesso, registrazione, pannello dell'azienda;
  instrada `/p/<progetto>/*` al container del progetto, avviandolo a richiesta e **spegnendolo da
  fermo**. Lo spegnimento non è una rifinitura: la decisione 23 ha scelto di *non* fare una quota di
  «progetti aperti insieme», quindi è l'unica difesa che c'è, ed è ciò che rende sufficiente un
  VPS-1 (decisione 39).
- `--auth-delegata` sul figlio: accetta l'identità dall'intestazione del gateway **solo** da socket
  locale. È la riga che il piano del 27-09 segnala per nome — «`ide_only` dietro il gateway deve
  voler dire *l'autenticazione la fa il gateway*, e le due cose non vanno confuse».
- Container podman rootless, immagine del runtime, montata **solo** la cartella del progetto
  (decisione 25).
- **Branding per azienda** (decisione 43): il gateway serve `/branding/active.json` per azienda
  invece che statico, e il frontend non cambia di una riga —
  `sws-editor/src/branding/index.ts:151` fa già quella fetch. Con il **catalogo** scelto il 06-10
  non c'è niente da caricare né da immagazzinare: i marchi restano file statici nell'immagine.
  L'**associazione azienda → marchio** si fa dalla console di amministrazione (decisione 42), che
  nasce in Fase 3.
- **Prerequisito infrastrutturale**: il canale di rilascio oggi è `rc-arm64`, e il gateway su un
  server x86 deve avviare un'immagine **amd64**, che la CI costruisce solo come build di sviluppo. Va
  pubblicata su ghcr prima di questa fase.

### Fase 5 — registrazione, email, 2FA

Dopo il gateway perché è lì che vivono le pagine pubbliche; prima dei pannelli perché è ciò che il
maintainer vuole mostrare.

- Registrazione libera con verifica dell'indirizzo, recupero password, inviti ai colleghi, via
  `lettre` riusando `notifications.rs`. **Attenzione**: oggi la configurazione SMTP è **del
  progetto**; qui ne serve una **dell'installazione** (`<config_dir>/smtp.yaml`), ed è un pezzo
  nuovo, non un riuso. Sui VPS OVH la porta 25 in uscita è bloccata di default: serve un relay su
  587 con PTR, SPF e DKIM, o le email di verifica finiscono nello spam (decisione 39).
- **2FA TOTP** opzionale per utente, che l'azienda può rendere obbligatoria (decisione 19). Unica
  dipendenza nuova del piano (`totp-rs`, oppure `hmac`+`sha1`+`base32`: le app di autenticazione
  vogliono SHA-1, e nel workspace c'è solo `sha2`).
- Accettazione di termini e informativa privacy: la registrazione libera li porta con sé
  (decisione 17).

### Fase 6 — i pannelli: abbinamento, primo accesso, tunnel

- **Codice di abbinamento** sullo schermo LVGL e sulla pagina locale (decisioni 12 e 14), che è
  **anche il primo accesso** del pannello (decisione CRA 4): finché non viene usato non entra
  nessuno, e sparisce l'Admin sintetico anche sui dispositivi. Lo stesso codice è il modo in cui il
  pannello riceve la **credenziale del tunnel**.
- **Il tunnel per dispositivo** (decisione 38). Due pezzi nuovi:
  - *lato pannello*: una connessione TLS uscente persistente verso il gateway, che inoltra a
    `localhost:8444` — nessuna porta in ingresso, nessun `tun`, nessun root, nessun riavvio;
  - *lato gateway*: il multiplexer, con riconnessione, keepalive, backpressure e timeout, che espone
    ogni pannello come `https://<gateway>/dev/<pannello>/…` e **decide per ogni richiesta** quale
    azienda può parlare con quale pannello.
- **Lo strato remoto esistente non si riscrive**: tutte le operazioni compongono `{base}/api/…` da
  `RemoteTarget.url` (fatto 6), quindi basta puntare `base` all'URL del multiplexer perché
  connessione, deploy, utenti, backup, database e aggiornamenti funzionino come oggi. Cambia la
  fiducia nel certificato: il TOFU di `certificati.rs` oggi fissa il certificato del dispositivo, lì
  si fissa quello del gateway.
- L'indirizzo del gateway è nell'immagine ma modificabile (decisione 13).
- **Utenti d'impianto «locali»** (Q54 opzione 3, decisione 21): il deploy sostituisce quelli del
  progetto e non tocca quelli nati sul pannello.

## Il vincolo del self-host, da tenere vivo (decisione 27)

Una guardia, `scripts/check_self_host.sh`: avvia l'IDE **senza gateway e senza azienda**, fa
l'accesso con un utente dell'installazione, apre un progetto. Se un domani una dipendenza dal cloud
si infila nel nucleo, quella guardia diventa rossa. Costa poco perché la strada esiste già —
`scripts/start_editor.sh` è letteralmente «l'IDE come lo avvierebbe un cliente».

## Verifica

Per ogni fase, la *definition of done* di `CLAUDE.md`: `cargo check`, `pnpm build`,
`./scripts/check_static.sh`, più la conferma del maintainer a schermo. In più:

- **Guardie nuove, da provare rosse**: `check_rotte_preauth.sh` (Fase 2), `check_self_host.sh`.
- **La prova che conta davvero**, da rifare a ogni fase utile: due browser, due utenti di due aziende
  diverse, ciascuno sul proprio progetto, contemporaneamente. È il caso che oggi `AppState` non
  regge, ed è quello che le aziende faranno per primo.
- **La prova di isolamento** (Fase 6): un pannello che tenta di raggiungere un pannello di un'altra
  azienda non deve avere nessuna strada — e con la decisione 38 non deve esistere nemmeno
  l'indirizzo da provare.

## Chiesto dal maintainer il 07-10-2026, e dove sta ciascuna cosa

Tre aspetti, con la fase in cui hanno senso e il perché — due stanno altrove, uno ha bisogno di
una correzione.

**Stato delle risorse del server.** Piccolo e indipendente: `/api/system` restituisce **già** CPU,
memoria e disco (`system.rs`), e la schermata «Questa installazione» della console è il posto dove
mostrarli. Non ha bisogno di una fase: si fa quando conviene, ed è mezza giornata.

**Gestione ed esportazione dei backup.** Questa invece **non è piccola, e non è nuova**: è una
delle domande aperte di Q44, «backup e ripristino **per azienda**, non per progetto come oggi». I
backup esistono (`backups.rs`) ma sono per progetto, e finché un progetto non appartiene a
un'azienda non esiste la cosa da esportare. Quindi: **dopo la 3b**, e il testo della domanda è già
nel seme — non serve riscriverlo.

**Regole VPN per azienda — ⚠ qui c'è da correggere un modello.** La VPN **non esiste più**: la
decisione 38 del 05-10 l'ha sostituita con un **tunnel per dispositivo**, proprio perché un
pannello può essere rooted dal cliente e una VPN lo metterebbe su una rete condivisa con gli altri.
Non ci saranno quindi «regole VPN»: la domanda equivalente è **quali pannelli appartengono a
un'azienda e cosa possono raggiungere**, e la risposta è strutturale invece che regolamentare — il
gateway decide per ogni richiesta, e fra due pannelli non esiste nessun segmento comune da vietare.
È la **Fase 6**, e il maintainer stesso l'aveva messa in attesa di quel momento.

## Quello che questo piano **non** fa

- Non tocca `users.yaml` del progetto né il deploy che lo porta: sono gli utenti d'impianto e restano
  dove sono (decisione 22). L'unico cambiamento li riguarda alla Fase 6, marcandoli «locali».
- Non cambia la licenza: fuori dal percorso critico, verificato il 07-09 (il titolare non è
  licenziatario di sé stesso).
- Non fa il terzo livello della gerarchia (integratore → cliente finale): lo schema non deve
  impedirlo (decisione 16), ma non si costruisce ora.
- Non fa TLS di default sui pannelli, verifica dei certificati di campo, reset di fabbrica, firma
  delle immagini, SBOM di prodotto, valutazione del rischio: restano nella
  [gap analysis CRA](2026-10-05-cra-gap-analysis.md) come lista della spesa per quando ci sarà un
  prodotto da consegnare.
