← [Indice](MAIN.md) | [← GitOps](12_gitops.md) | [Successivo → Testing](14_testing.md) →

---

# 13 — API Reference

> L'elenco completo delle rotte HTTP e WebSocket, per chi integra SWS con qualcos'altro o deve
> capire cosa passa sulla rete. Le rotte sono raggruppate **per chi può chiamarle**, perché è la
> domanda che si fa chi legge questo capitolo. Il modello di accesso sta nel
> [capitolo 09](09_auth_rbac.md); le intestazioni di servizio e i flussi nel
> [capitolo 18](18_container_e_comunicazione.md).
>
> Rigenerato da `sws-runtime/crates/sws-web/src/router.rs` il 19-10-2026.

---

## In breve

Un processo `sws-runtime` apre fino a due porte, e ognuna ha il suo router:

| Porta | Chi la usa | Autenticazione |
|---|---|---|
| **7443** | viewer operatori | facoltativa: senza token si è Viewer anonimo |
| **7444** | IDE e amministrazione | obbligatoria |

Su un pannello **senza utenti** entrambe rispondono `401 abbinamento_richiesto` a tutto quello
che non è nell'elenco delle rotte aperte qui sotto. Un'istanza **IDE** (`start_editor.sh`, il
cloud) apre solo la 7444, sulla porta 8460 o quella configurata. Di default il runtime è in HTTP;
con il TLS attivo, `https://`.

**Il token** si manda come `Authorization: Bearer <token>`. I WebSocket, che dal browser non
possono mandare intestazioni, lo passano come `?token=<token>`.

