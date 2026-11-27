# Il Save nella testata fissa delle schede, e la pagina Utenti senza salvataggio automatico (25-11-2026)

## Contesto

Collaudo della 2.27.0-dev.3, test 4 (la pagina Utenti, voce 4 della rc.30), fatto dal maintainer nell'IDE del cloud sul
progetto `tiny-ty`. La pagina funziona, ma il segnale di salvataggio è debole. Parole del maintainer:

- «il messaggio "Saved" compare nella colonna "Updated" e francamente è poco visibile, l'ho visto al terzo tentativo.
  Io sono dell'idea che un pulsante "Save" con barra verde di conferma sarebbe più chiaro del salvataggio automatico»;
- «Il pulsante di salvataggio, come regola generale, lo metterei in alto a destra del form […] Se il form scorre
  sarebbe bene che stesse su una parte statica prima della sezione che scorre»;
- «Nel tab "Tags" per esempio il pulsante "Save Project" […] è fisso ma i tag scorrono sotto ed è brutto. Sposterei il
  testo in blu e i pulsanti Export CSV, Import CSV, SAVE nella barra superiore che inizia con "🏷 Tags"»;
- «La stessa modifica va fatta in "Alarms", "Reports"».

## Le decisioni del maintainer (25-11-2026)

| | Domanda | Decisione |
|---|---|---|
| 1 | Il Save salva solo la scheda aperta? | **No.** Il Save resta uno solo e salva tutte le schede con modifiche, come dal 22-09-2026. Cambia il nome, da «Save project» a «Save», e cambia il posto, nella testata. La testata dice quali schede hanno modifiche non salvate. |
| 2 | La pagina Utenti | **Come le altre schede**: gli utenti diventano una bozza fra le sezioni pendenti, con il Save della testata, la barra verde e Ctrl+S. Il salvataggio automatico campo per campo sparisce. |
| 3 | La regola generale | **Regola UI 4 in `CLAUDE.md`**: il Save in alto a destra, nella testata fissa; la conferma è una barra verde. |

## Le misure di oggi

- **La testata esiste già**: `S.intestazione` in `sws-editor/src/config/ConfigView.tsx:135-149` mostra il percorso, l'icona
  e il nome della scheda. Sotto c'è `S.body`, che scorre.
- **Il Save è dentro la parte che scorre**: `SaveBar` (`sws-editor/src/config/comuni.tsx:225-292`) è un `div` con
  `position: sticky; top: 0`. Le righe passano sotto. Lo usano 11 schede: Tags, Alarms, Reports, Notifications,
  Recipes, Tipi, Protocols, Datastores, Ia, StileSimboli, Languages.
- **Il messaggio di conferma** è un testo di 12 px accanto al pulsante (`savedNotice`, `cfgUi.savedChangesAppliedImmediately`).
- **La scheda Tags**: il testo blu è `cfgUi.variablesNotice`; Export CSV e Import CSV stanno in `TagsTab.tsx:401`, sotto il Save.
- **La pagina Utenti** (`sws-editor/src/config/schede/UsersTab.tsx`): ogni campo chiama `onPatch` all'uscita dal campo
  o alla scelta, e «✓ Salvato» compare per 2,5 s nella riga (righe 36-37, 106-120, 269-291). Non è fra le sezioni pendenti.

## Cosa si fa

1. **La testata porta il Save.** `ConfigView` disegna a destra della testata lo stato e il pulsante «Save» («Salva» in
   italiano), che chiama `saveAll()` come oggi. `SaveBar` smette di disegnare: resta solo la registrazione della bozza,
   come fa già `SezionePendente`.
2. **Le azioni della scheda nella testata.** Una scheda mette nella testata il suo testo d'aiuto e i suoi pulsanti. Si
   parte da **Tags** (testo blu, Export CSV, Import CSV), **Alarms** e **Reports**. La strada tecnica (un portale verso
   un posto della testata, o una prop della scheda) si sceglie misurando, al momento di scrivere.
3. **La barra verde.** Dopo un salvataggio riuscito, una barra verde larga quanto la testata, per circa 3 s. Un errore
   resta rosso finché non si chiude.
4. **Le schede con modifiche.** Accanto al Save, la testata dice quali schede hanno modifiche non salvate.
5. **La pagina Utenti come bozza.** I campi scrivono in una bozza locale; la bozza si registra fra le sezioni pendenti;
   il Save della testata la scrive. Prima di scrivere il codice: misurare cosa si salva oggi con `onPatch` (nome, ruolo,
   zone, scadenza della sessione, password) e se la password resta un'azione a parte, con la sua finestra.
6. **Le altre otto schede** con `SaveBar` passano alla testata nello stesso ramo, se il lavoro resta piccolo. Altrimenti
   si annotano in un seme.

## Verifica

`cargo check`, `cargo test`, `pnpm build`, `pnpm exec vitest run`, `./scripts/check_static.sh`. Nell'IDE: Tags,
Alarms, Reports e Utenti con una lista lunga che scorre sotto la testata; il Save sempre visibile; la barra verde dopo
il salvataggio; Ctrl+S. La conferma del maintainer con `/test-changes` su una dev.

## Le decisioni del 27-11-2026

- **La password nuova resta un'azione a parte**, con la sua finestra, e salva subito: una password non resta in una
  bozza non salvata. Il resto della pagina Utenti (nome, ruolo, zone, scadenza della sessione) diventa bozza.
- **Le 8 schede che usano ancora `SaveBar`** passano alla testata nello stesso ramo (punto 6).
- Esce nella stessa dev del piano [cambio di nome del progetto](2026-11-27-cambio-di-nome-del-progetto.md), con un
  ramo dopo l'altro.
