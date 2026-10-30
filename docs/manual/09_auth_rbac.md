← [Indice](MAIN.md) | [← Historian](08_historian.md) | [Successivo → Deployment](10_deployment.md) →

---

# 09 — Autenticazione e Controllo Accessi

> Per chi installa e per chi amministra: **chi può entrare in un'istanza SWS, con che credenziale e
> con quali poteri**. Qui c'è il modello; le intestazioni, i token di servizio e i canali che li
> usano stanno nel [capitolo 18](18_container_e_comunicazione.md).
>
> Misurato sul codice il 19-10-2026.

---

## In breve

**Non esiste un'istanza aperta a tutti.** Un pannello appena installato non ha utenti, e proprio
per questo è **chiuso**: non entra nessuno, nemmeno in lettura, e mostra un **codice di
abbinamento** che chi sta davanti usa per creare la prima credenziale. Lo stesso vale per un'IDE
appena installata, che stampa all'avvio un **codice di primo accesso** da usare una volta sola.

> **Cambiato l'11-10-2026.** Fino al 10-10 un progetto senza utenti girava in «no-auth mode»:
> tutte le rotte aperte e un Admin sintetico per chiunque passasse. Non esiste più. Un pannello
> già in servizio senza utenti, dopo l'aggiornamento, si chiude finché non lo si abbina una volta.
> La scorciatoia `--senza-autenticazione` esiste ancora per lo sviluppo locale, e il runtime
> **rifiuta di partire** se la trova su una macchina con un indirizzo raggiungibile da Internet.

Chi può entrare dipende da che cosa è questa istanza. Il runtime lo decide una volta sola, e la
stessa decisione vale per tutte le rotte:

