# I tag calcolati costano troppa CPU sul pannello

> **FATTO, archiviato il 17-11-2026**: il maintainer ha confermato sul TY570 che i LED contano e la CPU è scesa.
>
> Piano del 17-11-2026, regola «un'anomalia che rovina l'uso passa davanti». Ramo `fix/derived-tags-cpu`.

## Il difetto

Sul TY570 (Tiny TY, un core ARM, 235 MB) la pagina degli 8 LED del progetto `tiny-ty` porta la CPU intorno all'87 %.
Misura del 17-11-2026 con `top`: `sws-runtime` **67 %** (spalmato su 9 thread `tokio-rt-worker` al 7 %),
`sws-lvgl-viewer` 13 %, il resto sotto il 3 %.

Il progetto ha `OllamaTest` (generatore a rampa, cambia ogni 100 ms) e 8 tag calcolati con un'espressione Python, uno
per bit. Il valutatore dei tag calcolati (`sws-runtime/src/main.rs`) a ogni cambio di un tag qualunque, per **ogni**
espressione:
1. apre un `spawn_blocking`;
2. ricostruisce il dizionario Python di **tutti** i tag;
3. rifà `ast.parse` e `compile` del testo, sempre uguale (`sws_pyscript::eval_expression`).

Ottanta compilazioni al secondo per otto bit. Il difetto c'è da quando ci sono le espressioni: si vede solo su un
processore piccolo e con un tag veloce.

## La correzione

1. **Il codice compilato si tiene**: una cache per testo dell'espressione (come `CODICE_COMPILATO` per gli script).
2. **Un giro Python solo per tutte le espressioni**: un `spawn_blocking`, un dizionario dei tag per giro (una copia
   leggera per espressione, così un'espressione che lo cambia non tocca le altre).
3. **Si ricalcola solo chi legge un tag cambiato**: da ogni espressione si ricavano i tag letti per nome
   (`tags["x"]`, `tags.get("x")`); un'espressione che li legge in altro modo si ricalcola sempre, come oggi.

Il comportamento non cambia: stessi risultati, stessi errori, stesse regole del giro.

## La verifica

- Test: la cache, il giro unico con un'espressione che sbaglia in mezzo, le dipendenze.
- Misura sul TY570 prima e dopo, con la stessa pagina: il numero va scritto qui sotto.

## Le misure

Sul TY570, con la stessa pagina e lo stesso progetto, CPU media su 30 secondi da `/proc/<pid>/stat`:

| | `sws-runtime` | `sws-lvgl-viewer` | macchina intera |
|---|---|---|---|
| Prima (runtime 2.26.0-rc.19 del pannello) | 65 % | 12 % | 86 % |
| Dopo (rc.20 più solo questa correzione, `cherry-pick` nel worktree `tmp/wt-ty`) | **6 %** | 11 % | **23 %** |

Nessun errore dei tag calcolati nel registro dopo il cambio. Il binario di prima è sul pannello come
`/opt/sws/bin/sws-runtime.prima-cpu-fix`; quello nuovo resta finché il pannello non riceve un pacchetto vero.
