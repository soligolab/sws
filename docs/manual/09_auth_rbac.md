← [Indice](MAIN.md) | [← Historian](08_historian.md) | [Successivo → Deployment](10_deployment.md) →

---

# 09 — Autenticazione e Controllo Accessi

SWS implementa autenticazione multi-utente con 4 ruoli gerarchici (RBAC) e
controllo di accesso per zona (ABAC). **L'autenticazione è opzionale.**

---

## No-auth mode (default del PoC)

Un progetto **senza utenti** (nessun `users.yaml`) gira in **no-auth mode**: tutte le route —
incluso l'Admin IDE sulla 8444 — sono aperte senza login. Il backend risponde a
`GET /api/auth/whoami` con un admin sintetico e il frontend non mostra alcuna schermata di login.

Si passa alla modalità autenticata semplicemente **creando il primo utente** da
*Configurazione → Utenti*: appena esiste almeno un utente, il runtime richiede il login e applica
RBAC/ABAC. Eliminando tutti gli utenti si torna in no-auth mode.

> ⚠️ In no-auth mode chiunque raggiunga la porta 8444 ha pieno accesso amministrativo. Crea
> utenti e attiva il TLS prima di esporre un runtime su una rete non fidata.

---

## Autenticazione

### Algoritmo: Argon2id

Le password sono conservate come hash **Argon2id** — l'algoritmo vincitore
della Password Hashing Competition 2015, resistente ad attacchi GPU e ASIC.
Le password in chiaro non vengono mai registrate nei log o nel database.

### Login (REST)

```bash
curl -k -X POST https://localhost:8444/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"mia_password"}'
```

**Risposta**:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_at_ms": 1735689600000,
  "role": "Admin"
}
```

Il token è un Bearer JWT. Includi in ogni richiesta protetta:

```bash
curl -k -H "Authorization: Bearer $TOKEN" https://localhost:8444/api/project
```

### Sessioni in-memory

I token sono mantenuti in memoria dal runtime. Un restart del runtime
invalida tutti i token — gli utenti devono autenticarsi nuovamente.

### TTL sessione

Il TTL di ogni sessione è configurabile per utente (in **Configurazione → Utenti**).
Default: 8 ore.

---

## Ruoli RBAC

SWS ha 4 ruoli gerarchici (da meno a più privilegiato):

| Ruolo | Livello | Descrizione |
|-------|---------|-------------|
| **Viewer** | 1 | Sola lettura, nessuna interazione |
| **Operator** | 2 | Può interagire (pulsanti, ACK allarmi, slider) |
| **Supervisor** | 3 | Può modificare configurazione, ricette, funzioni |
| **Admin** | 4 | Accesso completo, gestione utenti, deploy |

### Permessi per ruolo

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
| Git commit / push | ❌ | ❌ | Commit | ✅ |
| Gestire utenti | ❌ | ❌ | ❌ | ✅ |
| Deploy / packaging | ❌ | ❌ | ❌ | ✅ |
| Eliminare progetto | ❌ | ❌ | ❌ | ✅ |

---

## Gestione utenti

**Configurazione → Utenti → + Aggiungi utente**

```yaml
# Struttura utente in project.yaml
users:
  - username: operatore1
    password_hash: "$argon2id$v=19$m=65536,t=3,p=4$..."
    role: Operator
    allowed_zones: ["sala_a", "sala_b"]
    session_ttl_secs: 28800    # 8 ore (default)
```

> **Importante**: le password non vengono mai salvate in chiaro.
> Il form UI calcola l'hash Argon2id prima di salvare.

### Cambio password

Ogni utente può cambiare la propria password dalla UI:
**User: [nome] → Cambia password**

Gli Admin possono reimpostare la password di qualsiasi utente da
**Configurazione → Utenti → [utente] → Reimposta password**.

---

## ABAC — Controllo accessi per zona

Il modello **ABAC (Attribute-Based Access Control)** permette di limitare
l'accesso a pagine specifiche del sinottico.

### Configurazione zone per pagina

In **Configurazione → Editor → [pagina] → Zone** (o nel pannello proprietà della pagina):

```yaml
# In synoptics/sala_controllo.yaml
zones:
  - "sala_a"
  - "supervisore"
```

Solo gli utenti con almeno una di queste zone nel profilo possono visualizzare la pagina.
Lascia vuoto (`zones: []`) per accesso libero a tutti gli utenti autenticati.

### Configurazione zone per utente

```yaml
users:
  - username: operatore_a
    role: Operator
    allowed_zones: ["sala_a", "comune"]
  - username: supervisore
    role: Supervisor
    allowed_zones: ["sala_a", "sala_b", "comune", "supervisore"]
```

Un utente con `allowed_zones: []` ha accesso a tutte le pagine non ristrette.

---

## Porta 8443 vs 8444

Quando esistono utenti, le due porte hanno politiche di autenticazione diverse:

| Porta | Autenticazione (con utenti) | Uso |
|-------|------------------------------|-----|
| **8443** | Opzionale — senza token = Viewer anonimo | Pannelli HMI, operatori |
| **8444** | Obbligatoria — senza token = 401 | Ingegneri, Admin |

In **no-auth mode** (nessun utente) entrambe le porte sono completamente aperte.

**Viewer anonimo** (porta 8443 senza token):
- Può visualizzare sinottici
- Vede tag live (se non ci sono restrizioni di zona)
- Non può scrivere tag, ACK allarmi, accedere alla configurazione

Per disabilitare l'accesso anonimo sulla porta 8443:
imposta `optional_auth: false` nella configurazione del runtime.

---

## Audit log

Ogni azione significativa viene registrata nell'audit log:

| Evento | Cosa viene registrato |
|--------|----------------------|
| Login / Logout | Username, IP, timestamp, esito |
| Scrittura tag | Username, tag ID, valore scritto, timestamp |
| ACK allarme | Username, alarm ID, timestamp |
| Modifica progetto | Username, tipo modifica, timestamp |
| Deploy | Username, target, esito, timestamp |

Il log è un file JSONL append-only: `/var/lib/sws/<progetto>/audit.jsonl`.

```bash
# Lettura audit log
tail -f /var/lib/sws/default/audit.jsonl | jq '.'
```

---

## Primo avvio e creazione del primo utente

Di default un progetto nuovo **non ha credenziali** e gira in [no-auth mode](#no-auth-mode-default-del-poc):
l'IDE si apre senza login. Per attivare l'autenticazione:

1. Apri l'Admin IDE (porta 8444)
2. Vai in *Configurazione → Utenti → + Aggiungi utente*
3. Crea un utente **Admin** con una password forte
4. Da quel momento il runtime richiede il login a ogni accesso

La password viene salvata come hash Argon2id in `project.yaml`; il form UI calcola l'hash prima
di inviarlo al server. Eliminando l'ultimo utente il progetto torna in no-auth mode.

> **Container.** L'immagine non pretende credenziali: parte in no-auth mode come il binario
> nativo. `SWS_ADMIN_PASSWORD`, se impostata, seeda l'utente admin al primo avvio — resta
> facoltativa. (Il vecchio percorso `compose.yaml`, che la **richiedeva**, è stato rimosso il
> 2026-09-02: precedeva il no-auth mode e non partiva.)

## Le credenziali del progetto (`secrets.yaml`)

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

← [Indice](MAIN.md) | [← Historian](08_historian.md) | [Successivo → Deployment](10_deployment.md) →
