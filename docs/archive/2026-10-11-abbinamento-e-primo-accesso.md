# Abbinamento del pannello col codice, che è anche il primo accesso

> **Piano d'esecuzione, approvato l'11-10-2026. Stato: tutte e quattro le fette fatte (ramo `feat/abbinamento-pannello`), in attesa del
> collaudo completo del maintainer.** Scostamento dal piano: i pannelli abbinati stanno in
> `pannelli_abbinati.json` sul gateway e non in una tabella di `identita.db` — stessa forma delle righe, da
> spostare quando servirà una query.
>
> Nato come piano da approvare. Nasce dalla richiesta del maintainer dell'11-10-2026: «se
> installo il container su un dispositivo nuovo compare il codice per il pairing … una sequenza
> alfanumerica tutta in maiuscolo composta da 4 gruppi di 4 caratteri». Unisce la **Fetta 2** del
> [tunnel](2026-10-09-fase-6-tunnel-dei-pannelli.md), il seme
> [identità del pannello](2026-10-10-identita-del-pannello-e-token-ripetibile.md) e la decisione CRA
> del 05-10 in [identità utenti](2026-09-18-identita-utenti-istanze.md) («lo stesso meccanismo **è**
> il primo accesso»).

## Le scelte del maintainer (11-10-2026)

| Domanda | Scelta |
|---|---|
| Portata | **Abbinamento + primo accesso CRA**: il pannello resta chiuso finché il codice non viene usato, e chi abbina fissa la prima credenziale |
| Il codice dopo un factory reset | **Casuale**, generato al primo avvio e conservato nella configurazione del pannello; il gateway riconosce comunque la scatola dal seriale hardware e la rimette sulla stessa riga |
| Dove si rivendica | **IDE cloud**, sezione Dispositivi (decisione 12) — e, per non rompere il funzionamento locale, **anche dall'IDE locale** al «Connetti» |
| Dove compare il codice | **Log e output dell'installer, pagina locale, schermo LVGL** |

Vincolo permanente del maintainer: **il funzionamento locale resta compatibile**. Un pannello senza
internet deve potersi abbinare (= avere il primo accesso) dall'IDE in LAN, senza cloud.

## Il codice

- 16 caratteri in 4 gruppi: `7KQ2-M9XD-3HWP-T4BZ`.
- Alfabeto **Crockford base32 maiuscolo** (`0-9 A-Z` senza `I L O U`): 32 simboli → **80 bit**, non
  si indovina, e niente coppie che si confondono leggendo da uno schermo. In ingresso si accettano
  minuscole, spazi e trattini, e `O→0`, `I/L→1`.
- Generato con il generatore crittografico al primo avvio, salvato in `<config>/abbinamento.json`.
  Sopravvive a reinstallazione del container e aggiornamenti (la config è un volume); dopo un
  factory reset ne nasce uno nuovo.
- **Monouso**: usato una volta, il pannello è abbinato e il codice non vale più. Per riabbinare (cambio
  di azienda, credenziale persa) si rigenera dal pannello stesso — gesto locale, da definire nella
  fetta D (pulsante nella pagina locale da Admin, o cancellazione del file da SSH).

## L'identità hardware

Misurata il 10-10 sul TC620 (seme): in ordine, **seriale del device-tree**
(`/sys/firmware/devicetree/base/serial-number`, `P052600C00292600014`), poi **MAC** della prima
interfaccia fisica, poi un **UUID casuale** salvato in `abbinamento.json` e marcato «non hardware»
(un PC o una VM: il pannello funziona, ma dopo un reset non viene riconosciuto). Da verificare che
`/sys/firmware` sia leggibile da dentro il container rootless — se no, un mount in sola lettura
nell'installer.

## Gli stati del pannello

| Stato | Chi entra |
|---|---|
| **in attesa** (nessuna credenziale) | **nessuno**, nemmeno in lettura. Rispondono solo la lista bianca pre-auth e le due rotte nuove: `GET /api/abbinamento` (stato, codice, seriale, nome proposto) e `POST /api/abbinamento/rivendica` |
| **abbinato** | chi ha una credenziale: l'**Admin del dispositivo** fissato all'abbinamento, più gli utenti del progetto (`users.yaml`) se il progetto ne porta |

