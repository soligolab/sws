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
- Nessun accesso a pannelli o al VPS in queste sessioni: quello che vuole un dispositivo diventa una voce di
  `docs/COLLAUDI_IN_SOSPESO.md`.
- Ogni sessione aggiunge il suo paragrafo a `docs/sicurezza/valutazione-rischio.md` e al capitolo 17 del manuale, così
  C8 cresce col lavoro.

## Le sessioni

| # | Ramo | Cosa | Stato |
|---|---|---|---|
| 1 | `docs/cra-1-true-statements` | I testi falsi in pubblico corretti, lo scheletro della valutazione del rischio ([piano](2026-11-17-cra-1-testi-veri.md)) | **fatta, da validare** il 18-11: frasi false corrette in `SECURITY.md`, README, manuale e commenti; indice di `docs/sicurezza/`, bozza interna della valutazione del rischio, guardia `check_security_docs.sh`; due revisioni, correzioni in `8f9dda06` |
| 2 | `fix/cra-2-cloud-isolation-sandbox` | Segreto del gateway per container, espressioni in sandbox, `getattr` sicuro, tetti agli zip | da fare |
| 3 | `fix/cra-3-control-panel-access` | Pannello di controllo: PIN iniziale valido solo dallo schermo, rotte tolte dove non c'è un dispositivo (IDE e gateway del cloud), blocco del PIN non più unico per tutti, PIN sbagliati nell'audit, punto d'accesso Wi-Fi; porte di OpenPLC; cambio password obbligatorio anche sulla porta del viewer; installazioni native senza `admin`/`admin` e senza root; la guardia delle rotte aperte | da fare |
| 4 | `feat/cra-4-factory-reset` | C5: il reset completo, la guardia, il Tiny TY, i dati orfani nel cloud | da fare |
| 5 | `feat/cra-5-signing-sbom-scan` | C7 dal lato della build: firma, SBOM, scansione | da fare |
| 6 | `feat/cra-6-update-notices` | C7 dal lato del pannello e gli avvisi | da fare |
| 7 | `docs/cra-7-technical-file` | C8: valutazione del rischio, fascicolo, capitolo Sicurezza | da fare |

## Le decisioni prese in autonomia

Ogni riga: la decisione, il perché, cosa cambia per chi usa SWS, come si disfa.

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
