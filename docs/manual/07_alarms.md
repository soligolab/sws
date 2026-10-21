← [Indice](MAIN.md) | [← Protocolli](06_protocols.md) | [Successivo → Historian](08_historian.md) →

---

# 07 — Sistema Allarmi

> Come si definiscono gli allarmi, come cambiano di stato, come si confermano e sospendono, chi viene avvisato e
> dove resta traccia. Per chi configura un impianto. I widget che li mostrano sono nel
> [capitolo 05](05_widget_reference.md#allarmi).
>
> Misurato sul codice il 20-10-2026.

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

Gli allarmi sono definiti in **Configurazione → Progetto → Allarmi → + Aggiungi** (`sws-core/src/alarm.rs`, `AlarmDef`).

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
    email_mode: propri
    notify_email:
      - "responsabile@impianto.it"
      - { indirizzo: "manutenzione@impianto.it", lingua: en }
    escalate_after_s: 300
    escalate_to:
      - "direttore@impianto.it"
    telegram_mode: global
```

### Più livelli sullo stesso tag

Al posto di `condition`, `severity` e `message` si possono dare dei **livelli** (`levels`): ognuno ha la sua
condizione, la sua severità, il suo messaggio e, se serve, la sua banda morta. Vince il livello più grave fra quelli
veri, e a parità di severità l'ultimo dichiarato (`livello_vincente`): i livelli si scrivono in scala crescente, e il
validatore avvisa se due hanno la stessa severità. Lo storico tiene il massimo raggiunto (vedi [Storico allarmi](#storico-allarmi)).

```yaml
alarms:
  - id: batteria
    tag: casa.batteria_pct
    levels:
      - condition: { kind: below, threshold: 15 }
        severity: Warning
        message: "Batteria sotto il 15%"
        dead_band: 3
      - condition: { kind: below, threshold: 5 }
        severity: Critical
        message: "Batteria sotto il 5%"
        dead_band: 1
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
| `levels` | Più livelli sullo stesso tag, al posto di `condition`/`severity`/`message` (vedi sopra) |
| `inhibit_tag` | Tag che inibisce l'allarme quando vero |
| `inhibit_condition` | Condizione sull'`inhibit_tag`, se non basta «vero» |
| `notify_url` | Webhook POST su attivazione |
| `email_mode` | `progetto` (i destinatari di Configurazione → Progetto → Notifiche), `propri` (solo `notify_email`), `off` |
| `notify_email` | Destinatari propri: un indirizzo, o `{ indirizzo, lingua }` per scrivere in un'altra lingua |
| `escalate_after_s` | Secondi dopo i quali, se non confermato, si invia l'email di escalation |
| `escalate_to` | Destinatari dell'escalation, nella stessa forma |
| `telegram_mode` | `global` (le chat del progetto, il predefinito), `chats` (solo `telegram_chat_ids`), `off` |
| `telegram_chat_ids` | Le chat per `telegram_mode: chats` |

Un allarme scritto prima del 29-09-2026 senza `email_mode` manda ai suoi `notify_email` se li ha, altrimenti ai
destinatari del progetto.

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

La barra allarmi (`alarm_banner`) è un oggetto da mettere nelle pagine, come la campanella (`alarm_bell`) e il
visualizzatore (`alarm_viewer`): dal T-46 non c'è più una barra fissa sopra tutte le pagine, e una pagina senza
nessuno di questi oggetti non mostra allarmi. Di solito la si mette in una [cornice](04_editor_guide.md#cornici-testata-e-piede-comuni-a-più-pagine),
così compare su tutte le pagine che la usano. Mostra gli allarmi attivi con colore, messaggio e pulsante ACK.

```
No active alarms                         ← nessun allarme attivo

⚠️ Pressione alta (>10 bar)  [ACK]      ← Warning attivo non riconosciuto
🔴 Emergenza arresto macchina  [ACK]    ← Critical attivo
```

Dove c'è, il banner non si chiude dall'operatore.

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
curl -k -X POST https://localhost:7443/api/alarms/pressione_alta/ack \
  -H "Authorization: Bearer $TOKEN"
```

---

## Shelving (inibizione temporanea)

Lo shelving nasconde un allarme per un periodo definito, utile durante manutenzione.

### Da UI

Dal pulsante di sospensione dell'alarm viewer o della campanella (`alarm_viewer_show_shelve`,
`alarm_bell_show_shelve`), per i minuti impostati nel widget (`alarm_shelve_minutes`). Gli allarmi sospesi si
leggono con `GET /api/alarms/shelved`.

### YAML / API

```bash
curl -k -X POST https://localhost:7443/api/alarms/pressione_alta/shelve \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "Manutenzione programmata pompa P1",
    "duration_ms": 3600000
  }'
```

`duration_ms` è la durata della sospensione in millisecondi; `0` (o assente) la sospende senza scadenza.

---

## Notifiche

### Webhook

Su attivazione, SWS fa una POST al `notify_url` con payload JSON:

```json
{
  "id": "pressione_alta",
  "message": "Pressione alta (>10 bar)",
  "severity": "Warning",
  "tag": "sensore.pressione",
  "ts_ms": 1735600000000,
  "value": 10.5
}
```

La chiamata è «best effort»: se il server non risponde, SWS lo scrive nel log e non riprova
(`sws-runtime/crates/sws-runtime/src/main.rs`).

### SMTP (email)

Configura il server SMTP in **Configurazione → Progetto → Notifiche → SMTP**, con i destinatari di progetto
(`destinatari_email`):

```yaml
notifications:
  smtp:
    host: "smtp.impianto.it"
    port: 587
    from: "scada@impianto.it"
    username: "scada"
    password: "..."
    starttls: true
  destinatari_email:
    - "reparto@impianto.it"
```

Le email di notifica contengono: messaggio allarme, valore del tag, timestamp di attivazione.
Le email di escalation includono anche il tempo trascorso dall'attivazione.

### Telegram

Un canale in uscita per ricevere i messaggi su Telegram (allarmi + escalation) e per inviare
messaggi dagli script. Configura in **Configurazione → Progetto → Notifiche → Telegram**:

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

> **Nota**: *Invia test* e *Rileva chat* passano dal runtime che serve l'IDE
> (`POST /api/notifications/test-telegram`, `/telegram-chats`), quindi è quella macchina a dover raggiungere
> `api.telegram.org`; l'invio effettivo su allarme parte dal **runtime del dispositivo**, che deve raggiungerlo
> anche lui. Il `bot_token` è mascherato (`********`) nelle risposte del server.

**Ogni allarme che si attiva** (e le escalation) va per default a tutte le `chat_ids` del progetto
(`telegram_mode: global`); un allarme può mandare solo a chat sue (`chats`) o a nessuna (`off`). La scheda
**Cosa e dove**, accanto, decide quali eventi vanno su email e quali su Telegram: scatto, escalation, rientro,
esito di un aggiornamento, versione nuova (`eventi`, `TabellaEventi`). Una riga non impostata fa quello che si faceva
prima: scatto ed escalation su tutti e due, rientro su nessuno.

#### Invio da script

La funzione **`send_telegram("testo")`** è disponibile negli **script globali** e nelle **funzioni**:

```python
if tags["serbatoio.livello"] > 95:
    send_telegram(f"⚠️ Serbatoio quasi pieno: {tags['serbatoio.livello']}%")
```

Se Telegram non è configurato, la chiamata solleva un errore leggibile ("Telegram non configurato").

---

## Storico allarmi

Lo storico ha **una riga per ogni scatto** di un allarme. Si legge nel widget `alarm_history` (web e
pannello LVGL), nel pannello della campanella e via API.

**La riga nasce allo scatto** (dal 2026-09-25), nello stesso momento in cui parte la notifica, e si
aggiorna a ogni passaggio:

| cosa succede | nella riga |
|---|---|
| l'allarme scatta | nasce, con messaggio e severità del livello scattato |
| sale a un livello più grave | severità e messaggio del livello più grave raggiunto; se era già confermato, la conferma si azzera (va confermato di nuovo, come sul pannello) |
| scende a un livello meno grave | niente: la riga tiene il massimo raggiunto |
| qualcuno conferma | ora e utente della conferma |
| rientra | ora del rientro e durata (dallo scatto al rientro) |
| riscatta prima di essere confermato | è lo stesso scatto: la riga torna attiva |

Una riga resta **aperta** finché l'allarme non è rientrato **e** confermato: nel widget web si legge
«Attivo» / «Non confermato», sul pannello LVGL nella colonna **Stato** (Attivo, Da confermare, Chiuso).

**Righe interrotte.** Se il runtime si spegne o cade, o se gli allarmi vengono ricaricati (anche una
modifica dagli allarmi nell'IDE) mentre una riga è aperta, la riga si chiude come **interrotta**: il
rientro indicato è l'ora dell'interruzione, non un rientro vero. Se l'allarme è ancora vero, riscatta
subito e apre una riga nuova.

Fino al 2026-09-25 la riga nasceva solo a evento completo, cioè dopo la conferma: un allarme che
scattava, notificava e rientrava senza che nessuno lo confermasse non compariva mai nello storico.

```bash
# Via API
curl -k -H "Authorization: Bearer $TOKEN" \
  "https://localhost:7443/api/alarms/history?limit=50"
```

---

← [Indice](MAIN.md) | [← Protocolli](06_protocols.md) | [Successivo → Historian](08_historian.md) →
