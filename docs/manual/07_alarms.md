← [Indice](MAIN.md) | [← Protocolli](06_protocols.md) | [Successivo → Historian](08_historian.md) →

---

# 07 — Sistema Allarmi

SWS implementa il sistema di allarmi secondo lo standard **ISA-18.2**
(Management of Alarm Systems for the Process Industries).

---

## Modello a stati ISA-18.2

Ogni allarme passa attraverso quattro stati:

```
                    condizione vera
NORMAL ─────────────────────────────► ACTIVE_UNACKED
                                           │
                              operatore    │   condizione falsa
                              riconosce    │   (ma non riconosciuto)
                                   ▼       ▼
                         ACTIVE_ACKED    NORMAL_UNACKED
                                │             │
                    condizione  │    operatore │
                    falsa       │    riconosce │
                                ▼             ▼
                              NORMAL ◄────────┘
```

| Stato | Icona | Colore | Descrizione |
|-------|-------|--------|-------------|
| `normal` | — | — | Condizione non verificata |
| `active_unacked` | 🔴 | Rosso lampeggiante | Attivo, non riconosciuto |
| `active_acked` | 🟠 | Arancione | Attivo, riconosciuto dall'operatore |
| `normal_unacked` | 🟡 | Giallo | Tornato normale ma non riconosciuto |

---

## Definizione allarmi

Gli allarmi sono definiti in **Configurazione → Allarmi → + Aggiungi**.

### Configurazione YAML

```yaml
alarms:
  - id: pressione_alta
    tag: sensore.pressione
    condition:
      kind: above
      threshold: 10.0
    message: "Pressione alta (>10 bar)"
    severity: Warning
    dead_band: 0.5
    on_delay_s: 5
    off_delay_s: 2
    notify_url: "https://hooks.slack.com/..."
    notify_email:
      - "responsabile@impianto.it"
    escalate_after_s: 300
    escalate_to:
      - "direttore@impianto.it"
```

### Parametri

| Parametro | Descrizione |
|-----------|-------------|
| `id` | Identificatore univoco |
| `tag` | Tag da monitorare |
| `condition` | Condizione di attivazione (vedi sotto) |
| `message` | Testo mostrato agli operatori |
| `severity` | `Info`, `Warning`, `Critical` |
| `dead_band` | Isteresi: la condizione deve essere falsa di `dead_band` per disattivarsi |
| `on_delay_s` | Secondi di condizione vera continua prima dell'attivazione |
| `off_delay_s` | Secondi di condizione falsa continua prima della disattivazione |
| `inhibit_tag` | Tag che inibisce l'allarme quando vero |
| `notify_url` | Webhook POST su attivazione |
| `notify_email` | Email su attivazione |
| `escalate_after_s` | Secondi dopo i quali si invia email di escalation |
| `escalate_to` | Destinatari escalation |

---

## Condizioni di attivazione

Le condizioni supportano la composizione logica:

### Condizioni base

```yaml
# Valore sopra soglia
condition:
  kind: above
  threshold: 100.0

# Valore sotto soglia
condition:
  kind: below
  threshold: 5.0

# Booleano uguale a valore
condition:
  kind: bool_equals
  value: true

# Booleano vero
condition:
  kind: bool_true

# Booleano falso
condition:
  kind: bool_false
```

### Condizioni composte

```yaml
# AND — tutte le condizioni devono essere vere
condition:
  kind: and
  conditions:
    - kind: above
      threshold: 80.0
    - kind: below
      threshold: 120.0

# OR — almeno una condizione vera
condition:
  kind: or
  conditions:
    - kind: bool_true
    - kind: above
      threshold: 95.0

# NOT — inverte la condizione
condition:
  kind: not
  condition:
    kind: bool_true
```

---

## Severità

| Severità | Colore | Priorità | Uso tipico |
|----------|--------|---------|-----------|
| `Info` | Blu | Bassa | Notifiche informative, eventi attesi |
| `Warning` | Giallo | Media | Condizioni anomale, intervento consigliato |
| `Critical` | Rosso | Alta | Emergenze, arresto macchina, sicurezza |

---

## Alarm Banner

L'alarm banner è sempre visibile in cima all'interfaccia operatore.
Mostra gli allarmi attivi con colore, messaggio e pulsante ACK.

```
No active alarms                         ← nessun allarme attivo

⚠️ Pressione alta (>10 bar)  [ACK]      ← Warning attivo non riconosciuto
🔴 Emergenza arresto macchina  [ACK]    ← Critical attivo
```

