# Gap analysis CRA — SWS e il Cyber Resilience Act europeo

> **Analisi — decisione** (05-10-2026), richiesta del maintainer: «avvia una gap analysis per la compatibilità CRA
> europea». È una **prima passata**: misura SWS com'è oggi (`main` = 2.12.0-rc.23) contro i requisiti del
> Regolamento (UE) 2024/2847, e propone una roadmap. Le decisioni marcate **[D]** sono del maintainer; quando il
> lavoro parte, ogni blocco della roadmap va aperto con una sessione di plan dedicata.
>
> Non è un parere legale: classificazione del prodotto e ruolo di «fabbricante» vanno confermati con chi segue la
> conformità (Pixsys / consulente).

## 1. In sintesi

SWS parte **meglio della media** su processo e tracciabilità — politica di divulgazione (`SECURITY.md`),
`cargo audit` e SBOM CycloneDX in CI, vulnerabilità accettate motivate una per una, registro di audit a catena di
hash firmata, password argon2 con limite ai tentativi, aggiornamenti con istantanea e ritorno, segreti separati e
mascherati. Ma ha **lacune strutturali su «sicuro per impostazione predefinita»**, che è il cuore dell'Allegato I:

1. **Senza utenti il pannello è aperto** — *integrato nel piano [identità, utenti e istanze](2026-09-18-identita-utenti-istanze.md), sezione «Vincoli dal CRA»* — (Admin sintetico, `senza_autenticazione()` in `sws-web/src/router.rs`), e
   un'istanza IDE non ha mai password (Q56). Il TC620 di prova oggi risponde `200` senza login su `:8444/api/projects`
   e `/metrics`.
2. **HTTP in chiaro di default** (`plain HTTP mode` in `sws-runtime/src/main.rs`), TLS solo autofirmato e opzionale.
3. **TLS dei protocolli di campo non verificato di default**: MQTT con `insecure_skip_verify` (Q49 aperto),
   OPC-UA con `trust_all_certs: true` di default e security policy `None`.
4. **Catena degli aggiornamenti senza firma**: immagini su `ghcr.io` senza firma né verifica (nessun cosign /
   `policy.json`), aggiornamento automatico **spento** di default.
5. **Gestione delle vulnerabilità solo abbozzata**: contatti e pagina degli avvisi sono segnaposto
   (`security@soligolab.example`), supporto «solo l'ultima release» (il CRA chiede un periodo di supporto, ≥ 5 anni
   salvo vita più breve), nessuna procedura per le **segnalazioni dell'art. 14, in vigore dall'11-09-2026**.

## 2. Ambito e premesse

| Tema | Stato | Note |
|---|---|---|
| Prodotto CRA | **il runtime**: immagine `sws-runtime` (arm64/amd64), archivio offline, viewer LVGL | È l'unica parte che il cliente **installa**, quindi l'unica messa a disposizione sul mercato come prodotto |
| Fuori perimetro CRA | **l'IDE ospitato** su `sws.soligolab.net` | Servizio, non prodotto. Il CRA prende un servizio remoto solo se è *integrale* a un prodotto (art. 3(2)): qui il pannello esegue il progetto già deployato e resta usabile senza Internet (decisioni 21-22 del piano utenti), quindi non lo è. Restano NIS2 (soglie dimensionali verosimilmente non raggiunte) e il GDPR — e restano, a maggior ragione, i requisiti di sicurezza: è un IDE esposto a Internet |
| Fabbricante | **Soligonet, sola** (deciso 05-10-2026) | Il prodotto è software e solo suo; i pannelli Pixsys sono **banco di sviluppo**, non prodotti venduti con SWS dentro. Pixsys non immette nulla sul mercato e non è fabbricante di niente ai fini del CRA — il branding `pixsys` nell'IDE non cambia questo |
| Classificazione | probabilmente **categoria predefinita** | Gli SCADA/IACS non compaiono negli elenchi dell'Allegato III (classi I e II) né IV nel testo finale → autovalutazione (modulo A, art. 32). **Da confermare** |
| Date | art. 14 dall'**11-09-2026**; tutto il resto dall'**11-12-2027** | Le segnalazioni valgono già, anche per prodotti immessi prima |
| Stato del prodotto | PoC (CONTEXT.md), **nulla ancora sul mercato** | Gli obblighi scattano con l'immissione sul mercato. Niente è nelle mani di terzi, quindi **nemmeno l'art. 14 è ancora attivo**: serve pronto *prima della prima consegna*, non oggi. La prima stesura di questo documento diceva «già in ritardo» — era sbagliato, e la correzione cambia la fretta di tutto il P0 |
| Norme di riferimento | IEC 62443-4-1 (processo), 62443-4-2 (componenti), 62443-3-3 (sistema) | Le norme armonizzate CRA sono in preparazione; IEC 62443 è il riferimento naturale per un prodotto di automazione |

