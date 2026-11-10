# Collaudi in sospeso — da fare da casa, prima di rilasciare l'immagine

> **Per chi è**: il maintainer, davanti ai dispositivi di casa (TC620), prima di decidere che è
> ora di costruire e taggare l'immagine nuova.
>
> **Perché esiste**: la *definition of done* di `CLAUDE.md` chiede la conferma del maintainer che
> la funzione funzioni, e questa è l'unica delle cinque voci che nessuno script può dare. Le altre
> quattro — `cargo check`, `pnpm build`, `check_static.sh`, `cargo test` + `vitest` — sono verdi su
> `main` al 23-10-2026.
>
> **Come si usa**: si spunta quello che passa, si annota quello che non passa. Una voce che non
> passa non blocca le altre: sono indipendenti, e ognuna dice cosa vuol dire se fallisce.
> Il collaudo si fa con la skill **`/test-changes`** (dal 05-11-2026): propone le voci una alla
> volta e, a fine sessione, le spunta qui con la data.
>
> Quando l'elenco è vuoto (o quello che resta è dichiarato accettabile), si costruisce l'immagine
> e **solo allora** si tagga — regola «si tagga quando si costruisce», `CLAUDE.md`.

## Dove si fa cosa

| serve | dove | note |
|---|---|---|
| un pannello Pixsys con schermo | **TC620** di casa (`tc620-a-p3-c6-07aff9.local`), dal PC `ufficio` | TC620 e WP630 sono la stessa famiglia: fanno girare sia il viewer web sia quello LVGL |
| un server OPC-UA di prova | il PC, `npx node-opcua-server-example` o Prosys | niente hardware |
| un simulatore Modbus | il PC, `pymodbus` | solo se si vuole ricontrollare la Fase 3 |
| nient'altro che l'IDE | il PC | la maggior parte delle voci «IDE» |

---

## L'assistente: faceplate e sfondi (dal piano archiviato il 10-11-2026)

Dal piano [l'assistente disegna i simboli e compone il sinottico](archive/2026-11-03-assistente-genera-simboli-e-sinottici.md),
sezione «Code annotate il 10-11-2026». Nell'IDE (cloud o 8460), con una chiave vera.

1. [ ] **Faceplate proposti** (fatto il 06-11, `630a0f30`): in una chat, chiedere una pagina con tre macchine uguali. La
       proposta porta un faceplate e tre istanze, il diff li elenca, dopo «Salva» c'è `faceplates/<id>.yaml`.
2. [ ] **La conversazione intera con gli sfondi** (non passata il 05-11, corretta il 06-11): `genera_sfondo` → «Usa come
       base» → `varia_sfondo` → proposta → Applica → Salva → le foto in `images/`, in una chat sola. «Usa come base»
       reagisce al primo clic o dice che è in coda; nessuna istantanea in timeout.
3. [ ] **Il banco dei tubi** (F5): un giudizio da 1 a 5 sulle due pagine del 04-11 (`tmp/ai-misure/`, solo su
       theobroma). È l'ingresso del piano «secondo giro».

## «Aggiorna ora» non parte due volte (10-11-2026)

Fatto a casa il 10-11 (`fix/aggiornamento-in-corso`, squash `80114595`), nella **2.26.0-rc.11**. Si vede per intero solo
da un pannello **già sulla rc.11** che sale alla versione dopo: fra il clic e `in_corso` c'è l'istantanea dei dati
(minuti con lo storico di CasaDomotica), e prima la card tornava «disponibile» con il pulsante attivo.

1. [ ] Da un pannello sulla rc.11, «Aggiorna ora» verso la rc successiva, con CasaDomotica (storico grande). Durante la
       copia dei dati: cambia pagina e torna, ricarica il viewer, apri l'IDE nel cloud. Ovunque la card dice che
       l'aggiornamento è **in corso** e il pulsante resta spento; nessun secondo aggiornamento parte. Nell'IDE resta
       solo la riga dell'attesa, riletta ogni 15 s, finché il pannello non riparte.
2. [ ] Un secondo `POST` dell'aggiornamento mentre il primo è prenotato risponde **409** (si vede nel journal del pannello
       o con `curl`); dopo il riavvio lo stato torna normale e la conferma «Dopo l'aggiornamento» compare come sempre.

