# Q39 — Il validatore deve aprire la famiglia dei rilievi geometrici?

> Trasferito da `docs/OPEN_QUESTIONS.md` (Q39) il 2026-09-12, aperta il 2026-09-05. Presenta
> la domanda, non la decide.

## Il problema

T-52 ha aggiunto **un** rilievo geometrico al validatore: l'avviso «N oggetti sono fuori
pagina» (per non disabilitare in silenzio progetti esistenti quando si rimpicciolisce una
pagina). È il primo del genere, e apre una porta: oggetto di larghezza 0, due oggetti
sovrapposti al pixel, testo che esce dal suo box, oggetto sotto la barra di navigazione — tutti
rilievi plausibili, nessuno ancora scritto.

La domanda non è se singoli rilievi siano utili (alcuni lo sono), ma **se il validatore sia il
posto giusto**: oggi risponde a «questo progetto sta in piedi?», non a «questa pagina è fatta
bene?» — e ogni rilievo geometrico va tenuto d'accordo col render, che è la cosa che diverge nel
tempo (la stessa lezione di Q28: due motori, due interpretazioni).

## Opzioni

1. **Fermarsi qui**: l'avviso di pagina resta un'eccezione motivata da un cambio di
   comportamento (T-52), non l'inizio di una famiglia.
2. **Aprire la famiglia** dentro il validatore, con una severità propria (`hint`? `style`?)
   distinta dagli errori che impediscono al progetto di funzionare.
3. **Un controllore separato** — "rilievi di composizione" — che gira nell'IDE e non nel
   validatore, così le due domande (il progetto funziona / la pagina è fatta bene) restano
   distinte.

**Default per il PoC**: opzione 1 (stato attuale).

## Prossimo passo

Chiedere al maintainer se sono emersi casi concreti (oltre "fuori pagina") che gli farebbero
comodo come rilievo automatico — la risposta pratica probabilmente guida la scelta fra 2 e 3
più di un ragionamento teorico.

## File coinvolti (solo dopo la decisione)

`sws-runtime/crates/sws-web/src/validate.rs` (se si sceglie 2) o un modulo nuovo lato editor/IDE
(se si sceglie 3).
