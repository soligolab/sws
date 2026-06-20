← [Indice](MAIN.md) | [← GitOps](12_gitops.md) | [Successivo → Testing](14_testing.md) →

---

# 13 — API Reference

SWS espone API REST e WebSocket su due porte distinte.
La porta **8443** è pubblica (auth opzionale), la porta **8444** è admin (auth obbligatoria
*solo quando esistono utenti*; in no-auth mode tutte le route sono aperte — vedi
[09 — Autenticazione](09_auth_rbac.md)). Di default il runtime è in HTTP; con TLS attivo usa
`https://`.

---

## Autenticazione

Tutte le chiamate protette richiedono un Bearer token nell'header:
```
Authorization: Bearer <token>
```

### POST /api/auth/login

Autentica un utente e restituisce il token.

**Disponibile su**: 8443, 8444 (entrambe)

```bash
curl -k -X POST https://localhost:8444/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin"}'
```

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_at_ms": 1735689600000,
  "role": "Admin"
}
```

### POST /api/auth/logout

Invalida il token corrente.

```bash
curl -k -X POST https://localhost:8444/api/auth/logout \
  -H "Authorization: Bearer $TOKEN"
```

---

## Health e metriche

### GET /health

Stato di salute del runtime.

```bash
curl -k https://localhost:8443/health
# → ok
```

### GET /metrics

Metriche Prometheus (formato text/plain).

```bash
curl -k https://localhost:8443/metrics
# → sws_uptime_seconds{...} 3600
# → sws_tag_count 42
# → sws_cpu_usage_pct 12.3
```

### GET /api/cert

Scarica il certificato TLS self-signed del runtime.

```bash
curl -k https://localhost:8443/cert -o sws.crt
```

---

## Tag (Porta 8443)

### GET /api/tags

Snapshot corrente di tutti i tag.

```bash
curl -k https://localhost:8443/api/tags
```

```json
{
  "pressione": { "value": 9.8, "quality": "Good", "timestamp_ms": 1735600000000 },
  "temperatura": { "value": 65.2, "quality": "Good", "timestamp_ms": 1735600000000 }
}
```

### GET /api/tags/:id

Valore di un singolo tag.

```bash
curl -k https://localhost:8443/api/tags/pressione
```

### PUT /api/tags/:id

Scrive un valore al tag (richiede ruolo Operator+).

```bash
curl -k -X PUT https://localhost:8443/api/tags/valvola \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"value": true}'
```

---

## Historian (Porta 8443)

### GET /api/history/:tag

Storico campioni di un tag.

```bash
# Ultimi 100 campioni
curl -k "https://localhost:8443/api/history/pressione?limit=100"

# Finestra temporale
curl -k "https://localhost:8443/api/history/pressione?from_ms=1735000000000&to_ms=1735600000000"
```

```json
[
  { "ts_ms": 1735600000000, "value": 9.8, "quality": "Good" },
  ...
]
```

### GET /api/history/:tag/stats

Statistiche aggregate del tag.

```bash
curl -k "https://localhost:8443/api/history/pressione/stats"
```

```json
{
  "tag": "pressione",
  "count": 86400,
  "min": 8.1, "max": 12.3, "avg": 9.7, "stddev": 0.8,
  "first_ts": 1735000000000, "last_ts": 1735600000000
}
```

---

## Allarmi (Porta 8443)

### GET /api/alarms

Stato corrente di tutti gli allarmi.

```bash
curl -k https://localhost:8443/api/alarms
```

```json
{
  "pressione_alta": {
    "isa_state": "active_unacked",
    "active": true,
    "acknowledged": false,
    "activated_at_ms": 1735600000000,
    "last_value": 10.5,
    "def": { "id": "pressione_alta", "message": "Pressione alta (>10 bar)", ... }
  }
}
```

### POST /api/alarms/:id/ack

Riconosce un allarme (ruolo Operator+).

```bash
curl -k -X POST https://localhost:8443/api/alarms/pressione_alta/ack \
  -H "Authorization: Bearer $TOKEN"
```

### POST /api/alarms/:id/shelve

Shelving di un allarme (ruolo Supervisor+).

```bash
curl -k -X POST https://localhost:8443/api/alarms/pressione_alta/shelve \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"reason": "Manutenzione P1", "until_ms": 0}'
```

### GET /api/alarms/history

Storico degli allarmi passati.

```bash
curl -k "https://localhost:8443/api/alarms/history?limit=50" \
  -H "Authorization: Bearer $TOKEN"