I ruoli nominati nelle tabelle sono quelli del [capitolo 09](09_auth_rbac.md#4-i-quattro-ruoli-rbac):
Viewer, Operator, Supervisor, Admin, gerarchici — «Supervisor» vuol dire «Supervisor o Admin».

---

## Le rotte aperte, senza autenticazione

| Metodo | Rotta | Cosa fa | Porte |
|---|---|---|---|
| GET | `/health` | risponde `ok`: serve all'healthcheck del container | 7443, 7444 |
| GET | `/cert` | scarica il certificato TLS dell'istanza | 7443, 7444 |
| GET | `/.well-known/security.txt` | contatto per le segnalazioni di sicurezza | 7443, 7444 |
| POST | `/api/auth/login` | autentica e restituisce il token | 7443, 7444 |
| GET | `/api/abbinamento` | stato dell'abbinamento e, se il pannello è in attesa, il codice | 7443, 7444 |
| POST | `/api/abbinamento/rivendica` | usa il codice: crea l'Admin del dispositivo o salva le credenziali del tunnel | 7443, 7444 |
| POST | `/api/abbinamento/nome` | rinomina nel tunnel; la protegge la firma del gateway | 7444 |
| GET | `/api/identita/stato` | dice se l'installazione ha già un amministratore | 7444 |
| POST | `/api/identita/primo-amministratore` | crea il primo amministratore col codice di primo accesso | 7444 |
| GET | `/branding/:marchio/:file` | logo, favicon e `brand.json` di un marchio | 7444 |
| GET | `/api/project` | il progetto attivo, coi segreti mascherati | **solo 7443** |

> `GET /cert`, non `/api/cert`.

### GET /metrics

Metriche Prometheus in `text/plain`. **Non** è aperta: vuole una sessione oppure il token statico
`SWS_METRICS_TOKEN`.

```bash
curl -k -H "Authorization: Bearer $SWS_METRICS_TOKEN" https://localhost:7443/metrics
```

---

## Autenticazione e sessione

| Metodo | Rotta | Cosa fa | Porte |
|---|---|---|---|
| POST | `/api/auth/login` | apre una sessione | 7443, 7444 |
| GET | `/api/auth/whoami` | chi sono, con ruolo e zone | 7443, 7444 |
| POST | `/api/auth/logout` | chiude la sessione | 7443, 7444 |
| POST | `/api/auth/change-password` | cambia la propria password | 7443, 7444 |
| POST | `/api/auth/verify-password` | riconferma la password senza rifare il login | 7443, 7444 |
| POST | `/api/auth/refresh` | rinnova la sessione | 7443, 7444 |
| GET | `/api/identita/mie-aziende` | le aziende di chi è collegato | 7444 |
| GET | `/api/identita/marchio` | il marchio da mostrare | 7444 |
| GET | `/api/identita/spazio` | lo spazio usato, per le aziende che hanno un tetto | 7444 |

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

---

## Porta 7443 — il viewer

### Lettura (anche anonima)

| Metodo | Rotta | Cosa fa |
|---|---|---|
| GET | `/api/tags` | istantanea di tutti i tag |
| GET | `/api/tags/:id` | un tag |
| GET | `/api/alarms` | stato corrente degli allarmi |
| GET | `/api/alarms/history` | storico degli allarmi |
| GET | `/api/history/:tag` | campioni storici di un tag |
| GET | `/api/history/:tag/stats` | statistiche aggregate di un tag |
| GET | `/api/history/xy` | due tag l'uno contro l'altro, per il grafico XY |
| GET | `/api/history/export` | esportazione CSV dello storico |
| GET | `/api/synoptics` | elenco dei sinottici |
| GET | `/api/synoptics/:name` | un sinottico; con `?cornice=1` già composto con la sua cornice |
| GET | `/api/pages/nav` | l'albero delle pagine con gli id, per il navigatore |
| GET | `/api/cornici`, `/api/cornici/:id` | le cornici di pagina |
| GET | `/api/faceplates`, `/api/faceplates/:id` | i faceplate; `?dettagli=1` dà anche `predefinito` e `personalizzato` per ognuno |
| GET | `/api/recipes`, `/api/recipes/:id`, `/api/recipes/history` | le ricette e il loro storico |
| GET | `/api/project/images`, `/api/project/images/:name` | le immagini del progetto |
| GET | `/api/datastores`, `/api/datastores/:id/stats` | i datastore e le loro statistiche |
| GET | `/api/project/fingerprint` | l'impronta del progetto, per sapere se è cambiato |
| GET | `/api/system` | **ridotto** per chi non è Operator: solo versione, `uptime_s`, `auth_required`, stato del quadlet e domanda di conferma — i campi dell'avviso d'aggiornamento sullo schermo del pannello (dal 20-10-2026). Intero da Operator in su |
| GET | `/api/update/status` | se c'è una versione nuova (aperta dal 20-10-2026: l'avviso compare anche su un pannello abbinato) |

### Operator

| Metodo | Rotta | Cosa fa |
|---|---|---|
| PUT | `/api/tags/:id` | scrive un tag |
| POST | `/api/alarms/:id/ack` | riconosce un allarme |
| POST / DELETE | `/api/alarms/:id/shelve` | mette o toglie un allarme dallo scaffale (Supervisor) |
| GET | `/api/alarms/shelved` | gli allarmi sullo scaffale |
| POST | `/api/recipes/:id/apply` | applica una ricetta |
| POST | `/api/script/run/:name` | esegue una funzione Python del progetto |
| GET | `/api/system` | stato della macchina, intero |

### Admin

Le **scritture** dell'aggiornamento restano Admin anche sul viewer: l'avviso a schermo chiede le credenziali al
momento di applicare. Un test (`le_scritture_dell_aggiornamento_restano_admin_sul_viewer`) lo fissa.

| Metodo | Rotta | Cosa fa |
|---|---|---|
| POST | `/api/update/apply` | aggiorna |
| POST | `/api/quadlet/aggiorna` | aggiorna il quadlet dell'unità |
| POST | `/api/aggiornamento/istantanea` | istantanea dei dati prima di aggiornare |
| POST | `/api/aggiornamento/conferma` | conferma che la versione nuova funziona |

---

## Porta 7444 — l'IDE

### Lettura, con una sessione

Tutto quello che legge la 7443, più:

