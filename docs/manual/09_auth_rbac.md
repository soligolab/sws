← [Indice](MAIN.md) | [← Historian](08_historian.md) | [Successivo → Deployment](10_deployment.md) →

---

# 09 — Autenticazione e Controllo Accessi

SWS implementa autenticazione multi-utente con 4 ruoli gerarchici (RBAC) e
controllo di accesso per zona (ABAC).

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

Le due porte hanno politiche di autenticazione diverse:

| Porta | Autenticazione | Uso |
|-------|---------------|-----|
| **8443** | Opzionale — senza token = Viewer anonimo | Pannelli HMI, operatori |
| **8444** | Obbligatoria — senza token = 401 | Ingegneri, Admin |

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

## Password di default e primo avvio

**SWS non ha credenziali di default** — al primo avvio richiede di impostare
una password admin tramite variabile d'ambiente:

```bash
export SWS_ADMIN_PASSWORD=mia_password_sicura
./scripts/dev.sh
# oppure:
sws-runtime --config /etc/sws/config.yaml
```

Se `SWS_ADMIN_PASSWORD` non è impostata, il runtime si avvia ugualmente
ma l'utente `admin` avrà la password `admin` in ambiente di sviluppo (seeded da `dev.sh`).

> **Attenzione**: in produzione imposta sempre `SWS_ADMIN_PASSWORD` a una password forte.

---

← [Indice](MAIN.md) | [← Historian](08_historian.md) | [Successivo → Deployment](10_deployment.md) →