## 3. Allegato I, parte I — requisiti del prodotto

Legenda: ✅ c'è · ⚠️ parziale · ❌ manca.

| | Requisito | Stato | Evidenza nel codice | Lacuna → azione |
|---|---|---|---|---|
| (1) | Livello di sicurezza adeguato ai rischi | ⚠️ | molte scelte motivate nei commenti e nei piani | **Manca la valutazione del rischio** formale (art. 13(2)), da allegare alla documentazione tecnica |
| a | Nessuna vulnerabilità sfruttabile nota al rilascio | ⚠️ | `cargo audit` in CI; 5 avvisi accettati in `sws-runtime/.cargo/audit.toml` (rsa Marvin via async-opcua, rustls-webpki via rumqttc) | Nessuna scansione di **dipendenze JS** (`pnpm audit`), **Python** (`requirements.txt`) e **pacchetti dell'immagine** (base OS): aggiungere scanner immagine (es. Trivy/Grype) in CI e un gate di rilascio |
| b | Sicuro per default, con ripristino | ❌ | `senza_autenticazione(ide_only, ha_utenti)`; HTTP in chiaro; OPC-UA `trust_all_certs` default `true`; MQTT skip-verify | Primo avvio **con credenziale obbligatoria** (account creato all'installazione o password monouso), TLS acceso di default, verifica dei certificati di campo accesa di default; **ripristino alle impostazioni sicure** (oggi non c'è un reset di fabbrica dei dati) |
| c | Aggiornamenti di sicurezza, automatici di default con opt-out | ⚠️ | aggiornamento dal registry con canale, finestra, pilota automatico, istantanea e ritorno; **timer spento di default** (quadlet) | Valutare **auto-update di sicurezza attivo di default** (opt-out) o motivare perché no (ambienti industriali: aggiornamento controllato è prassi IEC 62443 — da documentare nella valutazione del rischio); notifica degli aggiornamenti disponibili già c'è |
| d | Controllo d'accesso, autenticazione, segnalazione di accessi non autorizzati | ⚠️ | argon2, rate limit sul login (`sws-auth`), ruoli Viewer/Operator/Admin, `auth.login_failed` in audit, IP allowlist | Rotte **pre-auth** sul router completo: upload/cancella/rinomina/apri progetto, `/api/fs/browse-dirs`, `/api/fs/mkdir`, `/metrics`; IDE senza password (Q56); nessun avviso attivo su tentativi ripetuti (solo registro) |
| e | Riservatezza (cifratura in transito / a riposo) | ❌ | TLS opzionale autofirmato; segreti in `secrets.yaml` separato e mascherato; pinning TOFU dei dispositivi (`certificati.rs`) | HTTP in chiaro di default (e companion `:8080`); nessuna cifratura a riposo di segreti e storico; MQTT/OPC-UA come sopra. Modbus/S7/EtherNet-IP non hanno cifratura: va **dichiarato** e mitigato con indicazioni di segmentazione (Allegato II) |
| f | Integrità di dati, comandi, programmi e configurazione | ⚠️ | audit a catena di hash con HMAC (`sws-audit/chain.rs`); validatore del progetto; immagine con etichetta di versione | **Immagini non firmate** né verificate all'installazione; progetti caricati (ZIP) non firmati; script Python di progetto eseguiti **senza sandbox** se RestrictedPython manca (`sws-pyscript`) |
| g | Minimizzazione dei dati | ⚠️ | storico per tag (opt-in), backup senza storico | **Assistente IA**: dati di progetto inviati ad Anthropic quando configurato — serve informativa e opt-in esplicito; log con dati personali (utenti/email) da rivedere |
| h | Disponibilità delle funzioni essenziali, resilienza a DoS | ⚠️ | riconnessione con attesa crescente (`riconnessione.rs`), `Notify=healthy` e ritorno automatico, istantanea dei dati | Nessun limite di richieste sulle API (solo login); nessun limite di dimensione su tutte le rotte di upload (alcune sì: `LIMITE_CORPO_UPLOAD`) — da censire |
| i | Minimo impatto su altri dispositivi/reti | ⚠️ | polling configurabile, timeout per dispositivo | Scritture verso il campo: limitare/registrare (già in audit `tag.write`); documentare il carico sul bus |
| j | Superficie d'attacco limitata | ⚠️ | `--no-admin` sul pannello (porta 8444 solo gestione); container rootless; `AddDevice` solo se la porta esiste | Montati nel container **bus D-Bus di sistema e utente** (documentato nel quadlet, «dà accesso a tutto il bus»); `/metrics` aperto; rotte pre-auth; `Network=host` |
| k | Mitigazione dell'impatto di un incidente | ⚠️ | container rootless con `keep-id`, segreti separati, ruoli | Script Python a privilegi pieni senza RestrictedPython; nessuna separazione fra processo che parla col campo e interfaccia web |
| l | Registrazione e monitoraggio degli eventi rilevanti (con opt-out) | ✅/⚠️ | `audit.jsonl` a catena firmata: login/logout/falliti, utenti, progetto, script, scritture e rifiuti, ricette, deploy, aggiornamenti, backup, download | Esportazione verso un SIEM / syslog; conservazione e rotazione documentate; opt-out dichiarato |
| m | Cancellazione sicura dei dati e trasferimento | ❌ | cancellazione progetto e backup; export progetto | **Reset di fabbrica** (progetti, storico, utenti, segreti, certificati, config) che non c'è; trasferimento sicuro (export cifrato?) da decidere |