| Metodo | Rotta | Cosa fa |
|---|---|---|
| GET | `/api/project/findings` | gli avvisi del validatore sul progetto |
| GET | `/api/boot-pages`, `/api/boot-pages/:name`, `…/png` | le immagini di avvio |
| GET | `/api/synoptics/:name/export` | esporta un sinottico |
| GET | `/api/project/git-status`, `/api/project/git/log`, `/…/changes`, `/…/diff`, `/…/tags` | lo stato del repository |
| PUT / DELETE | `/api/faceplates/:id`, `/api/cornici/:id`, `/api/recipes/:id` | salva o elimina |
| GET | `/api/datastores/:id/tags`, `/…/export`, `/…/download` | contenuto di un datastore |
| POST | `/api/datastores/:id/test`, `/…/vacuum`, `/…/purge`, `/…/clean-history`, `/…/delete-tag`, `/…/upload` | manutenzione di un datastore |
| GET | `/api/datastores/retention` | la ritenzione automatica di ogni datastore, con l'anteprima di quelli da confermare (Admin) |
| POST | `/api/datastores/:id/retention/confirm` | conferma il primo giro di ritenzione di un datastore (Admin) |
| GET | `/api/sources/:id/opcua/certs` | i certificati nel trust store di una sorgente OPC UA |
| POST | `/api/sources/:id/opcua/certs/:filename/trust` | dichiara fidato un certificato |
| DELETE | `/api/sources/:id/opcua/certs/:filename` | lo toglie |

### Operator

| Metodo | Rotta | Cosa fa |
|---|---|---|
| POST | `/api/script/check` | controlla uno script senza eseguirlo |
| GET | `/api/logs`, `/api/logs/files`, `/api/logs/file` | il log del runtime |
| GET | `/api/sources/stato` | lo stato delle sorgenti |
| POST | `/api/sources/mqtt/browse`, `/…/opcua/browse`, `/…/ha/browse` | esplora un dispositivo per importarne i tag |
| POST | `/api/sources/opcua/history`, `/…/opcua/detect-euromap` | storico e riconoscimento Euromap su OPC UA |

> `GET /api/logs`, non `/api/log`.

### Supervisor

| Metodo | Rotta | Cosa fa |
|---|---|---|
| PUT / DELETE | `/api/synoptics/:name` | salva o elimina un sinottico |
| POST | `/api/synoptics/import` | importa sinottici |
| PUT / DELETE | `/api/boot-pages/:name`, `PUT /…/png` | le immagini di avvio |
| POST / DELETE | `/api/project/images/:name` | le immagini del progetto |
| POST | `/api/project/git/commit` | commit |
| POST | `/api/project/git/tags` | crea un tag git |
| GET | `/api/discover` | cerca runtime SWS in rete (mDNS) |
| GET | `/api/remote/cert` | il certificato del dispositivo collegato |

### Admin — la configurazione del progetto

| Metodo | Rotta |
|---|---|
| PUT | `/api/project/tags`, `/…/types`, `/…/sources`, `/…/alarms`, `/…/functions`, `/…/datastores`, `/…/global-scripts`, `/…/notifications`, `/…/languages`, `/…/custom-symbols`, `/…/page-layout`, `/…/symbol-style`, `/…/target`, `/…/backup-config`, `/…/retention-time` |
| POST | `/api/project/tags/import-csv` — importa tag da CSV |
| POST | `/api/project/languages/translate` — traduzione assistita |
| POST | `/api/project/validate` — valida il progetto |
| POST | `/api/project/deploy` — GitOps: `git pull --ff-only` e ricarica il progetto |
| POST | `/api/project/migrate` — migra un progetto a un formato nuovo |
| POST | `/api/project/rollback` — torna a uno stato precedente |
| GET / PUT | `/api/project/export`, `/api/project/import` |
| GET / POST / DELETE | `/api/backups`, `/api/backups/:name`, `/…/restore`, `/…/download` |
| GET / POST / PUT / DELETE | `/api/auth/users`, `/api/auth/users/:username`, `/api/auth/users-file` |
| GET | `/api/schema/synoptic`, `/api/schema/source` — gli schemi per l'assistente IA |
| GET | `/ws/ai` — la chat dell'assistente |

