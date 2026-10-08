# Fase 3c — i ruoli confinano, e le quote contano

> Dettaglio della **Fase 3c** del [tronco cloud](2026-10-05-cloud-utenti-aziende-spazi.md).
> 3a e 3b sono chiuse e in archivio. **Approvato l'08-10-2026**: le decisioni in fondo sono del
> maintainer, prese una alla volta.

## Da dove nasce

Richiesta del maintainer, 07-10-2026: «una configurazione dei ruoli degli utenti, per esempio
potrei voler definire per una azienda un amministratore che vede solo la sua azienda e può
approvare nuovi utenti».

Il pezzo che manca **non è il ruolo**: è il confinamento. La stessa console, aperta da un
amministratore d'azienda, deve mostrare la sua azienda e nient'altro.

## Misurato nel codice l'08-10-2026

1. **I due ruoli non governano niente.** `membri.ruolo` è `amministratore | sviluppatore`
   (decisione 18), ma `auth_user_da_identita` (`router.rs`) li mappa **tutti e due** su
   `Role::Admin`. Fu una scelta dichiarata: l'editor non ammette meno di Admin per lavorare.
2. **La console è aperta solo all'amministratore di piattaforma**:
   `.route_layer(middleware::from_fn(require_amministratore_piattaforma))` su tutto
   `amministrazione.rs`. Non c'è nessuna via di mezzo fra «vedi tutto» e «non entri».
3. **Gli endpoint restituiscono tutto**: `elenca_aziende` dà tutte le aziende, `elenca_utenti`
   tutti gli utenti con le loro appartenenze. Nessuno filtra per chi guarda.
4. **Il confinamento dei progetti invece esiste già**, ed è la 3b: `visibilita()` decide, e
   `risolvi_progetto` la applica a ogni indirizzo. La console è l'ultimo posto che mostra ancora
   tutto a chiunque ci entri.
5. **Le quote sono colonne inerti** dal 07-10: `max_progetti`, `max_pannelli`, `max_byte` esistono
   su `aziende` e nessun conteggio le guarda. La console le mostra dicendo che non fanno niente.

## La forma probabile del lavoro

- Una guardia nuova accanto a quella esistente: entrare nella console non richiede più
  *piattaforma*, ma **piattaforma oppure amministratore di almeno un'azienda**. Chi è solo
  sviluppatore resta fuori, come oggi.
- Ogni endpoint della console filtra per le aziende di chi guarda — la stessa idea di
  `visibilita`, applicata a utenti e aziende invece che a progetti. **Una funzione sola**, come si
  è già fatto per l'elenco e per l'indirizzo: due regole da tenere d'accordo divergono.
- Le sezioni che non sono di nessuna azienda — **Posta** e **Questa installazione** — restano
  all'amministratore di piattaforma, e per gli altri non compaiono affatto (non «compaiono e
  danno 403»).
- Le quote: un conteggio al momento della creazione, e un rifiuto che dice **quale** limite è
  stato raggiunto e qual è.

## Le risposte del maintainer (08-10-2026)

> «un amministratore di azienda può creare i suoi utenti in libertà, non è un problema il numero
> di utenti di una azienda ma lo spazio, il numero di progetti contemporanei aperti (quindi il
> numero di container da avviare etc) che saranno definiti dall'admin globale. All'interno delle
> risorse che l'azienda ha concordato con l'admin globale, l'amministratore dell'azienda può fare
> tutto. Sia admin globale sia i singoli admin devono avere un sinottico dove poter visualizzare
> in un colpo d'occhio unico tutte le risorse disponibili e quante sono al limite.»

Da qui discendono quattro cose, e due di esse cambiano il piano:

1. **Gli utenti non sono una quota.** La colonna che la 3a aveva previsto per contarli non serve:
   un'azienda ne crea quanti vuole. Il suo amministratore li crea **in libertà**, e questo
   risponde anche alla domanda su chi può aggiungere persone.
2. **Le quote sono due, e sono risorse della macchina**: lo **spazio su disco** e il **numero di
   progetti aperti contemporaneamente**, che è il numero di container da avviare. La seconda non
   è un conteggio di righe in un database: è un limite su ciò che gira, e vive dove i container
   si avviano — cioè nel **gateway, Fase 4**. In 3c si può contare e mostrare; farla *rispettare*
   davvero richiede chi avvia i container.
3. **Il confine è la risorsa, non il permesso.** «Dentro le risorse concordate l'amministratore
   d'azienda può fare tutto» semplifica la 3c: non serve un elenco di cosa può e non può, serve
   che veda **solo la sua azienda** e che le quote lo fermino.
4. **Un sinottico delle risorse**, per tutti e due i ruoli: l'admin globale vede tutte le aziende,
   quello d'azienda la sua. È la parte **nuova** rispetto a come il tronco cloud descriveva la
   3c, ed è quella da progettare per prima perché decide quali numeri il resto deve produrre.

### Le decisioni (maintainer, 08-10-2026)

1. **Il sinottico è la prima pagina della console.** Aprendo `/index-console.html` la prima cosa è
   lo stato delle risorse; le altre sezioni restano nella barra laterale. Stessa schermata per
   tutti e due i ruoli, contenuto confinato: l'admin globale vede una riga per azienda, quello
   d'azienda vede solo la sua.
2. **Cosa mostra**: per azienda lo **spazio**, spaccato in *progetti* e **storico** — chi arriva
   al limite di solito ci arriva per lo storico, non per i sinottici, e saperlo cambia cosa si va
   a cancellare — e i **progetti aperti**. In fondo, separato, lo stato della macchina (disco,
   RAM, CPU), che non è di nessuna azienda ma dice se il limite vero sta arrivando per tutti.
   **Niente numeri senza un tetto** accanto a quelli che un tetto ce l'hanno: un conteggio
   affiancato a una barra sembra una quota anche quando non lo è.
3. **Al limite**: sopra una soglia si **avvisa** (nel sinottico e in cima alla schermata
   progetti), al 100% si **rifiuta** l'azione che farebbe crescere la risorsa, con un messaggio
   che dice quale limite e quanto vale. **Quello che già gira non si ferma**: lo storico continua
   a scrivere, perché fermarlo perderebbe dati d'impianto.
4. **Il marchio lo sceglie solo la piattaforma.** L'azienda lo vede e non lo cambia: un marchio è
   anche il nome di qualcun altro, e sbagliarlo è un problema legale, non estetico. (Precisa la
   decisione 43, che lo assegnava all'azienda senza dire chi lo decide.)
5. **I «progetti aperti» si configurano e si mostrano, non si applicano** — e lo si **dichiara a
   schermo**. Oggi un'istanza ha un progetto solo e i container li avvierà il gateway: il tetto
   concordato esiste già, così quando il gateway arriva non si ricontratta niente, ma nessun
   codice finge di farlo rispettare. È lo stesso patto dichiarato che la 3a ha fatto con
   `versione_fissata`.

**Non decise perché discendono**: chi entra nella console (piattaforma **oppure** amministratore
di almeno un'azienda — chi è solo sviluppatore resta fuori, come oggi) e quali sezioni restano
alla sola piattaforma (**Posta** e **Questa installazione**, che non sono di nessuna azienda; e
per gli altri non compaiono affatto, non «compaiono e danno 403»).

## Come si misura lo spazio

Non a ogni richiesta: sommare le dimensioni di un albero di cartelle costa, e il sinottico si
apre spesso. Un conteggio periodico con l'ultimo valore in cache, e il momento della misura
scritto accanto al numero — un dato vecchio che si dichiara vecchio è utile, uno che finge di
essere fresco no.
