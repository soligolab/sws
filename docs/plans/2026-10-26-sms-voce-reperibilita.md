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

## Il collaudo del 28-10-2026: fallito, e perché

Primo collaudo con un account Twilio vero. **Non è partito niente**, e a schermo c'era scritto
«runtime error». Tre difetti distinti, tutti corretti lo stesso giorno.

**1. Il SID di una chiave API dove va quello dell'account.** A Twilio si può entrare in due modi:
col SID dell'account (`AC…`) più il suo auth token, oppure con una **chiave API** (`SK…`) più il
suo segreto — ed è quello che la documentazione di Twilio consiglia oggi, perché una chiave si
revoca senza toccare l'account. Il maintainer ne ha creata una e ha incollato il suo `SK…` nel
campo «Account SID», che era l'unico che c'era.

Il punto che si sbaglia: **nell'URL di ogni chiamata ci va sempre il SID dell'account**, anche
quando ci si autentica con una chiave. La chiave dice *chi sei*, non *su quale account lavori*.
Con un `SK…` lì dentro l'URL diventa `/2010-04-01/Accounts/SK0000…/Messages.json`, che non esiste, e
Twilio risponde 404.

Corretto in due modi: `TwilioConfig` ha ora `api_key_sid` e `api_key_secret` (il secondo in
`secrets.yaml`, come il token), e `controlla()` rifiuta un `SK…` nel campo sbagliato **nominando
il campo giusto**.

**Un vincolo che resta, ed è bene saperlo**: la firma delle richieste che *arrivano* da Twilio
(tasto 1, risposta «OK») Twilio la calcola **sempre** col token dell'account, mai con una chiave
API. Quindi chi vuole le conferme dal telefono deve avere anche il token. L'interfaccia lo dice.

**2. Un `+39` davanti a un numero tedesco.** Il mittente era `+390049123456789` invece di
`+49123456789`. Questo **non si può prendere con un controllo locale**, e vale la pena
scriverlo perché la tentazione c'è: quindici cifre sono un numero E.164 perfettamente valido, e
quali numeri siano davvero dell'account lo sa solo Twilio. Il controllo su `numero` resta quello
che può dire con certezza — il `+`, da 8 a 15 cifre, niente spazi — e per il resto parla Twilio,
che risponde 21606 nominando il numero.

**3. E qui il difetto vero: la risposta di Twilio non arrivava a schermo.** `POST
/api/telefono/prova` rispondeva **502**, e il client dell'IDE traduce ogni 502 in «runtime
irraggiungibile» **buttando via il corpo** (`api/client.ts`, il 502 lo tiene solo per
`/api/remote/…`). Quindi il runtime aveva in mano «The requested resource
/Accounts/SK0000…/Messages.json was not found» e mostrava «runtime error».

Due correzioni: la rotta risponde **400**, così il corpo sopravvive; e `motivo_twilio()` tira
fuori `message` e `code` dal JSON di Twilio invece di mostrare il JSON intero — che è un modo
elegante di non dire niente.

**La lezione, che non è di Twilio.** Nessuno dei tre difetti era nel lavoro del 26-10: la logica
dei turni, la firma, il TwiML erano giusti. Tutti e tre erano **diagnosi esistenti e buttate
via** — la stessa famiglia del piano
[cosa sta succedendo nell'IDE](../archive/2026-10-28-cosa-sta-succedendo-nell-ide.md), scritto lo
stesso giorno per tutt'altro motivo.

**Da rifare**, col collaudo vero: un SMS che arriva davvero, con la coppia account+token e poi con
una chiave API; una chiamata; e il tasto 1 dal telefono su un pannello del cloud.

## La seconda prova, 29-10-2026: da vedere

Il maintainer ha riprovato «Invia SMS di prova» con la 2.23.6 e ha segnalato due errori, **da vedere dopo**. Adesso
almeno il motivo di Twilio arriva a schermo, col suo codice: è la correzione del 28-10 che funziona.

1. **Solo account (`AC…` + token)**: `Twilio ha risposto 400 Bad Request: Invalid template name. Trial accounts can only
   use predefined SMS templates. (codice Twilio 572006)`. Prima lettura, da verificare sulla documentazione di Twilio:
   è un limite dell'**account di prova**, che non manda testi liberi. Il rimedio sarebbe dalla parte di Twilio
   (passare a un account pagato), non nel nostro codice; da capire se esiste un modello predefinito che SWS possa usare
   per la prova, e cosa dire a schermo davanti al 572006.
2. **Con la chiave API (`SK…` + segreto)**: `Twilio ha risposto 401 Unauthorized: actor doesn't have any assertions
   (codice Twilio 8001)`. Prima lettura, da verificare: la chiave non ha permessi sui messaggi — una chiave
   «Restricted» senza permessi, o creata in un altro account o sotto-account. Da controllare il tipo di chiave e il suo
   account, e cosa dire a schermo davanti all'8001.

Nella stessa schermata, una cosa nostra: la nota sulla chiave API mostra `**sending**` con gli asterischi, perché il
testo (`notifiche.chiaveApiNota`) usa il grassetto Markdown e la scheda lo stampa come testo.

## Fuori, dichiarato

Altri fornitori; più numeri mittenti; calendari di reperibilità per data (ferie, festivi): l'elenco settimanale è il
primo passo. Il webhook degli SMS va impostato a mano sul numero nella console di Twilio (il manuale dice dove).