**Visto il 10-11-2026 sul WP630, dalla rc.10 alla rc.11 (dall'IDE nel cloud):** istantanea 1,1 MB alle 11:13:57, runtime
nuovo alle 11:14:56, «Aggiornamento completato» alle 11:16:56. Cambiando scheda e tornando, l'IDE diceva «aggiornamento in
corso» (bene); **durante il riavvio** diceva in rosso «Il dispositivo ha risposto 503 Service Unavailable: il pannello
«wp630-ufficio» non è collegato» e «Configurazione del servizio: non applicabile» — formalmente vero, ma allarma il
cliente (parole del maintainer). Corretto sul ramo `fix/collaudo-rc11`: per dieci minuti dal clic l'IDE dice «si sta
riavviando» in giallo e rilegge ogni 15 s; da collaudare al salto rc.11 → rc.12 (voce 3).

3. [ ] Dal cloud, aggiornando un pannello sulla rc.11 alla rc.12: durante il riavvio, riaprendo Connessione, la sezione
       «Aggiornamento del runtime» dice in giallo «Il pannello si sta riavviando per l'aggiornamento…» e «Configurazione
       del servizio» dice «Pannello non raggiungibile»; niente righe rosse. Al ritorno del pannello compare l'esito.

## Il viewer leggero (09-11-2026)

Rami A e B del piano `docs/plans/2026-11-09-viewer-leggero.md` (§10): `fix/mini-tendenze-leggere` e, annidato sopra,
`fix/ridisegno-mirato`, con le correzioni delle revisioni del 09-11. Vanno nella 2.26.0-rc.10 insieme all'occhio sulle
password: le voci del pannello vogliono quell'immagine. Il WP630 si aggiorna dal viewer e tiene Montagna a 10 Hz come
prova di carico (il template ora è a 1 Hz).

**Montagna sul WP630, viewer web** (progetto ancora a 10 Hz)
1. [ ] 30 minuti sulla pagina iniziale di Montagna. Il login si apre subito. I valori sono freschi: si confrontano con
       l'IDE. Le mini tendenze scorrono anche a valore fermo.
2. [ ] CPU del renderer con `top` (prima si chiede l'accesso SSH). Resta piatta fra il minuto 5 e il minuto 30. La base
       era il 96%.
3. [ ] Journal del runtime: non c'è «ws/tags subscriber lagged». Se c'è, si apre il passo facoltativo del §8 del piano.
4. [ ] IDE 8460, Montagna in modifica: le kpi mostrano mini tendenza e variazione.

**I segnali decisi il 09-11**
5. [ ] Dati in ritardo, **socket giù**: si ferma il runtime per 10 s (sul pannello serve SSH: chiederlo prima). Il socket
       si chiude. Dopo 5 s compaiono la fascia «Dati in ritardo di N s» e gli oggetti grigi, e il numero sale di 1 al
       secondo. Al riavvio del runtime spariscono. Sul viewer web e sul viewer LVGL. *Non* staccando la rete: il socket
       resta aperto per minuti, nessuno dei due motori ha un battito, e un socket vivo e muto vale come impianto fermo
       (il battito è nel seme `docs/plans/semi/2026-11-10-viewer-prestazioni-e-protocollo.md`).
6. [ ] Dati in ritardo, **aspetto** sul LVGL: `--ritardo-di-prova 8`. La fascia sta in alto, sopra la card
       dell'aggiornamento e sotto la schermata d'accesso; gli oggetti sono grigi.
7. [ ] Dati in ritardo, **età vera**, sul banco (`tmp/viewer-leggero/banco`, solo su theobroma): con una SPA ricostruita
       dopo la revisione e la copia a 10 Hz a ×6, la fascia non compare mai (le tre corse del 09-11 col ramo A: mai
       comparsa). Il §10 chiede anche che compaia con la SPA di base: non si può fare così, perché `www-base` (rc.9) la
       fascia non ce l'ha.
8. [ ] Login lento, viewer web: dopo 10 s il pulsante dice «Il pannello risponde lentamente…»; a 60 s compare «Nessuna
       risposta, riprova» e il pulsante torna attivo. Si vede solo con un pannello lento. Sull'IDE lo stesso testo dice
       «Il server risponde lentamente…». Sul LVGL le stesse attese sono la voce 14.
9. [ ] «Aggiorna ora» dal viewer, web e LVGL, aggiornando il WP630 alla rc.11: dal tocco fino alla partenza si legge
       «Aggiornamento in avvio…», anche quando in mezzo chiede l'accesso. Con un aggiornamento già in corso il pulsante
       è spento. Sul LVGL, dopo l'accesso chiesto per aggiornare, la card non torna con «Aggiorna ora» attivo.
10. [ ] LVGL: Montagna sul viewer LVGL per 30 minuti. CPU del viewer **e del runtime** piatte (fino alla revisione la
        mini tendenza LVGL chiedeva l'ora intera ogni 2 s, e il costo cadeva sul runtime). Le mini tendenze scorrono a
        valore fermo e tengono i picchi; linea ed etichetta stanno nel riquadro (i margini ora sono di 2 px come sul
        web, e su uno schermo non li ha ancora guardati nessuno).

**Ramo B, il ridisegno mirato e il filtro di pagina** (viewer web sul WP630; dove serve un faceplate o un tubo si usa
`demo-items-web`, perché CasaDomotica non ne ha)
11. [ ] Popup di un faceplate (bottone `open_faceplate`) e pagina-finestra con lo sfondo da variabile: i valori dentro
        al popup e alla finestra si muovono, e lo sfondo segue il suo tag. Anche dopo un cambio di pagina e ritorno, e
        dopo una riconnessione del socket (runtime riavviato: SSH da chiedere prima).
12. [ ] Il tubo segue la pompa (`demo-items-web`, il tubo agganciato all'oggetto che si muove). Toggle con conferma,
        incremento e checkbox partono dal valore attuale e scrivono quello giusto. Il badge ⌛ dello stale compare quando
        il tag sta fermo oltre `stale_after_s`, e non compare finché il tag si rinfresca.
13. [ ] IDE 8460 su CasaDomotica: il trascinamento è fluido, il pannello proprietà non è in ritardo, nessun valore resta
        fermo (in modifica i valori sono vivi). Su `demo-items-web`, trascinando un oggetto, griglie e faceplate non
        scattano.
14. [ ] LVGL, login lento: dopo «Accedi», entro 10 s la card dice che il pannello è lento; a 60 s compare «Nessuna
        risposta, riprova» e «Accedi» torna premibile. «Annulla» a metà attesa: una risposta arrivata dopo non fa
        entrare, e un toggle premuto subito dopo scrive subito, senza aspettare il login abbandonato. Si vede solo con un
        pannello lento, oppure congelando il runtime per qualche secondo (`kill -STOP`, poi `kill -CONT`; SSH da
        chiedere prima): un runtime fermo del tutto rifiuta la connessione, e quello non è il caso lento.

## L'occhio sulle password (09-11-2026)

Piano `docs/archive/2026-11-09-occhio-sulle-password.md`, ramo `feat/occhio-password` annidato su `fix/ridisegno-mirato`,
con le correzioni delle due revisioni del 09-11. Va nella 2.26.0-rc.10 insieme al viewer leggero: le voci del pannello
vogliono quell'immagine. Regola unica su tutti gli ambienti: la password parte nascosta, l'occhio la mostra, un secondo
tocco la nasconde, chiusa la finestra riparte nascosta. L'icona è la stessa su web e LVGL: aperta quando la password è
nascosta («toccami per vederla»), barrata quando si legge.

**IDE 8460**
1. [ ] Login: l'occhio a destra dentro il campo, parte nascosta, un clic mostra e uno nasconde, il fuoco resta nel campo
       e Invio entra ancora. Un login sbagliato lascia la password nascosta anche se era in chiaro.
2. [ ] Cambio password (tre campi) e Registrazione: occhi indipendenti, mostrarne uno non mostra gli altri; il testo si
       ferma prima dell'occhio.
3. [ ] Configurazione → Utenti: la password iniziale del nuovo utente in chiaro, poi «Crea»: il campo si svuota e torna
       nascosto, e la password del prossimo utente parte nascosta. La password per riga nel reset ha l'occhio anche sui
       campi bassi (sporge sopra e sotto, senza fondo).
4. [ ] Configurazione → Istanza → Device → Connessione, e Dispositivi: l'occhio c'è anche sui campi a larghezza fissa
       (150-160 px) e il campo non esce più largo dei vicini. Notifiche → Twilio: «Auth token» salvato e mascherato dal
       server ha l'occhio spento; scrivendo un token nuovo si accende.

**Viewer web sul pannello (TC620/WP630, touch e tastiera a schermo)**
5. [ ] Login per l'aggiornamento: l'occhio è da dito (40×40), il tocco mostra la password senza chiudere la tastiera a
       schermo, Invio dalla tastiera entra. Dopo l'invio la password torna nascosta.
6. [ ] Password di un comando critico su CasaDomotica (`chiedi({ password: true })`): la stessa cosa nella Finestra di
       avviso; la volta dopo riparte nascosta.

**LVGL sul pannello**
7. [ ] Login LVGL: l'occhio a destra nel campo password, stessa icona e stesso grigio del web, un fondo scuro mentre il
       dito preme; il tocco mostra il testo in chiaro, un secondo lo nasconde; «Annulla» e un login riuscito la rimettono
       nascosta, alla prossima apertura parte nascosta. Aprire e chiudere il login dieci volte non fa crescere la
       memoria del viewer (dalla revisione i raster dell'occhio sono condivisi).
8. [x] Tastiera LVGL in modalità password: oggi nessuna schermata la apre con `password = true`, quindi l'occhio della
       tastiera dal pannello non si vede. **Deciso dal maintainer il 10-11-2026: si tiene, pronto** per il primo campo password
       LVGL (es. i comandi critici, piano della parità). Niente da collaudare.

## La serie L0 → F2 → F3 (05-11-2026) — la sandbox Python e la Finestra di avviso dappertutto

In `main` dal 06-11-2026 (2.26.0-rc.2). *(08-11: il piano della Finestra di avviso è archiviato; restano qui L0.1 e L0.3
sul pannello, F2.4–5 sul WP630 e il residuo della 15.)*
L0 cambia il runtime e F3 il viewer: le voci del pannello vogliono l'immagine nuova. Le voci IDE si provano sull'IDE
locale (8460) o sul VPS dopo il rilascio.

**L0 — la sandbox Python** (su un pannello, in un progetto di prova: `grid-playground` non ha più funzioni)
1. [ ] Uno script globale con `print('ciao')` e un `for i in range(3): tot += i`: gira senza `NameError`, e nel
       registro del runtime compare la riga `print` col nome dello script e il testo. **Passata sull'IDE 8460 il
       06-11-2026**; resta da provare sul pannello.
2. [x] Una funzione con un parametro col predefinito (`chi`, predefinito `operatore`) chiamata da un bottone senza
       argomenti: usa il predefinito. «Prova» della funzione mostra il testo dei `print`. **Passata il 07-11-2026 sul
       TC620** (rc.2, CasaDomotica): «ciao operatore» e «ciao Mauro», righe `print` nel registro del pannello. Il log
       non arrivava all'IDE del cloud: difetto del canale, corretto nella rc.3 (banco `r3-log`).
3. [ ] `min`, `max`, `sum`, `sorted`, `enumerate` in uno script: girano sul pannello. **Passata sull'IDE 8460 il
       06-11-2026** (`ciao 3 1 3 3 [1, 2] [(0, 'a'), (1, 'b')]` nel registro); resta da provare sul pannello.

**F2 — deploy ed editor** (IDE; il deploy vuole un pannello raggiungibile)
4. [ ] Deploy verso un pannello con un altro progetto: la conferma «cancella dal pannello…» è una finestra rossa con
       Annulla predefinito; Annulla non tocca niente, Conferma procede. Lo stesso da Connessione e da Dispositivi.
5. [ ] «Utenti e segreti» in testata: la conferma, e poi (progetto senza utenti) «Questo progetto non ha utenti».
6. [x] Eliminare una pagina, una cornice, un faceplate usato, una planimetria; separare un gruppo; «Ruolo minimo» sotto
       la soglia della variabile (la tendina torna com'era se si annulla). Confermato il 06-11-2026 sull'8460.
7. [x] Un testo tradotto usato in due punti, cambiato in uno: «Cambia solo qui» / «Cambia dappertutto»; **Esc o
       Annulla lascia il testo com'era** (prima cambiava dappertutto). Esc nel campo butta quello che si è scritto.
       **Non passata il 06-11-2026**: confermando il campo con Invio la domanda si apriva e si richiudeva da sola
       (il `keypress` dello stesso Invio premeva Annulla, il predefinito di `scegli`). Corretto in
       `FinestraAvviso.tsx` (il fuoco va al predefinito solo quando Invio si alza) e provato col browser
       sull'IDE di prova, anche dentro un faceplate. **Riprovata e passata il 06-11-2026 sera.**
8. [x] Storico: «Carica database» chiede prima e poi apre il selettore di file — **in Chrome e in Firefox**.
       Confermato il 06-11-2026 sull'8460.

**F3 — viewer, console, finestre** (viewer sul pannello, kiosk WebKit: WP630 o TC620)
9. [x] Un bottone con `require_confirm`: la finestra con Annulla/Conferma nella lingua dei contenuti; Annulla non scrive.
10. [x] Un comando `critical`: la password in una finestra (campo nascosto), sbagliata dà errore e non scrive; con
       `require_reason` il motivo vuoto tiene aperta la finestra. **07-11 (rc.2): «403 forbidden»** — premuto prima
       di fare l'accesso, e il viewer mandava la scrittura senza credenziali. Nella rc.3 dice di accedere (`r3-critico`). **Passata l'08-11-2026 sul TC620** (rc.4/rc.5).
11. [x] Un bottone momentaneo con `require_confirm`: non chiede più niente e si tiene premuto. **07-11 (rc.2) non
       passa sul touch del TC620**: la pressione lunga non mandava niente (solo eventi del mouse). Rc.3: eventi pointer
       (`r3-momentaneo`). **Passata l'08-11-2026 sul TC620** (`r4-momentaneo`).
12. [x] Un toggle con conferma: scrive l'inverso del valore **al momento della conferma**.
13. [x] Allarmi: «Conferma» con motivo obbligatorio, «Conferma tutti», «Metti a tacere». **07-11 (rc.2)**: la conferma
       col motivo passa; «Conferma tutti» e «Metti a tacere» non c'erano nella modalità elenco. Rc.3 (`r3-allarmi`). **Passata l'08-11-2026 sul TC620**.
14. [x] Uno slider con `require_confirm`: una domanda sola al rilascio, e il cursore resta dove l'ha lasciato.
15. [ ] IDE. **Già passati il 05-11-2026 sull'8460**: chiudere il progetto con modifiche non salvate (Salva e chiudi /
       Chiudi senza salvare / Annulla) e la console (abbandonare le modifiche in Aziende e Persone); **il 06-11**
       «Crea variabile», «Rinomina tag» (da Progetto → Variabili, «Tags» con l'IDE in inglese) e «Cambia risoluzione».
       Restano: il pull dal dispositivo nella finestra nuova, sessione scaduta, chiusura dell'account: stessa cornice,
       Esc, Tab che resta dentro.
16. [x] L'avviso di aggiornamento sul pannello (versione nuova, conferma dopo l'aggiornamento) con il login per Admin
       che gli si apre sopra: si scrive nel login. **Passata il 07-11-2026 sul TC620** (2.25.1 → rc.2 dal viewer). Dall'IDE
       del cloud falliva dopo 60 s (l'istantanea dei dati): corretto nella rc.3 (`r3-agg`). **Dall'IDE del cloud passata l'08-11-2026** (rc.4 → rc.5, `r5-agg`).

## La 2.25.1 (05-11-2026) — anomalie del collaudo 2.25.0, regole dei template, lucchetto

Sul WP630 (`pixsys@wp630-a-p3-07a077.local`, canale `rc-arm64`) e su `sws.soligo.net`. Le correzioni trovate
collaudando stanno sul ramo `fix/collaudo-2-25-1` e vanno nella **2.25.2**; le voci 4–8 sono state provate il 05-11
con la SPA del ramo copiata nel container del pannello (prova sola, sparisce col container), quindi vanno ricontrollate
sull'immagine 2.25.2.

1. [ ] **Chat e registro in una finestra, nel cloud** (C0): sulla 2.25.1 danno **HTTP 401** — il gateway serviva in
       chiaro solo la radice del progetto. Corretto sul ramo (`guscio_di`, prova `prove_finestre_staccate`): da
       ricontrollare sulla 2.25.2 sul VPS.
2. [x] **Le scelte di pagina mostrano il nome** e non `{{t0001}}` (C0) — confermato dal maintainer il 05-11-2026.
3. [x] **«Montagna» sul WP630 non rallenta** (C0) — «va molto meglio», 05-11-2026; misurato: a riposo Chromium sotto
       lo 0,5% di un core (prima ~1,2 core).
4. [x] **Lo slider del lago non cambia pagina** trascinandolo — confermato il 05-11 (SPA del ramo).
5. [x] **Niente riquadro semitrasparente al tocco** — confermato il 05-11 (SPA del ramo).
6. [x] **La foto non lampeggia** passando da giorno a notte — confermato il 05-11 (SPA del ramo).
7. [x] **Il pallino segue il dito** fino in fondo — confermato il 05-11 (SPA del ramo): prima si muoveva di pochi pixel
       e perdeva il dito.
8. [x] **La dissolvenza segue lo slider senza scatti** — «ora funziona benissimo tutto», 05-11 (SPA del ramo).
9. [ ] **Aggiornamento dall'IDE**: prima di confermare compaiono le novità della versione, e il pannello si ricollega.
10. [ ] **Il lucchetto** (T1): `homeassistant-pro` senza accesso, pagina Sicurezza — «🔒 Operator» sul cancelletto,
        «🔒 Supervisor» sulla tapparella del garage, sul web e sul pannello; da Operator il primo sparisce.
11. [x] **Niente allarmi falsi all'avvio** (T1) (il 05-11-2026 il maintainer accetta il test unitario al posto della prova a mano): `homeassistant-pro` non dà «Soggiorno troppo freddo: 0.0 °C».
12. [x] **I template con la cornice** (T1 e T2): titolo, ora e navigazione su ogni pagina, comandi senza accedere, il
        titolo tradotto cambiando lingua; `tc620-sistema` con data e ora. Confermato il 06-11-2026.
13. [x] (05-11-2026, IDE 8460) **Faceplate**: in `tc620-sistema` il faceplate di un'interfaccia propone `tc620.ethernet0`; `motor_basic` e
        `tank_level` mostrano «1450 rpm» e «62.5 %».
14. [ ] **L'assistente e i nomi tradotti** (T2): trova una pagina dal nome tradotto, e il riepilogo non mostra `{{t0069}}`.

## Prestazioni: dove se ne va il tempo (26-10-2026) — chiusa

Le cinque voci passate: 2 e 4 il 27-10, 1, 3 e 5 l'08-11-2026 sul TC620 di casa con CasaDomotica dall'IDE nel cloud
(2.26.0-rc.6): colonna del pannello col runtime e le sorgenti, e la misura che si spegne circa un minuto dopo essere
passati all'editor (`curl …/api/prestazioni/richiesta` → `{"attiva":false}`). Il testo delle voci è nella storia git.

## A. La misura che blocca C4 — chiusa

Le quattro voci spuntate il 24-10-2026; il piano C4 è archiviato come fatto il 25-10
(`docs/archive/2026-10-23-c4-tls-di-default.md`). Sezione tolta il 05-11-2026: il testo è nella storia git.

---

## A-bis. La fiducia del browser del pannello (26-10-2026)

**Ha sostituito la proposta col certificato del dispositivo**, che era qui e non si collauda più:
quella strada è stata ritirata il 26-10, perché chi sviluppa PixsysOS ha detto che la chiave su
cui si reggeva è già un errore e potrebbe sparire. Il punto 4 di allora — «nel cloud la proposta
non compare mai» — è passato: oggi non compare da nessuna parte, perché non esiste più.

Serve un pannello Pixsys, **aggiornato all'immagine nuova** (l'installatore è cambiato, quindi
va rifatta anche la configurazione del servizio).

1. [ ] Dopo l'aggiornamento, sul pannello: `cat /data/user/sws/config/fiducia-browser` deve
       esistere, e `systemctl --user status sws-fiducia.path` deve essere attivo.
2. [ ] **Su un pannello che era in chiaro**: dopo il riavvio deve trovarsi in **HTTPS da solo**,
       e lo schermo deve mostrare il sinottico **senza** «La connessione non è privata».
3. [ ] Sicurezza → Certificati, colonna del pannello: la card dice che il browser si fida. Non
       deve esserci nessuna proposta da accettare né nessun comando da copiare.
4. [ ] **Il guardiano segue il cambio**: con il TLS acceso «Genera» non c'è (compare solo a TLS spento), quindi la
       prova si fa con **«Disabilita TLS»**, che di fatto rigenera il certificato (punto 5). Atteso: il pannello resta
       in HTTPS con un'impronta nuova, l'IDE chiede di dimenticare quella vecchia in Connessione,
       `fiducia-browser.sh <config> --verifica` elenca ancora «SWS pannello» e lo schermo resta senza avvisi. Se
       compare l'avviso e `--verifica` non elenca il certificato, il `PathChanged` di `sws-fiducia.path` si è perso fra
       cancellazione e ricreazione (meno di un secondo). *(Corretto il 05-11-2026.)*
5. [ ] **Rimuovi** il certificato: oggi il pannello **non** torna in chiaro — col marcatore `fiducia-browser` il
       runtime ne genera subito uno nuovo. Difetto noto (05-11-2026, nel piano `docs/plans/2026-11-10-manutenzione-e-verifiche-rimandate.md`): si riprova quando è corretto.
6. [ ] **Non misurato, da misurare qui**: dopo un cambio di certificato basta riavviare il solo
       kiosk, o serve tutto il pannello? Nella prova del 26-10 si era riavviato tutto.
7. [ ] Su un dispositivo **senza `certutil`** (o fingendolo): l'installatore deve dirlo, il
       pannello resta in chiaro, e la card deve spiegare perché invece di tacere.

**Da ripulire sui pannelli di prova**: il TC620 ha ancora la copia della chiave del dispositivo
fatta il 24-10. Va tolta — era un'eccezione a una strada che non esiste più.

## A-ter. Il configuratore dei moduli (25-10-2026) — l'MCM260X-5AD sul TC620

1. [ ] Il dispositivo 5AD del progetto di prova, card del dispositivo: la sezione «Configurazione del modulo» mostra i
       quattro tipi di sonda, l'unità, le due uscite e la compatibilità — **non** indirizzo, baud, parità.
2. [ ] Fissare AI1 = 12 (PTC1K), AI2-AI4 = 11 (NTC10K) come al collaudo del 04-10; salvare. Nel log del pannello:
       «setup del modulo — … da X a Y» solo per quelli diversi, poi «setup del modulo applicato».
3. [ ] Spegnere e riaccendere il pannello: al ricollegamento il log **non** riscrive niente (tutti uguali).
4. [ ] Cambiare a mano un parametro sul modulo (script Modbus o software Pixsys), riavviare il runtime: torna al
       valore del progetto. Gli AI leggono i valori giusti.

## A-quater. I report programmati (26-10-2026)

1. [x] Dal cloud, con il TC620 collegato: Configurazione → Progetto → Report → «+ Nuovo report», periodo «turno», due o
       tre tag con lo storico acceso, salvare, e **fare il deploy**: il pannello genera con la definizione del suo
       progetto, e senza deploy risponde «nessun progetto aperto» o «report sconosciuto» (29-10-2026).
2. [x] «▶ Genera ora»: compaiono un PDF e un Excel; scaricarli (visto il 29-10-2026 su `tc620-garage`). Il PDF ha riepilogo, andamento e allarmi con i valori
       veri; l'Excel si apre e i numeri si sommano.
3. [x] Con un destinatario email e l'SMTP delle Notifiche configurato: la mail arriva con i due allegati — **confermato
       dal maintainer l'08-11-2026**: su CasaDomotica le mail dei report arrivano regolarmente.
4. [x] Lasciare il pannello acceso oltre l'ora del cron (es. `*/15 * * * *` per provare): i file nascono da soli; con
       «File da tenere» = 2 restano solo le ultime due generazioni. *(08-11: la generazione da sola è confermata dalle mail
       regolari di CasaDomotica; la rotazione dei file non è stata guardata a parte.)*

## A-sexies. Il tunnel: vivo, spento o perso (26-10-2026)

1. [ ] Console → Pannelli con il TC620 collegato: pallino verde. `sudo systemctl --user stop sws-runtime` sul
       pannello (o spegnerlo dal pulsante): il pallino diventa **giallo** con l'ora, e il log del gateway dice
       «spegnimento annunciato».
2. [ ] Staccare il cavo di rete del pannello (half-open): entro circa un minuto e mezzo il log del gateway dice
       «tunnel muto» e il pallino diventa grigio.
3. [ ] «Sposta azienda» su un pannello collegato: si ricollega da sé in pochi secondi.

## A-septies. Chi sta dall'altra parte: la disponibilità delle sorgenti (29-10-2026)

Piano `docs/archive/2026-10-28-chi-sta-dall-altra-parte.md`. Nasce dal Zigbee2MQTT di casa spento per trenta ore senza
che niente lo dicesse. **Si fa dopo che il cloud gira la versione che contiene la funzione**: un runtime più vecchio
ignora `disponibilita:` e la cancella al primo salvataggio, senza avvisare.

**Nell'IDE, subito** (basta l'8460 sul ramo, progetto `casa-locale`, che punta a un broker che non esiste):

1. [x] *(08-11-2026, dal vivo su CasaDomotica: vedi la nota sotto la 10.)* Configurazione → Protocolli → una card MQTT, **chiusa**: la testata dice «non risponde dalle HH:MM» col
       pallino rosso, e il motivo nel suggerimento. Aperta: la sezione **DISPONIBILITÀ** sta fra Autenticazione e
       Mappatura, con lo stato a destra del titolo e il pulsante «⚠ Crea l'allarme di disponibilità». Sotto la
       card non c'è più nessuna riga.
2. [x] (29-10-2026) Sezione **DISPONIBILITÀ** → «Chi dice se è vivo» → Zigbee2MQTT: si compilano topic, campo e valore. Salvare: in
       Variabili compare il tag `<sorgente>.disponibile`.
3. [x] (29-10-2026) «⚠ Crea l'allarme di disponibilità», dentro la sezione: la scheda Allarmi si apre con l'allarme in bozza
       (`bool_false`, 60 s, Warning, il nome della sorgente nel messaggio). Salvare. Tornando alla card, al posto
       del pulsante c'è «Vai all'allarme».
4. [ ] «Personalizzato…» con un topic e **senza** valore «vivo»: la validazione avvisa.

**Dal vivo, con CasaDomotica e il Zigbee2MQTT di casa:**

5. [ ] Su ogni sorgente `mqtt-*` che parla con Zigbee2MQTT: la preimpostazione Zigbee2MQTT. Lo stato dice
       «risponde».
6. [ ] Allarme di disponibilità creato dal pulsante, e Telegram acceso per il suo scatto nella tabella eventi.
7. [ ] **Fermare Zigbee2MQTT**: entro un minuto e qualche secondo arriva il messaggio Telegram; i tag della sorgente
       nel sinottico sono non aggiornati (stale); un allarme di soglia su uno di quei tag **non** scatta.
8. [ ] *(08-11-2026: provato col singolo dispositivo, non con Zigbee2MQTT fermo — riattaccata la presa le variabili sono
       tornate buone subito, perché Z2M ripubblica lo stato al ritorno; il caso «Z2M riavviato» resta.)* Riavviare Zigbee2MQTT: la disponibilità torna vera, ma i tag restano `Bad` finché ognuno non riceve un valore
       vero — premere un interruttore e vederlo tornare buono.
9. [ ] Con Zigbee2MQTT fermo, premere un pulsante del sinottico: il comando **parte lo stesso** (si vede nel log
       del runtime). È voluto: un falso «morto» non deve bloccare i comandi.

**Le altre sorgenti** (basta una):

10. [ ] Una sorgente Modbus o S7 verso un dispositivo vero: staccarlo → `<sorgente>.disponibile` falso e tag `Bad`;
        riattaccarlo → vero, e i tag tornano buoni alla prima lettura.

*(08-11-2026, col maintainer, TC620 con CasaDomotica dall'IDE nel cloud 2.26.0-rc.6 — la variante **per dispositivo**,
non prevista dalla lista: `mqtt-sandokan` con disponibilità «Personalizzato…» sul topic
`zigbee2mqtt/presa.sandokan/availability`, campo `state`, vivo `online`. In Zigbee2MQTT è stata abilitata la
disponibilità (era spenta; timeout attivo 2 min). Presa staccata: `offline` sul broker alle 18:49:56, la card dice
«not responding since 06:49 PM» col motivo letto dal topic, pallino rosso nell'albero, allarme di disponibilità
scattato, `sandokan.*` Bad. Riattaccata: `online` alle 18:55:05, tutto verde e Good. La 10 su Modbus/S7 resta.)*

*(09-11-2026, TC620 con la 2.26.0-rc.9 — la **sorgente unica** `mqtt-casa` con 29 dispositivi: staccata
`presa.Laboratorio`, pallino rosso solo su di lei, `plug_lab.*` Bad e il resto Good; l'allarme «non risponde da un
minuto» compare un minuto dopo l'offline e rientra riattaccandola. La sera dell'08-11, con la rc.8, l'allarme non
scattava: difetto del ritardo degli allarmi, corretto in `ce5c6b91`. Passato.)*

## A-octies. Le card delle sorgenti, ridisegnate (29-10-2026)

Piano `docs/archive/2026-10-29-card-delle-sorgenti.md`. Nasce dal collaudo a schermo di A-septies: il pulsante
dell'allarme troppo nascosto, i titoli delle sezioni dello stesso colore delle etichette, il watchdog da solo su una
riga. Basta l'8460 sul ramo; un progetto con una sorgente per tipo aiuta.

1. [x] **Le nove testate uguali** (visto il 29-10-2026, spuntato il 05-11): tipo colorato · id · riepilogo · stato · azioni · ▲. Host e server OPC-UA senza
       stato (non hanno un altro capo).
2. [x] **L'ordine dei campi** (visto il 29-10-2026): in ogni card l'indirizzo (host, porta seriale, IP, endpoint, URL) viene per primo,
       l'ID sorgente per ultimo nella prima riga.
3. [x] **MQTT → AVANZATE** (visto il 29-10-2026) parte chiusa e dice cosa c'è dentro; aperta, keep-alive, QoS, clean session e
       **watchdog** stanno su una riga sola.
4. [x] **MQTT → MAPPATURA**: l'interruttore `[Topic | Sparkplug B]` nel titolo. Sparkplug B sostituisce la tabella
       dei topic e fa sparire DISPONIBILITÀ; tornare a Topic con delle metriche chiede conferma. Confermato il
       06-11-2026 sull'8460.
5. [x] **Il contrasto, nei due temi** (visto il 29-10-2026): i titoli di sezione si staccano dalle etichette; i campi hanno un fondo
       diverso dalla card; nel tema chiaro la card si stacca dal grigio della pagina (bordo e ombra).
6. [x] **OPC-UA client** (visto il 29-10-2026): la security policy e i certificati stanno in AVANZATE, chiusa, col riepilogo «Security
       policy: …»; utente e password si scelgono in AUTENTICAZIONE.

## A-nonies. Un faceplate si disegna sul canvas (29-10-2026)

Piano `docs/archive/2026-10-27-faceplate-disegnato-sul-canvas.md`. Basta l'8460 sul ramo, con un progetto che usa un
faceplate (il dimostrativo ha `tank_level`).

1. [x] (05-11-2026, IDE 8460) Albero delle pagine: il ramo **🧩 Faceplate** con i tre predefiniti (◇). Configurazione non ha più la scheda
       Faceplates.
2. [x] (05-11-2026, IDE 8460) Aprire `tank_level`: il foglio ha la misura del faceplate, i testi `{label}` si leggono «label» (o il
       predefinito). Con una cornice predefinita nel progetto, sotto il faceplate **non** c'è la cornice.
3. [x] (05-11-2026, IDE 8460) Trascinare un figlio, poi aprire una pagina con un'istanza di `tank_level`: **l'istanza è già cambiata**, prima
       di salvare. Ctrl+Z la rimette.
4. [x] (05-11-2026, IDE 8460) Salvare: `tank_level` diventa ◆ (personalizzato). Nelle proprietà, «Ripristina il predefinito» lo riporta com'era
       e il ◇ torna.
5. [x] (05-11-2026, IDE 8460) «+ Nuovo faceplate», disegnarlo, aggiungere un parametro dalle proprietà, salvare e ricaricare la pagina del
       browser: c'è ancora. **Trascinarlo dal ramo su una pagina**: l'istanza nasce dove lo si lascia, col faceplate
       giusto e della sua misura. Il ＋ della riga fa lo stesso al centro della vista; su un faceplate aperto è spento.
       Fra gli strumenti, «Faceplate» non c'è più.
6. [x] (05-11-2026, IDE 8460) «{ } JSON»: cambiare il nome nella definizione e «Applica»; scrivere un JSON rotto: «Applica» resta spento. Con
       un oggetto `type: faceplate` dentro, lo dice e non applica.
7. [x] (05-11-2026, IDE 8460) Selezionare due oggetti su una pagina → «⧉ Crea faceplate dalla selezione»: il faceplate compare nel ramo, la
       selezione diventa un'istanza, un Ctrl+Z toglie tutti e due.
8. [ ] **CasaDomotica** (dopo il rilascio, regola del 16-10): ridisegnare `tank_level` dal canvas e vederlo sul WP630.

## A-decies. La miniatura nell'elenco dei progetti (29-10-2026)

Ramo D del piano `docs/archive/2026-10-26-aprire-sws-soligo-net.md`.

1. [x] Aprire un progetto, cambiare qualcosa nella pagina iniziale, salvare, chiudere il progetto: la sua scheda
       mostra la miniatura, con la cornice, nelle due viste (griglia ed elenco) — **approvata a schermo il 29-10-2026**
       (homeassistant-pro); il telefono non è stato guardato.
2. [x] Salvare una modifica a un'altra pagina: la miniatura non si rifà (nella scheda Network non parte il `PUT`).
       Confermato il 06-11-2026.
3. [x] (05-11-2026) Nel cloud: la miniatura si vede nell'elenco servito dal gateway, e `anteprima.png` non compare in un commit Git
       del progetto.

## A-undecies. Lo schermo del pannello dal cloud — validato

**Validato dal maintainer il 29-10-2026 sera**, sulla 2.23.7 («funziona perfettamente lo schermo remoto»); piano in
`docs/archive/2026-10-29-schermo-remoto.md`. Le sette voci di traccia sono tolte il 05-11-2026 (sono nella storia git).
L'unica che varrebbe ancora la pena di fare è di sicurezza: un utente di un'altra azienda, con l'indirizzo
`/schermo/<pannello>/` copiato, non entra (serve un secondo account in un'altra azienda).

## A-duodecies. I corpi del testo e i testi che LVGL non disegnava (25-10-2026)

Piano `docs/archive/2026-10-25-corpi-e-parita-lvgl.md`, archiviato il 30-10-2026 con questo collaudo come unico
residuo. Serve un pannello in **modalità LVGL** (WP630, o TC620 commutato) col progetto `demo-items-lvgl`, che usa
tutti questi tipi. **Tutte e sei confermate a schermo il 06-11-2026.**

1. [x] Cambiare il corpo del valore e quello dell'unità (`unit_font_size`) su un gauge e su un kpi: sul pannello
       cambiano tutt'e due, e l'unità segue il valore (nel kpi accanto, nel gauge sotto).
2. [x] Sotto un **symbol** compare l'etichetta dello stato attivo; in una **sparkline** l'ultimo valore in alto a
       destra.
3. [x] **alarm_banner**: la pillola ISA (piena per l'attivo, col bordo per il rientrato) e il tasto ACK sulla riga.
4. [x] **Storico allarmi** e **registro dati**: la tabella scorre col dito fino all'ultima riga; titolo «STORICO
       ALLARMI». Il messaggio e lo stato stanno in due colonne, non in una sottoriga (dichiarato: resta del web).
5. [x] **alarm_bell**: la campana si vede (non un quadratino); **lang_selector**: codici in maiuscolo.
6. [x] **recipe_panel**: senza ricette dice che è vuoto; applicandone una, la riga d'esito.

## A-terdecies. L'impianto lo tocca il pannello, anche dal cloud (25-10-2026)

Piano `docs/archive/2026-10-25-impianto-dal-dispositivo.md`, uscito nella 2.21.0 e archiviato il 30-10-2026. La gamba
«nel cloud le sorgenti non partono» è già provata (28-10, dai thread del container); restano due minuti all'IDE.
Serve un progetto nel cloud con un **pannello collegato** (CasaDomotica e il TC620 del garage).

1. [ ] Dal cloud, una sorgente MQTT → **Sfoglia broker**: trova i topic, passando dal pannello (prima: 0 topic).
2. [ ] Nell'editor nel cloud i valori dei tag si muovono: arrivano dal pannello collegato, non da sorgenti
       avviate nel container.

## B. Lo schema `http`/`https` non è più scritto a mano

Quattro punti che prima non rileggevano il certificato. **Nessuno cambia il comportamento di un
pannello in chiaro**: se il TLS è spento, tutto deve funzionare esattamente come prima.

5. [ ] **Pannello in chiaro, com'è adesso**: installare/aggiornare e verificare che l'installer
       stampi `viewer : http://…:7443` e `IDE : http://…:7444`, che il browser parta, e che il
       codice di abbinamento compaia nel riquadro.
6. [ ] **Pannello con TLS acceso**: rilanciare `install-container.sh` e verificare che adesso
       stampi `https://`, che punti il browser su `https://127.0.0.1:7443` e che il codice di
       abbinamento lo legga lo stesso (prima due sonde su tre erano mute).
7. [x] **Pannello LVGL con TLS acceso e quadlet vecchio** (lo schermo LVGL col sinottico, collaudo del 06-11-2026): il viewer deve ripartire lo stesso. Nel
       log (`journalctl --user -u sws-lvgl-viewer`) deve comparire
       `[base-url] http://… non risponde, https://… sì: uso quello` e lo schermo deve mostrare il
       sinottico. Se resta nero, il ripiego di schema non ha funzionato.

---

## C. Il certificato: nome vero, e governo da remoto

8. [x] *(Misurato il 05-11-2026 sul WP630: `CN = wp630-a-p3-07a077, O = SWS`, SAN `localhost`, il nome, il nome
       `.local`, `127.0.0.1` e l'IP.)* **Rigenerare** il certificato sul pannello e guardarne il soggetto:
       `openssl s_client -connect <pannello>:7443 </dev/null 2>/dev/null | openssl x509 -noout -subject -ext subjectAltName`
       Deve dire `CN = <nome del pannello>` (non più `rcgen self signed cert`) e i SAN devono
       contenere `localhost`, `<nome>` e `<nome>.local` oltre agli IP.
9. [x] **La card «Certificato TLS» con un pannello connesso** (Configurazione → Istanza → Device):
       in testa deve dire «Dispositivo connesso — `<host:porta>`», non «Questa istanza», e deve
       mostrare le tre righe gialle (riavvio, impronta che cambia, schema che cambia).
       **Prima questa card governava il PC su cui gira l'IDE.** Confermato il 06-11-2026.
10. [ ] Premere «Genera certificato self-signed» **da lì**: deve agire sul **pannello**. Il PC
       dell'IDE non deve cambiare stato TLS.
11. [ ] Dopo il punto 10, riconnettersi: deve comparire l'errore «certificato cambiato» e il
       pulsante **«Dimentica certificato»** — e dopo averlo premuto la connessione deve riuscire.
       (Il «dimentica» non è e non deve essere automatico.)

## D. L'impronta mostrata al collegamento

12. [ ] **Primo collegamento** a un pannello mai visto (o dopo «dimentica»): sotto lo stato di
        Connessione deve comparire **Impronta del certificato** con il valore, e la riga gialla
        «Memorizzata adesso, al primo contatto…».
13. [ ] **Secondo collegamento** allo stesso pannello: la stessa impronta, ma la riga grigia «Già
        memorizzata da un collegamento precedente».
14. [ ] **Collegamento in `http://`**: **nessuna** riga dell'impronta. Se compare, è un difetto:
        non c'è nessuna identità da verificare.
15. [x] *(Misurato il 05-11-2026: l'impronta memorizzata dall'IDE 8460 per il WP630 è quella servita sulla 7443 e
        sulla 7444.)* Confrontare l'impronta con quella che il pannello dice di sé —
        `openssl x509 -in /data/user/sws/config/tls.crt -noout -fingerprint -sha256`. Devono
        coincidere. *(È la cosa che rende utile tutta la funzione: se non coincidono, il confronto
        che l'IDE propone è teatro.)*

---

## E. Accesso dal pannello LVGL — chiusa

Chiusa il 26-10-2026 sulla 2.22.0, con la guardia `check_accesso_lvgl.sh`. Sezione tolta il 05-11-2026.

---

## F. OpenPLC sul pannello (opzionale)

Rifatto il 30-10-2026 dopo il primo collaudo sul WP630, che aveva trovato il quadlet rotto: ora è un
container persistente (HOWTO cap. 28). **Già visto da Claude sul WP630 via SSH**: installazione con
`--solo-openplc`, programma caricato dall'Editor (CLI), stop pulito in 6 s, programma ancora in RUN
dopo un riavvio vero. Il giro **da utente** è fatto il 30-10-2026: bottone dall'IDE, Editor da Windows senza tunnel, Modbus letto da
SWS (`soglia_alta` = 900). Il riavvio (24) l'ha fatto Claude via SSH, col programma ancora in RUN.

19. [x] Senza `--con-openplc` OpenPLC non c'è: nessun container, nessun quadlet (WP630, 30-10-2026).
20. [x] **Dall'IDE, pannello già installato**: Istanza → Connessione → «OpenPLC sul pannello» →
        Installa. Il riquadro passa da «in corso» ad «Acceso» senza che SWS si fermi.
20b. [x] **Dichiarata coperta il 05-11-2026** (20 e 20c passate, il flag ha un test). **Dall'IDE, installando SWS**: scheda Installazione, «Installa anche OpenPLC» spuntata. Alla
        fine il riquadro della Connessione dice «Acceso».
20c. [x] **Dalla guida del cloud** (WP630, 02-11-2026: aggiornato alla 2.24.0 col comando della guida, OpenPLC e programma tenuti): la casella aggiunge `--con-openplc` all'ultimo comando. Si prova
        dopo una release: lo script viene dall'immagine del registry.
21. [x] L'Editor di OpenPLC **dal PC Windows**, sulla stessa rete, si collega alla 8443 del pannello
        senza tunnel, crea l'utente e carica un programma. La logica sta in `<progetto>/openplc/`.
22. [x] (05-11-2026, IDE 8460) La logica viaggia col progetto: backup, export e deploy la portano; `git` la prende da sé.
22b. [x] **Dall'IDE** (03-11-2026; fatto lo stesso giorno sul WP630 2.24.1: zip di 39 file caricato, riscaricato
        uguale e arrivato col deploy, `program.st` identico; trovati e corretti la codifica dei nomi nel deploy e lo zip
        non compresso): Connessione → «Logica PLC del progetto» → «Scarica (zip)», aprirla
        con l'Editor di OpenPLC sul PC Windows, modificarla, comprimere la cartella e «Carica zip…»;
        poi deploy e, sul pannello, il programma nuovo in `<progetto>/openplc/`.
23. [x] Modbus di OpenPLC risponde su `127.0.0.1:1502` e una sorgente Modbus di SWS puntata lì legge
        (`soglia_alta` = 900 col programma del laboratorio). Da Claude via SSH: sì.
24. [x] Dopo un riavvio del pannello OpenPLC riparte da solo, **col programma**.

---

## F-bis. Il tubo che segue un oggetto mosso da una variabile — chiusa

Confermato dal maintainer su tutti e due i motori, LVGL compreso sul WP630
(`docs/archive/2026-10-21-tubo-che-segue-gli-oggetti.md`), con la guardia `check_tubo_segue_lvgl.sh`. Tolta il 05-11.

---

## G. OPC-UA — strutture, dai due lati

Si può fare sul PC, senza pannello.

24. [ ] **Il nostro server**: un progetto con un tag **composito** (istanza di un tipo). Nel
        browse di un client terzo (UaExpert, o il nostro) la radice deve essere una **variabile**
        con un `DataType` struttura (dalla 4d, 23-10-2026: prima era una cartella), con un nodo
        figlio per foglia che ha l'identificatore del percorso (`motore1.velocita`). UaExpert deve
        mostrare il valore della radice coi suoi campi, non un `ExtensionObject` illeggibile.
25. [ ] I valori dei nodi figli devono **aggiornarsi** (il `TagDb` trasmette la radice: senza
        l'espansione in foglie resterebbero fermi per sempre).
26. [ ] Scrivere su un nodo figlio da un client terzo: deve arrivare sulla foglia giusta, con la
        scala applicata.
27. [ ] **Il nostro client** contro un server con strutture: scrivere su una foglia deve usare il
        **nodo figlio**. Se il server i figli non li espone, il rifiuto deve dire **perché**, non
        «non ancora supportata».
28. [ ] **Trust store**: aggiungere una sorgente OPC-UA nuova, collegarsi a un server mai visto.
        La tabella del trust store non deve più essere vuota, «Fidati» deve spostare davvero il
        certificato, «Elimina» non deve rispondere 404.
29. [ ] Una sorgente OPC-UA **vecchia** (che non dichiara la policy) deve continuare a collegarsi
        **come prima**. Se si stacca, la regola di compatibilità non ha funzionato ed è un difetto
        grave: sarebbe un aggiornamento che stacca impianti funzionanti.
30. [ ] **Il nostro client contro un server di terzi con strutture** (4d, passi 10-12, 25-10-2026):
        una sorgente OPC-UA con un tag composito mappato su un nodo struttura di un altro server
        (`node-opcua-server-example` ne ha). Le foglie del tag devono avere i valori del server,
        con qualità buona, e seguirne i cambi. Se restano `Bad`, nel log della sorgente c'è
        «albero dei tipi non costruito» col motivo — oppure il tipo è una union (non si legge, ed
        è dichiarato) o è annidato (fuori portata, dichiarato).

---

## G-ter. I tag compositi nell'editor (Fase 2 del piano dei tag, mai collaudata a schermo)

Si fa sul PC, nell'IDE.

31. [x] Configurazione → Variabili → **Tipi**: creare un tipo `Motore` con due membri, poi un tag
        istanza di `Motore`. Nell'albero il tag deve mostrare le foglie (`motore1.velocita`…).
        **Passa** (26-10-2026).
32. [x] Un oggetto del sinottico legato a una **foglia** (`motore1.velocita`): il completamento del
        percorso deve proporla, e il valore deve arrivare. **Passa** (26-10-2026).
33. [ ] **Rinominare** il tag radice: i riferimenti alle foglie nei sinottici devono seguire.

    > **NON PASSA — 26-10-2026.** Rinominando `motore1` in `Pompa2` la variabile si è sdoppiata:
    > nell'elenco è comparso un tag piatto `motore1.velocita` di tipo `f64`, accanto a `Pompa2`.
    >
    > Misurato in `CasaDomotica` sul VPS, non dedotto. In `project.yaml` ci sono **tutti e due**:
    > `- id: Pompa2 … type_ref: motore` e `- id: 'motore1.velocita '`. In `synoptics/Home.yaml`
    > l'oggetto punta **ancora** a `'motore1.velocita '`, cioè **al nome vecchio**.
    >
    > I due meccanismi che servirebbero **esistono già** e funzionano: `rinomina()`
    > (`tag/rinominaTag.ts:205`) segue anche i percorsi delle foglie quando la radice è
    > composita, e `ePercorsoDiUnaRadice` (`tag/riconciliaTag.ts:148`) impedisce di creare un
    > tag piatto dentro una radice. Non sono stati eseguiti perché la rinomina non è passata di
    > lì: `TagsTab.tsx:142` offre la rinomina-ovunque (l'icona ✎, riga 607) **solo per gli id già
    > salvati su disco**, e scrivere direttamente nel campo del nome rinomina solo quella riga.
    > Poi, al salvataggio, la riconciliazione ha visto il sinottico citare `motore1.velocita `
    > senza più una radice `motore1`, e l'ha creato — facendo esattamente il suo mestiere.
    >
    > Quindi il difetto è nell'interfaccia, non nelle due funzioni: **il campo del nome è
    > modificabile e la modifica non trascina niente**, mentre la rinomina sicura sta dietro
    > un'icona. Da decidere come chiuderlo — vietare la scrittura diretta, o farla passare
    > sempre da `rinomina()`.
    >
    > **Secondo rilievo, minore ma suo**: il membro del tipo è stato accettato come `velocita `
    > **con uno spazio in coda**, e lo spazio è finito nel percorso della foglia. Un id così non
    > lo ridigita giusto nessuno. I nomi dei membri vanno ripuliti in ingresso.
    >
    > **Ripulito il 05-11-2026** dal maintainer. Era: la prova è stata fatta dentro `CasaDomotica`, il progetto di riferimento.
    > Vanno tolti il tipo `motore`, il tag `Pompa2`, il tag orfano `'motore1.velocita '` e
    > l'oggetto in `Home.yaml:79`.
34. [x] (07-11-2026, TC620, tapparelle di «Collaudo 2.26») Un faceplate con parametro `istanza(Motore)`: scegliendo l'istanza, i campi si legano da soli.

---

## G-bis. Sparkplug B — serve un nodo vero (o un simulatore)

Il difetto corretto il 23-10-2026 è provato da dodici test che si costruiscono i byte a mano dai
numeri della specifica, quindi la decodifica è verificata. **Quello che i test non possono dire è
se un impianto vero parla come la specifica dice.**

32. [ ] Puntare una sorgente Sparkplug B a un nodo vero, o a un simulatore (Ignition, o
        `tahu`/`pysparkplug`). I valori devono arrivare — prima **non arrivavano affatto**: una
        metrica intera faceva rifiutare l'intero payload.
33. [ ] Verificare che arrivino anche i dati che usano **solo l'alias**: NBIRTH col nome, poi
        NDATA col solo numero. È il modo normale di Sparkplug e prima lo scartavamo in silenzio.
34. [ ] Un intero **negativo** (Int16 o Int32) deve arrivare negativo, non come un numero enorme.
35. [ ] Una metrica dichiarata **nulla** deve lasciare il valore precedente e marcare il tag
        Uncertain, non scrivere uno zero.
36. [ ] Se la sorgente ha una metrica scrivibile: un comando (NCMD) deve essere **accettato** dal
        nodo. Prima il payload che spedivamo non era leggibile, e non portava il tipo dichiarato.

---

## H. Ruoli e registro

30. [x] **Superata dal codice il 25-10-2026** (`9d58dbf3`): il trust store non sta più nella card della sorgente, che
        manda a Sicurezza → Certificati (solo Admin). Per un Supervisore il link porta in silenzio alle Variabili.
31. [ ] Generare, caricare e togliere un certificato, e fidarsi/eliminare un certificato OPC-UA:
        ognuna delle operazioni deve lasciare una voce nel **registro di audit**, **con il nome**
        di chi l'ha fatta.

---

## Non è un collaudo, ma è dovuto

- **CasaDomotica.** La regola di `CLAUDE.md` del 16-10-2026 dice che quando una funzione visibile
  entra in `main` va messa anche nel progetto di riferimento. Di questo giro le candidate sono: una
  sorgente **OPC-UA con una struttura** (oggi CasaDomotica non ne ha), e il **TLS acceso** sul
  pannello di casa. OpenPLC in un impianto domestico probabilmente non ha un posto sensato — e se
  è così **vale la pena annotarlo**, perché è un indizio su chi sia il destinatario di quella
  funzione.
- **`NOVITA.yaml`.** Il blocco `Unreleased` porta sei voci. Vanno rilette prima del rilascio: una
  voce aggiunta **dopo** che l'immagine è stata costruita non è nella sua etichetta, quindi non è
  vera.
