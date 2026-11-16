# Le chiavi IA dell'account, complete: tre fornitori, la prova, il modello

> **Stato: FATTO, archiviato il 16-11-2026 prima della rc.20.** Dopo G4 e G5 del [secondo giro
> dell'assistente](2026-11-10-assistente-secondo-giro.md) i fornitori nella finestra sono cinque (anche Mistral e Black
> Forest Labs). Il collaudo nel cloud è in `docs/COLLAUDI_IN_SOSPESO.md`, «Le chiavi IA dell'account, complete».
> Nato il 16-11-2026 collaudando la rc.19 nel cloud. Segue il piano (archiviato)
> [chiavi IA nel profilo utente](2026-11-12-chiavi-ia-nel-profilo-utente.md).

## Cosa ha visto il maintainer

Menu 👤 → «Le mie chiavi IA» ha **due** fornitori (Anthropic, Kimi), senza «Prova la chiave» e senza modello. La scheda
IA del progetto ne ha **tre** (anche OpenAI per gli sfondi), con la prova. Parole sue: «vorrei avere il menù completo,
comprensivo del test e, oltretutto, vorrei poter scegliere il modello tra quelli disponibili per ogni provider».
Decisione dello stesso giorno: il modello si sceglie **nel progetto e anche nell'account**.

## Com'è il codice oggi (misurato il 16-11)

- `sws-identita` tabella `ai_keys (user_id, provider, nonce, ciphertext, last4, created_ms)`: niente modello.
- `ai_keys.rs` (gateway): `provider_known` passa da `Fornitore::da_nome`, che conosce solo `anthropic` e `kimi`; un
  test controlla che `openai` sia rifiutato. `for_container` risponde `{ key }`.
- `ai/user_keys.rs` (container): `UserKeys` per `Fornitore`, quindi niente OpenAI.
- `ai/scopi.rs`: il modello di uno scopo è `cfg.modello` o `f.modello_default()`; gli sfondi (`carica_sfondi`) leggono
  solo `openai.key` del progetto. `prova_chiave(config_dir, fornitore)` chiama l'elenco dei modelli del fornitore
  (gratuito) e torna gli id: è già pensata «per le proposte del menù», ma oggi l'IDE mostra solo quanti sono.
- IDE: `MyAiKeys.tsx` con due fornitori scritti a mano; `IaTab.tsx` con il modello degli scopi in un campo di testo.

## Cosa si fa

1. **Identità**: colonna `model TEXT` in `ai_keys` (aggiunta all'apertura se manca, con `ALTER TABLE`); `set_ai_model`
   e `list_ai_keys` che la riporta. Il modello non è un segreto: in chiaro.
2. **Gateway** (`ai_keys.rs`): i fornitori sono quelli di `scopi::FORNITORI` (OpenAI compreso). Due rotte nuove,
   sempre della persona collegata: `POST /api/me/ai-keys/:provider/test` (la prova con la **sua** chiave: l'elenco
   dei modelli o l'errore del fornitore) e `PUT /api/me/ai-keys/:provider/model` (`{ model }`, vuoto = il default).
   `for_container` risponde `{ key, model }`. `prova_chiave` si divide in «trova la chiave» e «prova questa chiave».
3. **Container**: `UserKeys` per nome di fornitore (OpenAI compreso) con chiave e modello. Il modello di uno scopo è,
   nell'ordine: quello dello **scopo del progetto**, quello **dell'account** per quel fornitore, il default del
   fornitore. Gli sfondi usano la chiave OpenAI dell'account quando il progetto non ne ha una.
4. **IDE, account**: la finestra elenca i tre fornitori da un posto solo (lo stesso elenco della scheda IA). Per ognuno:
   chiave (le ultime quattro lettere), «Prova la chiave», e un menù a tendina «Modello preferito» riempito dalla prova,
   con in cima «predefinito del fornitore» e poi i modelli in ordine alfabetico.
5. **IDE, progetto**: negli Scopi il modello diventa un menù a tendina riempito da «Prova la chiave» (la chiave del
   progetto, o quella dell'account se il progetto non ne ha), con «predefinito» in cima e poi i modelli **in ordine
   alfabetico** (maintainer, 16-11-2026: «il campo Model dovrebbe essere un dropdown menù con l'elenco alfabetico delle
   opzioni»). Niente campo libero. Un modello scelto prima e non più nell'elenco resta nel menù, segnato.
6. Test: identità (colonna aggiunta su un db vecchio), gateway (prova e modello, fornitore sconosciuto rifiutato),
   container (ordine dei tre modelli, sfondi con la chiave dell'account), IDE (finestra con tre fornitori, menù dei
   modelli). CHANGELOG, NOVITA (it/en), HOWTO 32.

## Fuori

- La scelta del modello degli sfondi ha anche la «qualità»: resta solo nel progetto.
- Nessun prezzo nel menù dei modelli: il tetto di spesa resta quello di oggi.

## Collaudo

Nel cloud, con chiavi vere: tre fornitori nella finestra, la prova che elenca i modelli, un modello preferito
nell'account usato dall'assistente di un progetto senza modello suo; uno sfondo generato con la chiave OpenAI
dell'account.
