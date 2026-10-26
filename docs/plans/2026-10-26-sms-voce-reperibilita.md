# SMS, voce e reperibilità (P4) — piano d'esecuzione

> **FATTO il 26-10-2026, da collaudare** sul ramo `feat/sms-voce-reperibilita` (annidato). Firma di Twilio verificata
> contro un calcolo indipendente in Python; turni, TwiML e ripristino del token mascherato coperti da test. Collaudo
> vero con un account Twilio in `COLLAUDI_IN_SOSPESO.md` §A-quinquies.

> Nato dal [piano prima fascia e CRA](2026-10-15-piano-prima-fascia-e-cra.md), voce P4. Decisioni del maintainer del
> 25-10-2026: **servizio esterno via API, Twilio** (SMS e chiamata con sintesi vocale); **turni di reperibilità** con
> escalation al successivo; **conferma dal telefono solo per i pannelli collegati al cloud**, perché Twilio deve poter
> richiamare un indirizzo pubblico.

## Misurato il 26-10-2026

- Le notifiche ci sono (`notifications.rs`): email e Telegram all'attivazione, escalation per allarme dopo
  `escalate_after_s`, una **tabella eventi × canali** (`TabellaEventi`, `CanaliEvento { email, telegram }`).
- I segreti stanno in `secrets.yaml` (`sws-core/src/segreti.rs`), con una tabella dei campi che
  `check_segreti.sh` confronta col codice: il token di Twilio entra lì.
- Il gateway inoltra `/dev/<pannello>/…` al pannello nel tunnel **solo con una sessione** (`auth_utente_o_figlio`).
  Twilio non ha una sessione: serve una rotta sua, pre-auth, che inoltri solo `/api/telefono/…`.
- Il pannello conosce l'indirizzo del gateway (l'URL del tunnel) e il proprio nome (abbinamento o `--tunnel-nome`).
- HMAC-SHA1 per la firma di Twilio: `hmac 0.12` e `sha1 0.10` sono già nel lock (li compila `sws-audit` e altri):
  nessun crate nuovo.

## Il disegno

| Pezzo | |
|---|---|
| **Configurazione** | `notifications.twilio: { account_sid, auth_token, numero }` (il token in `secrets.yaml`); `notifications.reperibili: [{ nome, telefono, giorni: [1..7], dalle, alle }]` — l'ordine è l'ordine di escalation; `notifications.telefono_attesa_min` (predefinito 10) |
| **Canali** | `CanaliEvento` impara `sms` e `voce` (predefinito spenti): la tabella eventi × canali dice quali eventi chiamano |
| **Chi** | i reperibili **di turno adesso** (giorno della settimana e fascia, anche a cavallo della mezzanotte), nell'ordine dell'elenco; nessuno di turno = nessuna chiamata, e il log lo dice |
| **Escalation** | all'attivazione si avvisa il primo reperibile di turno; se dopo `telefono_attesa_min` l'allarme non è riconosciuto, il secondo, e così via; un riconoscimento (dal pannello, dall'IDE o dal telefono) ferma la catena |
| **La chiamata** | Twilio `Calls` con TwiML: il messaggio dell'allarme letto in italiano o inglese; se il pannello è nel cloud, «premi 1 per riconoscere» (`<Gather>`) |
| **La conferma** | il gateway espone `/telefono/<pannello>/…` senza sessione e lo inoltra al pannello come `/api/telefono/…`, con l'URL pubblico in un'intestazione; il pannello **verifica la firma di Twilio** (`X-Twilio-Signature`) col suo token e un **gettone** monouso dell'allarme. Tasto 1 → allarme riconosciuto da «telefono: <nome>»; risposta «OK» a un SMS → stessa cosa per l'ultimo allarme mandato a quel numero |
| **Editor** | Notifiche: sezione Twilio (con «Invia SMS di prova»), tabella dei reperibili; la tabella eventi ha le colonne SMS e Voce |

## Fuori, dichiarato

Altri fornitori; più numeri mittenti; calendari di reperibilità per data (ferie, festivi): l'elenco settimanale è il
primo passo. Il webhook degli SMS va impostato a mano sul numero nella console di Twilio (il manuale dice dove).
