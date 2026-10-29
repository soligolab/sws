# Aprire sws.soligo.net a utenti esterni

> **Piano d'esecuzione**, approvato il 26-10-2026. È il dettaglio della **Fase 5** del piano
> cloud [il tronco cloud](2026-10-05-cloud-utenti-aziende-spazi.md) — registrazione, posta,
> accesso — più una fase di interfaccia che quel piano non aveva.
>
> Le misure qui dentro sono del **26-10-2026**, lette dal codice da tre esplorazioni parallele.

## Contesto

Il maintainer vuole far provare SWS a persone esterne su `sws.soligo.net`, per avere un parere.
Oggi non si può: gli utenti li crea solo un amministratore, non esiste registrazione, e le due
schermate che un nuovo arrivato vede per prime — accesso e scelta del progetto — sono le più
trascurate del prodotto.

Richiesta del 26-10-2026, con le scelte fatte nelle domande:

- accesso con **PIN monouso via e-mail**, **in aggiunta** alla password (non al posto): si sceglie;
- **registrazione libera con verifica** dell'indirizzo;
- **«ricordami» 30 giorni** su quel browser;
- chi entra vede **l'IDE**, lavora da solo, **vede solo i suoi progetti**, **tre a testa**;
- **non** può: aprire la console, vedere i pannelli altrui, toccare le impostazioni
  d'istanza, invitare altre persone;
- **marchio standard SWS** di default; l'admin gliene assegna un altro dopo;
- può **abbinare un pannello Pixsys** con la procedura di installazione;
- schermate di accesso e scelta progetto **moderne, responsive**, icone vere, testi non tagliati,
  **anteprima della prima pagina**, «chiara e ariosa come l'IDE di oggi»;
- posta in uscita: **Infomaniak**, `mail.infomaniak.com:587`, **personalizzabile per azienda**.

## Quello che già esiste (misurato il 26-10-2026)

Tre esplorazioni hanno letto il codice. La maggior parte del lavoro è già fatta, e in due punti il
piano cloud di ottobre è **superato dai fatti**:

| cosa | stato |
|---|---|
| **SMTP d'installazione** | **esiste già**: `<config_dir>/smtp.yaml`, `leggi_smtp`/`scrivi_posta`/`prova_posta` in `sws-web/src/amministrazione.rs:588-700`, pagina console `sws-editor/src/console/Posta.tsx`. Il piano cloud lo dava come «pezzo nuovo»: non lo è più. |
| **porta 25 in uscita sul VPS** | il piano cloud (decisione 39) la dava **bloccata**. Misurato il 26-10: **25, 587 e 465 sono tutte aperte**. Con Infomaniak su 587 non cambia niente, ma la decisione 39 va corretta. |
| **isolamento per azienda** | una regola sola, `visibilita` (`sws-web/src/projects.rs:913`), usata da elenco progetti, apertura progetto e permesso sui pannelli (`tunnel/gateway.rs:304 puo_parlargli`). |
| **marchio per azienda** | colonna `aziende.marchio`; `GET /api/identita/marchio` (`router.rs:1944`); se è NULL si ricade sul marchio d'installazione, che su `sws.soligo.net` è lo standard SWS. **Niente da costruire.** |
| **abbinamento pannello dal cloud** | funziona **senza amministratore**: `AbbinaPannelloCloud.tsx` → `POST /api/remote/abbina-cloud` → il gateway ricava l'azienda **dalla chiave di ritorno del container**, non dal corpo (`tunnel/gateway.rs:578-590`). **Niente da costruire**, a una condizione: il progetto deve stare in un'azienda vera. |
| **console confinata** | `require_console` (`router.rs:2494`) ammette l'amministratore di piattaforma e chi amministra un'azienda. Un `Sviluppatore` non entra. Le sezioni di sola piattaforma non compaiono (`Console.tsx:31-35`). |
| **codici monouso** | `abbinamento.rs:57 genera_codice()` (Crockford base32, 80 bit, `/dev/urandom`) + `normalizza()`; `telefono.rs:163 gettone_nuovo`/`:179 usa_gettone` (monouso, scadenza 1h); `router.rs:2151 confronto_costante`. |
| **blocco per tentativi** | 5 tentativi / 5 minuti **per e-mail** (`sws-identita/src/lib.rs:232-233`). |

