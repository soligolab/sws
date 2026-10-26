# Un piccolo editor 3D per le planimetrie dei sinottici — seme

> **Seme — decisione.** Quando questo lavoro comincia, il primo passo è una **sessione di plan dedicata e
> approfondita** per sviscerarne tutti i dettagli. Quello che c'è qui è materiale, non un piano d'esecuzione.

## L'idea (maintainer, 25-10-2026)

«Piccola idea folle da pianificare: introdurre un minimo editor di ambienti 3D per disegnare delle planimetrie da usare
come sinottico delle pagine.» Il caso che l'ha fatta nascere è CasaDomotica: una pagina come la planimetria della
casa o del garage, con le luci e i sensori al loro posto.

## Cosa c'è oggi (25-10-2026)

- Lo sfondo di una pagina può essere un'immagine (anche solo nell'area attiva della cornice, dal 25-10-2026): oggi una
  planimetria si disegna fuori da SWS e si carica come immagine.
- I sinottici sono SVG sul web e LVGL sul pannello: qualunque cosa 3D deve diventare, a runtime, qualcosa che i due
  motori sanno disegnare (un'immagine renderizzata, o primitive 2D), o vivere solo sul web.

## Le domande da sciogliere nella sessione di plan

- **3D vero o 2,5D**: un editor di stanze (muri, porte, finestre in pianta) con una vista prospettica *renderizzata
  una volta* in un'immagine di sfondo, oppure una scena 3D navigabile a runtime (solo web, e il pannello LVGL?).
- **Dove vivono gli oggetti**: gli oggetti del sinottico (luci, sensori) restano 2D sopra lo sfondo, o stanno nella
  scena e si proiettano?
- **Costruire o integrare**: una libreria esistente (es. un editor di planimetrie open source) contro un editor nostro
  minimo; licenze; peso nel bundle dell'IDE.
- Per chi è: domotica (CasaDomotica) o anche impianti industriali (layout di reparto)? La regola di CasaDomotica dice
  che una funzione che lì non trova posto racconta chi ne è il destinatario.