Il banner ha priorità visiva assoluta — non può essere nascosto dagli operatori.

---

## Riconoscimento (ACK)

### Dalla UI

1. Click su **[ACK]** nel banner o nella lista allarmi
2. L'allarme passa da `active_unacked` → `active_acked`
3. L'evento di ACK viene registrato nell'audit log con username e timestamp

### Dall'Alarm Viewer (widget)

Il widget Alarm Viewer embedded nel sinottico ha un pulsante ACK inline per ogni riga.
Richiede ruolo **Operator** o superiore.

### Via API

```bash
curl -k -X POST https://localhost:8443/api/alarms/pressione_alta/ack \
  -H "Authorization: Bearer $TOKEN"
```

---

## Shelving (inibizione temporanea)

Lo shelving nasconde un allarme per un periodo definito, utile durante manutenzione.

### Da UI

**Configurazione → Allarmi → [allarme] → Shelving** oppure via pulsante nell'alarm viewer.

### YAML / API

```bash
curl -k -X POST https://localhost:8443/api/alarms/pressione_alta/shelve \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "Manutenzione programmata pompa P1",
    "until_ms": 1735689600000
  }'
```

Un valore `until_ms: 0` shelving indefinito.

---

## Notifiche

### Webhook

Su attivazione, SWS fa una POST al `notify_url` con payload JSON:

```json
{
  "alarm_id": "pressione_alta",
  "message": "Pressione alta (>10 bar)",
  "severity": "Warning",
  "ts_activated_ms": 1735600000000,
  "tag": "sensore.pressione",
  "value": 10.5
}
```

### SMTP (email)

Configura il server SMTP in **Configurazione → Notifiche**:

```yaml
notifications:
  smtp:
    host: "smtp.impianto.it"
    port: 587
    from: "scada@impianto.it"
    username: "scada"
    password: "..."
    starttls: true
```

Le email di notifica contengono: messaggio allarme, valore del tag, timestamp di attivazione.
Le email di escalation includono anche il tempo trascorso dall'attivazione.

### Telegram

Un canale in uscita per ricevere i messaggi su Telegram (allarmi + escalation) e per inviare
messaggi dagli script. Configura in **Configurazione → Notifiche → Notifiche Telegram**:

```yaml
notifications:
  telegram:
    bot_token: "123456789:ABCdef..."   # da @BotFather
    chat_ids: ["111206798", "-1001234567890"]   # destinatari (chat globali)
```

Passi guidati nel pannello:

1. Su Telegram crea un bot con **@BotFather** (`/newbot`) e copia il **token**. Incollalo nel campo.
2. Scrivi `/start` al bot (o aggiungilo a un gruppo/canale e manda un messaggio lì).
3. Premi **Rileva chat**: SWS elenca le chat che hanno scritto al bot → **Aggiungi** quelle volute
   (i gruppi hanno ID negativo `-100…`). In alternativa inserisci le chat ID a mano.
4. Premi **Invia test** per verificare, poi **Salva**.

> **Nota**: *Invia test* e *Rileva chat* chiamano l'API di Telegram **direttamente dal browser**,
> quindi funzionano anche dal solo editor (senza runtime). L'invio effettivo su allarme parte invece
> dal **runtime**: assicurati che il dispositivo raggiunga `api.telegram.org`. Il `bot_token` è
> mascherato (`********`) nelle risposte del server.

**Ogni allarme che si attiva** (e le escalation) viene inviato a tutte le `chat_ids` configurate.
A differenza delle email (opt-in per-allarme via `notify_email`), Telegram è un feed globale.

#### Invio da script

La funzione **`send_telegram("testo")`** è disponibile negli **script globali** e nelle **funzioni**:

```python
if tags["serbatoio.livello"] > 95:
    send_telegram(f"⚠️ Serbatoio quasi pieno: {tags['serbatoio.livello']}%")
```

Se Telegram non è configurato, la chiamata solleva un errore leggibile ("Telegram non configurato").

---

## Storico allarmi

**Configurazione → Allarmi → Storico** mostra tutti gli allarmi passati con:
- Timestamp attivazione
- Timestamp ACK e utente che ha riconosciuto
- Timestamp normalizzazione
- Durata totale

```bash
# Via API
curl -k -H "Authorization: Bearer $TOKEN" \
  "https://localhost:8443/api/alarms/history?limit=50"
```

---

← [Indice](MAIN.md) | [← Protocolli](06_protocols.md) | [Successivo → Historian](08_historian.md) →
