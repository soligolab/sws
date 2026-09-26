# Lo storico allarmi perde gli allarmi mai confermati — seme

> **Difetto misurato il 23-09-2026**, trovato dal maintainer: «in alarm_viewer e alarm_history non
> vedo gli allarmi, ma le notifiche degli allarmi mi arrivano su telegram».
>
> **Quando questo lavoro comincerà, il primo passo è una sessione di plan approfondita, in plan mode
> e senza scrivere codice, per sviscerarne ogni dettaglio.** Non si decide qui: la correzione cambia
> cosa significa il registro, e si incrocia con
> [«Un allarme per tag, con più condizioni dentro»](2026-09-23-un-allarme-per-tag-con-piu-condizioni.md).

## La prova

Sul progetto di prova, con tre allarmi sullo stesso tag a soglie 60, 70 e 80:

1. tag a 95 → **tre allarmi attivi**, notifica Telegram partita;
2. conferma di **uno solo** dei tre;
3. tag a 5 → tutti e tre rientrano;
4. `GET /api/alarms/history` → **un evento solo**, quello confermato.

Gli altri due sono scattati, hanno notificato e sono rientrati. Nel registro non esistono.

## Perché

`sws-core/src/alarm.rs`, macchina a stati ISA-18.2. Un evento entra nel journal solo quando è
**completo**, e completo vuol dire passato per la conferma:

| transizione | evento registrato |
|---|---|
| `ActiveAcked` → `Normal` (rientra dopo la conferma) | **sì** |
| `NormalUnacked` → `Normal` (conferma dopo il rientro) | **sì** |
| `ActiveUnacked` → `NormalUnacked` (rientra e nessuno conferma) | **no**, l'evento resta aperto |

L'ultimo caso è la norma su un impianto senza nessuno davanti allo schermo. L'evento resta aperto in
memoria per sempre, e se il progetto si ricarica sparisce anche da lì.

Il paradosso che rende la cosa evidente: **la notifica parte allo scatto** e il registro scrive al
rientro-con-conferma. Il sistema sa che l'allarme è scattato, lo dice su Telegram, e non lo scrive.

## La direzione, dal maintainer

«L'allarme deve avvisare quando scatta, non quando rientra.» Detto della notifica, ma vale per il
registro: **la riga nasce allo scatto**, e si completa quando l'allarme rientra o viene confermato.
Nessun evento perso, e lo storico mostra anche ciò che è in corso.

## Cosa la sessione di plan dovrà decidere

- **Riga scritta due volte, o scritta e aggiornata?** Oggi `append_alarm_event` fa solo `INSERT`
  (`sws-historian/src/sqlite.rs:306`). Scrivere allo scatto e completare al rientro vuol dire un
  `UPDATE` su una riga aperta: serve una chiave (`alarm_id` + `ts_activated_ms`?) e una decisione su
  cosa succede se il runtime si spegne con un evento aperto.
- **Il journal in memoria** (`journal_snapshot`, il ripiego quando non c'è SQLite) ha lo stesso
  problema e la stessa correzione.
- **Chi legge**: `alarm_history` (web e LVGL) mostrerebbe righe senza rientro — servono una colonna
  «in corso» e un ordinamento che regga le righe aperte.
- **Gli eventi già aperti** al momento dell'aggiornamento: si chiudono, si buttano, si scrivono?