E quello che **manca o è in rotta di collisione**:

1. **Non esiste registrazione.** Gli utenti nascono solo da `POST /api/amministrazione/utenti` o
   dal codice di primo accesso.
2. **Un utente senza azienda ha un'esperienza rotta, non vuota.** `create_project`
   (`projects.rs:935`) **non controlla nessuna appartenenza**: crea il progetto nella radice, e
   `visibilita` poi lo nasconde al suo stesso autore. È il primo gesto di un curioso.
3. **L'azienda implicita è una sola, condivisa.** Metterci gli esterni li farebbe vedere tutti fra
   loro, e il suo tetto sui progetti aperti è **codificato a `None`** (`gateway/rotte.rs:82-84`).
4. **Nessun limite di memoria o CPU sui container** (`gateway/progetti.rs:390-456`): niente
   `memory`, `cpu`, `pids` nella spec passata a podman. Il VPS ha 2 vCore e 3,7 GiB.
5. **Non esiste una quota «quanti progetti in tutto»**: ci sono `max_byte` e
   `max_progetti_aperti`. Attenzione: `max_progetti` è un nome **bruciato**, la migrazione v3 lo
   rinomina in `max_progetti_aperti` (`sws-identita/src/lib.rs:451-467`).
6. **Nessun utente senza password è rappresentabile**: `hash_password TEXT NOT NULL`. Non è un
   problema — il PIN è **in aggiunta**, la password resta.
7. **La sessione dura 8 ore scorrevoli** (`DURATA_SESSIONE`, `lib.rs:235`), uguale per tutti: la
   tabella `sessioni` non ha una colonna di durata.
8. **Le due schermate non usano niente di condiviso**: «SWS» è cablato in tre punti, le icone sono
   **emoji letterali** (`📁` a `WelcomeScreen.tsx:1508` e `:1551`), le larghezze sono in pixel
   fissi, e in tutto `src/` c'è **una sola `@media`** (ed è `prefers-reduced-motion`).

## La decisione centrale: un'azienda a testa

Tutto quello che il maintainer chiede — vedere solo i propri progetti, tre a testa, marchio
assegnabile dall'admin, abbinare un pannello, niente console, niente inviti — **il modello per
azienda lo fa già**. Non serve un concetto nuovo di «proprietario del progetto»: serve che chi si
registra nasca con **un'azienda sua, di cui è `Sviluppatore`**.

Questo è il cardine del piano. Tutto il resto è conseguenza.

- *vede solo i suoi progetti* → è solo nella sua azienda, `visibilita` fa già il resto;
- *niente console* → è `Sviluppatore`, non `Amministratore`: `require_console` lo rifiuta;
- *non invita nessuno* → `crea_utente` vuole che tu amministri un'azienda;
- *marchio* → `aziende.marchio` NULL ⇒ standard SWS; l'admin la cambia dalla console;
- *pannelli* → la chiave di ritorno del container porta la sua azienda, non la radice.

---

## Passo 0 — chiudere il ramo aperto — **sciolto il 28-10-2026**

`feat/accesso-lvgl-due-campi` era aperto e conteneva l'accesso LVGL a due campi, finito dentro il
commit `3269dd92`, che si chiamava `chore(vps)`. Il ramo **non esiste più** (`git branch -a`,
28-10-2026: restano solo `main` e il backup pre-riscrittura), e questo piano non è più bloccato da
niente.

---

## Ramo A — `feat/azienda-personale-e-tetti`

Backend puro, nessuna interfaccia. È il ramo che rende sicuro far entrare degli sconosciuti.