```

### GET /api/log

Log del runtime (streaming o snapshot).

```bash
curl -k "https://localhost:8443/api/logs?limit=100&level=WARN" \
  -H "Authorization: Bearer $TOKEN"
```

---

## Progetto (Porta 8444 — Admin)

### GET /api/project

Metadati e configurazione del progetto corrente.

```bash
curl -k https://localhost:8444/api/project \
  -H "Authorization: Bearer $TOKEN"
```

### POST /api/project

Salva la configurazione del progetto (tag, sorgenti, allarmi, utenti).

### GET /api/project/fingerprint

Fingerprint SHA256 del progetto corrente.

```bash
curl -k https://localhost:8444/api/project/fingerprint \
  -H "Authorization: Bearer $TOKEN"
```

```json
{ "sha256": "a3f4c2d1...", "computed_at_ms": 1735600000000 }
```

### GET /api/projects

Lista di tutti i progetti disponibili sul runtime.

### POST /api/projects/open

Apre un progetto.

```bash
curl -k -X POST https://localhost:8444/api/projects/open \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name": "mio-progetto"}'
```

---

## Sinottici (Porta 8444)

### GET /api/synoptics

Lista dei sinottici del progetto corrente.

### GET /api/synoptics/:name

Contenuto YAML di un sinottico specifico.

### POST /api/synoptics/:name

Salva un sinottico.

### DELETE /api/synoptics/:name

Elimina un sinottico.

---

## Script Python (Porta 8443/8444)

### POST /api/script/run/:name

Esegue una funzione Python del progetto.

```bash
curl -k -X POST https://localhost:8443/api/script/run/apri_valvola \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"arg1": "valore"}'
```

---

## GitOps (Porta 8444)

### GET /api/project/git/status

Stato Git del progetto.

```bash
curl -k https://localhost:8444/api/project/git/status \
  -H "Authorization: Bearer $TOKEN"
```

```json
{
  "sha": "abc123",
  "author": "Mauro Soligo",
  "message": "feat: aggiunta pompa P3",
  "branch": "main",
  "clean": true,
  "unpushed_commits": 2
}
```

### POST /api/project/git/commit

Commit del progetto (ruolo Supervisor+).

```bash
curl -k -X POST https://localhost:8444/api/project/git/commit \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"message": "feat: aggiunta pompa P3"}'
```

### POST /api/project/git/push

Push al remote (ruolo Admin).

### POST /api/project/git/pull

Pull dal remote.

### POST /api/project/git/rollback

Rollback a un commit precedente.

---

## Package Builder (Porta 8444)

### POST /api/build/package

Avvia la build del tarball (streaming log).

```bash
curl -k -X POST https://localhost:8444/api/build/package \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"no_rust": false, "no_spa": false}'
```

Risposta: testo in streaming riga per riga, termina con `DONE` o `ERROR:`.

### GET /api/build/packages

Lista tarball disponibili in `dist/`.

```bash
curl -k https://localhost:8444/api/build/packages \
  -H "Authorization: Bearer $TOKEN"
```

```json
[
  { "name": "sws-0.1.0-dev-linux-x86_64.tar.gz", "size_bytes": 12582912, "mtime_ms": 1735600000000 }
]
```

### POST /api/deploy/device

Deploy SSH su un device remoto (streaming log).

```bash
curl -k -X POST https://localhost:8444/api/deploy/device \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "tarball": "sws-0.1.0-dev-linux-x86_64.tar.gz",
    "host": "192.168.1.10",
    "port": 22,
    "user": "root",
    "password": "mia_password",
    "remote_dir": "/tmp/sws-deploy"
  }'
```

---

## WebSocket

### WS /ws/tags

Stream live di tutti gli aggiornamenti tag.

```javascript
const ws = new WebSocket('wss://localhost:8443/ws/tags');
ws.onmessage = (e) => {
  const update = JSON.parse(e.data);
  // { "tag_id": "pressione", "value": 9.8, "quality": "Good", "ts": 1735600000000 }
};
```

### WS /ws/alarms

Stream live degli aggiornamenti allarmi.

### WS /ws/logs

Stream live dei log del runtime.

---

← [Indice](MAIN.md) | [← GitOps](12_gitops.md) | [Successivo → Testing](14_testing.md) →
