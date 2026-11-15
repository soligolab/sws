# Sfondi di pagina alla misura del pannello

**Piano, 14-11-2026.** Nasce dal collaudo della rc.18 sul TY570. Il maintainer: «il cambio pagina era molto lento»,
e poi «ma lo sfondo non è alla misura giusta?». Non lo era. Approvato lo stesso giorno («Ok, mi sembra sensato»).
È un ramo annidato su `fix/control-panel-ty` (`fix/sfondi-alla-misura`), da rilasciare nella rc.19.

Prende **un punto** del seme [sfondi pesanti e precarico](semi/2026-11-13-sfondi-pesanti-e-precarico.md): «se convenga
decodificare il JPEG direttamente alla misura giusta». Gli altri punti del seme (l'avviso nell'IDE, quanti sfondi
precaricare) restano lì.

## Misure (14-11-2026)

- Lo sfondo di HVAC (`ai-sfondo-075ec9.jpg`, generato dall'assistente) è **1536×1024**. L'area dentro la cornice
  (`cornici::sfondo_area`) è 1024×(600 − testata − piede), circa 1024×500, con proporzioni diverse.
- Prima visita sul TY: **1840 ms** (`[sfondo] … pronto in`). Il pannello scarica 200 KB e decodifica 1,5 Mpx dentro un
  SVG con resvg, poi scala, ritaglia (`xMidYMid slice`) e converte nel formato di LVGL. Le pagine senza sfondo si
  costruiscono in 100-200 ms.
- La cache della rc.18 (gli ultimi due sfondi decodificati) dalla seconda visita dava un canvas di 0×0 pixel: corretta
  in `55b574ad`. Il maintainer quindi non ha mai visto la seconda visita veloce.

## Cosa si fa

1. **Il runtime serve lo sfondo alla misura chiesta.** `GET /api/project/images/<nome>?w=W&h=H`: per un JPEG o un PNG
   restituisce un JPEG di W×H esatti, scalato e ritagliato come `cover` (lo stesso `xMidYMid slice` del web e di
   LVGL). Il risultato si salva su disco accanto alle immagini, in una cartella di varianti nascosta, con il nome
   legato a misura e data del file originale. Così si calcola una volta sola e sopravvive ai riavvii. L'originale non
   si tocca: se la cornice cambia, cambia la misura chiesta e nasce un'altra variante. Senza `w`/`h` tutto resta
   com'è (web, IDE, export).
2. **Il viewer LVGL chiede lo sfondo alla sua misura e decodifica il JPEG direttamente** con `zune-jpeg`, che c'è già
   nell'albero tramite resvg. Il JPEG va subito nel buffer di LVGL, senza SVG, senza scala e senza ritaglio. Se la
   risposta non ha la misura attesa (un runtime vecchio, un SVG) si torna alla strada di oggi.
3. **Le varianti si preparano in anticipo.** All'apertura del progetto, in sottofondo, per ogni pagina con
   `sfondo_immagine`, alla misura dell'area di `sfondo_area`. La prima visita trova la variante già pronta.

## Verifica

- Test: la variante ha la misura chiesta e il ritaglio `cover`; un secondo GET la legge dal disco; un originale
  cambiato produce una variante nuova; senza query si ha l'originale; un nome fuori dalla cartella viene rifiutato.
- Il viewer, con un JPEG della misura giusta, non passa da resvg (riga di log diversa).
- Sul TY570: la riga `[sfondo] … pronto in N ms` alla prima visita di HVAC, prima e dopo, e il confronto visivo
  dell'istantanea con quella di oggi.