### Admin — git

| Metodo | Rotta | Cosa fa |
|---|---|---|
| POST | `/api/project/git/push` | push al remoto |
| POST | `/api/project/git/init` | aggancia il progetto a un repository |
| POST | `/api/project/git/fork` | fork |
| POST | `/api/project/git/prova`, `/…/prova/esci`, `/…/prova/riparti` | il ramo di prova |
| GET | `/api/project/git/ssh-keys` | le chiavi SSH dell'istanza |
| PUT | `/api/project/git/ssh-key` | imposta la chiave dell'istanza |
| GET / POST | `/api/project/git/ssh-key/progetto` | la chiave SSH **del progetto** |
| PUT | `/api/project/git/identity` | nome ed email dei commit |
| POST / DELETE | `/api/project/git/tags/:name/push`, `/api/project/git/tags/:name` | tag git |

### Admin — il ciclo di vita dei progetti

| Metodo | Rotta | Cosa fa |
|---|---|---|
| GET / POST | `/api/projects` | elenca, oppure crea |
| POST | `/api/projects/:azienda/:nome/open` | apre un progetto |
| POST | `/api/projects/:nome/open` | la stessa, senza azienda |
| POST | `/api/projects/close` | chiude quello aperto |
| POST | `/api/projects/:azienda/:nome/rename` | rinomina |
| POST | `/api/projects/:azienda/:nome/duplicate` | duplica («Salva come…») |
| POST | `/api/projects/:azienda/:nome/archive`, `/…/unarchive` | archivia e disarchivia |
| DELETE | `/api/projects/:azienda/:nome` | elimina |
| POST | `/api/projects/upload` | carica un progetto da un archivio |
| GET | `/api/templates` | i modelli di progetto |
| GET | `/api/catalogo/dispositivi`, `/…/:marca/:nome` | il catalogo dei dispositivi di campo |
| GET / POST | `/api/fs/browse-dirs`, `/api/fs/mkdir` | sfoglia e crea cartelle |

> **Ogni rotta esiste in due forme**, con e senza azienda: `/api/projects/:azienda/:nome/…` e
> `/api/projects/:nome/…`. La seconda vale per un'istanza che non usa le aziende.
> Non esiste `POST /api/projects/open` con il nome nel corpo.

### Admin — la macchina e gli aggiornamenti

| Metodo | Rotta | Cosa fa |
|---|---|---|
| GET | `/api/system` | stato della macchina |
| POST | `/api/system/start`, `/…/stop`, `/…/reboot` | governa il servizio e la macchina |
| GET / POST / PUT / DELETE | `/api/system/tls`, `/api/system/tls/generate` | il certificato TLS |
| GET / PUT | `/api/security/frame-origins` | le origini ammesse a incorniciare il viewer |
| GET / PUT | `/api/update/schedule` | quando aggiornare da solo |
| GET / POST | `/api/update/status`, `/api/update/apply` | aggiornamento |
| POST | `/api/quadlet/aggiorna`, `/api/aggiornamento/istantanea`, `/api/aggiornamento/conferma` | quadlet, istantanea, conferma |
| POST | `/api/boot-image/reset` | ripristina l'immagine di avvio |
| GET | `/api/host/catalog`, `/api/host/seriali` | cosa offre la macchina alla sorgente Host |
| GET | `/api/audit`, `/api/audit/verify` | l'audit log e la verifica della sua catena |
| GET / PUT | `/api/ai/config`, `/api/traduzione/config` | assistente IA e traduzione |
| PUT | `/api/mqtt/source/:id/client-id-override` | il client id MQTT |

### Admin — pacchetti e deploy

