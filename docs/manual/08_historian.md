← [Indice](MAIN.md) | [← Allarmi](07_alarms.md) | [Successivo → Autenticazione](09_auth_rbac.md) →

---

# 08 — Historian e Trend

> Come SWS registra i valori dei tag nel tempo, dove li tiene, come si leggono nei trend, via API e in CSV. Per chi
> configura lo storico di un impianto.
>
> Misurato sul codice il 20-10-2026.

SWS include un sistema historian integrato che registra i valori dei tag nel tempo
e li rende disponibili per analisi e visualizzazione.

---

## Architettura historian

```
Tag update (da plugin PLC)
        │
        ▼
        ├──► Ring buffer in-memory (ultimi N campioni per ogni tag)
        │
        ▼
   history: true?  banda morta?  intervallo minimo?
        │ sì
        ▼
  Datastore su disco
  (SQLite del progetto: history/historian.db, oppure PostgreSQL)
```

Il ring buffer garantisce bassa latenza per il trend; una richiesta più vecchia del ring si legge dal disco. Su disco
scrive solo il datastore, per i tag con `history: true` e con i loro filtri (`sws-historian/src/lib.rs`). I trend
dal vivo si aggiornano dal WebSocket dei tag (`/ws/tags`), non da un canale dello storico.

### Il formato del file (dal 03-10-2026)

`history/historian.db` tiene il nome di ogni tag una volta sola (tabella `tag_storico`) e i campioni in
`campioni (tag_id, ts_ms, tipo, valore, qualita)`: il valore col suo tipo (booleano, intero esatto, reale, testo, o
JSON per array e strutture), la qualità come numero (0 Good, 1 Uncertain, 2 Bad). Occupa circa la metà del formato
di prima (CasaDomotica: 36 → 18 MB; la copia da 7 milioni di righe 547 → 227 MB). Un file del formato di prima si
converte da solo alla prima apertura, **in sottofondo**: il runtime parte subito, registra già nel formato nuovo, e un
thread sposta le righe vecchie a lotti (una transazione ciascuno: se il pannello si spegne a metà, riprende da lì),
poi compatta. Finché non ha finito — un minuto o due per un milione di righe — i trend mostrano il passato in parte. La vista `samples (tag, ts_ms, value, quality)` rifà la
forma di prima per chi legge il file con `sqlite3`. Un pannello aggiornato a questa versione e poi riportato alla
precedente con «Torna alla …» riprende lo storico dall'istantanea presa prima dell'aggiornamento (HOWTO §21): la
versione di prima non sa leggere il formato nuovo.

### Backup e storico

I backup automatici (ogni N minuti) **non** contengono lo storico: lo copiavano intero a ogni giro (CasaDomotica: 7
backup, 3,8 GB). «Crea backup» lo contiene, copiato in modo coerente anche mentre il runtime registra, e senza le
copie `historian-prima-della-pulizia-*`. Ripristinare un backup senza storico lascia lo storico com'è.

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
| **On-change** | `history_deadband: 0` o assente | Campiona ad ogni cambiamento |
| **Intervallo minimo** | `history_min_interval_ms` | **Al massimo** un campione ogni N ms |

Combinando `deadband` e `min_interval_ms` si ottiene: campiona se il valore cambia abbastanza,
ma non più spesso di N ms. Non c'è un campionamento periodico: un valore fermo non scrive righe nuove.

---

## Datastores

SWS supporta più datastores configurabili per tag diversi:

```yaml
datastores:
  - id: default
    label: "Storico principale"
    backend:
      kind: sqlite
      path: "history/historian.db"   # il predefinito; relativo alla cartella del progetto
    retention_rows: 1000000  # max righe per tag
    retention_days: 365      # max giorni
```

| Backend | Stato |
|---|---|
| `sqlite` | completo: il file del progetto, il predefinito |
| `postgres` | completo (anche TimescaleDB): `host`, `port`, `database`, `username`, `password`, `ssl_mode` (`disable`/`prefer`/`require`), `schema` |
| `odbc` | uno stub: risponde «non compilato» finché non c'è un caso concreto (`odbc_backend.rs`) |

**La ritenzione non gira da sola.** `retention_rows` e `retention_days` si applicano quando un Admin lo chiede
(`POST /api/datastores/:id/purge`, `sws-core/src/project.rs`, `DatastoreConfig`): non c'è una pulizia programmata.
Il ring in memoria invece ha sempre un tetto per tag.

---

## Trend interattivo

Il widget **Trend** visualizza la storia di uno o più tag in un grafico Canvas 2D.

### Operazioni di navigazione

| Azione | Risultato |
|--------|-----------|
| **Trascina sul grafico** | Seleziona un intervallo e lo ingrandisce |
| **Reimposta zoom** | Il pulsante nell'angolo torna alla finestra di prima |
| **⤢** | Apre la vista espansa |
| **CSV** | Scarica i dati della finestra visibile |

### Vista espansa

La vista espansa offre:
- Canvas a schermo intero
- Asse X con timestamp leggibili
- Asse Y con range auto o configurato
- Multi-serie (tag principale + tag extra in overlay)
- Legenda interattiva (click per nascondere/mostrare serie)
- Preset di tempo: Diretta, 1 h, 8 h, 24 h, 7 giorni, Tutto, e un intervallo «dal … al …» (`TrendExpanded.tsx`)

**Sul pannello LVGL** (dal 18-10-2026) il trend ha lo stesso ⤢ nell'angolo in alto a destra: il grafico copre tutto
lo schermo e in basso compaiono i preset di tempo — Diretta (la finestra del progetto), 1 h, 8 h, 24 h, 7 giorni. Un
secondo tocco su ⤢ lo rimette nel suo riquadro, con la finestra del progetto. «Tutto» e «personalizzato» restano del
web, perché vogliono un calendario.

**Le medie dei secchi** (finestre oltre 15 minuti) si calcolano su tutti i campioni dell'intervallo. Fino al 18-10-2026
si calcolavano dopo averne scartata una parte a passo fisso, e la parte recente, densa, «oscillava» rispetto a quella
più vecchia letta dal disco.

---

## Dati storici via API

### GET /api/history/:tag

```bash
TOKEN=$(curl -sk -X POST https://localhost:8443/api/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$SWS_ADMIN_PASSWORD\"}" | jq -r .token)

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

Dal pulsante **CSV** di un trend (anche nella vista espansa), oppure da **Configurazione → Dati → Datastore**:

1. Scegli il tag (o più tag)
2. Imposta il range temporale
3. Scarica il file `.csv`

L'API è `GET /api/history/export?tags=a,b&from_ms=&to_ms=`. Formato CSV:
```
ts_ms,ts_iso,tag_id,value,quality
1735600000000,2026-01-01T10:00:00.000Z,pressione,9.8,Good
1735600001000,2026-01-01T10:00:01.000Z,pressione,9.9,Good
```

Un valore composto (array o struttura) esce come JSON fra virgolette.

**Lo storico di un pannello** (dal 18-10-2026): il pannello non ha dove salvare un file. Con l'IDE collegato al
dispositivo, **Configurazione → Istanza → Device → Storico del dispositivo (CSV)**: scegli uno dei trend delle pagine e
un intervallo (ultima ora, 8 ore, 24 ore, 7 giorni), e il CSV arriva dal pannello, con i suoi dati
(`/api/remote/history/export`).

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

**Configurazione → Dati → Datastore → [nome]** mostra:
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
