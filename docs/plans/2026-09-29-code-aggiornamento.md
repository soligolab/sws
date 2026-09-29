# Chiudere l'aggiornamento del runtime: avviso su LVGL, email come canale

## Contesto

Il piano [aggiornamento runtime e bus utente](2026-09-27-aggiornamento-runtime-e-bus-utente.md)
è arrivato alla rc.10 con le Fasi 1, 1b, 2, 3 e 4 su `main`. Restano **due code**, ed è quello che
il maintainer ha chiesto di completare oggi prima di aprire il piano grosso su utenti e aziende:

1. **L'avviso a schermo su LVGL** — la decisione 41 dice «in web **e in LVGL**», e oggi è fatta
   solo a metà. Una funzione a metà è peggio di una assente: chi ha un pannello LVGL non sa di non
   essere avvisato.
2. **L'email come canale di notifica**, al pari di Telegram. Le decisioni 33 e 52 la nominano
   («notifica coi canali del progetto — Telegram/email»), ma il 28-09 è stata rimandata con una
   nota esplicita: nel progetto un destinatario email esiste **solo per singolo allarme**, e uno
   di progetto «sarebbe una decisione nuova». Oggi il maintainer l'ha presa.

Prima di entrambe va chiuso un residuo: il ramo `feat/aggiornamento-f1b-changelog`, superato dallo
squash di stanotte, esiste ancora qui e su origin.

## Decisioni del maintainer (29-09-2026)

| | Scelta |
|---|---|
| ordine | **prima LVGL, poi l'email**, due rami corti uno per volta |
| ramo vecchio | **cancellare**, locale e su origin |
| email | un **canale** come Telegram, non un campo: la usano gli allarmi e l'aggiornamento |
| destinatari | **`{indirizzo, lingua}` subito**, migrando i `notify_email` esistenti: una volta sola invece di due |
| quali eventi | **scelta per evento**, con una **tabella eventi × canali** nella scheda Notifiche |
| collaudo SMTP | server vero, dati passati al momento (la password va in `secrets.yaml`) |

---

## R0 — Chiudere il ramo superato (prima di tutto)

Verificato oggi: `AvvisoAggiornamento.tsx` e i suoi test **sono** su `main`; il mio
`changelog_sezione.py` no, perché è stato sostituito da `NOVITA.yaml` + `scripts/novita.py`, che è
una soluzione migliore per lo scopo (righe brevi bilingui per chi usa il pannello, invece della
sezione di CHANGELOG che è tecnica e monolingue). Il diff `main → ramo` è fatto quasi solo di
rimozioni.

```
git branch -D feat/aggiornamento-f1b-changelog
git push origin --delete feat/aggiornamento-f1b-changelog
```

Lo STATUS di stanotte lo chiedeva già («Da fare al prossimo push»).

---

## R1 — L'avviso a schermo su LVGL · `feat/aggiornamento-lvgl-avviso`

Porta sul viewer LVGL quello che `sws-editor/src/runtime-view/AvvisoAggiornamento.tsx` fa nel
viewer web: l'esito dell'ultimo aggiornamento (decisioni 52-54) e l'avviso di versione nuova
(41, 44), **solo su un progetto senza utenti**.

### Quello che c'è già e si riusa

- **Le rotte sono già sulla porta del viewer**: `/api/update/status` e `/api/update/apply` sono
  registrate in `sws-web/src/router.rs:1198-1209` dietro `require_admin`. Senza utenti l'Admin
  sintetico passa; con utenti un anonimo prende 403 — e quel 403 **è** la risposta «ci sono
  utenti».
- **Sapere se il progetto ha utenti**: `client::fetch_system` (`sws-lvgl-viewer/src/client.rs:146`)
  legge `auth_required` da `/api/system`, ed è già chiamata all'avvio (`main.rs:286-300`), con il
  risultato in `SessionState.auth_required` (`session.rs:85-99`).
- **Il client HTTP col token**: la forma di `put_tag` (`client.rs:550-577`) — `reqwest` con
  `pinned_client_config` e header `Authorization: Bearer`.
- **Le scritture passano dal thread di rete**: `net_worker.rs` esiste per Q55 (una POST che
  riceveva 200 e non tornava mai, **solo dentro questo binario**). `Comando::AvviaAggiornamento`
  va aggiunto lì accanto a `PutTag`/`AckAlarm`/`ApplyRecipe`, non chiamato dal loop di rendering.