Oggi `FonteAutenticazione::Nessuna` dà un Admin sintetico a un dispositivo senza utenti: **sparisce**
(resta solo `--senza-autenticazione`, sviluppo su loopback). Al suo posto:

- `InAttesa` — tutto 401 con `{"abbinamento_richiesto": true}`, fuori dalla lista bianca;
- l'**Admin del dispositivo** sta in `<config>/utenti_dispositivo.yaml`, stesso formato e stesso hash
  argon2 di `users.yaml`, **fuori dal progetto**: un deploy non lo porta via. È l'utente «locale»
  della decisione 22. Vale sempre, anche quando il progetto porta i suoi utenti.

`GET /api/abbinamento` mostra il codice a chi raggiunge la pagina locale: è voluto (decisione 14) —
chi sta in LAN o davanti allo schermo è il «possesso fisico» che il codice certifica. Il codice non
esce mai dal pannello verso il cloud se non quando il pannello lo presenta lui al gateway.

## Le fette

### A — il pannello: codice, stati, rivendicazione locale (sws-web, sws-auth)

- `sws-web/src/abbinamento.rs` nuovo: codice (generazione, normalizzazione, confronto a tempo
  costante), identità hardware, `abbinamento.json`, le due rotte.
- `POST /api/abbinamento/rivendica {codice, username, password}`: codice giusto → crea l'Admin del
  dispositivo, stato abbinato, risponde col token di sessione (si è già dentro). Limite ai tentativi
  come il login.
- `fonte_autenticazione` riscritta con `InAttesa` e la fonte «dispositivo»; `require_auth` valida
  contro i due archivi (dispositivo + progetto).
- `check_rotte_preauth.sh`: le due rotte entrano nella lista bianca, dichiarate.
- Log all'avvio, finché in attesa: `codice di abbinamento: XXXX-XXXX-XXXX-XXXX`.

### B — l'IDE locale: «Connetti» verso un pannello in attesa

- Se il target risponde `abbinamento_richiesto`, il pannello di «Connetti» chiede **codice + utente e
  password del primo Admin**, chiama `rivendica` sul target (via `remote.rs`) e prosegue collegato.
- La SPA servita dal pannello stesso (pagina locale): al posto del login, se in attesa, mostra il
  codice grande e lo stesso modulo di rivendica.

### C — dove compare il codice

- **Installer** (`install-container.sh`): a servizio partito aspetta `/health` e stampa il codice
  letto da `GET /api/abbinamento` su localhost, con due righe su cosa farne.
- **LVGL**: una schermata «Abbina questo pannello» col codice quando `/api/abbinamento` dice in
  attesa, al posto della pagina; sparisce da sola ad abbinamento fatto.

### D — il cloud: abbinare attraverso il tunnel

- **Indirizzo del gateway nell'immagine** (decisione 13): `SWS_TUNNEL_URL` predefinito
  `wss://tunnel.soligo.net/tunnel/v1`, modificabile, e spegnibile (`SWS_TUNNEL_URL=` vuoto) per chi
  non vuole un pannello che chiama fuori. Nome e token non si scrivono più a mano.
- Un pannello **in attesa** si collega presentando codice, identità hardware e nome proposto
  (l'hostname). Il gateway lo tiene in un registro **in memoria** «in attesa», per codice; non lo
  elenca a nessuno.
- IDE cloud, Dispositivi → **«Abbina pannello»**: codice, nome, utente e password del primo Admin. Il
  container del progetto chiama `POST <gateway>/api/pannelli/abbina` con la sua chiave di ritorno
  (azienda = quella del progetto). Il gateway:
  1. trova il pannello in attesa per codice;
  2. cerca l'identità hardware nella tabella **`pannelli`** di `identita.db` (`hw`, `nome`, `azienda`,
     `stato` attivo/sospeso/bandito, `abbinato_ms`, `ultimo_ms`): stessa azienda → **stessa riga**
     (riconosciuto dopo un reset); azienda diversa e attivo → rifiuto, serve l'amministratore della
     piattaforma; bandito → rifiuto, prima di tutto il resto;
  3. calcola il token `HMAC(segreto del gateway, "pannello:" + hw)` — ripetibile, non memorizzato;
  4. attraverso il tunnel in attesa chiama `rivendica` sul pannello passandogli anche token e nome;
     il pannello li salva e si ricollega da abbinato.
