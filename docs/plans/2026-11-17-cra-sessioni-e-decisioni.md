# CRA: le sessioni del 17-11-2026 e le decisioni prese in autonomia

> Richiesta del maintainer, 17-11-2026: «Prova a procedere una sessione alla volta su tutta la parte CRA. Prova a
> prendere tu le decisioni migliori in termini di qualità del prodotto, alla fine delle sessioni mi fai un report delle
> decisioni importanti che hai preso in autonomia e le valideremo assieme.»
>
> Questo file è il piano delle sessioni **e** il registro delle decisioni. Ogni decisione ha un numero (D1, D2…), il
> perché e cosa cambia per chi usa SWS: alla fine si validano una per una, e quelle respinte si disfano.

## Da dove si parte: la misura del 17-11-2026

La parte CRA del [piano prima fascia e CRA](2026-10-15-piano-prima-fascia-e-cra.md) diceva «restano C5–C8». Rimisurato
sul codice di `main` (`4db7e228`, 2.26.0-rc.20) con otto letture indipendenti, i rapporti sono in `tmp/cra/` (non
versionati: `annex1.md`, `reset.md`, `supply.md`, `docs.md`, `residui.md`, `web-cra.md`, `web-tools.md`, `critic.md`):

- **C6 e P5 sono fatti dal 18-10**, C4 è **parziale** dal 26-10 (il TLS si accende da sé solo dove l'installatore trova
  `certutil`): l'indice dei piani era indietro.
- **C5** esiste a metà dal 15-11 (`control_panel/reset.rs`): lascia sul pannello l'istantanea degli aggiornamenti
  (una copia intera di progetti e utenti), `tls.key`, le chiavi IA, i log.
- **C7** è tutto da fare: niente è firmato e niente è verificato, lo SBOM copre solo i crate Rust.
- **C8**: c'è solo il capitolo 17 del manuale, fermo al 20-10; valutazione del rischio e fascicolo non esistono.
- **Difetti nuovi, nati dopo il 12-10**, che un revisore CRA metterebbe davanti a tutto:
  1. il pannello di controllo è fuori dall'autenticazione e il PIN iniziale sono le ultime sei cifre del MAC: dalla
     rete, senza credenziali, si arriva a rete, riavvio e reset;
  2. nel cloud il segreto radice del gateway finisce nell'ambiente di ogni container di progetto, e le espressioni dei
     tag girano senza sandbox: chi ha un progetto nel cloud può leggerlo e diventare Admin degli altri;
  3. `admin`/`admin` nelle due installazioni native, che in più girano da root;
  4. `SECURITY.md` e il manuale dichiarano aggiornamenti automatici di default: non è vero.

Niente di questo scade oggi: i requisiti del CRA valgono dall'11-12-2027 e solo per ciò che è immesso sul mercato.
L'ordine è quindi scelto sul rischio vero per chi usa i pannelli e il cloud adesso.

## Come si lavora

**Un po' alla volta** (maintainer, 17-11-2026): «faremo questo lavoro un po' alla volta […] finisci il passo 1 poi
decidiamo». Il ramo resta aperto fra una ripresa e l'altra; si riparte dal primo passo non fatto della tabella.

- Una sessione alla volta, ognuna col suo ramo, i suoi test, due revisioni e le correzioni.
- I rami sono **annidati** (regola «un ramo alla volta», opzione 2): niente arriva su `main` e niente viene pushato
  finché il maintainer non ha validato. Dopo la validazione si fanno gli squash merge in ordine.
- Nessun accesso ai pannelli in queste sessioni: quello che vuole un dispositivo diventa una voce di
  `docs/COLLAUDI_IN_SOSPESO.md`. Il VPS sì, dal 18-11 («sul VPS sei in grado di entrare»), per leggere e misurare;
  cambiarlo resta un passo del rilascio.
- Ogni sessione aggiunge il suo paragrafo a `docs/sicurezza/valutazione-rischio.md` e al capitolo 17 del manuale, così
  C8 cresce col lavoro.

## Le sessioni