- **La finestra**: due pattern esistenti. `lv_msgbox_create(NULL)` (`lvgl_render.rs:785`) sta sul
  layer superiore e **sopravvive al cambio pagina**; l'overlay di login (`render_auth_widget`,
  `lvgl_render.rs:6001`) è figlio dello *screen*, ha libertà di layout ma **va ridisegnato a ogni
  pagina**. Servono quattro pulsanti e un testo scorrevole, quindi: **overlay costruito come
  l'auth widget ma agganciato al layer superiore**, così non si perde navigando.
- **La persistenza**: niente `localStorage` qui. C'è `session_path()`
  (`session.rs:105-109`) → `~/.config/sws/lvgl_session.json`; un `aggiornamento_visto.json`
  accanto è coerente con quella convenzione.

### Le tre trappole già pagate, da non ripagare

1. **La mappa dei pulsanti del msgbox deve essere `static`** (`lvgl_render.rs:817-838`): LVGL ne
   conserva il puntatore, un array locale è un segfault al primo ridisegno. Vale per qualunque
   `lv_btnmatrix`.
2. **Gli stili vanno `Box::leak`-ati** (come in `render_auth_widget`): LVGL tiene il puntatore.
3. **`auth_required` oggi è letto una volta sola all'avvio.** Nel viewer web questo è stato un
   difetto vero, corretto nella rc.7: l'avviso non poteva comparire. Qui va aggiunto il
   ricontrollo periodico con il riconoscimento del riavvio del runtime da `uptime_s` che scende —
   la funzione `ripartito()` del gemello web è la specifica.

### I testi

Le stringhe d'interfaccia del viewer LVGL sono **italiane cablate** (`c"Annulla"`, `"Accesso"`).
La decisione 57 vuole la lingua dell'interfaccia, quindi le voci nuove («Aggiorna ora», «Più
tardi», «Ignora questa versione», «Novità», «Chiudi») vanno in `sws-core::testi_sistema`, con la
fixture condivisa `tests/fixtures/testi-sistema.json`, il test Rust, quello TypeScript e la
guardia statica che li confronta. È la strada già in uso, non un'eccezione da dichiarare.

Il **contenuto** delle Novità arriva invece già bilingue dall'API (`testo`/`testo_en`,
`compatibilita`/`compatibilita_en`): si sceglie con la stessa logica di `novitaNellaLingua`.

### Passi

1. `Comando::AvviaAggiornamento` in `net_worker.rs` + `client::stato_aggiornamento()` e
   `client::avvia_aggiornamento(token)` in `client.rs`, sulla forma di `put_tag`.
2. Le voci in `testi_sistema.rs` e nella fixture; guardia verde.
3. Il polling: `auth_required` e stato dell'aggiornamento, con `ripartito()` portato in Rust
   (funzione pura, **test prima**).
4. L'overlay: esito se c'è un evento non ancora chiuso, altrimenti versione nuova; quattro
   pulsanti; `aggiornamento_visto.json` per «Ignora» e per l'esito già chiuso.
5. Collaudo sul TC620: pannello senza utenti, versione nuova nel canale.

---

## R2 — L'email come canale di notifica · `feat/notifiche-email-progetto`

### Quello che c'è già

Il canale email **esiste**: `sws-web/src/notifications.rs` usa `lettre` (`build_transport:29`,
`send_email_sync:56`) e manda sugli allarmi. Quello che manca è tutto intorno:

| | Telegram | Email (oggi) |
|---|---|---|
| trasporto | `TelegramConfig.bot_token` | `SmtpConfig` (host, porta, from, credenziali, STARTTLS) ✓ |
| destinatari **di progetto** | `chat_ids` ✓ | **assenti** |
| destinatari per allarme | — | `AlarmDef.notify_email` (`sws-core/src/alarm.rs:230`) |
| invio fuori dagli allarmi | `telegram_sender` in `AppState` ✓ | **assente** |

È questa asimmetria il cuore del lavoro: l'esito dell'aggiornamento
(`aggiornamento_esito.rs:156-159`) manda solo su Telegram perché per l'email non esiste né un
destinatario di progetto né un modo di spedire fuori dal supervisore allarmi.

### Le scelte fatte

