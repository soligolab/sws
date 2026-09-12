# Q28 — Il grafico a barre usa due scale diverse nei due motori

> Trasferito da `docs/OPEN_QUESTIONS.md` (Q28) il 2026-09-12, aperta il 2026-08-31, misurata
> ma **non decisa**. Questo file presenta la domanda e le opzioni per il maintainer — non
> decide nulla, per la regola di `CLAUDE.md` su `docs/OPEN_QUESTIONS.md`. Rileggere la scheda
> originale per le misure complete (pixel, valori) prima di scegliere.

## Il problema, in breve

`bar_chart` legge la scala in due modi diversi a seconda del motore:

| | Scala |
|---|---|
| **Web** | una sola per tutto il grafico: `obj.min`/`obj.max`, o senza dichiarazione `0..max(valori correnti)` — **si muove coi dati** |
| **Pannello LVGL** | una per serie: `bar_series[i].min/max`, default **`0..100` fissa** |

Misurato sui pixel (2026-09-06): con gli stessi tre tag a 20/45/30, le barre nel browser sono
**più del doppio** di quelle sul pannello, a parità di progetto — perché nessuno dei due template
demo dichiara una scala esplicita, quindi entrambi cadono sui default, che sono diversi. Il
*rapporto* fra le barre è identico nei due motori (partono entrambe da zero); quello che cambia
è "quanto è pieno" il grafico visto da solo.

## Le domande, senza risposta

1. **Quale lettura è quella voluta?** Scala comune (si confrontano le barre fra loro, ma il
   grafico "respira" coi dati) o scala per serie (si legge il riempimento rispetto al proprio
   fondo scala, utile per grandezze diverse nello stesso grafico)? È una scelta di prodotto.
2. Se vince la scala comune: `bar_series[].min/max` va tolto dal modello o ridefinito — lasciarlo
   lì a non fare niente è peggio che non averlo.
3. Se vince la scala per serie: `obj.min`/`obj.max` sul `bar_chart` non significano niente e
   vanno tolti dal pannello proprietà.
4. In entrambi i casi: cosa succede ai progetti esistenti che già dichiarano l'uno o l'altro e
   hanno un aspetto approvato dal cliente.
5. **Anche il default deve coincidere**, qualunque scelta vinca — altrimenti la divergenza resta
   esattamente dov'è per ogni grafico che non dichiara nulla (cioè, oggi, per tutti e due i
   template demo).

## Perché non si può decidere da codice

Non c'è un modo "neutro" di scegliere: dipende da cosa i clienti mettono davvero nello stesso
grafico (grandezze omogenee → scala comune ha senso; grandezze eterogenee → scala per serie).
Serve il giudizio del maintainer su casi d'uso reali, non un'analisi tecnica in più.

## Quando si deciderà

Nessun file coinvolto finché non c'è una risposta alle domande sopra — a quel punto il lavoro è
piccolo (allineare un default, eventualmente togliere campi morti dal pannello proprietà e dal
modello). Nota di copertura: nessuna guardia oggi confronta il disegno web con quello LVGL per
questo tipo di divergenza — `istantanea_pagina`/T-59 potrebbe chiuderla in futuro.
