# Oggetti agganciati all'area della cornice

> **Seme — decisione.** Nato l'11-11-2026 durante il collaudo della 2.26.0-rc.12 sul WP630 (test dell'assistente su
> Montagna). **Quando questo lavoro comincerà, il primo passo è una sessione di plan approfondita e dedicata** per
> sviscerarne tutti i dettagli: qui ci sono solo l'idea e le misure di oggi.

## L'idea

Richiesta del maintainer: «sarebbe da introdurre uno snap agli angoli interni in modo che se ridimensiono il frame
vengano riposizionati lo sfondo e gli oggetti».

Oggi una pagina con cornice ha uno spazio utile, l'**area interna**: quello che resta fra testata e piede. Se si cambia
l'altezza della testata o del piede, o la misura della cornice, quello che sta nella pagina non si sposta. Un oggetto
che prima stava sotto la testata ci finisce dentro, oppure resta un vuoto.

L'idea è che un oggetto (o uno sfondo) possa dichiararsi **agganciato** a uno o più angoli dell'area interna. Allora,
cambiando la cornice, l'oggetto si sposta (o si allunga) con l'area.

## Cosa c'è oggi nel codice (misura dell'11-11-2026)

- La cornice ha `larghezza`, `altezza`, `testata.altezza`, `piede.altezza` (`sws-web/src/cornici.rs`, `Cornice` e
  `Fascia`). L'area interna si calcola già: `area_libera(c)` → `Area { x, y, w, h }`.
- **Lo sfondo di pagina segue già l'area.** `sfondo_immagine` della pagina diventa un rettangolo `ID_SFONDO_AREA` largo
  quanto la cornice e alto quanto l'area, ricalcolato a ogni composizione (`sfondo_area`). Cambiando la cornice, lo
  sfondo si adatta da solo.
- **Gli oggetti no.** Hanno `x`, `y`, `width`, `height` assoluti in pixel di pagina. Un `rect` con `bg_image` usato come
  sfondo (come fa l'assistente quando cicla più foto giorno/notte) è un oggetto qualunque, e non segue l'area.
- La guardia c'è: `oggetti_nelle_fasce` segnala chi invade una fascia, e l'editor mostra le fasce in modifica
  (`sws-editor/src/cornici/fasce.ts`). Ma segnala soltanto: non sposta niente.
- L'assistente riceve `area_libera` in `leggi_progetto` e nelle cornici (`ai/tools.rs`, `ai/prompt.rs`) e ha la regola
  di stare dentro. Coordinate assolute anche per lui.

## Le domande per la sessione di plan

1. **Dove si scrive l'aggancio.** Un campo dell'oggetto (per esempio `ancora: [alto, sinistra]` o «riempi l'area»),
   oppure una regola implicita per tutti gli oggetti di una pagina con cornice (coordinate relative all'area invece
   che alla pagina)? La seconda cambia il significato di `x`/`y` per tutti i progetti esistenti.
2. **Spostare o allungare.** Agganciato a un angolo: l'oggetto si sposta. Agganciato a due angoli opposti: si allunga.
   Serve anche «centrato nell'area»?
3. **Quando si applica.** Solo nell'editor, quando si ridimensiona la cornice (gli oggetti si riscrivono nel file), o a
   ogni composizione nel runtime (il file non cambia, il runtime calcola)? La prima tiene il formato com'è e funziona
   uguale sui due motori; la seconda va fatta due volte, web e LVGL.
4. **Lo snap nell'editor.** Trascinando un oggetto vicino a un angolo dell'area interna, l'editor lo aggancia (calamita)
   e registra l'aggancio?
5. **L'assistente.** Se l'aggancio esiste, l'assistente dovrebbe usarlo per gli sfondi e per gli oggetti di bordo.
6. **Faceplate e pagine-finestra.** Le pagine-finestra non hanno cornice: l'aggancio vale anche per i bordi della
   finestra?
