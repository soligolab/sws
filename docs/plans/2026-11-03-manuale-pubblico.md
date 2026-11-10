# Il manuale su `sws.soligo.net/manuale/`, con le letture contate e un menù Aiuto nell'IDE

> Richiesta del maintainer, 03-11-2026: «integrare il manuale direttamente su sws.soligo.net sia come link nella
> pagina principale, credo possa essere utile vederla anche prima del login, sarebbe interessante però raccogliere
> statistiche di quanti la leggono e proteggerla dai BOT. Poi la stessa documentazione dovrebbe essere sempre
> accessibile dall'IDE tramite un menù di help».
>
> **Stato: piano d'esecuzione, sessioni M1–M5 della [serie coordinata](README.md#-la-serie-coordinata-del-04-11-2026--lordine-delle-sessioni).**
> Decisioni del 03-11 e del 04-11 qui sotto; misura del codice del 04-11 in `tmp/piani-misure/manuale.md` (solo su
> theobroma). La condizione d'avvio di prima («quando la catena `docs/manuale-tutorial` è mergiata») è soddisfatta:
> mergiata in `54b812ae` il 03-11.

## Le decisioni

**03-11-2026**

| Domanda | Scelta |
|---|---|
| Da dove si serve | **un sito statico a parte sul VPS**, non dentro il runtime. Si aggiorna senza rilasciare SWS; l'IDE di un cliente senza internet non lo raggiunge, ed è accettato |
| Indirizzo | **`sws.soligo.net/manuale/`**: Traefik manda quel prefisso al container statico, il resto al gateway. Stessa origine, niente DNS nuovo, niente CORS per il contatore |
| Cosa si pubblica | **solo i capitoli per chi usa SWS**: fuori 03 architettura, 13 API, 14 test (e quello che M1 trova di analogo) |
| Quando si aggiorna | **a ogni release**, dallo stesso giro che costruisce e spinge le immagini |
| Bot | **niente crawler IA e niente scaricamento in massa** (non è chiesto il «non indicizzato») |
| Statistiche | **un contatore nel gateway, visto dalla console**: letture per capitolo e per giorno, visitatori distinti con un hash che cambia ogni giorno, niente cookie, niente IP salvati |

**04-11-2026**: **«Sito e VPS subito, testi alla fine».** M1 e M2 vengono presto nella serie, perché toccano solo
`scripts/` e `deploy/vps/`; i testi e le schermate (M5) per ultimi, quando la Finestra di avviso, l'impostazione iniziale
e la Logica hanno cambiato l'interfaccia. Il sito si rigenera a ogni release, quindi pubblicarlo prima non costa niente.

## La misura (04-11-2026)

**`docs/manual/`**: 30 file, 398 KB di testo, 48 PNG (3,5 MB).
- **`MAIN.md` non indicizza il tutorial** (zero rimandi ai capitoli T); **`T11_pannello.md:1` e `:98` puntano a
  `T12_cloud.md`, che non esiste.**
- Parti per sviluppatori anche in capitoli pubblici: 01 §Stack (165), 02 §«Per chi sviluppa SWS» (105-119), 10 build del
  tarball e Yocto (18-42, 143-212), 11 §«Pacchetto Runtime» (26-72, scheda `devpackage` che c'è solo da checkout), 15
  (42, §5), 16 §«Rifare la misura» (72-83), 18 (19 riferimenti al codice).
- Link che sul sito non funzionerebbero: **14** verso file del repo, **14** verso i capitoli esclusi (4 nelle barre
  «← →», che si spezzano), **31** con àncora nello stile di GitHub (5 con lettere accentate, una da un titolo con emoji),
  2 a GitHub. Il 18 ha 8 diagrammi Mermaid.
- Nome e licenza in testa: `MAIN.md:3` dice «Soligo Web SCADA», il marchio «SWS — SCADA Web Studio»; `MAIN.md:5` e
  `01:199-204` dicono AGPL-3.0, e il seme `2026-10-29-licenza-del-software.md` la vuole cambiare.
- Schermate: le 11 di `screenshots/` sono del 20-09 (prima dello stile VS Code), 5 citate e 6 no; le 37 del tutorial
  sono del 03-11, **e gli script che le hanno scattate non esistono più** (`tmp/tutorial/` sparita, niente nel repo).
  `e2e/screenshots.spec.ts` scrive tre file che la cartella non ha.
- **L'IA descritta è quella di prima del 04-11**: 04:72 (le voci della chat nel ☰), 04:38-41 (le tredici icone), 04:247-254
  (manca il ramo IA, e anche Report, Telefono, Eventi, Certificati, Prestazioni), 15:99. Nessun capitolo per chi usa SWS
  descrive l'assistente (c'è solo HOWTO §7).

**Il VPS** (`deploy/vps/`): Traefik legge `dynamic/` a caldo (`watch: true`), nessun middleware definito, un solo
router `Host(sws.soligo.net)` → `sws-gateway:8444`; un router `Host && PathPrefix(/manuale/)` vince per lunghezza della
regola. `accessLog` nel journal (12 mesi). `check_quadlet.sh` non guarda i quadlet del VPS. Nessuno script del rilascio
parla col VPS.

