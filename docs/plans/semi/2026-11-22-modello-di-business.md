# Il modello di business: profili d'uso, supporto commerciale, la pagina iniziale — seme

> **Stato: seme — decisione.** Nato il 22-11-2026 dal maintainer: «vorrei iniziare a valutare il modello di business
> ideale, idealmente vorrei tenere il codice OpenSource con dei limiti per uso commerciale e poi offrire alcuni profili di
> utilizzo, uno gratuito abbastanza limitato e poi dei profili a pagamento più orientati al mondo business. Il cliente
> si registra gratuitamente e poi valuta se passare ai profili avanzati. In aggiunta ci sono 3 livelli di supporto
> commerciale. Tutto questo sarà spiegato nella pagina iniziale sws.soligo.net».
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan approfondita, dedicata, per sviscerarne tutti
> i dettagli.** Qui ci sono le decisioni già prese, le misure del 22-11-2026 e le domande per quella sessione.

## Le decisioni già prese (22-11-2026)

1. **La licenza resta quella di oggi: `AGPL-3.0-only OR LicenseRef-SWS-Commercial`** (dalla 2.26.0, decisa il
   10-11-2026, [`LICENSING.md`](../../../LICENSING.md), piano archiviato
   [licenza del software](../../archive/2026-10-29-licenza-del-software.md)). Messa davanti alla scelta fra «limiti per
   uso commerciale» (BSL 1.1 o FSL: codice pubblico ma non più open source OSI) e l'open source vero, il maintainer ha
   scelto di restare AGPL + commerciale. Quindi **il codice non limita l'uso commerciale**: si guadagna con
   - il **servizio cloud** a profili (il valore è l'ospitalità, il tunnel, i backup, l'aggiornamento, l'IA);
   - il **supporto commerciale** a livelli;
   - la **licenza commerciale** per chi non vuole gli obblighi AGPL (un costruttore di pannelli che modifica SWS e non
     vuole pubblicare le modifiche, un OEM che lo mette in un prodotto chiuso, chi offre SWS modificato come servizio
     senza dare il sorgente).
2. **I profili si distinguono per quantità, non per funzioni**: pannelli collegati, progetti, spazio. Tutte le
   funzioni restano in tutti i profili (coerente con l'open source: chi installa SWS da sé le ha comunque).
3. **A vendere sarà una società da costituire**, titolare del servizio e dei contratti. Oggi il titolare è Mauro Soligo
   persona fisica («Soligonet»).
4. Il percorso del cliente: **si registra gratis**, prova, e passa a un profilo a pagamento quando gli serve.
5. **Si prepara tutto adesso, e si lavora come su un prodotto commerciale; i servizi commerciali si presentano
   «prossimamente»** (il maintainer, stesso giorno: «l'idea è che preparo tutto ora e lavoro come fosse un prodotto
   commerciale, i servizi commerciali però li presento coming soon»). Quindi:
   - **adesso, davvero**: la registrazione gratuita e il profilo gratuito con i suoi tetti; la pagina iniziale con
     l'offerta completa; i profili a pagamento e i tre livelli di supporto **descritti** con il loro contenuto, e il
     segno «prossimamente» al posto del prezzo e del pulsante d'acquisto;
   - **dopo, quando ci sarà la società**: pagamenti, fatture, contratti di supporto, il passaggio di profilo
     self-service. Nel frattempo un profilo superiore si assegna a mano dalla console (come oggi i tetti), per chi lo
     chiede o per le prove;
   - **«come un prodotto commerciale»** vuol dire anche lavorare già alle regole che varranno allora: il CRA (il piano
     parcheggiato), le condizioni d'uso e la privacy, la documentazione, i tempi di risposta che il supporto prometterà.

## Cosa c'è già (misurato il 22-11-2026)

- **I tetti per azienda** nel database delle identità (`sws-identita`, tabella `aziende`): `max_progetti_aperti`
  (container accesi insieme), `max_progetti_totali`, `max_pannelli`, `max_byte`. Sono fatti rispettare dal runtime
  (`sws-web/src/projects.rs`: spazio e progetti totali) e si impostano **a mano** dalla console della piattaforma
  (`amministrazione.rs`). È la base dei profili: un profilo è un insieme di questi quattro valori.
- **Le aziende si approvano** (`StatoAzienda`: in attesa / approvata): oggi un essere umano approva ogni azienda.
- **L'IA** ha la spesa per scopo e i tetti (`ai/spending.rs`, `tetto_usd`), e le chiavi dell'account.
- **Le condizioni d'uso e l'informativa privacy** del servizio esistono (`docs/legale/`), con un segnaposto per il
  titolare.
- **Il nome**: c'è un seme a parte, [hmify](2026-11-01-hmify.md) (domini registrati il 01-11-2026). La pagina iniziale
  e i nomi dei profili si scrivono una volta sola se il nome è deciso prima.
- **Non c'è**: nessun pagamento, nessuna fattura, nessun profilo con nome, nessun passaggio automatico fra profili,
  nessuna pagina pubblica che spieghi l'offerta.

## Uno schema di partenza, da discutere (i numeri sono segnaposto)

| Profilo | Per chi | Pannelli | Progetti | Spazio | Supporto |
|---|---|---|---|---|---|
| **Gratuito** | provare, casa, didattica | 1 | 2 | 1 GB | comunità (issue, documentazione) |
| **Professionale** | il piccolo integratore, un impianto | ~5 | ~10 | ~20 GB | livello 1 |
| **Business** | integratori, più impianti | ~25 | illimitati | ~100 GB | livello 2 |
| **Enterprise** | su misura, installazione propria o dedicata | su contratto | | | livello 3, SLA |

**Tre livelli di supporto**, per esempio: (1) posta elettronica, risposta in 2-3 giorni lavorativi; (2) risposta in un
giorno lavorativo, assistenza remota, aiuto sui progetti; (3) SLA con tempi di intervento, reperibilità, canale
dedicato. Da decidere se il supporto si compra a parte o è legato al profilo (nello schema: legato).

## Da decidere nella sessione di plan

- **I profili**: quanti, nomi, numeri, prezzi (mensile/annuale), cosa succede al superamento di un tetto (blocco,
  avviso, periodo di grazia), un pannello installato da sé e collegato al cloud conta come pannello del profilo?
- **Il supporto**: legato al profilo o venduto a parte; cosa copre (il software, i progetti del cliente, i pannelli
  Pixsys?); chi lo dà oggi (il maintainer da solo) e cosa promettere di conseguenza.
- **La licenza commerciale**: un listino o «su richiesta» come oggi; il caso Pixsys e i costruttori di pannelli.
- **La registrazione gratuita**: senza approvazione a mano (oggi ogni azienda si approva) o con; verifica dell'email;
  limiti contro l'abuso del gratuito.
- **Il passaggio di profilo dentro il prodotto**: una pagina «Il tuo profilo» nella console dell'azienda, il pagamento
  (Stripe o simili), le fatture (in Italia fatturazione elettronica SDI; IVA europea per i clienti esteri), il rinnovo,
  la disdetta e cosa resta dei progetti.
- **La società**: forma, sede, chi è il titolare dei diritti sul codice (oggi Mauro Soligo; la CLA dei contributori
  nomina lui), contratti, condizioni d'uso e privacy aggiornate col nuovo titolare.
- **Il CRA**: vendendo il servizio e il supporto, SWS diventa un prodotto messo sul mercato da un'impresa; gli obblighi
  del Cyber Resilience Act valgono pieni. Il piano [CRA](../2026-11-17-cra-sessioni-e-decisioni.md) è parcheggiato:
  va ripreso prima di vendere.
- **La pagina iniziale di `sws.soligo.net`** (o del nome nuovo): cosa fa SWS, i profili a confronto, il supporto, la
  licenza spiegata in due righe («open source AGPL; licenza commerciale per chi non vuole pubblicare le modifiche»),
  registrazione, accesso. Dove vive (oggi la radice del dominio è il gateway; il seme hmify proponeva GitHub Pages per
  la vetrina).
- **La raccolta dei contatti** (decisa dal maintainer, stesso giorno: «buona idea la raccolta contatti»): accanto a
  ogni servizio «prossimamente» un «avvisami» che lascia l'email (e il profilo o il livello di supporto che interessa);
  un «contattaci» per la licenza commerciale e l'Enterprise già da subito. Da decidere: dove si salvano (il database
  delle identità del gateway, una tabella a parte; mai in un servizio esterno senza deciderlo), il consenso esplicito e
  la voce nell'informativa privacy (finalità, conservazione, revoca), la conferma dell'indirizzo (doppio opt-in), la
  protezione dall'abuso (limite per indirizzo IP, nessun captcha di terzi), come il titolare li legge ed esporta dalla
  console, e come li cancella su richiesta.
- **L'ordine**: prima il nome (hmify) o prima i profili; cosa del gratuito e della pagina iniziale va fatto prima di
  aprire la registrazione a tutti (oggi ogni azienda si approva a mano).