**1. Ogni utente nuovo nasce con la sua azienda.** In `sws-identita`, accanto a
`crea_azienda(nome)` (`lib.rs:1214`), una funzione che crea l'azienda con **cartella esplicita**
`u<id>` invece che derivata dal nome — due `mario@` di domini diversi non devono finire nella
stessa cartella. Nome dell'azienda: l'indirizzo e-mail, che è unico per costruzione. L'utente
entra in `membri` con ruolo `Sviluppatore`.

Chiamata dai due punti dove oggi nasce un utente (`amministrazione.rs:373` e il primo
amministratore) e dalla registrazione del ramo C. **Un'azienda senza amministratori è uno stato
nuovo**: da verificare che niente lo dia per impossibile. La promozione d'ufficio
(`assicura_amministratore_piattaforma`, `lib.rs:1131`) è **di piattaforma e globale**, esce subito
finché il maintainer esiste: non tocca questo caso.

**2. Colonna `personale INTEGER NOT NULL DEFAULT 0`** su `aziende`. Non riusare `implicita`: quella
è l'azienda singola condivisa e il codice la confronta in più punti. Serve solo alla console, per
non confondere venti curiosi con venti clienti — e per ritrovarli quando si assegna un marchio.

**3. Quota `max_progetti_totali INTEGER`** su `aziende`, stessa semantica delle altre
(`NULL` non limita, `0` non concede — `StatoQuota::frazione`, `projects.rs:1921-1933`). Applicata
in `create_project` accanto a `rifiuta_se_piena` (`projects.rs:1986`). Valore per un'azienda
personale: **3**. Mostrata nella console come le altre quote.

**4. Chiudere il buco di `create_project`.** Oggi non controlla l'appartenenza: va rifiutato
(coerentemente con `risolvi_progetto`, **404**, non 403) quando chi chiama non è membro
dell'azienda di destinazione e non è amministratore di piattaforma. Stessa coppia già usata
altrove: `appartenenze_di` (`projects.rs:698`) + `visibilita`.

**4-bis. Cancellare un progetto deve spegnere il suo container.** Difetto vero, costato un'ora
il 26-10-2026 e **verificato sul VPS**, non dedotto.

