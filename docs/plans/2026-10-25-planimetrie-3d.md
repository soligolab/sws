# Planimetrie: la pianta si disegna nell'IDE, la vista 3D diventa lo sfondo — piano d'esecuzione

## Context

Idea del maintainer (25-10-2026): «introdurre un minimo editor di ambienti 3D per disegnare delle
planimetrie da usare come sinottico delle pagine», nata da CasaDomotica. Sessione di plan il
28-10-2026; decisioni del maintainer:

1. **Resa generata una volta** nell'IDE → immagine di sfondo della pagina (niente scena viva a
   runtime: web e LVGL ricevono la stessa immagine, zero peso).
2. **Oggetti del sinottico 2D sopra lo sfondo**: oggetti normali della pagina, piazzati a mano
   dove si vedono nella vista.
3. **three.js solo nell'IDE**, chunk lazy (~150 KB gzip); l'editor di pianta è nostro.
4. **Anche industriale da subito**: oltre a muri/porte/finestre, **aree** (zone di reparto a
   pavimento, colorate ed etichettate) e **blocchi** (macchine/arredi come parallelepipedi).

### Perché regge (misurato il 28-10-2026)

- Le immagini di progetto esistono già: `<progetto>/images/`, API `uploadProjectImage` ecc.
  (`client.ts:1627-1646`), viaggiano in export/deploy/backup; `sfondo_immagine` della pagina
  (25-10) le usa; LVGL le disegna dal 2.23.3 (resvg `raster-images`), confermato dal maintainer
  sul WP630 il 28-10.
- Il precedente della «resa generata una volta» è `boot/rasterizza.ts`: il browser dell'IDE
  produce il PNG al salvataggio. Qui il produttore è three.js invece del canvas SVG, ma il
  principio (l'IDE genera, il runtime consuma un'immagine) è lo stesso.
- Lo schema cornici (`cornici.rs`, router.rs:7610-7730) è il modello per rotte e trasporto.

## Il modello — `planimetrie/<id>.yaml`

```yaml
id: casa-pt
nome: "Casa — piano terra"
unita_px_m: 50            # scala della pianta: pixel per metro
muri:                     # polilinee con spessore e altezza (metri)
  - { id: m1, punti: [[0,0],[10,0],[10,8]], spessore: 0.2, altezza: 2.7 }
aperture:                 # agganciate a un muro: t = posizione 0..1 lungo la polilinea
  - { id: a1, muro: m1, t: 0.3, larghezza: 0.9, altezza: 2.1, tipo: porta }
  - { id: a2, muro: m1, t: 0.7, larghezza: 1.2, altezza: 1.2, tipo: finestra, da_terra: 0.9 }
aree:                     # zone a pavimento (reparto, stanza): poligono, colore, etichetta
  - { id: z1, punti: [[0,0],[5,0],[5,4],[0,4]], colore: "#1e3a5f", etichetta: "Cucina" }
blocchi:                  # macchine/arredi: box con rotazione
  - { id: b1, x: 6, y: 2, larghezza: 1.2, profondita: 0.8, altezza: 1.5, rotazione: 0,
      colore: "#64748b", etichetta: "Caldaia" }
camera: { pos: [12, 9, 10], target: [5, 0, 4], fov: 45 }   # l'ultima inquadratura salvata
sfondo: "#0f172a"
```

- TS in `src/planimetrie/modello.ts`; lato Rust struct **opaca** (id, nome + `Value`), come il
  passthrough di `FaceplateDef`: il server archivia, non interpreta.
- Le **aperture tagliano il muro per segmentazione**, non per CSG: il tratto di muro si spezza
  all'apertura, sopra una porta resta l'architrave, una finestra ha davanzale e architrave. È
  geometria nostra, testabile come dati puri, e **non aggiunge dipendenze oltre a three**.

## Server (pattern cornici)