| # | Ramo | Cosa | Stato |
|---|---|---|---|
| 1 | `docs/cra-1-true-statements` | I testi falsi in pubblico corretti, lo scheletro della valutazione del rischio ([piano](2026-11-17-cra-1-testi-veri.md)) | **fatta, da validare** il 18-11: frasi false corrette in `SECURITY.md`, README, manuale e commenti; indice di `docs/sicurezza/`, bozza interna della valutazione del rischio, guardia `check_security_docs.sh`; due revisioni, correzioni in `8f9dda06` |
| 2 | `fix/cra-2-cloud-isolation-sandbox` | Segreto del gateway per container, pannello di controllo solo sui dispositivi (anticipato dalla 3), espressioni in sandbox, `getattr` sicuro, tetti agli zip ([piano](2026-11-18-cra-2-isolamento-cloud-e-sandbox.md)) | **fatta, da validare** il 18-11: decisioni D6-D12; due revisioni, correzioni nell'ultimo commit del ramo. Il ramo **non si pusha** prima che il gateway nuovo sia nel cloud (D5) |
| 3 | `fix/cra-3-control-panel-access` | Pannello di controllo: PIN iniziale valido solo dallo schermo, blocco del PIN non più unico per tutti, PIN sbagliati nell'audit, punto d'accesso Wi-Fi; porte di OpenPLC; cambio password obbligatorio anche sulla porta del viewer; installazioni native senza `admin`/`admin` e senza root; la guardia delle rotte aperte; nel cloud il peso della CPU dei container (D12) | da fare |
| 4 | `feat/cra-4-factory-reset` | C5: il reset completo, la guardia, il Tiny TY, i dati orfani nel cloud | da fare |
| 5 | `feat/cra-5-signing-sbom-scan` | C7 dal lato della build: firma, SBOM, scansione | da fare |
| 6 | `feat/cra-6-update-notices` | C7 dal lato del pannello e gli avvisi | da fare |
| 7 | `docs/cra-7-technical-file` | C8: valutazione del rischio, fascicolo, capitolo Sicurezza | da fare |

## Le decisioni prese in autonomia

Ogni riga: la decisione, il perché, cosa cambia per chi usa SWS, come si disfa.

**D1-D12 validate dal maintainer il 18-11-2026**, con quattro aggiunte scritte nelle righe: il perché di D2, l'esempio
di f-string fra i modelli (D8), il segreto del gateway da cambiare al rilascio (D10), e l'avviso quando un archivio
fatto da SWS sfora i tetti (D11).

### Generali

- **D1 — Il cloud è dentro il prodotto.** Gateway e tunnel sono «elaborazione remota» del pannello (art. 3 del CRA):
  abbinamento dal cloud, schermo remoto e deploy dal tunnel sono funzioni del pannello che senza gateway non ci sono, e
  l'immagine porta l'indirizzo del tunnel. La decisione del 05-10 («cloud fuori») è di prima del gateway. *Cambia*: la
  valutazione del rischio e il fascicolo coprono anche il gateway. *Si disfa*: togliendo quei paragrafi.
- **D2 — L'aggiornamento automatico resta spento di default. Ribalta la decisione 3 del maintainer del 05-10-2026**
  («aggiornamenti di sicurezza accesi di default», gap analysis §7), che nel codice non è mai stata attuata: il
  pilota automatico nasce spento e l'installatore non accende il timer di podman. Perché: un HMI che si riavvia da
  solo durante la produzione ferma l'impianto, e il considerando 56 del CRA (da rileggere sul testo ufficiale)
  ammette l'eccezione per gli ambienti dove l'aggiornamento automatico interferisce con il processo. Restano
  l'avviso di versione nuova, l'installazione da un Admin, la finestra programmata e il «Pilota automatico». Si
  correggono i testi che dicevano il contrario. *Cambia*: niente nel comportamento; cambia la decisione scritta.
  *Si disfa*: accendendo il pilota automatico di default, con la sua riga di compatibilità nelle Novità.
  *Il maintainer, validandola*: «l'aggiornamento e il metodo da usare è una cosa che definisce chi configura
  l'impianto, noi mettiamo a disposizione l'aggiornamento automatico con le sue opzioni ma è spento di default».