**Tre fatti che il piano del 03-11 non diceva:**
1. **Traefik non vede l'indirizzo vero**: per lui ogni visitatore è `10.89.0.89` (seme
   `2026-10-18-indirizzo-vero-dietro-traefik.md`). Un limite per IP diventa un limite per tutti; l'hash
   (IP + user-agent + sale) conta gli user-agent; il gateway oggi non conta gli indirizzi privati (`limiti.rs:195-230`).
2. **`robots.txt` vale solo alla radice** (RFC 9309): sotto `/manuale/` non lo legge nessuno. Serve una rotta per
   `/robots.txt`.
3. **Il service worker dell'IDE** (`public/registra-sw.js`, portata `/`) intercetta ogni GET che non è `/api/`, `/ws/` o
   `/schermo/` (`sw.js:28-49`): `/manuale/` va escluso.

**L'informativa privacy** (`docs/legale/informativa-privacy.md`, bozza del 29-10): parla a chi si registra, non a chi
legge senza account; non ha una finalità di statistica; è compilata nel binario (`registrazione.rs:270-271`) e `/privacy`
si serve solo a registrazione aperta — **oggi su sws.soligo.net risponde 404**.

**Il lato IDE**: `LoginScreen.tsx` lo usano anche il viewer del pannello e la console (un link messo lì compare dovunque;
`identitaStato()` dice già `gateway` e `gestita`). La testata `App.tsx:859-1018` è la stessa nei due stili. Prima del
login si servono solo i campi del marchio in `CAMPI_PUBBLICI` (`marchi.rs:96-106`). Il tasto `?` apre già `ShortcutHelp`.

## Le sessioni

**M1 — `feat/manuale-sito`: il sito, in locale.**
- `scripts/manuale/genera_sito.sh` con l'elenco dichiarato dei capitoli in `scripts/manuale/capitoli_pubblici.txt`.
- Il generatore (vedi decisioni): navigazione rifatta senza 03, 13 e 14; àncore come quelle di GitHub (`pymdownx.slugs`
  o equivalente); Mermaid.
- I link verso capitoli esclusi e file del repo diventano testo o puntano al repo; `scripts/check_manuale_sito.sh`
  fallisce su un link rotto nel sito generato.
- Testo, solo quello che il sito romperebbe o che descrive una cosa già in `main`: l'indice della Parte II in
  `MAIN.md`, il link a T12, il nome in testa, la parte IA del 04 (72, 38-41, 247-254) e 15:99.
- Il risultato in `sws/tmp/manuale-sito/`, da aprire.

**M2 — `feat/manuale-vps`: sul VPS, protetto.**
- `deploy/vps/quadlet/sws-manuale.container` (server statico, sola lettura su `~/sws-vps/manuale/`) e
  `deploy/vps/traefik/dynamic/sws-manuale.yml` con i router `PathPrefix(/manuale/)` **e** `Path(/robots.txt)`.
- Blocco degli user-agent dei crawler IA (GPTBot, ClaudeBot, CCBot, Google-Extended, Bytespider, PerplexityBot,
  Amazonbot, …) → 403; `robots.txt` che li nomina.
