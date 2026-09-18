# Un server MCP per far editare il progetto all'IA

> **Come si legge questo piano.** Nasce da una o più schede di
> `docs/OPEN_QUESTIONS.md`, spostate qui il 18-09-2026 per decisione del maintainer: le domande
> non vivono più in un elenco, diventano file di piano. **Il testo delle schede è riportato
> integralmente più sotto**, non riassunto — è la misura fatta quando la domanda è nata, e
> riassumerla vorrebbe dire rifare il lavoro a naso.
>
> ⚠️ **Quando si prenderà in mano questo lavoro, la prima cosa da fare è una sessione di plan
> approfondita.** Quello che segue è materiale, non un piano d'esecuzione: le misure hanno la
> data che hanno, il codice si è mosso, e alcune opzioni potrebbero non avere più senso.

## Stato

Richiesta del maintainer del 31-08-2026, nessuna decisione presa. Questo file tiene insieme
l'analisi; il lavoro non è aperto.

È una **superficie di editing nuova**: l'assistente IA non suggerisce soltanto, scrive nel
progetto. Tenuta separata da [ROS 2](2026-09-18-ros2-robot-come-sorgente.md), che è una superficie
*dati*.

⚠️ Da riverificare quando si riprenderà: il repo ha già `sws-web/src/ai/` con l'astrazione dei
fornitori, e `synoptic_schema.rs` — generato dalle fonti — è il vocabolario che oggi si dà
all'assistente. Parte del lavoro che questa scheda immaginava potrebbe essere già in piedi, come
è successo per Q43.


---

## Dalla scheda Q26 — Un server MCP per far editare il progetto all'IA

*Aperta il 2026-08-31, su richiesta del maintainer. Nessuna decisione presa.*

L'idea: esporre il progetto SWS attraverso un **server MCP**, così che l'utente possa usare un
assistente IA per costruire e modificare sinottici, tag, allarmi e script — invece di disegnare
tutto a mano nell'IDE.

Va segnata e non decisa. Quello che segue è il perimetro delle domande, non una risposta.

### Cosa renderebbe l'idea interessante

Il progetto è **già** in una forma che un modello linguistico maneggia bene: YAML dichiarativo,
uno schema unico e autorevole (`sws-web/src/synoptic.rs`, 238 campi), un parser vero
(`Project::load`) e sette guardie che dicono no a un progetto malformato. Un assistente che
scrive YAML ha quindi un giudice, e non deve indovinare se ha fatto bene.

### Le domande da sciogliere, prima di scrivere una riga

1. **Dove gira, e quindi cosa può toccare.** Sul PC di sviluppo accanto all'IDE, o sul
   dispositivo accanto al runtime? Le due cose hanno superfici di rischio molto diverse: la
   seconda significa un canale che scrive nella configurazione di un impianto in servizio.
2. **Sola lettura o anche scrittura.** Un server che *legge* il progetto e risponde a domande
   («quali tag non sono usati da nessuna pagina?») è quasi tutto guadagno. Uno che *scrive* è un
   secondo autore del progetto, e apre le tre domande sotto.
3. **Chi approva.** Nessuna modifica dovrebbe raggiungere un dispositivo senza che una persona
   l'abbia vista. Il posto naturale è il deploy, che già esiste ed è già un gesto esplicito.
4. **Come si torna indietro.** Il progetto è in git nel repo del maintainer, ma sul dispositivo
   no. Serve almeno un ripristino a colpo sicuro prima di dare a un assistente il permesso di
   scrivere.
5. **Che rapporto ha con `write_min_role` e con Q17.** Un canale che scrive nel *progetto* è
   diverso da uno che scrive nei *tag*, ma il confine va disegnato una volta sola, non due.
6. **Il vincolo che il progetto è dell'utente.** I segreti viaggiano col progetto (decisione del
   2026-08-20): password dei driver e token stanno nello YAML in chiaro. Un server MCP che
   esponesse il progetto esporrebbe anche quelli, e a un servizio esterno. È probabilmente il
   punto più affilato di tutti.

### Rapporto con le altre voci

- **Q17** (`/api/recipes/:id/apply` senza controllo per-tag) è il precedente da non ripetere: un
  canale di scrittura nato senza dire chi può usarlo.
- **Q21** (due superfici Python nel progetto) è lo stesso genere di domanda — quante strade
  diverse possono cambiare la stessa cosa — e conviene rispondere insieme.

### Aggiornamento del 2026-08-31 — esiste una proposta, la domanda resta aperta

Il maintainer ha chiesto un piano per una **chat nell'editor collegata a Claude Code**:
`docs/archive/2026-08-31-chat-ai-nelleditor.md`. Il piano risponde a cinque delle sei domande qui
sopra, e va letto prima di decidere. In sintesi:

- **le modifiche dell'assistente non toccano il disco**: vanno nello store dell'editor, che dà
  l'annullamento con Ctrl+Z e non persiste nulla finché una persona non salva. Questo scioglie da
  solo «dove gira», «chi approva» e «come si torna indietro»;
- **il punto sui segreti era sbagliato**: `GET /api/project` li maschera già
  (`mask_project_secrets`, `router.rs:1905`) e il server li ricompone al salvataggio. Chi legge
  dall'API non li vede. Resta vero per `GET /api/project/export`, che per decisione del 2026-07-29
  li spedisce in chiaro;
- il server MCP autonomo — la forma con cui questa domanda era nata — diventa l'**ultima** fase e
  non la prima: gli strumenti servono comunque, e l'involucro MCP costa poco quando ci sono.

**La domanda resta aperta**: il piano propone, non decide. Le cinque scelte che spettano al
maintainer sono nel §9 del piano.
