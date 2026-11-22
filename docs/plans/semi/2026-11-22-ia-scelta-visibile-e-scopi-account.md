# Quale modello IA risponde, detto dove si usa; e un modello per scopo anche nell'account — seme

> **Stato: seme — decisione.** Nato il 22-11-2026 dal maintainer, nell'IDE del cloud sulla 2.26.0-rc.26: la scheda IA
> dell'editor dei simboli usava Kimi, mentre nelle sue chiavi IA aveva scelto «Fornitore preferito per il testo:
> Anthropic». «Però l'IDE è configurato così, perché usa comunque Kimi». Proposta: dire il modello e chi l'ha scelto nel
> punto in cui si usa. Il maintainer: «direi che anche nella configurazione globale serve il campo, per il resto ok».
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan approfondita, dedicata, per sviscerarne tutti
> i dettagli.** Qui ci sono l'idea e le misure del 22-11-2026.

## Perché succede (misurato il 22-11-2026)

- La scelta del modello per uno scopo di testo (`sws-web/src/ai/scopi.rs`, `carica_per_con`): lo scopo del progetto
  (`ai.yaml` → `scopi.<scopo>`), se no **l'assistente del progetto** (`client::carica_con`), e solo se il progetto non
  sceglie niente il fornitore preferito dell'account (`user_keys.rs`, `preferred_text`, dal 17-11-2026).
- CasaDomotica ha `ai.yaml` con `fornitore: kimi` (il formato vecchio, l'assistente) almeno dal 10-11-2026 (i backup
  del VPS lo dicono). «Disegno dei simboli» non ha uno scopo suo, quindi è Kimi; la chiave è quella Kimi dell'account,
  perché il progetto non ne ha.
- La finestra «Le mie chiavi IA» lo scrive («il modello preferito vale dove il progetto non ne sceglie uno»), ma nel
  punto in cui si disegna non si vede chi risponde né perché.
- L'account oggi tiene: una chiave e un modello preferito per fornitore (`anthropic`, `kimi`, `mistral`, `openai`,
  `bfl`), un fornitore preferito per il testo e uno per le immagini. **Non** ha una scelta per scopo: «Un modello per
  scopo» esiste solo nella Configurazione → IA del progetto.

## L'idea, con le tre parti già accettate

1. **Dire chi risponde dove si usa**: nella scheda IA dell'editor dei simboli (e negli altri punti che chiamano uno
   scopo: traduzione, campi, sfondi, l'assistente) una riga «modello: Kimi (kimi-k2.7-code), scelto dal progetto»,
   oppure «… dal tuo account», con il collegamento a dove si cambia. Il maintainer: «per il resto ok».
2. **Un modello per scopo anche nell'account** («anche nella configurazione globale serve il campo»): in «Le mie chiavi
   IA», accanto ai due fornitori preferiti, gli scopi (assistente, disegno dei simboli, traduzione, campi, sfondi…) con
   fornitore e modello.

3. **La finestra «Le mie chiavi IA» va chiarita e rifatta** (il maintainer, stesso giorno: «vero, errore mio, ma va
   chiarito meglio nella scheda di configurazione globale, dove migliorerei anche l'estetica che ora è molto basilare»).
   Oggi è un elenco di righe uguali (fornitore, campo chiave, Salva / Prova la chiave / Togli, modello preferito) sotto
   un paragrafo che spiega la precedenza in una frase sola, che si legge male. Da fare: la precedenza detta in modo che
   si capisca al primo sguardo (per esempio uno schema «progetto → account → predefinito», o per ogni scopo «qui decide
   il progetto X» quando l'IDE è dentro un progetto che sceglie), e una grafica nello stile dei pannelli dell'IDE:
   sezioni che si aprono e si chiudono, lo stato di ogni chiave a colpo d'occhio, le azioni meno in vista.

4. **«Applica a tutti i progetti»** (il maintainer, stesso giorno): dalla finestra dell'account, un comando che apre
   l'elenco dei progetti, con una casella per ognuno, e scrive la configurazione IA scelta in quelli selezionati. Le
   sue parole: «potrebbe essere la strada per decidere chi vince, vince sempre il progetto ma da questa pagina potrei
   aggiornare in modo batch tutti».

**La precedenza, quindi, è decisa: vince sempre il progetto** (come oggi). L'account dà i valori di chi non sceglie, e
con «Applica a tutti i progetti» li porta nei progetti che si vogliono allineare.

## Da decidere nella sessione di plan

- **«Applica a tutti i progetti», nel dettaglio**: cosa scrive (gli scopi e i modelli, mai le chiavi: quelle restano
  nell'account, o nel progetto se ce l'ha già); se sovrascrive una scelta del progetto diversa o la mostra prima
  (un'anteprima «CasaDomotica: assistente Kimi → Anthropic»); quali progetti vede (quelli dell'azienda di chi scrive,
  nel cloud; la radice dei progetti, nell'IDE locale); un progetto aperto da qualcun altro (il lock del progetto,
  `feat/project-lock`); il registro (`audit`) di cosa è cambiato e dove; se scrive `ai.yaml` dei progetti dal gateway
  o chiede a ogni container.
- Dove vive la scelta dell'account: nell'identità del gateway (come le chiavi, `ai_keys.rs` e
  `GET /api/internal/ai-preferences`), e come arriva al container del progetto.
- L'IDE locale senza gateway: ha un «account»? Oggi le chiavi dell'account esistono solo dietro il gateway.
- I tetti di spesa (`tetto_usd`) per scopo: anche nell'account, o solo nel progetto.
