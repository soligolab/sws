# Il validatore della richiesta all'assistente

> **Seme — decisione.** Nato l'11-11-2026 durante il collaudo della 2.26.0-rc.12 sul WP630 (test dell'assistente su
> Montagna). **Quando questo lavoro comincerà, il primo passo è una sessione di plan approfondita e dedicata** per
> sviscerarne tutti i dettagli: qui ci sono solo l'idea e le misure di oggi.

## L'idea

Richiesta del maintainer: «introduci un validatore di prompt che faccia il lavoro che hai appena fatto: l'utente dà un
prompt sicuramente poco chiaro, il validatore lo revisiona con una micro sessione stile plan per capire bene le
esigenze dell'utente e poi prepara il prompt completo».

Il caso che l'ha fatta nascere. Il maintainer ha scritto in poche righe cosa voleva: una pagina con un impianto di
risalita, un faceplate meteo a valle e in cima, quattro sfondi per il giorno e la notte, un faceplate della cabinovia
con una pagina popup («non so quali altri dati siano significativi»), le foto agganciate agli angoli dell'area
interna. Claude Code l'ha riscritta in una richiesta completa per l'assistente dell'IDE:
- ha diviso le parti (sfondo, meteo, cabinovia, popup, vincoli);
- ha scelto i dati che mancavano (vento, neve fresca, visibilità; potenza, carico, cabine, persone/ora, temperatura
  del motore, ore, ultimo allarme);
- ha esplicitato le regole implicite (dati simulati coerenti fra loro, stessa inquadratura per le quattro foto,
  oggetti dentro l'area libera);
- ha accorpato tutto in un solo messaggio per spendere meno crediti.

Il validatore porterebbe questo passo dentro il prodotto: prima che la richiesta arrivi al modello che compone, una
fase breve fa le domande che servono, propone quello che manca, e mostra alla persona la richiesta completa da
confermare o correggere.

## Cosa c'è oggi nel codice (misura dell'11-11-2026)

- Il prompt di sistema dell'assistente (`sws-web/src/ai/prompt.rs`) ha già due regole vicine:
  - «Se manca un'informazione, chiedila» (indirizzi, topic, quale pagina), ma solo per i dati tecnici;
  - per un sinottico intero, il passo 2 «**Il piano, a parole, e ti fermi**»: macchine, simboli, tipi e istanze,
    faceplate, poi aspetta il via. È già una micro sessione di plan, ma la fa lo **stesso modello** che poi compone,
    e arriva **dopo** l'inventario (`cerca_simboli`, `elenca_tag`, `leggi_progetto`), cioè dopo aver già speso
    chiamate.
- Gli **scopi** (`sws-web/src/ai/scopi.rs`) danno un modello per ogni uso: `assistente`, `simboli`, `traduzione`,
  `sfondi`, configurati in `config_dir/ai.yaml`. Un modello più economico per la fase di chiarimento sarebbe uno scopo
  in più, con la stessa ricaduta sull'assistente se non è configurato.
- La conversazione vive in `ai/conversazioni.rs` (legata a chi l'ha aperta, dalla rc.12).

## Le domande per la sessione di plan

1. **Un passo separato o un comportamento dell'assistente.** Uno scopo nuovo (`chiarimento`) con un modello economico
   e un prompt suo, che consegna la richiesta completa all'assistente? Oppure si rafforza il passo «il piano, a parole»
   del prompt che c'è, senza un secondo modello?
2. **Quando parte.** Sempre, solo per le richieste lunghe (una pagina intera, un sinottico), su un pulsante «Rivedi la
   richiesta», o quando la richiesta è sotto una certa soglia di dettaglio?
3. **Cosa vede la persona.** Le domande una alla volta o tutte insieme? La richiesta completa modificabile in un
   campo prima dell'invio, o solo un «procedi / correggi»?
4. **Cosa sa del progetto.** Per proporre i dati che mancano gli serve il contesto (tag, tipi, faceplate, cornici,
   risoluzione). Leggerlo costa: tutto, un riassunto, o niente?
5. **I crediti.** Il guadagno atteso è meno giri di correzione dopo una proposta sbagliata. Va misurato: quanto costa
   il chiarimento, quanto costa una proposta rifatta.
6. **Lingua.** La persona scrive nella sua lingua; la richiesta completa resta nella stessa lingua.
