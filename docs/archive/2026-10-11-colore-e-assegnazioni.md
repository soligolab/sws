# Variabili colore e bottoni che assegnano

> **Piano d'esecuzione, approvato l'11-10-2026. Stato: i tre passi fatti (ramo `feat/colore-e-assegnazioni`), in
> attesa del collaudo del maintainer.** Correzione emersa dalla prova dal vivo: lo sfondo di un **oggetto** si lega
> con `bindings.fill`, non `bg_color` — su un rettangolo il riempimento copre il fondo.
>
> Nato come piano da approvare. Richiesta del maintainer dell'11-10-2026: «non esiste una variabile di tipo
> colore e non esiste un modo per usare i bottoni per fare assegnazioni. Volevo implementare dei bottoni che settano
> il colore di sfondo».

## Scelte del maintainer (11-10-2026)

| Domanda | Scelta |
|---|---|
| La variabile colore | **tipo scalare nuovo `color`**, validato dal runtime |
| Cosa fa un bottone | **un elenco di assegnazioni** «variabile = valore», su variabili qualsiasi, eseguite al clic |
| Lo sfondo da cambiare | **degli oggetti** e **della pagina** |

## Misurato oggi

- Tipi scalari: una tabella sola, `tests/fixtures/tipi-scalari.json`, letta da `sws-core/src/tipo.rs`
  (`TipoScalare`, `parse`, `nome`, categorie, conversioni), da `sws-editor/src/tag/tipiScalari.ts` e dalla guardia
  `check_tipi_scalari.sh` (nessuna select scritta a mano: passano da `<OpzioniTipo />`).
- Bottone: `button_mode` (`write`, `momentary`, `toggle`, `set`, `reset`, `increment`, `decrement`) sulla **sua**
  variabile `tag`; web in `canvas/SvgCanvas.tsx` (`guardedWrite`, conferma `require_confirm`), LVGL in
  `lvgl_render.rs` (`render_button`, `ButtonClickCtx`, `TagCommand`).
- Sfondo oggetto: `bg_color` universale, già collegabile con `bindings` (`{ "bg_color": "<tag>" }`), web e LVGL.
- Sfondo pagina: `background` / `background_dark` della pagina, **fissi** (`resolvePageBackground` in
  `RuntimeView.tsx`); nessun collegamento a una variabile.

## 1. Il tipo `color`

- Valore: stringa `#rrggbb` o `#rrggbbaa`, normalizzata in minuscolo. In scrittura si accettano anche `#rgb` (espanso)
  e i nomi CSS più comuni? **No** — solo esadecimale: un nome che il web capisce e LVGL no sarebbe un colore che cambia
  da uno schermo all'altro.
- `sws-core/src/tipo.rs`: `TipoScalare::Colore`, categoria nuova `Colore`, `parse("color")`, conversione in
  lettura/scrittura (stringa valida → normalizzata; altro → rifiuto), valore iniziale `#000000`. Fixture
  `tipi-scalari.json`: la riga e le coercizioni (validi, `#ABC`→`#aabbcc`, `rosso`→rifiuto, numero→rifiuto).
- Protocolli: un `color` non si mappa su un registro (Modbus, S7…): il validatore lo rifiuta come tipo di una mappatura,
  come oggi `string` dove non ha senso. Vive nelle variabili interne e in MQTT (testo).
- IDE: `tipiScalari.ts`; nella tabella delle variabili il valore si modifica con un **selettore di colore** (campione
  + `<input type="color">` + esadecimale), anche nel valore iniziale.

## 2. Il bottone che assegna

- Campo nuovo sull'oggetto `button`: `assegnazioni?: { tag: string; valore: string | number | boolean }[]`. Con
  `assegnazioni` non vuoto il bottone esegue **quelle**, in ordine, al clic (al posto di `button_mode`/`write_value`);
  senza, tutto come oggi. `require_confirm` vale per l'insieme (una conferma sola).
- Web (`SvgCanvas.tsx`): per ogni assegnazione `guardedWrite(tag, valore)`; una scrittura rifiutata non ferma le altre,
  e lo si dice come oggi.
- LVGL (`lvgl_render.rs`): `ButtonClickCtx` porta l'elenco precalcolato; al clic un `TagCommand` per assegnazione.
- Editor, pannello proprietà del bottone: sezione **«Al clic»** — scelta fra il comportamento di oggi e
  «Assegnazioni», con righe «variabile ▸ valore»; il campo valore segue il tipo della variabile (selettore colore per
  `color`, spunta per `bool`, numero, testo). Regola UI 2: il campo `tag` del bottone resta per la modalità di oggi,
  non si duplica.
- Validatore (`validate.rs`): ogni `tag` delle assegnazioni esiste, ogni valore è accettabile per il suo tipo.
- Schema AI del sinottico (`check_synoptic_schema`): il campo entra nello schema generato.

## 3. Lo sfondo della pagina collegato a una variabile

- Pagina: campo nuovo `background_tag?: string`. Se presente e la variabile ha un colore valido, vince su
  `background`/`background_dark`; altrimenti si torna a quelli (variabile assente, qualità cattiva, valore non colore).
- Web: `resolvePageBackground` riceve il valore della variabile; LVGL: lo sfondo dello screen si aggiorna quando la
  variabile cambia (come i `bindings` degli oggetti).
- Editor: nelle proprietà della pagina, «Sfondo da variabile» con la scelta fra le variabili `color`.
- Sfondo degli **oggetti**: niente di nuovo da costruire — `bindings.bg_color` esiste; l'editor propone le variabili
  `color` per i campi colore collegabili.

## Esempio d'uso (quello del maintainer)

Variabile `sfondo: color = #1e293b`; tre bottoni con `assegnazioni: [{ tag: sfondo, valore: "#7f1d1d" }]` ecc.; la
pagina con `background_tag: sfondo` (o un rettangolo con `bindings.bg_color: sfondo`).

## Ordine

1. tipo `color` (runtime + fixture + IDE tabella) — 2. bottone che assegna (web + LVGL + editor + validatore) —
3. sfondo pagina collegato. Ogni passo chiude con la definition of done; un ramo, `feat/colore-e-assegnazioni`.

## Verifica

- Rust: `tipo.rs` (parse, normalizzazione, rifiuti), validatore (assegnazioni, tipo nelle mappature), LVGL
  (assegnazioni → comandi, sfondo da variabile).
- vitest: selettore colore nella tabella, assegnazioni nel pannello del bottone, clic che scrive tutte le variabili,
  sfondo pagina da variabile e ripiego.
- Guardie: `check_tipi_scalari.sh`, `check_synoptic_schema.sh`, `check_static.sh`.
- Dal vivo: progetto di prova con `sfondo: color` e tre bottoni; web e `--istantanea` LVGL; poi sul TC620.