| Metodo | Rotta | Cosa fa |
|---|---|---|
| POST | `/api/build/package` | costruisce il tarball, log in streaming |
| GET | `/api/build/packages`, `/api/build/container-packages` | i pacchetti disponibili |
| GET | `/api/build/stato` | stato di una build in corso |
| POST | `/api/deploy/device` | deploy SSH su un dispositivo |
| POST | `/api/deploy/device-container` | deploy del container |
| POST | `/api/deploy/device-container/manage` | avvia, ferma, disinstalla un container già installato |
| GET / PUT | `/api/devices` | i dispositivi registrati (etichetta, URL, utente — mai la password) |
| GET | `/api/discover/dispositivi` | ~3 s di ascolto mDNS: chi annuncia ssh, sftp o sws |
| POST | `/api/device/probe` | interroga un dispositivo |
| POST | `/api/device/hostkey/forget`, `/api/device/cert/forget` | dimentica una chiave host o un certificato |

### Admin — il dispositivo collegato (`/api/remote/*`)

Quando l'IDE è collegato a un pannello, queste rotte fanno **sul pannello** quello che le altre
fanno qui. L'IDE le chiama su sé stesso e il runtime inoltra.

| Metodo | Rotta | Cosa fa |
|---|---|---|
| POST / DELETE | `/api/remote/connect` | collega o scollega il dispositivo |
| GET | `/api/remote/status` | se è collegato e come |
| GET | `/api/remote/cloud` | i pannelli visibili nel cloud |
| POST | `/api/remote/abbina-cloud` | abbina un pannello dal cloud |
| GET / POST | `/api/remote/pannello-cloud/:nome`, `/…/rinomina` | riepilogo e rinomina di un pannello |
| POST | `/api/remote/deploy` | distribuisce il progetto sul pannello |
| POST | `/api/remote/users` | manda gli utenti |
| GET / POST | `/api/remote/project/export`, `/api/remote/project/delete` | esporta ed elimina il progetto remoto |
| GET | `/api/remote/system`, `/…/host/catalog`, `/…/host/seriali`, `/…/sources/stato` | lo stato del pannello |
| GET | `/api/remote/history/export` | lo storico del pannello |
| GET / POST / DELETE | `/api/remote/backups`, `/…/:name`, `/…/:name/download`, `/…/:name/restore` | i backup del pannello |
| GET / POST | `/api/remote/database/:id/download`, `/…/upload`, `/…/clean-history` | i datastore del pannello |
| GET / POST | `/api/remote/datastores/retention`, `/api/remote/datastores/:id/retention/confirm` | la ritenzione automatica del pannello, coi suoi numeri |
| GET / POST / PUT | `/api/remote/update/*`, `/api/remote/quadlet/aggiorna`, `/api/remote/aggiornamento/*` | l'aggiornamento del pannello |
| GET / PUT | `/api/remote/security/frame-origins` | le origini iframe del pannello |
| POST | `/api/remote/boot-image/reset`, `/api/remote/mqtt-client-id` | — |
| GET | `/ws/remote/:sub` | il relay dei WebSocket verso il pannello (`tags`, `alarms`, `logs`) |

### La console

Ci entra chi amministra la piattaforma o almeno un'azienda. Ogni rotta restringe da sé quello che
restituisce.

| Metodo | Rotta | Chi |
|---|---|---|
| GET | `/api/amministrazione/risorse` | azienda |
| GET | `/api/amministrazione/progetti-aperti` | azienda: i container di progetto accesi sul gateway, con quante finestre sono collegate |
| DELETE | `/api/amministrazione/progetti-aperti/:azienda/:nome` | azienda: chiude a mano un progetto aperto; con qualcuno collegato risponde 409 `{collegati}` se manca `?anche_con_collegati=true` |
| GET / PATCH | `/api/amministrazione/aziende`, `/…/:id` | azienda |
| GET / POST / PATCH | `/api/amministrazione/utenti`, `/…/:id` | azienda |
| GET | `/api/amministrazione/marchi` | azienda (legge) |
| POST | `/api/amministrazione/aziende` | solo piattaforma |
| GET / PUT / POST | `/api/amministrazione/smtp`, `/…/smtp/prova` | solo piattaforma |
| PUT / DELETE | `/api/amministrazione/marchi/:id`, `/…/:id/file/:nome` | solo piattaforma |
| GET / POST | `/api/amministrazione/pannelli`, `/…/:nome/stato` | solo piattaforma |
| POST | `/api/amministrazione/pannelli/:nome/azienda` | solo piattaforma: sposta un pannello a un'altra azienda (il segmento del gateway, `-` per la radice). È **l'unica** strada: un pannello non cambia azienda facendosi rivendicare, nemmeno quando è sospeso. Il tunnel si stacca e il pannello si ricollega da sé |