| Istanza | Fonte dell'identità | Dove vivono le credenziali |
|---|---|---|
| Pannello **senza utenti** | nessuna: **in attesa di abbinamento** | — (c'è il codice) |
| Pannello **con utenti** | utenti del progetto + Admin del dispositivo | `users.yaml` del progetto, `utenti_dispositivo.yaml` della config |
| **IDE** (PC, server, cloud) | utenti dell'installazione | `identita.db` della config |
| **Container di progetto** nel cloud | la dice il gateway, firmata | nessuna: `X-SWS-Gateway` + `X-SWS-Utente` |
| `--senza-autenticazione` | nessuna: Admin sintetico | — (solo loopback) |

Riferimento: `fonte_autenticazione` in `sws-runtime/crates/sws-web/src/router.rs:1644`, usata da
`require_auth` (`:2166`) e `optional_auth` (`:2351`).

---

## 1. Un pannello nuovo è chiuso: l'abbinamento

Un pannello senza nessun utente risponde **401 `abbinamento_richiesto`** a ogni rotta di dati,
viewer compreso. Restano aperte solo quelle che servono proprio ad abbinarlo o a sapere che è
vivo: `GET /api/abbinamento`, `POST /api/abbinamento/rivendica`, `POST /api/abbinamento/nome`,
`POST /api/auth/login`, `/health`, `/cert`, `/.well-known/security.txt` e — sulla sola 7443 —
`GET /api/project`. I file statici dell'interfaccia si servono comunque: è così che il browser
riesce a disegnare la schermata col codice invece di una pagina bianca.

### Il codice

```
7KQ2-M9XD-3HWP-T4BZ
```

- **16 caratteri in quattro gruppi**, alfabeto Crockford base32 maiuscolo (niente `I L O U`):
  80 bit. In ingresso si perdonano minuscole, spazi, trattini e le lettere che si scambiano per
  cifre (`O` vale `0`, `I` e `L` valgono `1`).
- **Casuale, generato al primo avvio** e salvato in `<config>/abbinamento.json` con permessi
  `0600`: resta lo stesso fra reinstallazioni del container e aggiornamenti, e ne nasce uno nuovo
  dopo un factory reset.
- **Monouso**: appena viene usato se ne genera un altro, che si mostra solo se il pannello torna
  senza utenti.
- **Dieci tentativi sbagliati in cinque minuti** e il pannello smette di accettarne finché la
  finestra non scade. Ogni tentativo sbagliato finisce nel log e nell'audit log.

**Dove si legge**: nel log all'avvio, al posto di ogni pagina del pannello, sullo schermo del
viewer LVGL, e in coda all'output di `install-container.sh`. Vederlo è la prova di «possesso
fisico»: chi sta davanti allo schermo, o raggiunge la pagina in rete locale, può abbinare il
pannello.

### Abbinare in rete locale

Dall'IDE, **Configurazione → Istanza → Device → Connessione → «Connetti»**: se il pannello è in
attesa compare il campo del codice. Oppure direttamente dalla pagina del pannello. Si inseriscono
codice, nome utente e una password di **almeno 8 caratteri**, e nasce l'**Admin del dispositivo**.

### L'Admin del dispositivo

Vive in `<config>/utenti_dispositivo.yaml`, **fuori dal progetto**: un deploy non se lo porta via
e non lo sovrascrive. Vale accanto agli utenti del progetto — il login prova prima gli uni, poi
gli altri — e ha ruolo `Admin` senza restrizioni di zona.

È la differenza che conta quando un progetto viene sostituito: gli utenti del progetto arrivano e
se ne vanno col deploy, l'Admin del dispositivo resta ed è la credenziale di servizio di quella
scatola.

### Abbinare dal cloud

Un pannello che non è ancora abbinato chiama da solo il gateway (l'indirizzo sta nell'immagine) e
si presenta **in attesa**, col suo codice e la sua identità hardware. Dall'IDE nel cloud,
**«Abbina un pannello»** manda il codice al gateway, che gira la rivendica al pannello
attraverso il tunnel insieme a nome e token.

Due casi diversi, e la differenza è voluta:

| Il pannello | Cosa serve per abbinarlo al cloud | Cosa succede |
|---|---|---|
| **non ha utenti** | il solo codice | prende nome e token, e **resta senza utenti**: chiuso in rete locale, raggiungibile solo dal gateway, in attesa del primo progetto |
| **ha già utenti** | il codice **e** le credenziali di un suo Admin | prende nome e token; gli utenti restano quelli |

Il secondo caso esiste perché chi legge il codice sullo schermo di un pannello già in servizio
non deve poterselo portare nella propria azienda.

Finché il pannello abbinato non ha utenti lo raggiunge solo il gateway, che firma le richieste nel
tunnel con `X-SWS-Dal-Gateway`. Il **primo deploy si ferma** (428 `serve-admin`) se il progetto
non porta almeno un Admin, e l'IDE offre di aprire la scheda Utenti.

Il meccanismo del tunnel, l'identità hardware e i token sono descritti nel
[capitolo 18](18_container_e_comunicazione.md#3-nel-cloud).

---

## 2. Il primo accesso di un'installazione IDE

Un'IDE (`start_editor.sh`, il container sul VPS, il gateway) non usa gli utenti di un progetto:
ha il suo archivio, `identita.db`, nella cartella di configurazione.

Quando l'archivio è vuoto il runtime stampa all'avvio un **codice di primo accesso** monouso:

```
  ════════════════════════════════════════════════════════════
  PRIMO ACCESSO — nessun utente in questa installazione.

    codice: 3f9a1c7e5b2d4086a1f3c9d7e5b20486

  Aprilo nell'IDE e crea l'amministratore. Il codice vale
  finche non esiste un utente, poi smette da se.
  ════════════════════════════════════════════════════════════
```

La schermata del primo amministratore chiede quel codice, un'email, un nome e una password. Due
condizioni, e servono entrambe: **non deve esistere ancora nessun utente** (appena ne esiste uno
la rotta smette di funzionare per sempre) e **il codice deve combaciare**, confrontato a tempo
costante. Il codice vive solo in memoria: un riavvio ne genera un altro.

Insieme al primo amministratore nasce l'**azienda implicita**, con lui dentro.

---

## 3. Gli utenti del progetto

Sono gli utenti che stanno sul dispositivo e viaggiano col deploy: operatori, manutentori,
ingegneri d'impianto.

### Dove stanno

In `users.yaml`, **accanto** a `project.yaml` nella cartella del progetto — non dentro di esso.

```yaml
# <progetto>/users.yaml
users:
  - username: operatore1
    password_hash: "$argon2id$v=19$m=65536,t=3,p=4$..."
    role: Operator
    allowed_zones: ["sala_a", "sala_b"]
    session_ttl_secs: 28800    # 8 ore (predefinito)
    must_change_password: false
```

Si gestiscono da **Configurazione → Sicurezza → Utenti**.

### Password

Hash **Argon2id**, mai in chiaro né nei log né su disco. Un utente creato da un amministratore
nasce con `must_change_password`: al primo accesso l'API lo obbliga a cambiarla prima di
lasciargli fare altro. Ogni utente cambia la propria da **Utente → Cambia password**; un Admin
può reimpostare quella di chiunque.

### Login

```bash
curl -k -X POST https://localhost:7444/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"mia_password"}'
```

```json
{
  "token": "…",
  "expires_at_ms": 1735689600000,
  "role": "Admin"
}
```

Il token si manda come `Authorization: Bearer …`; i WebSocket, che dal browser non possono mandare
intestazioni, lo passano come `?token=…`.

```bash
curl -k -H "Authorization: Bearer $TOKEN" https://localhost:7444/api/project
```

### Sessioni e limiti

| | |
|---|---|
| Durata | 8 ore (`SWS_SESSION_TTL_SECS`), sovrascrivibile per utente con `session_ttl_secs` |
| Dove vivono | **in memoria**: un riavvio del runtime invalida tutti i token |
| Login sbagliati | **5 in 60 secondi** sullo stesso nome utente e si resta fuori (`SWS_LOGIN_RATE_LIMIT`, `SWS_LOGIN_RATE_WINDOW_SECS`) |

Le sessioni degli **utenti dell'installazione** sono invece persistite in `identita.db` e durano
8 ore scorrevoli, rinnovate a ogni uso: dietro un gateway che avvia e ferma container, una
sessione che muore al riavvio del processo butterebbe fuori chi sta lavorando.

Un deploy **non** butta fuori chi è collegato: riaprendo il progetto il runtime conserva le
sessioni degli utenti che esistono ancora con la stessa password, ruolo e zone.

---

## 4. I quattro ruoli (RBAC)

| Ruolo | Livello | Descrizione |
|-------|---------|-------------|
| **Viewer** | 1 | Sola lettura, nessuna interazione |
| **Operator** | 2 | Può interagire (pulsanti, ACK allarmi, slider) |
| **Supervisor** | 3 | Può modificare configurazione, ricette, funzioni |
| **Admin** | 4 | Accesso completo, gestione utenti, deploy |

| Azione | Viewer | Operator | Supervisor | Admin |
|--------|--------|---------|-----------|-------|
| Visualizzare sinottici | ✅ | ✅ | ✅ | ✅ |
| Visualizzare tag live | ✅ | ✅ | ✅ | ✅ |
| Visualizzare trend/storico | ✅ | ✅ | ✅ | ✅ |
| Scrivere tag (pulsanti/slider) | ❌ | ✅ | ✅ | ✅ |
| ACK allarmi | ❌ | ✅ | ✅ | ✅ |
| Shelving allarmi | ❌ | ❌ | ✅ | ✅ |
| Applicare ricette | ❌ | ✅ | ✅ | ✅ |
| Modificare configurazione | ❌ | ❌ | ✅ | ✅ |
| Git commit / tag | ❌ | ❌ | ✅ | ✅ |
| Git push / init / fork | ❌ | ❌ | ❌ | ✅ |
| Gestire utenti | ❌ | ❌ | ❌ | ✅ |
| Deploy / packaging | ❌ | ❌ | ❌ | ✅ |
| Eliminare progetto | ❌ | ❌ | ❌ | ✅ |

I ruoli sono gerarchici: un controllo scritto come «almeno Supervisor» lascia passare anche
l'Admin.

---

## 5. Le zone (ABAC)

Le zone limitano **quali pagine** un utente vede, dentro il ruolo che ha. Sono un secondo asse,
indipendente dal primo.

```yaml
# synoptics/sala_controllo.yaml
zones:
  - "sala_a"
  - "supervisore"
```

```yaml
# users.yaml
users:
  - username: operatore_a
    role: Operator
    allowed_zones: ["sala_a", "comune"]
  - username: supervisore
    role: Supervisor
    allowed_zones: ["sala_a", "sala_b", "comune", "supervisore"]
```

Vede la pagina chi ha **almeno una** zona in comune con quelle della pagina. Due liste vuote
valgono entrambe «nessuna restrizione»: una pagina con `zones: []` la vedono tutti, e un utente
con `allowed_zones: []` vede tutte le pagine.

Le zone decidono anche da quale pagina si apre il viewer, quando la pagina iniziale del progetto
non è fra quelle permesse.

---

## 6. Gli utenti dell'installazione, le aziende e la console

Gli utenti di `identita.db` sono un modello diverso da quelli del progetto: non stanno su un
impianto, stanno su un'installazione dell'IDE, e sono quelli che il cloud usa.

### Due ruoli, più un asse a parte

| Ruolo | Cosa può fare |
|---|---|
| **Sviluppatore** | lavora sui progetti dell'azienda |
| **Amministratore** | più i membri e le impostazioni dell'azienda |

Sono due e non quattro per scelta: sono i ruoli **dell'azienda**, non quelli dell'impianto.

A parte, su un asse suo, c'è l'**amministratore di piattaforma**: una spunta su un utente, non un
grado più alto. È chi approva le aziende. Un Admin di progetto non amministra la piattaforma, e
un amministratore d'azienda non deve poter approvare sé stesso.

### Le aziende

| Stato | Cosa comporta |
|---|---|
| `in_prova` | chi si registra prova l'editor con quote piccole |
| `approvata` | i pannelli si possono abbinare |
| `sospesa` | — |

Uno stato illeggibile vale `in_prova`: nel dubbio, il meno potente.

Ogni azienda ha una cartella sotto la radice dei progetti, un marchio facoltativo e tre quote:
`max_progetti_aperti` (quanti progetti può tenere **aperti insieme**, perché ogni progetto aperto
è un container da avviare — non il numero totale), `max_pannelli` e `max_byte`.

### Entrare: password, PIN, «ricordami»

Un utente dell'installazione entra con email e password. Dalla 2.23.8, nella stessa schermata:

- **«Ricordami su questo browser per 30 giorni»**: la sessione dura 30 giorni invece di 8 ore, e
  come quella normale si rinnova a ogni uso;
- **«Entra con un PIN via e-mail»**, se l'installazione ha la posta configurata (console → Posta):
  arriva un codice di otto simboli, valido 10 minuti e una volta sola. La password non cambia.

I tentativi sbagliati di password e di PIN si contano **insieme**: cinque in cinque minuti
bloccano quell'indirizzo per cinque minuti, e il PIN in volo si butta.

### Registrarsi da soli (gateway)

Un gateway acceso con **`--gateway-registrazione`** (o `SWS_GATEWAY_REGISTRAZIONE=1`) e con la
posta configurata mostra anche **«Crea un account»**. Chi si registra accetta le condizioni d'uso e
approva a parte le clausole del punto 14, riceve un codice per posta e, scrivendolo, entra: nasce
con **un'azienda sua**, di cui è Sviluppatore, con un tetto di tre progetti. Vede solo i suoi
progetti, non entra nella console e non invita nessuno. Le condizioni e l'informativa sono in
`/condizioni` e `/privacy`, che esistono solo a registrazione aperta.

Per costruzione la schermata non dice mai se un indirizzo è iscritto: registrarsi con un
indirizzo che ha già un account, o chiedere un PIN per uno che non ce l'ha, risponde allo stesso
modo, e all'iscritto arriva una e-mail che lo avvisa.

L'interruttore è spento di default, e va acceso di proposito: i testi di `docs/legale/` sono
ancora una bozza da rivedere.

### La console

Aziende, persone, pannelli, marchi, risorse, posta e impostazioni dell'installazione si governano
dalla **console**. Ci entra chi è **amministratore di piattaforma** oppure amministratore di
almeno un'azienda; su un dispositivo la console non esiste e nessuno ci entra.

---

## 7. Le due porte

| Porta | Senza utenti | Con utenti |
|-------|---|---|
| **7443** viewer | 401 `abbinamento_richiesto`, salvo le rotte pre-auth del §1 | autenticazione **facoltativa** — senza token si è Viewer anonimo |
| **7444** gestione | 401 `abbinamento_richiesto`, salvo le rotte pre-auth del §1 | **obbligatoria** — senza token 401 |

**Viewer anonimo** (7443 con utenti, senza token): vede i sinottici e i tag live nei limiti delle
zone, non scrive tag, non riconosce allarmi e non entra in configurazione. Un token scaduto o
sconosciuto vale come nessun token: si resta anonimi, e le rotte che scrivono continuano a
chiedere il ruolo.

Non esiste un'impostazione per spegnere l'accesso anonimo sulla 7443. Se la 7443 non deve essere
raggiungibile, la si chiude a livello di rete; sul pannello la **7444 ascolta già solo su
`127.0.0.1`** (`--no-admin`) e si raggiunge con un tunnel SSH o dal cloud. Vedi il
[capitolo 17](17_sicurezza.md).

---

## 8. Audit log

| Evento | Cosa viene registrato |
|--------|----------------------|
| Login / Logout | Username, IP, timestamp, esito |
| Codice di abbinamento sbagliato | timestamp |
| Abbinamento riuscito | utente creato, se locale o dal cloud |
| Primo amministratore dell'installazione | email |
| Scrittura tag | Username, tag ID, valore scritto, timestamp |
| ACK allarme | Username, alarm ID, timestamp |
| Modifica progetto | Username, tipo modifica, timestamp |
| Deploy | Username, target, esito, timestamp |

Il log è un JSONL append-only in `<config>/audit.jsonl`, concatenato per hash — dove `<config>`
è `--config`, cioè `/var/sws/config` di default, `/data/user/sws/config` sul pannello e `.run/config`
nello stack di sviluppo. Con `SWS_AUDIT_KEY` è anche firmato; senza, resta *tamper-evident* ma non
*tamper-resistant*, e il runtime lo dice all'avvio.

```bash
tail -f /data/user/sws/config/audit.jsonl | jq '.'
```

---

## 9. Le credenziali del progetto (`secrets.yaml`)

Le password e i token che il progetto usa per **collegarsi** (broker MQTT, HomeAssistant, OPC-UA, Postgres,
ODBC, SMTP, bot Telegram) non stanno in `project.yaml`: vivono in `secrets.yaml`, nella stessa cartella, con
permessi `0600`. Sono sette campi, con una chiave stabile per id:

```yaml
# secrets.yaml — 0600, mai in git, mai in un export condiviso
datastores.pg1.password: ...
notifications.smtp.password: ...
notifications.telegram.bot_token: ...
sources.broker.password: ...
sources.casa.token: ...
```

Il runtime li rimette a posto al caricamento, quindi per tutto il resto del codice il progetto è quello di
sempre. **Un solo punto scrive**: `scrivi_progetto` estrae i segreti, scrive `secrets.yaml` e poi
`project.yaml`, entrambi in modo atomico.

**Fuori dal runtime escono mascherati.** Ogni lettura via HTTP (`GET /api/project`) e ogni lettura
dell'assistente IA sostituisce i sette valori con `********`: il browser non li vede mai, e nemmeno il
fornitore del modello. Rimandare indietro il segnaposto vuol dire «non toccare»; il valore vero lo rimette il
runtime prima di scrivere.

**Dove viaggiano**: col deploy e col backup sì (un dispositivo senza credenziali non si collega a niente), con
l'export condiviso no — a meno della casella «Includi i segreti», spenta di default. In git mai:
`secrets.yaml` finisce in `.gitignore`, e se un repository lo aveva già tracciato il commit successivo lo toglie
dall'indice e lo dice.

**Un progetto salvato prima del 22-09-2026** ha ancora i valori in chiaro dentro `project.yaml`: alla prima
apertura il runtime fa un backup dell'intera cartella e poi li sposta, lasciando una riga nell'audit log. Quello
che era già finito in un backup, in un export o in un commit **resta in chiaro**: la storia non si riscrive, e
il rimedio è ruotare le credenziali.

Da non confondere con le password **degli utenti** di questo capitolo, che sono hash Argon2id e non sono
recuperabili: quelle dicono chi può entrare, queste dicono come il progetto parla con il mondo.

---

## Riferimenti nel codice

| Cosa | Dove |
|---|---|
| La decisione sulla fonte | `sws-runtime/crates/sws-web/src/router.rs:1644` (`fonte_autenticazione`) |
| I due middleware | `router.rs:2166` (`require_auth`), `router.rs:2351` (`optional_auth`) |
| Abbinamento, codice, Admin del dispositivo | `sws-runtime/crates/sws-web/src/abbinamento.rs` |
| Primo accesso dell'installazione | `router.rs:1811` (`identita_stato`), `router.rs:1851` |
| Utenti del progetto, Argon2id, ruoli | `sws-runtime/crates/sws-auth/src/lib.rs` |
| Utenti dell'installazione, aziende, quote | `sws-runtime/crates/sws-identita/src/lib.rs` |
| Zone | `router.rs:6623` (`zone_allowed`) |
| La scorciatoia di sviluppo e il suo rifiuto | `sws-runtime/crates/sws-runtime/src/main.rs:1139` |

---

← [Indice](MAIN.md) | [← Historian](08_historian.md) | [Successivo → Deployment](10_deployment.md) →
