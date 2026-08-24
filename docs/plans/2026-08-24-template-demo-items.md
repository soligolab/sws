# Template gemelli: "Demo Items - Web" e "Demo Items - LVGL"

## Contesto

Il maintainer vuole un banco di prova vero per i due motori di rendering, al posto dei due template
attuali, e poi caricarlo sul WP630 (dove oggi c'è un progetto di prova senza valore).

Cosa c'è adesso, misurato:

| | tipi coperti | pagine | dati |
|---|---|---|---|
| `demo-items` | **19 su 35** | 4, da 800x600 a 900x700 | broker pubblico `broker.freemqtt.com` |
| `lvgl-demo` | **31 su 31** | 3, 1280x800 | nessuna sorgente: si muove solo al tocco |

I tipi sono **35** in palette, **31** girano su LVGL. I 4 solo-web sono `image`, `kpi_tile`,
`alarm_history`, `data_log`. `SUPPORTED_TYPES` (motore) e `LVGL_SUPPORTED_TYPES` (palette) oggi
**combaciano** — verificato, 31 e 31.

Il template LVGL è già completo sui tipi; quello web ne salta 16. E nessuno dei due ha dati che si
muovono da soli: i trend, le sparkline e i grafici disegnano piatto, cioè proprio gli oggetti che
sono appena stati corretti.

Scelte del maintainer (2026-08-24): **stessa demo in due varianti**, pagine **1280x800**, dati mossi
da uno **script Python interno**.

Esito voluto: aprire la stessa pagina sul browser e sul pannello e confrontarle a colpo d'occhio —
qualunque differenza è un difetto di parità, non una differenza di progetto.

---

## Struttura

Due cartelle nuove sotto `examples/templates/`, che sostituiscono `demo-items` e `lvgl-demo`
(entrambe rimosse). Un template è una cartella con `template.yaml` + il progetto: l'elenco è una
scansione di directory (`templates.rs:40`), quindi non c'è nessun indice da aggiornare.

    demo-items-web/     template.yaml → id: demo-items-web,  label: "Demo Items - Web"
    demo-items-lvgl/    template.yaml → id: demo-items-lvgl, label: "Demo Items - LVGL"

**Stesse pagine, stessi nomi, stessi tag, stesse coordinate.** La variante LVGL omette i 4 tipi
solo-web e nient'altro. Nessuna rinumerazione, nessuna ricomposizione: se un oggetto sta a (120, 340)
nel web, ci sta anche in LVGL.

Quattro pagine da 1280x800, raggruppate per famiglia invece che per ordine alfabetico:

1. **Base e comandi** — `rect` `ellipse` `line` `text` `button` `navbutton` `checkbox` `radio`
   `slider` `setpoint` `symbol`
2. **Indicatori** — `led` `state_lamp` `gauge` `progress_bar` `pipe` `text_list` `alarm_bell`
   `lang_button` `lang_selector`
3. **Grafici e tabelle** — `trend` `sparkline` `bar_chart` `pie_chart` `xy_plot` `table` `grid`
4. **Allarmi e composizione** — `alarm_viewer` `alarm_banner` `faceplate` `recipe_panel`
   — e **solo nel web**: `image` `kpi_tile` `alarm_history` `data_log`

31 tipi nella variante LVGL, 35 nel web. Una barra di navigazione con `navbutton` su ogni pagina:
sul pannello non c'è la barra del browser, e senza quella non ci si sposta.

---

## I dati: uno script che anima, non un broker

`ScriptTrigger::Interval { interval_s }` esiste già (`project.rs:771`), e l'API Python è
`tags.read(id)` / `tags.write(id, value)` (`sws-pyscript/src/lib.rs:153,168`).

**Verificato sul WP630**: dentro il container ci sono `libpython3.12.so` e Python 3.12.3, e
`sws-pyscript` è compilato nel runtime. Lo script gira sul pannello anche senza rete — che è il
motivo per cui questa strada batte il broker pubblico: un template di prova che sembra rotto quando
manca Internet non serve a provare niente.

Un solo script globale, `interval_s: 1`, che muove:

- una **rampa** e un **seno** per trend, sparkline e xy_plot (dati continui, l'autofit ha qualcosa
  da fare);
- un **contatore** e alcuni valori discreti per barre, torta e tabella;
- un valore che attraversa le soglie di allarme, così `alarm_viewer`/`banner`/`bell` si accendono e
  si spengono **da soli** invece che a comando;
- alcuni booleani per led, lampade e simboli.

Gli allarmi di `lvgl-demo` (`above 70` = Warning, `above 90` = Critical) si riusano così com'è: con
un valore animato entrano e escono da soli, e diventano una prova dello storico invece che di una
soglia mai superata.

I tag scrivibili dai widget (slider, setpoint, checkbox) **non** vanno guidati dallo script, o
combatterebbe col dito dell'utente: due insiemi separati, `demo.sim.*` mossi dallo script e
`demo.cmd.*` mossi da chi tocca.

---

## File

- `examples/templates/demo-items-web/` — `template.yaml`, `project.yaml` (tag, allarmi, lingue,
  script globale), `synoptics/*.yaml` (4), `images/` per il tipo `image`.
- `examples/templates/demo-items-lvgl/` — gli stessi, meno i 4 oggetti solo-web, più
  `target: {kind: lvgl_framebuffer}` in `project.yaml`.
- Rimozione di `examples/templates/demo-items/` e `examples/templates/lvgl-demo/`.

Le pagine si scrivono a mano in YAML seguendo `lvgl-demo/synoptics/*.yaml`, che è già il riferimento
buono per quali campi ogni tipo accetta.

**Da correggere mentre ci si passa**: `lvgl-demo/project.yaml` dichiara
`target: { kind: lvgl_framebuffer, framebuffer_device: "/dev/fb0" }`, ma il viewer su questi
pannelli gira via **SDL2/XWayland**, non sul framebuffer — il percorso DRM è bloccato dai permessi
(Q19). Il campo va tenuto per dire "questo progetto è per il pannello", non copiato con `/dev/fb0`
come se fosse la strada in uso.

---

## Verifica

1. **Copertura, contata non stimata**: uno script di controllo confronta i tipi presenti nei
   sinottici con `SUPPORTED_TYPES` e con la palette. Deve dire: LVGL 31/31, web 35/35, e la variante
   LVGL non deve contenere nessuno dei 4 solo-web. È lo stesso tipo di controllo di `check_f7.sh`.
2. **Parità di layout**: le due varianti devono avere pagine con lo stesso nome, la stessa
   dimensione e — per gli oggetti comuni — lo stesso `id` e le stesse coordinate. Verificabile con un
   confronto automatico fra i due alberi YAML, che è più affidabile di guardarli.
3. **Sul browser**: creare un progetto dal template Web, controllare che ogni pagina disegni e che
   dopo qualche secondo trend e sparkline abbiano una traccia che sale.
4. **Sul WP630**: caricare il template LVGL e far ripartire il viewer. Attenzione al nome della
   pagina — `--page` deve puntare alla prima pagina del template nuovo. Il container è uscito poco
   fa proprio per questo: chiedeva `Page 1`, che sul progetto attuale (`testLVGL`) non esiste, e ha
   risposto 404.
5. Confronto finale fianco a fianco delle stesse pagine sui due motori: le differenze che restano
   sono il lavoro di parità F9c ancora da fare, e vanno annotate.

`cargo check --workspace` + `pnpm build` verdi restano la definizione di fatto, anche se qui si
tocca quasi solo YAML: i template vengono letti dal runtime, e un campo sbagliato si manifesta come
oggetto mancante, non come errore.

---

## Da sapere prima di cominciare

- **Il viewer LVGL sul pannello è fermo** (uscito con 404 su `Page 1`). Va rilanciato col nome
  giusto: non è un difetto del binario, che è quello nuovo con movimento e trend.
- **Il pannello ha già `testLVGL`**, copia del vecchio `lvgl-demo`. Sostituirlo col template nuovo è
  proprio quello che il maintainer ha chiesto, ma è un'azione sul dispositivo: la confermo prima.
- Restano da fare, dalla sessione: `STATUS.md`, `CHANGELOG.md`, la copia del piano in `docs/plans/`,
  e **la ripubblicazione dell'immagine**, che il maintainer ha esplicitamente rimandato. Finché non
  avviene, sul pannello il discovery mDNS resta rotto e il runtime resta la 2.1.0 pubblicata.
- Il lavoro va su un branch dedicato (`feat/template-demo-items`), squash merge solo dopo conferma.
