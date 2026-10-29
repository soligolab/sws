# Lo schermo del pannello su un'origine sua

> **Seme — decisione.** Nato chiudendo il piano
> [lo schermo del pannello dal cloud](../archive/2026-10-29-schermo-remoto.md), validato dal maintainer
> il 29-10-2026 sera. **Quando questo lavoro comincia, il primo passo è una sessione di plan
> approfondita per sviscerarne tutti i dettagli**: qui ci sono l'idea e le misure di oggi, non un
> disegno.

## L'idea

Lo schermo remoto mostra la pagina operatore **del pannello** (decisione 5 del piano), servita
attraverso il tunnel sotto `https://sws.soligo.net/schermo/<pannello>/`. Quindi HTML e script
scritti dal pannello girano sull'**origine del cloud**, la stessa dell'IDE.

Con un pannello nostro, che serve la nostra immagine, è la stessa pagina che gira in rete locale e
non c'è niente da temere. Un pannello **manomesso** (accesso fisico, root) invece potrebbe servire
uno script che legge il `localStorage` di `sws.soligo.net`, dove sta il gettone cloud di chi apre
il suo schermo (chiave `sws.auth`). Anche quello di chi amministra la piattaforma, che lo apre dal
link della console.

La strada che chiude il problema è un'**origine separata** per gli schermi, dove il gettone del
cloud non c'è.

## Misurato il 29-10-2026

| Cosa | Dove | Perché conta |
|---|---|---|
| Il gettone del cloud sta in `localStorage`, chiave `sws.auth` | `sws-editor/src/store/index.ts` (`AUTH_KEY`) | Ogni script della stessa origine lo legge. La chiave separata dello schermo (`sws.auth@/schermo/<p>`) evita solo gli incidenti, non uno script ostile |
| Il cookie `sws_schermo` ha `Path=/schermo/<p>/`, `HttpOnly` | `sws-web/src/schermo.rs` | Il cookie è al sicuro; il problema è il `localStorage`, che il `Path` non divide |
| Il biglietto si chiede a `POST /api/pannelli/:nome/schermo` e si scambia con `?biglietto=` | `schermo.rs`, `ViewerLink.tsx`, `console/Pannelli.tsx` | Lo scambio funziona già fra due richieste separate: spostarlo su un altro nome non cambia il meccanismo |
| Certificati Let's Encrypt con la sfida **HTTP-01** | `deploy/vps/STATO.md`, `traefik.yml` | Un nome fisso si aggiunge come `sws.soligo.net`; un nome per pannello vuole un certificato per nome, o un jolly con la sfida DNS-01 (token API di Cloudflare) |
| DNS su Cloudflare, solo DNS (nuvola grigia) | `deploy/vps/STATO.md` | Un record in più, nessun proxy da configurare |

## Le strade che si vedono oggi

1. **Un nome per tutti gli schermi** (`schermo.sws.soligo.net`): un record DNS e un certificato
   HTTP-01. Il gettone del cloud non c'è più; restano insieme gli schermi dei pannelli diversi, che
   potrebbero leggersi i login fatti nello schermo l'uno dell'altro.
2. **Un nome per pannello** (`<pannello>.schermo.sws.soligo.net`): isolamento completo, ma serve
   il certificato jolly (DNS-01 con un token Cloudflare sul VPS) oppure un certificato per pannello.
3. **Lasciare com'è** finché i pannelli collegati sono solo i nostri e quelli dei due clienti di
   prova, dichiarandolo nelle condizioni d'uso.

Da decidere **prima che lo schermo esca dalla prova** con i due clienti di oggi.
