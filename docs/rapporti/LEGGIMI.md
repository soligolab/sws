# Rapporti

Documenti formali, stampati in PDF, da girare a chi li chiede. Ognuno ha un **codice**, una **revisione** e la
**versione di SWS** su cui è stato verificato, scritti nei `<meta name="sws-…">` del file HTML: finiscono
nell'intestazione di ogni pagina.

| Codice | File | Contenuto |
|---|---|---|
| SWS-RT-01 | [runtime-risorse.html](runtime-risorse.html) | Il runtime: struttura, file, disco, memoria, CPU, comunicazione |

## Stampare

```bash
node docs/rapporti/stampa.mjs                       # runtime-risorse.html → tmp/<codice>_rev<n>_<versione>.pdf
node docs/rapporti/stampa.mjs <rapporto.html> [uscita.pdf]
```

Usa il Chromium di Playwright dell'editor (`sws-editor/node_modules`, quindi serve `pnpm install` in
`sws-editor`). Il PDF va in `tmp/`, non si committa: si rigenera.

## Quando si aggiorna

- Quando cambia una cosa che il rapporto misura: immagine, volumi, porte, prestazioni.
- Quando lo script avvisa che la versione del workspace è diversa da quella del rapporto: si rilegge, e se
  qualcosa è cambiato si fa una revisione nuova.

Una revisione nuova: si alzano `sws-revisione`, `sws-versione` e `sws-data`, si aggiunge una riga alla tabella
«Revisioni» in fondo al documento, e le misure grezze nuove vanno in `docs/prestazioni/` con la data.
