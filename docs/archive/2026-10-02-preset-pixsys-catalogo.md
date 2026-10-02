# Preset dei dispositivi Pixsys: il catalogo intero, dedotto dalla nomenclatura

> Scritto il 02-10-2026 nella sessione di plan che il seme
> [`2026-09-19-preset-pixsys-catalogo.md`](../archive/2026-09-19-preset-pixsys-catalogo.md)
> chiedeva prima di toccare qualunque cosa. Quel seme è ora in archivio: questo piano lo apre e lo
> chiude.

## Contesto

L'IDE offre dei «Preset dispositivo» quando una pagina è a dimensione fissa: scegli il pannello e
width/height si impostano da sé. Oggi l'elenco Pixsys ha **sei voci** scritte a mano in
`sws-editor/public/branding/pixsys/brand.json`, e il seme del 19 settembre era fermo su una cosa
sola: i nomi dei modelli non stanno in nessun file del repo, e inventarli sarebbe sbagliato.

Il maintainer ha dato oggi la **nomenclatura**, che risolve il problema alla radice — il nome di un
prodotto Pixsys *contiene* la sua risoluzione:

| pezzo | significato |
|---|---|
| `WP` / `TC` | WebPanel / TouchController — due linee commerciali, stesso prodotto per noi, **da distinguere nel menù** |
| 1ª cifra | touch: **5, 6** capacitivo · **7, 8** resistivo (fra 5 e 6, e fra 7 e 8, nessuna differenza che conti qui) |
| 2 cifre | schermo: `70` → 7" 1024×600 · `00` → 8" 1024×768 · `15` → 10,1" 1280×800 · `20` → 12,1" 1280×800 · `30` → 15,6" 1920×1080 |

**Non esistono però tutte le combinazioni che la regola permetterebbe.** Per ogni schermo c'è *un*
modello capacitivo e *uno* resistivo, e la cifra dipende dalla serie: **5/7** sul 7", **6/8** su
tutti gli altri. Il catalogo è questo — dieci codici per linea, **venti modelli**:

| schermo | capacitivo | resistivo |
|---|---|---|
| 7" 1024×600 | `570` | `770` |
| 8" 1024×768 | `600` | `800` |
| 10,1" 1280×800 | `615` | `815` |
| 12,1" 1280×800 | `620` | `820` |
| 15,6" 1920×1080 | `630` | `830` |

per `WP` e per `TC`. Un `WP670` la nomenclatura lo genererebbe, ma non esiste: per questo l'elenco
si **scrive**, non si calcola — un ciclo `for` produrrebbe prodotti inventati. La serie `TD` non
esiste più.

## Cosa si fa

### 1. I venti preset, in due gruppi

`device_presets` passa da 6 a 40 voci, con un campo nuovo che dice a quale gruppo appartengono:

```json
{ "label": "WP615 — 10,1\" capacitivo (1280×800)", "group": "WebPanel", "width": 1280, "height": 800 }
```

- **Il gruppo serve davvero**: oggi `EditorShell.tsx` crea *un solo* `<optgroup>` con lo
  `shortName` del brand. Con venti voci in un elenco piatto si fatica a trovare il proprio pannello, e il maintainer ha
  chiesto che WebPanel e TouchController si distinguano.
- **Il tipo di touch sta nell'etichetta** perché è l'unica cosa che distingue `WP515` da `WP715`:
  stesso schermo, stessa risoluzione. Senza, il menù avrebbe quattro voci apparentemente identiche
  per ogni dimensione.
- **Dentro ogni gruppo si ordina per pollici**, non per numero: chi cerca sa che schermo ha davanti,
  non il codice.
- Le venti righe si **generano una volta** da una tabella del catalogo e si committa il JSON: il
  file resta l'elenco leggibile che è oggi.

### 2. Una guardia che tiene il nome e la risoluzione d'accordo

È il pezzo che vale di più, e nasce dalla nomenclatura stessa: **il nome contiene la risoluzione**,
quindi la coerenza si può verificare invece che sperare. Un test (`sws-editor/tests/`, accanto a
`coloriPredefiniti.test.ts`) legge `brand.json` e controlla che ogni voce rispetti la codifica:
le due cifre finali decidono width/height e i pollici, la prima cifra decide il touch nell'etichetta,
il prefisso decide il gruppo.

Così un `WP615` nato per sbaglio con 1920×1080 diventa rosso, e lo stesso vale per un modello nuovo
aggiunto fra sei mesi da chi la regola non la ricorda. Si prova rosso cambiando una risoluzione.

### 3. Le risoluzioni senza prodotto vanno fra le generiche

`480×272`, `1280×768` e `1366×768` non corrispondono a nessun codice della regola. Non spariscono:
entrano in `STANDARD_DEVICE_PRESETS` (`sws-editor/src/pageLayout.ts`), dove un preset senza nome di
prodotto è legittimo — servono a chi disegna per un display che non è dei vostri. Stessa sorte per
`800×480`, che resta una risoluzione comune anche senza più il TD710.

### 4. La tabella del branding smette di mentire

`docs/branding/BRAND_SWS.md` elenca sei righe di cui quattro «da confermare» e una confermata col
nome di un prodotto che non esiste più. Va riscritta sulla nomenclatura: le cinque risoluzioni vere
dei pannelli con i codici che le generano, e le altre dichiarate per quello che sono — risoluzioni
generiche, non pannelli Pixsys.

## File da toccare

| file | cosa |
|---|---|
| `sws-editor/public/branding/pixsys/brand.json` | 20 `device_presets` con `group`, generati dal catalogo |
| `sws-editor/src/branding/index.ts` | `DevicePreset` prende `group`; ripiego sullo `shortName` per i brand che non lo usano |
| `sws-editor/src/editor/EditorShell.tsx` (~1850) | un `<optgroup>` per gruppo invece di uno solo |
| `sws-editor/src/pageLayout.ts` | le quattro risoluzioni generiche in `STANDARD_DEVICE_PRESETS` |
| `sws-editor/tests/presetPixsys.test.ts` (nuovo) | la guardia nome ↔ risoluzione |
| `docs/branding/BRAND_SWS.md` | tabella riscritta sulla nomenclatura |
| `CHANGELOG.md`, `NOVITA.yaml` | una riga: il menù dei pannelli ora è il catalogo intero |

## Verifica

1. `pnpm test` — compresa la guardia nuova, **provata rossa** cambiando la risoluzione di un modello.
2. `pnpm build`, `cargo check`, `./scripts/check_static.sh` verdi (definition of done).
3. **A schermo, dall'IDE** (che tengo allineato su 8460): aprire un progetto a dimensione fissa e
   guardare «Preset dispositivo» — tre gruppi (Standard, WebPanel, TouchController), i modelli
   ordinati per pollici, e scegliendone uno la pagina prende la dimensione giusta. È il collaudo che
   chiude la definition of done, e si fa senza pannello.

## Quello che questo piano **non** fa

- Non tocca `data_path_presets`, che nomina le famiglie `WP5xx/WP6xx/WP8xx` in una stringa sola e
  non ha lo stesso problema.
- Non introduce un preset «modello» che porti con sé altro oltre la dimensione (touch, DPI,
  orientamento). Se un giorno servisse, il campo `group` è il punto da cui crescere — ma oggi
  sarebbe inventare un bisogno.