- Il limite di richieste: vedi decisioni (dipende dall'indirizzo vero).
- `/manuale/` escluso da `sw.js`.
- `scripts/manuale/pubblica.sh` (genera e copia via `scp`), **a sé e non dentro `build_containers_all.sh`**; citato in
  HOWTO §5 e in `deploy/vps/STATO.md`, nello stesso giro SSH che aggiorna il gateway. README del VPS aggiornato.
- Prova: `sws.soligo.net/manuale/` si legge da telefono; `curl -A GPTBot` riceve 403.

**M3 — `feat/manuale-letture`: le letture nella console.**
- Rotta aperta `POST /api/manuale/letto {capitolo}` nel gruppo `open` di `router.rs` (dove c'è `/condizioni`), nella
  lista bianca di `check_rotte_preauth.sh` col motivo; chiamata da uno script nelle pagine del sito; scarta gli
  user-agent dei bot.
- Si salva solo giorno, capitolo, hash di (indirizzo + user-agent + sale del giorno); il sale si butta a fine giornata.
- Una sezione della console, solo per l'amministratore della piattaforma (`rotte_di_piattaforma`,
  `amministrazione.rs:783-808`): capitolo × letture × visitatori distinti negli ultimi 30 giorni.
- Solo dove il sito è servito: un pannello o un IDE da cliente non conta niente.
- La nota sulla privacy (vedi decisioni).
- **Immagine** del gateway.

**M4 — `feat/manuale-aiuto`: il link prima del login e il menù Aiuto.**
- Un link «Manuale» in `LoginScreen.tsx`.
- Un menù **Aiuto** nella testata comune (vedi decisioni) con «Manuale» (scheda nuova) e «Scorciatoie» (`ShortcutHelp`).
- L'indirizzo dal marchio: un campo in `brand.json` aggiunto a `CAMPI_PUBBLICI`, col valore di oggi come predefinito.
- Testi it/en, CHANGELOG, NOVITA. CasaDomotica: non si applica (è un sinottico); annotato.
- **Immagine.**

**M5 — `docs/manuale-giro-finale`: testi e schermate.**
- Gli script di scatto delle schermate **nel repo** (sono andati persi una volta); le 11 vecchie e quelle del tutorial
  toccate dalla serie rifatte.
- I capitoli toccati dalla serie: pop-up (T10:52-61, T11:75, T02:88, 04:556-562, 04:70, 04:717, 04:479), impostazione
  iniziale (T02:45-94, 04:431-460, 04:514, 04:532-548, 05:224-229, T08:26-30), Logica (04:40, 04:141, 04:223-226,
  04:250-260, 04:756-769, 05:164, 05:882-898, 07:369-373, 09:219-230, 15:191-193), più un capitolo sulla Logica coi modelli
  di L3 e una sezione sull'assistente IA.
- Le regole dei template (T1, 04-11): il tutorial T09–T11 è stato eseguito con `openplc-laboratorio` quando la pompa
  chiedeva Operator; ora Marcia / Arresto si comanda da Viewer e solo la soglia della finestra Parametri resta a
  Supervisor. La tabella delle voci per template in 15:150-165 è del 20-10. Le pagine dei template hanno le cornici, e
  i nomi delle pagine sono token: 04:465-466 dice che il nome della pagina non si traduce e cita `tc620-sistema` come
  esempio del titolo tenuto sulla pagina, e dal 04-11 è il contrario.
- **I tutorial che mancano** (dal [manuale rifatto](../archive/2026-10-19-manuale-rifatto.md), archiviato il 05-11-2026):
  T12 il pannello dal cloud (abbinamento, tunnel, deploy remoto; `T11_pannello.md:1` e `:98` lo citano già come
  `T12_cloud.md`), T13 aggiornare il pannello, T14 facoltativo (EtherNet/IP: OpenPLC v4 non ce l'ha, va fatto in un altro
  modo o tolto). Come T01–T11: ogni passo eseguito davvero contro il laboratorio e fotografato.
- I timbri di data in testa ai capitoli.
- Il piano si archivia.

## Da decidere all'inizio di ogni sessione

La proposta vale se il maintainer non dice altro.

**M1**
1. Il generatore: *proposta: mkdocs-material in podman, a versione fissa* (navigazione, ricerca, telefono e Mermaid già
   fatti; su theobroma c'è mkdocs 1.4.2 senza il tema). L'alternativa è uno script Python con `markdown`.
2. Le parti per sviluppatori di 01, 02, 10, 11, 16 e 18: *proposta: restano, con un riquadro «per chi sviluppa SWS»;
   via solo il §«Pacchetto Runtime» del capitolo 11, che senza checkout non si vede.*
3. I link a file del repo: *proposta: diventano testo* (il repo non è pubblico).
4. Il nome in testa: *proposta: «SWS — SCADA Web Studio», come il marchio.*

**M2**
1. Il limite per indirizzo: *proposta: si fa prima l'indirizzo vero dietro Traefik* (il seme del 18-10, un pezzo di
   configurazione di Traefik e di podman); se non sta nella sessione, un limite per user-agent e il resto nel seme
   [indirizzo vero dietro Traefik](semi/2026-10-18-indirizzo-vero-dietro-traefik.md).
2. Il server statico: *proposta: nginx a versione fissa.*

**M3**
1. Dove si salvano le letture: *proposta: un file SQLite a parte nel gateway* (`identita.db` resta delle identità), per
   400 giorni.
2. La privacy: *proposta: una pagina «Cosa contiamo» sul sito del manuale*, e la frase nell'informativa al primo rilascio
   con la registrazione aperta.

**M4**
1. Il link «Manuale» anche nel login del pannello? *Proposta: no; solo sul gateway e nell'IDE* (`identitaStato()` lo dice
   già).
2. Dove sta il menù Aiuto: *proposta: un «?» nella testata comune (`App.tsx`, accanto a `UserMenu`), uguale nei due
   stili.*
3. L'aiuto porta al capitolo della scheda aperta? *Proposta: sì per le schede che hanno un capitolo (Allarmi → 07,
   Storico → 08, …), una tabella in un file.*

**M5**
1. Le schermate: *proposta: stile VS Code; si aspetta lo stile sobrio solo se è già deciso.*
2. T12–T14 e il ramo 4 del [manuale rifatto](../archive/2026-10-19-manuale-rifatto.md): **deciso il 05-11-2026: entrano qui**, e quel
   piano è già archiviato.

## Cosa non fa questo piano
- Non traduce il manuale in inglese.
- Non mette il manuale dentro l'immagine: senza internet il menù Aiuto non apre niente. Se un giorno servisse offline,
  è un seme a parte.