- **D3 — Nelle sessioni CRA non si fanno, perché il CRA non li chiede e costano all'uso**, e si dichiarano nella
  valutazione del rischio:
  - la firma del registro di audit (oggi è una catena di hash, firmata solo se c'è `SWS_AUDIT_KEY`);
  - la cifratura a riposo dei segreti sul pannello (oggi file con permessi 0600);
  - le opzioni di isolamento di systemd nei quadlet (`NoNewPrivileges` e simili): il 04-10-2026 un'opzione che il
    podman del pannello non conosceva ha fatto rifiutare l'intero file, e il pannello è rimasto senza runtime;
  - un gettone monouso per i WebSocket al posto del gettone di sessione nell'indirizzo;
  - il bus D-Bus nel container e i comandi che il runtime fa eseguire all'host: servono a rete, ora, schermo e
    OpenPLC.

  **2FA e LDAP restano fuori da D3**: il 05-10-2026 il maintainer li ha detti necessari (decisione 5). Non sono un
  requisito del CRA, quindi restano la voce P6 del piano prima fascia, con la sua sessione di plan, fuori da queste
  sessioni. *Si disfa*: ognuna delle voci elencate può diventare un seme.
- **D4 — Il fabbricante si scrive «Mauro Soligo (Soligonet)»**, come nella decisione del 10-11-2026; il recapito
  postale resta un campo da riempire.

### Sessione 1

- **D5 — Nel manuale pubblico si dice la verità e la difesa che c'è; le catene d'attacco ancora aperte restano nei
  documenti interni finché non sono chiuse.** *Riscritta dopo la revisione del 18-11*: la prima versione voleva
  tenere fuori dal manuale il PIN ricavato dal MAC e il segreto del gateway, ma tutti e due erano già pubblici (i
  testi dell'IDE e il CHANGELOG per il PIN, il capitolo 18 per il segreto). Quindi:
  - il capitolo 17 dice che il pannello di controllo si apre con un PIN di servizio, che quello del dispositivo non è
    un segreto, e che la prima cosa da fare è impostare un PIN del progetto: è l'unica difesa di oggi, e l'IDE la
    consiglia già;
  - le frasi false che toccano i difetti aperti si correggono senza descrivere come si sfruttano («tutte
    autenticate» diventa «autenticate tranne…»; «gli script Python» diventa «gli script del progetto»);
  - la valutazione del rischio, i piani delle sessioni e il commento di `gateway/ritorno.rs` descrivono la catena
    del cloud (un'espressione legge l'ambiente del container, e con il segreto si diventa Admin degli altri). Quella
    catena non è scritta in nessun documento pubblico: **questi file non si pushano finché la sessione 2 non l'ha
    chiusa**, e la valutazione del rischio resta interna finché nomina un difetto aperto che non è già pubblico.

  *Cambia*: chi legge il manuale oggi sa del PIN e sa come difendersi. *Si disfa*: togliendo dal capitolo 17 il
  paragrafo sul pannello di controllo.

### Sessione 2

- **D6 — Ogni container di progetto ha un segreto suo**, e il gateway lo ricalcola quando inoltra. Il segreto del
  gateway non esce più dal gateway. *Cambia*: niente per chi usa il cloud; col gateway nuovo i container si rifanno
  tutti. *Si disfa*: rimettendo il segreto del gateway nell'ambiente del container. *Corretta dalla D10*: il segreto
  del container non si ricava più dal segreto del gateway.
- **D7 — Un'espressione di un tag è un sottoinsieme di Python, nella sandbox**: valori, operatori, f-string,
  `tags[...]`, assegnazioni, `if`/`else` e un elenco fisso di funzioni (`round`, `min`, `max`, `abs`, `int`, `float`,
  `str`, `len`, `sum`, `format` e poche altre). Niente `import`, cicli, funzioni, lambda, classi, `try`, `with`,
  comprensioni, `+=`, `range`, `pow`, `str.format`, nomi o attributi che cominciano con `_`. I valori annidati
  (strutture e array) sono di sola lettura. Le 29 espressioni misurate sui progetti di theobroma passano tutte.
  - *Corretta dopo la revisione del 18-11*: la prima versione diceva «senza cicli un'espressione finisce sempre». Non
    era vero: `10 ** 10 ** 10` tiene l'interprete per ore, e non lo si può fermare. Ora le operazioni che in un passo
    solo danno un risultato enorme si rifiutano subito: `**`, `<<`, `*` su testi ed elenchi, `round` con migliaia di
    cifre, una larghezza di formato enorme, i metodi che allungano un testo (`ljust`, `zfill`…). Restano possibili,
    scritte apposta, catene di operazioni che riempiono la memoria. Nel cloud le ferma il tetto di memoria del
    container, che è del solo progetto; sul pannello chi scrive il progetto è già il suo amministratore.
  - Senza RestrictedPython l'espressione non gira, salvo la deroga di sviluppo, che usa gli stessi nodi, le stesse
    funzioni e gli stessi controlli.
  - Un'espressione che dà errore lascia l'ultimo valore, ma **marcato «Bad»**, e il registro lo dice una volta sola
    per errore, non a ogni cambio dei tag che legge. Prima il valore vecchio restava «Good» e il registro si
    riempiva.

  *Cambia*: un'espressione che usa altro smette di dare valori, il tag diventa «Bad» e il registro dice perché; riga
  di compatibilità nelle Novità. *Si disfa*: togliendo il controllo dei nodi e tornando a `exec`.
  *Misurato sul VPS il 18-11*, dopo la validazione: le 37 espressioni e i 13 script e funzioni dei 16 progetti del
  cloud passano tutti, compilati e fatti girare con le regole nuove.
- **D8 — Negli script in sandbox `getattr` è `safer_getattr` di RestrictedPython**: niente attributi con `_`, niente
  `str.format`. Nessuno script dei progetti di theobroma usa `.format(`. Il controllo del codice (quello che usa
  l'assistente) segnala `.format(` con il suggerimento della f-string. *Corretta dopo la revisione*: `safer_getattr`
  dà `None` per un attributo che non c'è, e un errore di battitura diventava «NoneType is not callable» più avanti;
  ora è un `AttributeError` col nome, come in Python. *Cambia*: chi usa `.format` passa alle f-string; riga di
  compatibilità nelle Novità. *Si disfa*: rimettendo `getattr`. *Chiesto dal maintainer validandola*: un esempio fra
  gli script. Il modello «Avviso Telegram» dell'IDE ora scrive il messaggio con una f-string e un formato (i minuti da
  cui l'allarme è attivo, con un decimale), e un commento spiega come si legge.
- **D9 — Il pannello di controllo esiste solo dove c'è un dispositivo**: non sull'istanza IDE, non sul gateway (dove
  dava su Internet), non nei container di progetto. *Cambia*: niente per chi usa un pannello; l'IDE legge ancora la
  luminosità solo da un dispositivo. *Si disfa*: togliendo la condizione `is_device` dalle tre `merge`.
- **D10 — I container hanno una chiave loro, separata dal segreto del gateway** (dopo la revisione del 18-11). La
  D6 ricavava il segreto di ogni container dal segreto del gateway. Ma quel segreto **è stato nell'ambiente di ogni
  container fino a oggi**, e chiunque l'abbia letto con un'espressione lo ha ancora: con la D6 da solo poteva
  ricalcolare il segreto di qualunque container. Ora:
  - il gateway crea una seconda chiave, nel file `container_key` della sua configurazione, che non è mai uscita;
  - da questa si ricavano il segreto di ogni container (`"container:<azienda>/<progetto>"`) e le chiavi di ritorno
    (`"return:<azienda>/<progetto>"`), con due etichette diverse: un segreto di container non vale come chiave di
    ritorno;
  - un container porta l'impronta della chiave con cui è nato, e il gateway non riadotta un container senza
    l'impronta giusta: quelli di prima si rifanno.

  **I token dei pannelli** abbinati al cloud si ricavano ancora dal segreto del gateway: chi lo ha letto può
  presentarsi come uno di quei pannelli. **Decisione del maintainer (18-11): il segreto si cambia al rilascio**, e i
  tre pannelli di prova (`tc620-garage`, `ty570-1ad-p1-06e990`, `wp630-ufficio`) si riabbinano. Il TC620 di casa ha
  dati da conservare: prima, il backup del suo database. La procedura è nel
  [piano della sessione 2](2026-11-18-cra-2-isolamento-cloud-e-sandbox.md), «Il rilascio». *Cambia*: niente per chi
  usa il cloud. *Si disfa*: ricavando di nuovo il segreto del container dal segreto del gateway.
- **D11 — Un archivio zip che arriva da fuori ha un tetto** (bundle di progetto, logica PLC, deploy): al massimo
  10 000 voci, contate prima di leggere l'archivio; al massimo 64 MB una volta espanso, e meno per un archivio
  piccolo (8 volte la sua misura, più 16 MB); al massimo 32 MB una sola voce. Un progetto vero con molte immagini sta
  sotto: le immagini non si comprimono, quindi un archivio da 8 MB si espande poco più di 8 MB. *Cambia*: un archivio
  oltre il tetto si rifiuta con un messaggio che lo dice. *Si disfa*: alzando le costanti in `zip_limits.rs`.
  *Chiesto dal maintainer validandola*: quando è SWS a fare l'archivio, deve dire se sfora. L'export lo salva lo
  stesso (è il progetto, e un backup) e l'IDE dice perché un import lo rifiuterebbe; il deploy si ferma prima di
  partire, col motivo. Il controllo è quello dell'altro lato: i tetti di qui sopra **e** gli 8 MB che un import o un
  deploy accettano. Il tetto vero oggi è questo secondo: i bundle non sono compressi, e sul VPS `CasaDomotica_WP630`
  ne fa già 6 e `CasaDomotica` 5.
- **D12 — Il tetto di CPU dei container del cloud non si mette in questa sessione**, anche se la revisione lo
  proponeva. Il motivo: su podman senza root il controllo della CPU c'è solo se systemd lo delega all'utente, e un
  tetto che il VPS non sa applicare fa fallire l'avvio di **ogni** progetto. Il VPS in questa sessione non si
  raggiunge, quindi non si può verificare. Il danno di oggi è limitato: l'interprete Python di un container usa al
  massimo un core su due. Passa alla sessione 3, con la verifica sul VPS e, meglio di un tetto, un peso più basso per
  i container dei progetti rispetto al gateway. *Si disfa*: è una cosa non fatta.
  *Misurato sul VPS il 18-11*: Debian 13, podman 5.4.2, 2 core; systemd delega all'utente 1000 i controller
  `cpu memory pids`. Il peso e il tetto si possono quindi mettere: lo fa la sessione 3.
- **Misurato dopo la validazione**: le espressioni e gli script dei progetti del cloud. Durante la sessione il VPS
  non si raggiungeva; il 18-11 sì, e passano tutti (vedi D7).