- Ingresso nel tunnel: prima `pannelli.yaml` (compatibilità, `tc620-casa`), poi la tabella; il
  bandito è rifiutato **prima** del token.
- Console della piattaforma: elenco dei pannelli con stato, e il ban. Minimo indispensabile.

## Compatibilità — da dire prima di partire

**Un pannello già in servizio senza utenti, aggiornato, si chiude finché non lo si abbina.** È il
punto della scelta CRA, non un effetto collaterale: oggi quel pannello è aperto a chiunque in LAN.
Mostrerà il codice; dall'IDE locale si fa «Connetti», si inserisce il codice e si fissa l'Admin, una
volta. Va in `NOVITA.yaml` e nella sezione «⚠ Compatibilità» del CHANGELOG, e l'installer lo dice.
Un pannello con `users.yaml` nel progetto **non** si chiude: è già «abbinato» di fatto, e il codice
serve solo per il cloud.

`tc620-casa` (dichiarato a mano) continua a funzionare: `pannelli.yaml` resta letto.

## Ordine e misura

A+B in una sessione (tutto locale, si prova col runtime di sviluppo e poi sul TC620), C nella
successiva, D dopo. Ogni fetta chiude con la definition of done; il merge lo decide il maintainer.

## Verifica

- Rust: codice (formato, alfabeto, normalizzazione, 80 bit), stati e `fonte_autenticazione`, rivendica
  (codice giusto/sbagliato/già usato, limite tentativi), Admin del dispositivo che sopravvive a un
  deploy, rotte pre-auth; gateway: token HMAC, riconoscimento dopo reset, rifiuti (altra azienda,
  bandito prima del token).
- vitest: «Connetti» verso un pannello in attesa, pagina locale col codice.
- Dal vivo: runtime locale senza utenti → chiuso, codice nel log → rivendica dall'IDE locale; TC620 di
  casa (config abbinamento rimossa per simulare un pannello nuovo) → codice su LVGL e pagina →
  abbinamento dall'IDE cloud → tag dal vivo; reinstallazione → riconosciuto sulla stessa riga.

## Da decidere strada facendo (non bloccanti)

- Il gesto per rigenerare il codice (fetta A/B).
- Se `X-Forwarded`/loopback possano mai far passare per «locale» una richiesta dal tunnel: nel
  disegno non conta, perché nessuna rotta si fida dell'origine — tutto passa da credenziali.

## Fetta E — dal cloud senza utente: gli utenti arrivano col primo progetto (11-10-2026, sera)

Dopo il collaudo sul TC620 il maintainer preferisce che l'abbinamento dal cloud **non** crei l'utente: gli utenti
arrivano col primo progetto distribuito. Scelte (11-10-2026):

| Domanda | Scelta |
|---|---|
| Come entra l'IDE nel cloud in un pannello abbinato senza utenti | **fiducia del gateway solo fino al primo deploy**: le richieste inoltrate nel tunnel portano `X-SWS-Dal-Gateway = HMAC(token del pannello, "dal-gateway")` e valgono da Admin finché il pannello non ha utenti; dopo, credenziali del progetto anche dal cloud |
| Primo deploy di un progetto senza utenti | **bloccato** (428 `serve-admin`) finché il progetto non porta almeno un Admin, con pulsante verso la scheda Utenti |
| Dopo l'abbinamento | **riepilogo del pannello** (nome, azienda, seriale, versione, progetto) e **Rinomina** (gateway + pannello, senza riabbinare) |
| In LAN | invariato: codice + credenziali |

Fra abbinamento e primo progetto il pannello resta chiuso in LAN; pagina locale e LVGL mostrano «abbinato al cloud
come …, in attesa del primo progetto». La firma il gateway la toglie da tutto ciò che arriva da fuori e la mette
solo verso un pannello abbinato, dopo i controlli di sempre. `POST /api/abbinamento/nome` sul pannello (la
Rinomina) la vuole sempre: è l'unico che conosce il token.