## 4. Allegato I, parte II — gestione delle vulnerabilità

| | Obbligo | Stato | Evidenza | Lacuna → azione |
|---|---|---|---|---|
| 1 | Identificare e documentare componenti e vulnerabilità, **SBOM** leggibile a macchina | ⚠️ | job CI `rust-sbom` (CycloneDX per crate) | SBOM **di prodotto** unico per release: runtime + editor (npm) + Python + **immagine** (pacchetti OS), allegato a ogni rc/release e conservato |
| 2 | Correggere senza ritardo, con aggiornamenti | ⚠️ | pipeline rc/canali, `audit.toml` motivato | SLA interni per gravità; backport sulle versioni supportate (oggi «solo l'ultima») |
| 3 | Test e revisioni di sicurezza regolari | ⚠️ | 31 guardie statiche (es. `check_segreti`, `check_password_browser`), revisione pre-2.7.0 | Test di sicurezza dedicati (fuzzing dei parser Modbus/S7/OPC-UA/YAML, DAST sulle API), revisione periodica pianificata |
| 4 | Divulgare le vulnerabilità corrette (avvisi) | ❌ | `SECURITY.md` rimanda a una pagina segnaposto | Pagina avvisi reale (GitHub Security Advisories è già il canale indicato) e CVE tramite CNA (GitHub) |
| 5 | Politica di divulgazione coordinata (CVD) | ⚠️ | `SECURITY.md`: 5 giorni lavorativi per la risposta, 90 per la correzione | Contatti veri (email + chiave PGP), politica pubblicata sul sito |
| 6 | Punto di contatto per le segnalazioni | ⚠️ | GitHub Advisories | Email reale; `security.txt` (RFC 9116) sul sito e, opzionale, servito dal runtime |
| 7 | Distribuzione sicura degli aggiornamenti | ⚠️ | HTTPS verso `ghcr.io`, istantanea + ritorno | **Firma** delle immagini (cosign/sigstore) e **verifica** sul pannello (`policy.json` di podman / `containers-policy`), firma anche dell'archivio offline |
| 8 | Aggiornamenti di sicurezza gratuiti, con avvisi, per il periodo di supporto | ⚠️ | `NOVITA.yaml` mostrata prima di aggiornare | Periodo di supporto dichiarato **[D]**; disponibilità degli aggiornamenti per almeno 10 anni o per il periodo di supporto; avvisi di sicurezza distinti dalle novità |

## 5. Altri obblighi

| Obbligo | Stato | Azione |
|---|---|---|
| **Art. 14 — segnalazioni** (vulnerabilità sfruttate attivamente e incidenti gravi): preallarme **24 h**, notifica **72 h**, rapporto finale **14 giorni** (vuln.) / **1 mese** (incidente), al CSIRT coordinatore e a ENISA tramite la piattaforma unica; informare gli utenti | ❌ **già applicabile** | Procedura interna (chi, come, con quali dati), referente, registrazione alla piattaforma ENISA, modello di avviso agli utenti, esercitazione |
| Art. 13 — valutazione del rischio e documentazione tecnica (Allegato VII) | ❌ | Documento di valutazione del rischio; fascicolo tecnico: architettura (`docs/manual/03_architecture.md` è una base), SBOM, test, gestione vulnerabilità, periodo di supporto |
| Art. 13 — periodo di supporto (≥ 5 anni salvo vita più breve) | ❌ | **[D]** definire e pubblicare; adeguare `SECURITY.md` («solo l'ultima release») |
| Art. 13 — vulnerabilità nei componenti: segnalarle a chi li mantiene | ⚠️ | Già fatto informalmente (es. rumqttc/async-opcua in `audit.toml`): formalizzare |
| Allegato II — informazioni all'utente (contatti, uso previsto, rischi noti, periodo di supporto, istruzioni di messa in servizio sicura, aggiornamento, dismissione, SBOM su richiesta) | ⚠️ | Il manuale è ampio ma non ha un capitolo «sicurezza»: messa in servizio sicura (primo utente, TLS, rete separata, porte da esporre), rischi residui (protocolli di campo in chiaro), dismissione (reset) |
| Dichiarazione UE di conformità e marcatura CE (artt. 28-30) | ❌ | Dopo l'autovalutazione, per ogni versione immessa; **[D]** chi firma |
| Conservazione documentazione 10 anni | — | Il repo e i tag lo permettono; definire dove stanno SBOM e fascicolo per release |

## 6. Roadmap proposta

**P0 — ora (art. 14 già in vigore, e prima di vendere altro)**
1. **[D]** Ruolo di fabbricante e periodo di supporto; contatti di sicurezza reali in `SECURITY.md` + `security.txt`.
2. Procedura di segnalazione art. 14 (24 h / 72 h / 14 gg) con referente e registrazione alla piattaforma ENISA.
3. Pagina avvisi: GitHub Security Advisories pubblici.

**P1 — sicuro per default (blocco più grosso, ~2027)**
4. Primo avvio con credenziale obbligatoria (niente Admin sintetico sul pannello); IDE esposto con autenticazione
   (chiude Q56 / Q44); rotte pre-auth ridotte al minimo (lista bianca: login, health, cert). **Integrato nel piano
   della gestione utenti**: [identità, utenti e istanze](2026-09-18-identita-utenti-istanze.md), sezione «Vincoli
   dal CRA», che lo incastra con le decisioni del 27-09 (codice di abbinamento, 2FA, utenti d'impianto, gateway) e
   propone come primo pezzo il primo accesso del pannello e la lista bianca delle rotte pre-auth.
5. TLS di default (certificato generato al primo avvio, HTTP solo come rimando); verifica dei certificati di campo
   accesa di default (MQTT Q49, OPC-UA `trust_all_certs: false` con fiducia esplicita, policy diversa da `None`).
6. Reset di fabbrica sicuro (requisito m) e ritorno alle impostazioni sicure (b).
7. Sandbox degli script Python obbligatoria nell'immagine (RestrictedPython presente e verificato all'avvio).

**P2 — catena di fornitura e processo**
8. Firma delle immagini e degli archivi (cosign) + verifica sul pannello; SBOM di prodotto per release (runtime,
   editor, Python, immagine) allegato alla release; scansione dell'immagine in CI con gate.
9. Valutazione del rischio formale e fascicolo tecnico (Allegato VII); capitolo «Sicurezza» del manuale (Allegato II).
10. Test di sicurezza: fuzzing dei parser dei protocolli e del YAML di progetto, DAST delle API, revisione annuale.
11. Header HTTP di sicurezza (CSP, `X-Frame-Options`/`frame-ancestors`, HSTS quando TLS), limiti di richieste e di
    dimensione su tutte le rotte di scrittura; `/metrics` dietro autenticazione.
12. Montaggi D-Bus ristretti (proxy della sola interfaccia del launcher, già ipotizzato nel quadlet).

## 7. Decisioni del maintainer — prese il 05-10-2026

Le cinque **[D]** sono state poste una alla volta e risolte tutte. Quello che segue è ciò che è stato deciso, con
il motivo dove è servito.

1. **Fabbricante: Soligonet, sola.** Posta prima come «Soligonet e/o Pixsys», è stata riaperta e corretta nella
   stessa sessione: «l'utilizzo di prodotti Pixsys è solo a scopo di sviluppo, il prodotto è solo software e solo
   mio». Pixsys esce dal quadro CRA. Vedi §2.

2. **Periodo di supporto: 5 anni dall'ultima release, supportata solo l'ultima.** È il minimo di norma del CRA, e
   conserva la regola di oggi: le correzioni di sicurezza escono sull'ultima versione e chi vuole restare sicuro
   aggiorna. Niente backport, niente rami di manutenzione — con un solo sviluppatore sarebbe un impegno che non si
   regge. Da scrivere in `SECURITY.md`, che oggi dice «solo l'ultima release» senza dichiarare un periodo.
   **Conseguenza da documentare nelle istruzioni d'uso**: un pannello che non può aggiornare (validazione di
   processo, impianto fermo) resta scoperto.

3. **Aggiornamenti di sicurezza: accesi di default**, con finestra di manutenzione, istantanea prima e ritorno
   automatico se il servizio non diventa `healthy`; disattivabili dalla configurazione, e la disattivazione va
   nell'audit. Costa poco perché la macchina c'è già tutta: oggi manca solo che il timer nasca acceso.
   **Prerequisito non negoziabile**: prima va chiuso il seme
   [il viewer non riparte dopo un aggiornamento](2026-10-01-viewer-non-riparte-dopo-aggiornamento.md). Un
   aggiornamento automatico notturno su quel difetto spegne schermi senza nessuno davanti — il contrario di un
   aggiornamento di sicurezza.

4. **Primo avvio: il codice di abbinamento è anche il primo accesso.** Un meccanismo solo invece di due. Al primo
   avvio il pannello genera un codice monouso e lo mostra sullo schermo LVGL **e** sulla pagina locale (decisioni
   12 e 14 del piano utenti); finché non viene usato non entra nessuno, nemmeno in lettura; chi ce l'ha davanti lo
   inserisce nell'IDE, rivendica il pannello e fissa la prima credenziale vera. Spariscono l'Admin sintetico e
   `senza_autenticazione()`, e non nasce nessuna password di fabbrica. Scioglie la proposta marcata *[D]* alla
   riga 221 del piano utenti.

5. **Priorità: P0 sì, ma il lavoro vero è il P1 di utenti, aziende e spazi di lavoro.** Parole del maintainer: «il
   prossimo step che mi interessa è l'implementazione utenti/aziende/spazi di lavoro (P1) … vorrei mostrare il
   lavoro tramite un sito web ad alcune possibili aziende facendo capire la strada che ha preso il progetto. È
   sempre un PoC quindi non mi serve una compliance CRA pesante ma i meccanismi chiave tipo la registrazione degli
   utenti, la 2FA e un po' di infrastruttura base mi servono. La CRA deve rimanere un po' sul fondo come linea
   guida».

   **Come si traduce**, ed è il criterio con cui leggere tutto il resto di questo documento: il CRA **non è il
   programma di lavoro**. È il metro con cui si giudicano le scelte di un lavoro che ha un'altra ragione — far
   vedere il progetto a delle aziende. Quindi:
   - si fa il **P0** (contatti veri, `security.txt`, procedura art. 14, pagina degli avvisi): poche ore, nessun
     codice, e serve comunque prima della prima consegna;
   - si fa il **P1 limitatamente a utenti, aziende, spazi di lavoro, registrazione e 2FA**, perché è la
     funzionalità che il maintainer vuole mostrare — e di conseguenza il primo accesso (decisione 4) e la lista
     bianca delle rotte pre-auth entrano gratis, essendo lo stesso lavoro;
   - **non** si fanno adesso TLS di default, verifica dei certificati di campo, reset di fabbrica, firma delle
     immagini, SBOM di prodotto, valutazione del rischio e fascicolo tecnico. Restano scritti qui, come lista
     della spesa per quando ci sarà un prodotto da consegnare davvero.

### Quello che resta aperto dopo queste cinque

- **Classificazione del prodotto** (categoria predefinita, autovalutazione modulo A): da confermare con chi segue
  la conformità, non è un parere che questo documento possa dare.
- ~~L'IDE installabile.~~ **Chiuso il 05-10-2026**: la decisione 27 del piano utenti è stata riscritta. Il
  servizio si fornisce **solo cloud** — è il business model scelto — ma la strada del **self-host resta aperta**,
  eventualmente come container che il cliente avvia su un proprio server; non deve per forza essere installabile su
  un singolo PC. Finché è solo cloud, l'IDE è un servizio e sta fuori dal perimetro CRA; il giorno in cui un
  container self-host viene consegnato a un cliente, quello è un prodotto con elementi digitali e porta con sé gli
  obblighi da fabbricante. Il vincolo da rispettare da subito è architetturale, non normativo: il cloud deve
  restare *un modo di far girare l'IDE*, non un prodotto diverso.

## Fonti

- Regolamento (UE) 2024/2847 (Cyber Resilience Act), GU L del 20-11-2024: <https://eur-lex.europa.eu/eli/reg/2024/2847/oj/eng>
- Art. 71, date di applicazione: <https://www.springlex.eu/en/packages/cra/cra-regulation/article-71/>
- Art. 14, obblighi di segnalazione: <https://www.springlex.eu/en/packages/cra/cra-regulation/article-14/>
- Sintesi Allegato I e II: <https://opensecurityarchitecture.org/frameworks/cra>, <https://www.eucybersecurity.org/glossary/annex-i>
- Calendario 2026-2027: <https://finitestate.io/blog/cyber-resilience-act-timeline-2026-2027>