- Rotte `/api/planimetrie` (GET elenco, GET/PUT/DELETE `/:id`), Operator+ in lettura,
  Configurator+ in scrittura, header versione Q30, `scrivi_atomico`, cartella `planimetrie/`.
- Trasporto: export/import ZIP (`build_project_zip`, `sync_yaml_dir_from_zip`), deploy remoto,
  backup, percorsi `git_deploy`, cache `DI_PROGETTO`, **impronta** (un IDE su un'altra macchina
  deve vederla cambiare). **Niente istantanea** (il banco disegna pagine; il PNG generato sta in
  `images/`, già copiata) e **niente viewer**: web e LVGL non sanno che le planimetrie esistono.

## Editor

- Sezione **«Planimetrie»** in LeftPanel (righe + «+ Nuova planimetria»); selezionarne una apre
  `PlanimetriaEditor` al posto del canvas (il precedente è `FunctionEditor` con
  `selectedFunctionId`).
- `PlanimetriaEditor` (`src/planimetrie/`): **pianta 2D in SVG** (disegno muri a polilinea con
  snap alla griglia metrica; porte/finestre trascinate su un muro, parametro `t`; aree poligonali;
  blocchi con rotazione; selezione + proprietà a destra) e **anteprima 3D** affiancata
  (`import("three")` dinamico: muri estrusi con la segmentazione alle aperture, blocchi = box,
  aree = piani colorati sul pavimento con etichetta, luce ambiente + direzionale, OrbitControls;
  l'inquadratura si salva in `camera`).
- Stato e salvataggio: **draft di sezione con Salva** (il pattern delle schede config /
  `pendingSections`), fuori dalla history globale delle pagine — una planimetria non è una
  `SynopticPage` e non deve esserlo: non ha oggetti sinottici, ha muri.
- **«Genera sfondo…»**: scelta della misura (proposta: quella della pagina corrente o il formato
  del progetto), render fuori schermo a 2× e ridotto, `toBlob` →
  `uploadProjectImage("planimetria-<id>.png")`. Le pagine che hanno quell'immagine come
  `sfondo_immagine` (campo e selettore esistono già in PageProps) si aggiornano da sole:
  rigenerare sovrascrive lo stesso nome.
- i18n it/en; il chunk three **non entra nell'avvio**: import dinamico solo all'apertura della
  sezione.

## Rami (uno alla volta)

1. **`feat/planimetrie-modello`** — modello TS+Rust, rotte, trasporto, impronta, test cargo;
   sezione LeftPanel; editor di pianta 2D completo (senza 3D), salvataggio a draft.
2. **`feat/planimetrie-resa`** — chunk three.js lazy, anteprima 3D orbitabile, «Genera sfondo» →
   `images/`, misura del PNG, collaudo del peso del chunk.
3. **`feat/planimetrie-casadomotica`** — planimetria della casa (o del garage) su CasaDomotica,
   sfondo della pagina corrispondente, manuale (capitolo editor), CHANGELOG + NOVITA (it+en).

## Fuori da questo piano

- Scena 3D viva a runtime (se mai, seme suo quando il PoC la chiede).
- Oggetti del sinottico proiettati dalla scena.
- Import di formati esterni (IFC, DXF); multi-piano in una sola planimetria (se ne fanno due).
- Texture/materiali: colori pieni e basta.

## Verifica

- Definition of done completa (cargo check/test, pnpm build, vitest, check_static).
- vitest sulla **geometria pura**: segmentazione del muro alle aperture (porta, finestra, due
  aperture sullo stesso tratto, apertura su un vertice), poligoni delle aree, costruzione della
  scena come **dati** (liste di box/estrusi) senza WebGL.
- cargo: CRUD, round-trip YAML, impronta che segue `planimetrie/`, bundle export/import.
- Dal vivo (IDE 8460): disegnare la pianta del garage, generare lo sfondo, metterlo a una pagina,
  verificare sul WP630 che LVGL la mostri (la strada raster è già confermata); misurare il peso
  del chunk three nel `dist` e che non si carichi all'avvio.