---

## Il gateway e il tunnel

Presenti solo in un'istanza avviata con `--gateway`. Il funzionamento è nel
[capitolo 18](18_container_e_comunicazione.md#3-nel-cloud).

| Metodo | Rotta | Cosa fa |
|---|---|---|
| — | `/p/:azienda/:progetto/*resto` | inoltra al container di quel progetto |
| — | `/dev/:pannello/*resto` | inoltra al pannello attraverso il suo tunnel |
| GET | `/tunnel/v1` | il WebSocket su cui i pannelli si collegano |
| GET | `/api/pannelli` | i pannelli visibili |
| POST | `/api/pannelli/abbina` | abbina un pannello col suo codice |
| POST | `/api/pannelli/:nome/rinomina` | rinomina un pannello |

---

## `--no-admin`: la porta di gestione ridotta

Sul pannello la 7444 ascolta su tutte le interfacce (`0.0.0.0`, perché l'IDE in rete locale la raggiunge) e porta
**solo** quello che serve a gestirlo da remoto: apertura e chiusura di progetti, caricamento ed esportazione, utenti,
backup, datastore e la loro ritenzione, log, aggiornamenti, `/ws/tags` e `/ws/alarms`. Tutto il resto dell'IDE — editor dei sinottici,
configurazione, git, pacchetti — **non c'è**, e una chiamata risponde 404.

Questo è il motivo per cui una rotta che esiste sul proprio PC può non esistere su un pannello.

---

## WebSocket

| Canale | Porte | Cosa porta | Chi |
|---|---|---|---|
| `/ws/tags` | 7443, 7444 | istantanea e variazioni dei tag sottoscritti; comandi | autenticato o anonimo |
| `/ws/alarms` | 7443, 7444 | stato degli allarmi | idem |
| `/ws/logs` | 7444 | il log del runtime | Operator nell'IDE, Admin sul pannello |
| `/ws/ai` | 7444 (IDE) | la chat dell'assistente | Admin |
| `/ws/remote/:sub` | 7444 (IDE) | relay verso il pannello collegato | Admin |
| `/tunnel/v1` | gateway | il tunnel dei pannelli | token del pannello |

```javascript
const ws = new WebSocket(`wss://localhost:7443/ws/tags?token=${token}`);
ws.onmessage = (e) => {
  const u = JSON.parse(e.data);
  // { "tag_id": "pressione", "value": 9.8, "quality": "Good", "ts": 1735600000000 }
};
```

---

## Esempi

### Leggere i tag

```bash
curl -k https://localhost:7443/api/tags
```

```json
{
  "pressione":   { "value": 9.8,  "quality": "Good", "timestamp_ms": 1735600000000 },
  "temperatura": { "value": 65.2, "quality": "Good", "timestamp_ms": 1735600000000 }
}
```

### Scrivere un tag

```bash
curl -k -X PUT https://localhost:7443/api/tags/valvola \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"value": true}'
```

### Storico e statistiche

```bash
curl -k "https://localhost:7443/api/history/pressione?limit=100"
curl -k "https://localhost:7443/api/history/pressione?from_ms=1735000000000&to_ms=1735600000000"
curl -k "https://localhost:7443/api/history/pressione/stats"
```

```json
{
  "tag": "pressione",
  "count": 86400,
  "min": 8.1, "max": 12.3, "avg": 9.7, "stddev": 0.8,
  "first_ts": 1735000000000, "last_ts": 1735600000000
}
```

### Lo storico degli allarmi

Una riga per scatto, la più recente per prima. Parametri facoltativi: `alarm_id`, `from_ms`,
`to_ms` (sull'ora di attivazione), `limit` (predefinito 200).

Ogni riga: `alarm_id`, `alarm_message` e `severity` (del livello più grave raggiunto),
`ts_activated_ms`, `ts_acked_ms`, `acked_by`, `ts_normalized_ms`, `duration_s` (dallo scatto al
rientro) e `interrotto` (la riga è stata chiusa da uno spegnimento, una caduta o una ricarica
degli allarmi). Dal 2026-09-25 la riga c'è **dallo scatto**: `ts_normalized_ms` e `ts_acked_ms`
sono `null` finché l'allarme non rientra o non viene confermato.

```bash
curl -k "https://localhost:7443/api/alarms/history?limit=50" -H "Authorization: Bearer $TOKEN"
```

### Riconoscere e mettere sullo scaffale

```bash
curl -k -X POST https://localhost:7443/api/alarms/pressione_alta/ack \
  -H "Authorization: Bearer $TOKEN"

curl -k -X POST https://localhost:7443/api/alarms/pressione_alta/shelve \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"reason": "Manutenzione P1", "until_ms": 0}'
```

### Eseguire una funzione Python

```bash
curl -k -X POST https://localhost:7443/api/script/run/apri_valvola \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"arg1": "valore"}'
```

### Aprire un progetto

```bash
curl -k -X POST https://localhost:7444/api/projects/acme/impianto1/open \
  -H "Authorization: Bearer $TOKEN"
```

### L'impronta del progetto

```bash
curl -k https://localhost:7444/api/project/fingerprint -H "Authorization: Bearer $TOKEN"
```

```json
{ "sha256": "a3f4c2d1…", "computed_at_ms": 1735600000000 }
```

### Costruire un pacchetto

Risposta: testo in streaming riga per riga, che finisce con `DONE` o `ERROR:`.

```bash
curl -k -X POST https://localhost:7444/api/build/package \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"no_rust": false, "no_spa": false}'

curl -k https://localhost:7444/api/build/packages -H "Authorization: Bearer $TOKEN"
```

```json
[
  { "name": "sws-2.13.0-rc.3-linux-x86_64.tar.gz", "size_bytes": 12582912, "mtime_ms": 1735600000000 }
]
```

### Deploy su un dispositivo

```bash
curl -k -X POST https://localhost:7444/api/deploy/device \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "tarball": "sws-2.13.0-rc.3-linux-x86_64.tar.gz",
    "host": "192.168.1.10",
    "port": 22,
    "user": "root",
    "password": "mia_password",
    "remote_dir": "/tmp/sws-deploy"
  }'
```

---

## Riferimenti nel codice

| Cosa | Dove |
|---|---|
| Il router della 7444 e di un'istanza IDE | `sws-runtime/crates/sws-web/src/router.rs:271` (`build`) |
| Il router della 7443 | `router.rs:1482` (`build_runtime_inner`) |
| La porta di gestione ridotta di `--no-admin` | `router.rs:1353` (`deploy_only_app`) |
| Chi può chiamare cosa | `router.rs:2166` (`require_auth`), `router.rs:2351` (`optional_auth`) |
| Le rotte della console | `sws-runtime/crates/sws-web/src/amministrazione.rs:612` e `:633` |
| Gateway e tunnel | `sws-runtime/crates/sws-web/src/gateway/`, `…/tunnel/` |
| Abbinamento | `sws-runtime/crates/sws-web/src/abbinamento.rs` |

---

← [Indice](MAIN.md) | [← GitOps](12_gitops.md) | [Successivo → Testing](14_testing.md) →
