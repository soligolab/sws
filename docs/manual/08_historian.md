← [Indice](MAIN.md) | [← Allarmi](07_alarms.md) | [Successivo → Autenticazione](09_auth_rbac.md) →

---

# 08 — Historian e Trend

SWS include un sistema historian integrato che registra i valori dei tag nel tempo
e li rende disponibili per analisi e visualizzazione.

---

## Architettura historian

```
Tag update (da plugin PLC)
        │
        ▼
   Campionamento?
   (deadband / on-change / periodico)
        │ sì
        ▼
  Ring buffer in-memory
  (ultimi N campioni per tag)
        │
        ├─── WebSocket /ws/history/:tag  (streaming live)
        │
        ▼
  Persistenza SQLite
  (per-project historian.db)
```

Il ring buffer garantisce bassa latenza per il trend live.
SQLite garantisce persistenza tra restart del runtime.

---

## Configurazione campionamento

Ogni tag definisce la propria strategia di campionamento:

```yaml
tags:
  - id: pressione
    description: "Pressione impianto"
    data_type: float
    history: true              # abilita la storicizzazione
    history_deadband: 0.1      # varia solo se cambia di > 0.1
    history_min_interval_ms: 1000  # max 1 campione al secondo
    datastore_id: "default"    # datastore di destinazione (opzionale)
```

### Modalità di campionamento

| Modalità | Configurazione | Descrizione |
|----------|---------------|-------------|
| **Deadband** | `history_deadband > 0` | Campiona solo se il valore cambia di più di `deadband` |
| **On-change** | `history_deadband: 0` | Campiona ad ogni cambiamento |
| **Periodico** | `history_min_interval_ms` | Almeno un campione ogni N ms |

Combinando `deadband` e `min_interval_ms` si ottiene: campiona se il valore cambia molto,
ma non più spesso di N ms.

---

## Datastores

SWS supporta più datastores configurabili per tag diversi:

```yaml
datastores:
  - id: default
    label: "Storico principale"
    backend:
      kind: sqlite
      path: "historian.db"   # relativo alla directory del progetto
    retention_rows: 1000000  # max righe per tag (rimozione FIFO)
    retention_days: 365      # max giorni (rimozione FIFO)
```

**Nota**: nel PoC, solo SQLite è completamente implementato.
InfluxDB e PostgreSQL sono previsti per fasi successive.

---

## Trend interattivo

Il widget **Trend** visualizza la storia di uno o più tag in un grafico Canvas 2D.

### Operazioni di navigazione

| Azione | Risultato |
|--------|-----------|
| **Trascina** | Pan orizzontale nella finestra temporale |
| **Rotella mouse** | Zoom in/out centrato sul cursore |
| **Click su titolo** | Apre la vista espansa a schermo intero |
| **Double click** | Reset alla finestra predefinita |

### Vista espansa

La vista espansa offre:
- Canvas a schermo intero
- Asse X con timestamp leggibili
- Asse Y con range auto o configurato
- Multi-serie (tag principale + tag extra in overlay)
- Legenda interattiva (click per nascondere/mostrare serie)

---

## Dati storici via API

### GET /api/history/:tag

```bash
TOKEN=$(curl -sk -X POST https://localhost:8443/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin"}' | jq -r .token)

# Ultimi 100 campioni
curl -k -H "Authorization: Bearer $TOKEN" \
  "https://localhost:8443/api/history/pressione?limit=100"

# Finestra temporale specifica
curl -k -H "Authorization: Bearer $TOKEN" \
  "https://localhost:8443/api/history/pressione?from_ms=1735000000000&to_ms=1735600000000"
```

**Risposta**:
```json
[
  { "ts_ms": 1735600000000, "value": 9.8, "quality": "Good" },
  { "ts_ms": 1735600001000, "value": 9.9, "quality": "Good" },
  ...
]
```

### GET /api/history/:tag/stats

Statistiche aggregate (min, max, media, deviazione standard):

```bash
curl -k -H "Authorization: Bearer $TOKEN" \
  "https://localhost:8443/api/history/pressione/stats?from_ms=1735000000000"
```

**Risposta**:
```json
{
  "tag": "pressione",
  "count": 86400,
  "min": 8.1,
  "max": 12.3,
  "avg": 9.7,
  "stddev": 0.8,
  "first_ts": 1735000000000,
  "last_ts": 1735600000000
}
```

---

## Export CSV

**Configurazione → Datastore → Export CSV**:

1. Scegli il tag (o più tag)
2. Imposta il range temporale
3. Scarica il file `.csv`

Formato CSV:
```
timestamp_ms,timestamp_iso,valore,qualità
1735600000000,2026-01-01T10:00:00Z,9.8,Good
1735600001000,2026-01-01T10:00:01Z,9.9,Good
```

---

## Backfill OPC-UA

Per tag da sorgenti OPC-UA che supportano dati storici,
attiva l'opzione `opcua_backfill: true` nel widget Trend:

```yaml
# proprietà del widget trend
opcua_backfill: true
```

Al mount del widget, SWS interroga il server OPC-UA per i dati storici
nel range della finestra temporale corrente, completando i vuoti nel
buffer locale.

---

## Monitoraggio datastore

**Configurazione → Datastore → [nome]** mostra:
- Numero di tag con storia
- Numero totale di campioni
- Timestamp primo e ultimo campione
- Dimensione database su disco
- Stato connessione

```bash
# Via API
curl -k -H "Authorization: Bearer $TOKEN" \
  "https://localhost:8443/api/datastores/default/stats"
```

---

← [Indice](MAIN.md) | [← Allarmi](07_alarms.md) | [Successivo → Autenticazione](09_auth_rbac.md) →