Il maintainer ha cancellato `CasaDomotica_WP630` e poi ci ha salvato sopra un altro progetto con
lo stesso nome. Da quel momento l'IDE rispondeva `500 — project parse error: reading
/progetto/project.yaml`. Sul disco `project.yaml` c'era, 18 KB, leggibile da tutti; **dentro il
container `ls /progetto` dava `total 0`**. Il mount di podman è legato all'**inode**: cancellata
la cartella, il container è rimasto attaccato a quella vecchia, e la nuova non la vede. Il
container era nato alle 11:12:40, la cartella ricreata alle 11:14.

La causa nel codice: `regia.chiudi()` è chiamata da **un solo punto in tutto il repo**, la
chiusura a mano della console (`amministrazione.rs:178`). `delete_project` (`projects.rs:935`)
non le parla. Vale anche per rinomina e «Salva come» sopra un nome esistente.

**E l'autospegnimento dei 20 minuti non ripara.** La condizione è `collegati == 0 && fermo da ≥
limite` (`gateway/progetti.rs:54`): ogni ricarica della pagina riapre un WebSocket, `collegati`
torna a 1 e il cronometro riparte. Più si riprova, meno si ripara — il container è rimasto in
piedi due ore.

Due correzioni:

- in `delete_project`, e sugli altri percorsi che tolgono o rimpiazzano una cartella, chiamare
  `regia.chiudi(&riferimento)` — la stessa che usa già la console;
- `format!("project parse error: {e}")` → `{e:#}` nei tre punti che lo scrivono
  (`projects.rs:1593`, `projects.rs:3209`, `router.rs:4568`). La catena persa nascondeva un «No
  such file or directory» che avrebbe chiuso la diagnosi in cinque secondi.

Sta nel ramo A e non in un `fix/` a parte perché è **esattamente** il gesto di un utente esterno:
cancellare il primo progetto di prova è fra le prime cose che si fanno. Oggi lascia il nome
inservibile, e l'unico rimedio passa dalla console di amministrazione, che a un utente esterno
non è data.

**5. Tetti sui container.** Nella spec podman di `gateway/progetti.rs:390-456` aggiungere
**memoria** e **pids**. Misura disponibile: 23-41 MB per container sul VPS, 86 MB RSS in debug;
256 MB è largo. Più un **tetto globale** di container accesi insieme
(`--gateway-max-container`, accanto a `--gateway-fermo-minuti`): `max_progetti_aperti` è per
azienda, e venti aziende da uno non si fermano a vicenda. Il tetto globale rifiuta, non spegne il
più vecchio — stessa scelta già fatta a `gateway/progetti.rs:9-13`.

Il `None` codificato per l'azienda implicita (`gateway/rotte.rs:82-84`) resta: lì ci sono i
progetti del maintainer. Con un'azienda a testa, nessun esterno ci finisce.

**Non si fa qui**: `max_pannelli` resta un dato mostrato e non applicato — è una decisione già
rimandata (`docs/plans/2026-10-21-quando-si-libera-una-licenza.md`).

---

## Ramo B — `feat/schermate-accesso-e-progetti`

Solo frontend. Va **prima** della registrazione, così le schermate nuove del ramo C nascono già
nello stile giusto invece di essere rifatte due volte.

File: `sws-editor/src/components/LoginScreen.tsx` (197 righe),
`sws-editor/src/components/WelcomeScreen.tsx` (1673 righe, sei componenti),
`sws-editor/src/components/schermataAccesso.ts`.

**1. Un posto solo per le primitive.** Oggi ci sono tre sistemi di stile (`config/comuni.tsx`,
`console/stile.ts`, e le costanti locali di queste due schermate) e **nessuno dei tre** è usato
qui. Nuovo `sws-editor/src/ui/base.ts` con `scheda`, `pulsante`, `campo`, `etichetta`, costruiti
**sui token `--brand-*`** — che è ciò che nessuno dei tre fa del tutto (`S.btn("primary")` ha
l'esadecimale cablato). Dichiarato come il posto in cui gli altri convergeranno, non come un
quarto binario.

**2. Il troncamento e il responsive si risolvono insieme.** La causa è
`width: 158` fisso (`WelcomeScreen.tsx:1487`) più `textOverflow: ellipsis`. Sostituire il
`flex-wrap` con `display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr))` —
la forma già usata in `EditorShell.tsx:98-103` e `CatalogoDispositiviModal.tsx:151`. Il nome su
due righe (`-webkit-line-clamp: 2`), e `title={p.name}`, non `p.path` come oggi.

Poi: `schedaModulo(320)` prende un `maxWidth` (sotto i 360 px di finestra oggi sfora); la colonna
fissa `1080`/`480` (`:1275`) diventa fluida; `BarraIdentita.tsx:99-120` perde l'accoppiamento a
mano fra `height: 44` e `margin: -32px`.

**3. Icone vere.** Nuovo `sws-editor/src/ui/iconeInterfaccia.ts`, stessa forma di
`editor/iconeStrumenti.ts` (39 icone, `viewBox 24×24`, `currentColor`, estremi arrotondati) e
stesso renderer di `IconaStrumento.tsx`. **Modulo separato, non si aggiunge a `ICONE_STRUMENTI`**:
`scripts/check_icone_strumenti.sh` accoppia quel modulo alla palette e direbbe «icona senza voce
nella palette». Servono: cartella/progetto, griglia, lista, archivio, pacchetto, matita, duplica,
caricamento, avviso, più, conferma, chiudi. Spariscono le 14 emoji, compresa quella dentro
`welcome.openFromZip` nel catalogo i18n.

**4. Il marchio si vede.** `<BrandLogo/>` (`components/BrandLogo.tsx`, oggi usato in **un solo
punto**, `App.tsx:860` — era `:831` il 26-10, la riga si sposta) al posto dello «SWS» cablato in `WelcomeScreen.tsx:1278` e
`LoginScreen.tsx:112-113`. Via anche il nome vecchio «Soligo Web SCADA», che il brand ufficiale
chiama `"SWS — SCADA Web Studio"`. Prima dell'accesso vale `active.json` (standard SWS); dopo,
`useMarchioDellAzienda()` ha già rimesso quello dell'azienda — cioè il requisito del marchio è
soddisfatto senza una riga di backend.

**5. Occasione da non sprecare: i selettori e2e.** `e2e/editor.spec.ts:40-50` cerca un
`button` di nome «Apri» che **oggi non esiste già più** (è un `div`, e in vista griglia non c'è
affatto) e fallisce in silenzio per via del `.catch(() => false)`. Mettere `role="button"` sulla
card e rendere veri quei due helper. Conservare invece `input[autocomplete="username"]`,
`current-password` e il pulsante `/Accedi|Log ?in/i` del login, che i test usano davvero.

**6. Spezzare il file.** 1673 righe e sei componenti: i quattro modali escono in file propri.
Questo serve anche al piano vivo `docs/plans/2026-09-22-riorganizzare-i-file-dell-editor.md`, che
va aggiornato di conseguenza. Attenzione: `tests/raggruppaProgetti.test.ts` importa `raggruppa` e
`titoloGruppo` **da `@/components/WelcomeScreen`** — se si spostano, si aggiorna l'import.

**8. La versione del runtime si vede — ma solo dopo il login** (richiesta del maintainer,
28-10-2026: «sarebbe comodo vedere sia nella finestra di login sia una volta aperto il progetto, la
versione del runtime in uso»).

Misurato lo stesso giorno, e costa pochissimo perché **il dato è già in mano a tutti e due i
posti**:

- **A progetto aperto non serve niente di nuovo.** `GET /api/system` torna già `runtime_version`,
  e `components/RuntimeCtrl.tsx` la mette già in uno stato suo (`setRuntimeVersion`) che poi
  **nessuno disegna**. È solo da mostrare — accanto al `<BrandLogo/>` in testata, o nel menu ☰.
- **Nella scelta del progetto** (`WelcomeScreen`) la pagina è già autenticata, quindi `/api/system`
  si può chiedere come altrove. È il primo posto in cui si arriva dopo il login, ed è lì che
  «quale versione sto usando» viene in mente.
- **Nella schermata di accesso NON si mette** — scelta del maintainer, stesso giorno. Tecnicamente
  sarebbe stato il più economico dei tre (un campo in più in `GET /api/identita/stato`, che è già
  pre-auth, è già la prima cosa che il frontend chiede, e il cui commento in `router.rs` dice
  «una rotta in più sarebbe un secondo viaggio per un booleano»), e **proprio per questo vale la
  pena scrivere perché non si fa**: la versione esatta prima del login la dice anche a chi non è
  entrato, cioè a chi vuole sapere quali difetti noti provare. Su un'istanza aperta a esterni —
  che è il punto di tutto questo piano — è un regalo gratuito. Se un giorno servisse comunque, la
  via di mezzo è dire solo la minore (`2.23`) prima del login e la patch dopo.

**7. Guardie.** `check_i18n_ui.sh` ha **tolleranza zero**: ogni stringa italiana fuori da `t()` è
un errore. Ogni testo nuovo va in `it.json` **e** `en.json` (`check_i18n_parita.sh`).

**Proposta, da decidere**: `scripts/check_contrasto.sh` oggi misura solo l'IDE **a progetto
aperto** (`contrasto_measure.mjs:9`), quindi queste due schermate non sono mai state misurate. Un
secondo `goto` senza progetto le porterebbe dentro la rete WCAG. Il punto a rischio è
`--brand-text-subtle` su `--brand-surface` in tema chiaro.

---

## Ramo C — `feat/registrazione-e-pin`

**1. Il blocco che emette una sessione si estrae.** `Identita::accedi` (`lib.rs:581`) è oggi
l'**unica** cosa che produce un `Accesso`, e lo fa nel blocco `lib.rs:638-654`. Si estrae in
`emetti_accesso(utente_id, durata) -> Accesso`, e lo chiamano sia la password sia il PIN. È il
refactor chiave, ed è piccolo.

**2. Durata della sessione per sessione.** `sessioni` prende `durata_ms INTEGER` (NULL = le 8 ore
di `DURATA_SESSIONE`). Il rinnovo scorrevole in `valida` (`lib.rs:691`, rinnovo a `:734`) usa il
valore della riga invece della costante. «Ricordami su questo browser» ⇒ **30 giorni**.
`POST /api/auth/refresh` passa da `sws-auth`, non da `identita`: non si tocca.

**3. Quattro rotte nuove, tutte pre-auth.** Vanno **dichiarate con il loro motivo** in
`scripts/check_rotte_preauth.sh:93-107`, che oggi elenca esattamente 13 percorsi e diventa rossa
appena ne compare un quattordicesimo non dichiarato.

| rotta | cosa fa |
|---|---|
| `POST /api/identita/registrazione` | e-mail + password (≥8, come `crea_utente`) + accettazione termini → utente **non attivo** + azienda personale + codice di verifica via e-mail |
| `POST /api/identita/registrazione/conferma` | il codice → l'utente diventa attivo |
| `POST /api/auth/pin` | «mandami un PIN». Risponde **sempre 200**, esista o no l'indirizzo: altrimenti dice a chiunque chi è iscritto |
| `POST /api/auth/pin/accesso` | e-mail + PIN + `ricordami` → `Accesso` |

**Materiale da riusare, non da reinventare**: `genera_codice()` e `normalizza()` di
`abbinamento.rs:57,80` per il codice (Crockford, niente lettere ambigue) — **tagliato a 8 simboli**,
40 bit, mostrato in due gruppi di quattro: con scadenza a 10 minuti e il blocco a 5 tentativi è
abbondante, e 80 bit da ribattere a mano non li vuole nessuno; `gettone_nuovo`/`usa_gettone` di
`telefono.rs:163,179` per la conservazione monouso (in memoria: un riavvio del gateway invalida i
PIN in volo, accettabile su una finestra di 10 minuti, e si risparmia una tabella);
`confronto_costante` (`router.rs:2151`) per il confronto; il blocco a 5 tentativi / 5 minuti per
e-mail, **esteso anche alla via del PIN**, altrimenti il PIN si prova a forza bruta.

**4. SMTP per azienda.** Sei colonne su `aziende` — `smtp_host`, `smtp_porta`, `smtp_da`,
`smtp_utente`, `smtp_password`, `smtp_starttls` — che rispecchiano `SmtpConfig`
(`sws-core/src/project.rs:1507-1521`). Si modificano dalla scheda dell'azienda nella console.

Chi manda cosa, deciso il 26-10:

- **PIN e verifica della registrazione: sempre l'SMTP d'installazione.** Quando arriva la
  richiesta si conosce solo l'indirizzo, e cercare a quale azienda appartiene **prima** di far
  entrare qualcuno direbbe a chi prova indirizzi a caso quali sono iscritti e dove.
- **La posta dell'azienda** (inviti, allarmi, report dal cloud): la sua, con ripiego su quella
  d'installazione.

**Un punto che attraversa il confine esistente**: oggi `amministrazione.rs:263-280` riserva alla
piattaforma stato, marchio e quote, e l'SMTP d'installazione è in `SOLO_PIATTAFORMA`
(`Console.tsx:31-35`). L'SMTP **dell'azienda** è affare suo: lo imposta **l'amministratore
d'azienda**. È l'unica cosa che sposta quel confine, quindi va spostata di proposito —
`scripts/check_amministrazione.sh` e il test del confine vanno aggiornati con una motivazione
scritta. La password si rilegge **mascherata**, come già fa `leggi_smtp`.

**5. Infomaniak sul VPS — ~~da fare~~ FATTO il 26-10-2026.** Il maintainer ha configurato la
posta dalla console lo stesso giorno in cui questo piano è stato scritto, e le e-mail partono.
`~/sws-vps/gateway-config/smtp.yaml`: `mail.infomaniak.com:587`, STARTTLS, mittente
`login@soligo.net`, utente `mauro@soligo.net`. Non in git, c'è dentro una password; registrato in
`deploy/vps/STATO.md`.

**Il prerequisito di DNS è soddisfatto**, misurato il 26-10: SPF `include:spf.infomaniak.ch -all`,
DKIM pubblicato (selettore `dkim`), DMARC `p=none` con rapporti a Cloudflare. Quindi quando si
scriverà il codice del PIN, il trasporto **esiste già e funziona**: non resta niente da costruire
sotto.

**Quello che resta da sapere, e non è codice**: che le e-mail arrivino è provato; **dove**
arrivano fuori dal dominio no. Una prova verso Gmail o Outlook dice se finiscono in Posta in
arrivo o nello spam, ed è lì che vivono gli utenti esterni. Da fare prima di aprire, non dopo:
una registrazione il cui codice finisce nello spam è una registrazione che non funziona, e chi
la subisce non lo segnala — se ne va.

**6. Termini e informativa privacy.** La registrazione libera raccoglie indirizzi di sconosciuti:
la decisione 17 del piano cloud li vuole già. Serve il testo — anche breve — prima di aprire.

> **Bozza scritta il 29-10-2026** dalle risposte del maintainer: [`docs/legale/`](../legale/LEGGIMI.md), condizioni
> d'uso e informativa, con le scelte (B2B, prova gratuita «così com'è», IA solo con la chiave dell'utente, account
> inattivi cancellati dopo 12 mesi + 30 giorni, `privacy@soligo.net`, legge italiana e foro della sede, italiano e
> inglese) e i punti da far verificare. **Va rivista da una persona competente** prima di pubblicarla. Il `LEGGIMI`
> elenca anche quello che il codice del ramo C deve fare perché i testi siano veri (le due caselle alla registrazione,
> l'avviso di inattività, la chiusura dell'account, le pagine pubbliche). La licenza del software, che il maintainer
> vuole cambiare, è un seme a parte.

**Schermate** (nello stile del ramo B): registrazione, conferma del codice, «accedi con un PIN»
accanto a «accedi con la password», e la casella «ricordami per 30 giorni».

---

## Ramo D — `feat/anteprima-prima-pagina`

L'ultimo, e il più contenibile. Non esiste nessuna miniatura di progetto, ma **la catena è già
scritta** per le pagine di boot: `sws-editor/src/boot/rasterizza.ts` (monta `SvgCanvas` fuori
schermo, incorpora le `<image>` come data URI, sostituisce le `var(--brand-*)` con colori
concreti, `toBlob`) → `PUT /api/boot-pages/:name/png` (`sws-web/src/boot.rs:435-484`) →
`boot/AnteprimaPng.tsx`.

Si generalizza: PNG della prima pagina scritto **al salvataggio**, un campo in più su
`ProjectListEntry` (`types/index.ts:2142`, riempito da `projects.rs:200-276`), e l'icona
`progetto` del ramo B quando non c'è. Due cose da decidere allora, non adesso: dove vive il file
(dentro la cartella del progetto conta nella quota `max_byte`, accanto no) e il tetto di peso
(`MAX_PNG_BYTES` oggi è 5 MB, troppo per una miniatura).

---

## Ordine, e perché non è quello della richiesta

**A → B → C → D.** Il maintainer ha elencato prima il PIN; il piano mette prima l'azienda
personale e i tetti. Il motivo in una riga: il buco di `create_project` e i container senza
limiti sono invisibili finché non entra qualcuno, e distruttivi appena entra. Le schermate brutte
sono visibili e innocue.

A, B e D sono indipendenti fra loro. C dipende da A (chi si registra deve avere un'azienda) e
conviene dopo B (le sue schermate nascono nello stile nuovo invece di essere rifatte).

Ogni ramo è una sessione da 3-4 ore, e ognuno si chiude per conto suo con la *definition of done*
completa — compresi `cargo test` e `pnpm exec vitest run`.

## Verifica

Per ogni ramo, le cinque voci di `CLAUDE.md`. In più, per questo lavoro:

- **Ramo A**: creare due utenti dalla console, verificare che ognuno veda solo i suoi progetti e
  che il quarto progetto venga rifiutato; provare a creare un progetto in un'azienda non propria
  (deve dare 404); `podman stats` su un container avviato dal gateway, per vedere il tetto.
  E il difetto 4-bis, rifacendo il gesto che l'ha scoperto: **aprire un progetto, cancellarlo
  dall'IDE, salvarne subito un altro con lo stesso nome e riaprirlo**. Deve aprirsi, senza
  passare dalla console. Controprova dal VPS: `podman exec sws-p---<nome> ls /progetto` non deve
  mai dire `total 0` mentre sul disco la cartella è piena.
- **Ramo B**: le due schermate a 400 px e a 1920 px senza barra orizzontale; nei due temi;
  `check_i18n_ui.sh`, `check_i18n_parita.sh`, `check_icone_strumenti.sh`, i test vitest.
- **Ramo C**: registrazione vera con un indirizzo del maintainer, su `sws.soligo.net`;
  verificare che il PIN arrivi e **non finisca in spam**; sbagliarlo sei volte e vedere il blocco;
  chiudere il browser e rientrare dopo un giorno con «ricordami»; `check_rotte_preauth.sh` e
  `check_amministrazione.sh` verdi.
- **Collaudo finale, con dati veri**: un account nuovo che crea un progetto, lo apre, **abbina un
  pannello Pixsys** seguendo la procedura di installazione, e non trova nessuna traccia degli
  altri. E, dal lato admin: assegnargli un marchio e vedere che cambia.
- **CasaDomotica**: il marchio per azienda e l'anteprima della prima pagina sono funzioni visibili,
  quindi finiscono anche lì (regola del 16-10).

## Quello che questo piano NON fa

- **2FA TOTP** (decisione 19 del piano cloud). La colonna `totp_segreto` esiste e **non la legge
  nessuno**: resta così. Il PIN via e-mail non è la 2FA — è una seconda via d'ingresso.
- **Inviti ai colleghi** (Fase 5 del piano cloud): il maintainer ha chiesto esplicitamente che un
  utente esterno non possa invitare nessuno.
- **Recupero password** come funzione a sé: la via del PIN la copre già.
- **`max_pannelli` applicato**: resta un dato mostrato, come deciso.
- **Approvazione manuale dei nuovi iscritti**: la scelta è «registrazione libera con verifica». Se
  dovesse servire, lo stato `aziende.stato` («in prova / approvata / sospesa») esiste già ed è il
  posto dove metterla.

## Aggiornamenti ai piani esistenti

Alla fine del lavoro, in `docs/plans/2026-10-05-cloud-utenti-aziende-spazi.md`:
- la **Fase 5** rimanda a questo piano;
- l'SMTP d'installazione **non è più «un pezzo nuovo»**: esiste;
- la **decisione 39** sulla porta 25 bloccata sui VPS OVH è **falsa su questa macchina** —
  misurato il 26-10, 25/587/465 tutte aperte in uscita.
