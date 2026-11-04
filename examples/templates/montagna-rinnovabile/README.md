# Ruolo di questo template

**Applicazione realistica, piccola** — e insieme il confronto fra due modelli dell'assistente IA, fatto il
04-11-2026 sulla stessa richiesta.

| | |
|---|---|
| **Risorsa** | un impianto di energia rinnovabile: pensiline fotovoltaiche con inverter, una centrale idroelettrica con la condotta forzata, il consumo di un villaggio |
| **Caso d'uso** | vedere a colpo d'occhio quanto producono il sole e l'acqua, quanto consuma il villaggio e quanto si cede alla rete; avviare la turbina e accendere l'illuminazione pubblica |

## Cosa c'è

- **Due pagine dello stesso impianto**: *Impianto — Opus 5.5* (la pagina iniziale) e *Impianto — Kimi K3.1 Pro*.
  Le ha composte l'assistente IA dell'IDE, con la stessa richiesta e le stesse risposte, una con ciascun modello.
  Il resoconto del confronto è in `docs/archive/2026-11-04-un-modello-per-ogni-scopo.md`.
- **Una terza pagina, *Lago — sfondi in due passi***: un lago alpino con un rifugio, di giorno e di sera, e un
  **cursore giorno/notte** in basso che fa la dissolvenza fra le due foto. La sera è una *modifica* della foto del
  giorno (la regola dei due passi degli sfondi dell'assistente), quindi il rifugio resta nello stesso punto. Le due foto
  sono i JPEG 1536×1024 di gpt-image-2 così come escono, coperti con `image_fit: cover`; il cursore scrive
  `c.giorno_notte` mentre si trascina, e lo può muovere chiunque (`write_min_role: Viewer`).
- **Tre foto della stessa valle** in `images/` (giorno, tramonto, sera), generate con gpt-image-2: la base del giorno,
  e le altre due come sue modifiche, così pensiline, condotta e villaggio stanno negli stessi punti. Sono tre oggetti
  `image` sovrapposti a tutta pagina, con l'opacità legata a `s.luce`: si danno il cambio in dissolvenza.
- **Una giornata in 10 minuti**: `s.ora` va da 0 a 24, `s.luce` da 0 (mezzanotte) a 1 (mezzogiorno). Lo script
  `giornata` fa seguire l'ora al fotovoltaico (zero dalle 18 alle 6) e alla turbina il comando `c.turbina_marcia`.
- **Tre simboli disegnati dall'assistente** nel progetto: `prj:turbina-idro` e `prj:lampione-stradale` (Opus),
  `prj:turbina-pelton` (Kimi).

## Per provarlo

Crea un progetto da questo template e premi RUN: non ci sono sorgenti, tutto si muove da sé. La turbina parte ferma:
premi *Marcia turbina*. Nella pagina *Lago* il cursore parte dalla notte: trascinalo verso destra.

Nessun indirizzo, nessuna credenziale: le variabili sono interne. Per un impianto vero si collegano in Comunicazione.
