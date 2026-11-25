# Il pannello di controllo dallo schermo remoto del cloud (seme, 25-11-2026)

> **Seme — decisione.** Quando questo lavoro comincia, **il primo passo è una sessione di plan dedicata e
> approfondita** che ne sviscera tutti i dettagli. Quello che segue è l'idea e le misure di oggi.

## L'idea

La revisione a più agenti del ramo `fix/dev3-collaudo` (25-11-2026) ha trovato un difetto che c'era già. Sullo schermo
remoto del cloud (`https://<gateway>/schermo/<pannello>/`) la pagina del pannello manda ogni richiesta col prefisso
`/schermo/<pannello>` (`getBaseUrl()` → `prefissoSchermo()`, `percorsoPubblico`). Il pannello di controllo no: le sue
chiamate partono dalla radice e arrivano al gateway, che non è un dispositivo e non ha le rotte del pannello di
controllo. Dallo schermo remoto la sessione del pannello di controllo non si apre.

## Le misure di oggi

- `sws-editor/src/control-panel/api.ts`: `fetch("/api/control-panel…")` dalla riga 226 in poi, senza prefisso.
- Il lato server si aspetta queste richieste dal tunnel: `Origin::RemoteScreen`, il reset che tiene il cloud come unico
  reset da remoto (decisione D14 delle sessioni CRA, 18-11-2026).
- `docs/COLLAUDI_IN_SOSPESO.md`: la voce 4 del pannello di controllo dallo schermo remoto è ancora aperta, ed è
  probabilmente questa la causa.
- Il controllo `/health` dopo un reset (`control-panel/reloadWhenBack.ts`) usa già il prefisso dal 25-11-2026.

## La domanda

Si mette il prefisso a tutte le chiamate di `control-panel/api.ts`, come per il resto della pagina? Prima va misurato
che il gateway inoltri `/schermo/<pannello>/api/control-panel/*` nel tunnel con l'origine giusta, e che la sessione e
il PIN del progetto (decisione D13) funzionino da remoto.
