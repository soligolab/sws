# Arricchire le pagine demo di CasaMauro con le feature F2-F6 non esercitate

## Contesto

Da `STATUS.md` "Da fare, dalle sessioni precedenti", punto 7: **CasaMauro è un progetto
personale del maintainer** (non un template del repo — vive in `.run-editor/projects/CasaMauro`
su questa macchina, sei pagine `Demo F2 Binding` … `Demo F6 Simboli` più `CasaMauro`/`Page 2`),
usato come banco di prova durante lo sviluppo delle fasi F2-F6. È rimasto fermo a quel momento e
non esercita quanto aggiunto dopo.

**Verificato scandendo tutte le pagine** (non assunto dalla nota, che risale al 2026-08-xx):
47 `text`, 37 `navbutton`, 20 `symbol`, nessun `type: alarm_history`, nessun `text_wrap`,
nessun `bar_mode`/`pie_group_below_pct`/`alarm_bell_sound` in nessuna pagina. Il progetto ha già
2 `bar_chart` e 2 `pie_chart`, ma nessuno dei due usa le opzioni avanzate — non mancano i tipi,
mancano le opzioni.

## Cosa manca, concretamente

| Feature | Verificato assente | Dove aggiungerla |
|---|---|---|
| Table 2.0 (ordinamento/filtri/celle scrivibili) | Nessun `table` con `table_sortable`/`table_filterable` | Una pagina con dati tabellari — `Demo F5 Storico` ha già `data_log`, ci sta bene accanto |
| Barre negative/impilate | I 2 `bar_chart` non hanno `bar_mode` | Aggiungere una serie con valore negativo a uno dei due esistenti, o un terzo grafico dedicato |
| Pie raggruppato | I 2 `pie_chart` non hanno `pie_group_below_pct` | Un pie con più fette piccole da raggruppare in "altro" |
| Testo multiriga | Nessun `text_wrap: true` | Su una delle 47 `text` esistenti, o una nuova, con un testo abbastanza lungo da dover andare a capo |
| Storico allarmi (`alarm_history`) | Assente — c'è solo `alarm_viewer`/`alarm_bell`/`alarm_banner` | `Demo F4 Allarmi` è la pagina naturale |
| Suono | Nessun `alarm_bell_sound` | Sullo stesso `alarm_bell` già presente in quella pagina |

## Disegno

Non è un piano di codice — è arricchimento di contenuto in un progetto già esistente. Passi:

1. Aprire `Demo F4 Allarmi`: aggiungere un `alarm_history` (storico piazzabile) e attivare
   `alarm_bell_sound` sull'`alarm_bell` già presente.
2. Aprire `Demo F5 Storico`: aggiungere un `table` con `table_sortable`/`table_filterable`
   accanto al `data_log` esistente.
3. Sui due `bar_chart`/`pie_chart` esistenti (cercarli con `grep -rn "type: bar_chart\|type:
   pie_chart"` nelle pagine per la posizione esatta): aggiungere una serie negativa a uno dei
   bar_chart, `pie_group_below_pct` a uno dei pie_chart.
4. Una delle 47 `text` esistenti (o una nuova, se nessuna ha senso con testo lungo): `text_wrap:
   true` con un contenuto che ne mostri l'effetto.

## Verifica

- Non c'è una "definition of done" nel senso di `cargo check`/`pnpm build` — è dati di progetto,
  non codice. Verifica: aprire ogni pagina toccata nell'editor e controllare visivamente che la
  feature nuova si veda e non abbia rotto nient'altro sulla pagina.
- **Attenzione**: è il progetto personale del maintainer, non un template del repo — nessun
  commit coinvolto, salvo che il maintainer chieda di trasformarlo in un template versionato a
  parte (fuori scope di questo piano, da chiedere se emerge l'interesse).

Non serve un branch git: non tocca il repo.