- **`Destinatario { indirizzo, lingua }`** come forma unica, in `NotificationConfig` (di progetto)
  e in `AlarmDef.notify_email` (per allarme). La lettura accetta **anche la stringa nuda** dei
  progetti esistenti (`serde` untagged), così i progetti vecchi si aprono; la scrittura usa sempre
  la forma nuova. Chiude anche la variante rimasta aperta a settembre
  (`docs/archive/2026-09-18-multilingua-residuo.md:172-185`), invece di migrare due volte.
- **Tabella eventi × canali** in `NotificationConfig`: righe = evento (allarme scattato, allarme
  rientrato, esito aggiornamento, versione nuova), colonne = canale. `CanaleNotifica` esiste già
  (`project.rs:1357`), e `lingua_per(canale, ripiego)` (`:1363-1390`) resta il punto unico per la
  lingua.
- **Un `email_sender` in `AppState`**, gemello di `telegram_sender`: un canale mpsc e un task che
  spedisce, così l'esito dell'aggiornamento e gli allarmi usano la stessa via e nessuno chiama
  `send_email_sync` dal ciclo di vita del supervisore.
- **La password SMTP è un segreto**: va in `secrets.yaml` come il token Telegram — 0600, fuori da
  git e dall'export, mascherata nella GET. Da verificare che `SmtpConfig.password` sia già fra i
  campi-segreto, e aggiungerla altrimenti (`check_segreti.sh` ha la tabella).

### Passi

1. `Destinatario` e la lettura tollerante, con i test dei due formati (**prima rossi**).
2. La tabella eventi × canali nel modello, con un default che riproduce il comportamento di oggi:
   allarmi su entrambi se configurati, esito aggiornamento su Telegram.
3. `email_sender` in `AppState` + invio dell'esito (`aggiornamento_esito.rs`) e della versione
   nuova.
4. `NotificationsTab.tsx`: destinatari di progetto (sul modello della textarea `chat_ids`,
   riga 403) e la tabella con le caselle. Attenzione al difetto già pagato lì: un payload parziale
   **cancellava** le sezioni non incluse (commento righe 28-30).
5. Collaudo con l'SMTP vero del maintainer: un allarme che scatta e un esito di aggiornamento.

---

## Poi: archiviare, e aprire il piano grosso

Chiuse le due code, il piano dell'aggiornamento va in `docs/archive/` con la riga nel README, e
resta solo il seme del quadlet che non viaggia.

Il lavoro dopo è il [piano utenti e aziende](2026-09-18-identita-utenti-istanze.md):
**29 decisioni già prese, zero righe di codice scritte**, e il piano chiede **due volte** che la
prima cosa sia una sessione di plan approfondita. La sua decisione 29 dà anche l'ordine: prima i
pezzi che toccano il codice condiviso (la semantica di `ide_only`, gli utenti d'impianto «locali»,
il mount `/data/openvpn`), poi il gateway. Non si comincia oggi a scrivere: si apre quella
sessione.

## Rischi

- **LVGL non ha rete di test a schermo**: nel crate non c'è `tests/`, solo `#[cfg(test)]` in-file.
  Le parti pure (quando mostrare, cosa ricordare, la lingua) si testano; l'overlay si verifica sul
  pannello. `--istantanea` rende una pagina in PNG ma **non esercita la rete** — è scritto in
  `main.rs:594` e ci siamo già cascati il 24-09.
- **La tabella eventi × canali tocca il payload di Notifiche**, dove un salvataggio parziale ha già
  cancellato sezioni una volta.
- **La migrazione di `notify_email`** riguarda progetti veri del maintainer: la lettura tollerante
  è la rete, e va provata su un progetto esistente prima del merge.

## Verifica

Per ogni ramo: `cargo check`, `pnpm build`, `pnpm test`, `cargo test`, `./scripts/check_static.sh`
verdi, **più la conferma del maintainer** — la definition of done ne vuole quattro.

- **R1**: sul TC620 senza utenti, con una versione nuova nel canale → l'overlay compare, «Più
  tardi» lo nasconde fino al riavvio, «Ignora» anche dopo; con utenti definiti non compare nulla.
  Dopo un aggiornamento vero, l'esito e il suo «Chiudi».
- **R2**: un allarme che scatta manda l'email ai destinatari di progetto **nella lingua di
  ciascuno**; l'esito di un aggiornamento arriva sui canali spuntati; togliendo la spunta non
  arriva; la password SMTP non compare in un export.
