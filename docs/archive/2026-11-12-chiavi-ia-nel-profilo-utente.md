# Le chiavi dell'assistente IA anche nel profilo dell'utente

> **Stato: archiviato il 16-11-2026** — fatto nella rc.19; il collaudo nel cloud è in `docs/COLLAUDI_IN_SOSPESO.md` (rc.19, voce 9). Il seguito è il piano delle chiavi IA dell'account complete (16-11-2026).

> **Prima dell'archivio: piano in corso.** Nato come seme il 12-11-2026, richiesta del maintainer: «potrebbe essere utile poter definire le api key
> dell'assistente AI anche nel profilo utente, in quel caso quelle di progetto prevalgono se presenti altrimenti
> vengono usate quelle utente in automatico». **La sessione di plan approfondita c'è stata il 15-11-2026: le decisioni e il lavoro fatto
> stanno in fondo.

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

## Deciso il 15-11-2026 (sessione di plan) e fatto

Decisioni del maintainer: **il container le chiede al gateway** al momento della chat; **cifrate nel database dell'identità**;
**qualunque utente del cloud** può metterle; **regola fissa**: la chiave del progetto prima, poi quella dell'utente,
nessun divieto per progetto. Fornitori: Anthropic e Kimi.

Fatto sul ramo `feat/chiavi-ia-account` (annidato su `fix/sfondi-alla-misura`):

1. **`sws-identita`** (`ai_keys.rs`, tabella `ai_keys`, schema 8): AES-256-GCM con `ring`, nonce per riga, testo
   autenticato `<utente>:<fornitore>`; chiave-madre in `chiave_segreti` (0600, creata al primo uso, mai da una lettura).
   Un file rovinato non si riscrive. Dopo un ripristino senza la chiave-madre la riga c'è ma non si legge (`readable:
   false`) e va riscritta. Si cancella con l'utente.
2. **Gateway** (`sws-web/src/ai_keys.rs`): `GET /api/identity/ai-keys`, `PUT` e `DELETE /api/identity/ai-keys/:provider`
   (mai il valore indietro, nell'audit solo il fatto); `GET /api/internal/ai-key/:provider?user=<email>` per il
   container, con la sua chiave di ritorno (`x-sws-figlio`, già esistente), **solo per chi il gateway ha inoltrato a quel
   container negli ultimi 5 minuti** (`Forwarded`, in memoria). Un container non raccoglie le chiavi di chi non c'è.
3. **Container** (`ai/user_keys.rs`, `ai/client.rs`): `resolve_key` (progetto, poi utente), `carica_con`,
   `carica_per_con`; la chiave dell'utente si chiede una volta all'apertura della sessione di chat, per i fornitori che
   il progetto non ha, e resta in memoria. L'evento `pronto` dice di chi è la chiave (`chiave: project|user`).
4. **IDE**: menu 👤 → «Le mie chiavi IA» (solo nel cloud), e in Fornitori e chiavi la riga «Questo progetto usa:…»
   (`source` in `GET /api/ai/config`).
5. **Documenti**: HOWTO 32; `deploy/vps/backup-dati.sh` esclude `chiave_segreti`.

**Nomi**: il codice nuovo è in inglese come da regola (`ai_keys`, `/api/identity/ai-keys`); la tabella e le colonne
pure. Le rotte del gateway già esistenti (`/api/identita/…`) restano com'erano.

**Resta**: il collaudo nel cloud con una chiave vera (VPS): un utente senza chiave di progetto aggiunge la sua e la chat
parte; la toglie e dice «nessuna chiave»; un progetto con chiave sua usa quella; un secondo utente senza chiave non ne
ha. Il registro della spesa che dice di chi era la chiave (G5 del piano «assistente, secondo giro») resta lì: oggi
l'origine sta nell'evento `pronto` e nel log `sws_ai`.

