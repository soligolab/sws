# Le chiavi dell'assistente IA anche nel profilo dell'utente

> **Seme — decisione.** Nato il 12-11-2026, richiesta del maintainer: «potrebbe essere utile poter definire le api key
> dell'assistente AI anche nel profilo utente, in quel caso quelle di progetto prevalgono se presenti altrimenti
> vengono usate quelle utente in automatico». **Quando questo lavoro comincerà, il primo passo è una sessione di plan
> approfondita e dedicata** per sviscerarne tutti i dettagli: qui ci sono solo l'idea e le misure di oggi.

## L'idea

Chi lavora su più progetti nel cloud oggi deve mettere la chiave del fornitore (Anthropic, Kimi) in ognuno. Con la
chiave anche nel proprio profilo, l'assistente funzionerebbe subito su ogni progetto aperto da quell'utente. Una chiave
del progetto, se c'è, resta quella usata: per esempio un progetto di un cliente che paga lui il consumo.

L'ordine voluto: **chiave del progetto → chiave dell'utente che sta usando l'assistente**.

## Le misure di oggi (12-11-2026)

- **Dove si cerca la chiave.** `chiave_di` e `percorsi_chiave_di` in `sws-runtime/crates/sws-web/src/ai/client.rs`,
  in quest'ordine:
  1. la variabile d'ambiente del fornitore (`ANTHROPIC_API_KEY`; `MOONSHOT_API_KEY` o `KIMI_API_KEY`);
  2. il file `<config>/anthropic.key` o `kimi.key`;
  3. `~/.config/sws/<file>`.

  Il commento dice «**mai nel progetto**: il progetto si esporta, si manda in giro e finisce su un dispositivo». La
  chiave «di progetto» di cui parla il maintainer è in realtà quella della **cartella di configurazione
  dell'istanza**, che nel cloud è il container del progetto. Il pannello «Fornitori e chiavi» la scrive con
  `crate::segreti::scrivi_chiave`.
- **Cosa sa l'assistente di oggi.** `get_ai_config` in `ai/config_api.rs` dice se una chiave è configurata, mai
  quale, e quali variabili d'ambiente scavalcano il file.
- **Il profilo dell'utente.** Gli utenti del cloud stanno in `sws-identita` (`Utente` in
  `sws-runtime/crates/sws-identita/src/lib.rs`: id, email, nome, ruolo, attivo, amministratore di piattaforma). Non
  c'è oggi un posto per le preferenze né per i segreti dell'utente.

## Da decidere nella sessione di plan

- **Dove si custodisce la chiave dell'utente.** Una chiave di un fornitore a pagamento è un segreto di valore: va
  cifrata a riposo, mai mostrata dopo l'inserimento, e va pesata col piano CRA.
- **Come arriva al container del progetto.** Il gateway gliela passa alla richiesta, oppure il runtime la chiede
  all'identità solo per la chiamata, senza scriverla su disco.
- **Di chi è la chiave usata.** Nel cloud un progetto può essere aperto da più utenti: quella di chi scrive in chat.
  E nel registro della spesa (G5 del piano «assistente, secondo giro») si deve vedere di chi era la chiave.
- **Il pannello sul dispositivo** (senza cloud) non ha utenti del cloud: lì resta solo la chiave dell'istanza.
- **Cosa vede l'utente.** «Questo progetto usa la tua chiave» oppure «… la chiave del progetto».
