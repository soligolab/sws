# Il collaudo da zero sul WP630 — factory reset, rc.21, tutto il sospeso

> **Stato**: pronto. Si fa al lavoro (`theobroma` + WP630), con `/test-changes`.
> **Origine**: il maintainer, 19-11-2026, notte: «il collaudo lo riprendo a lavoro e lo faremo da 0 partendo dal
> factory reset». Perimetro scelto: **tutto il sospeso**, non solo l'editor dei simboli.

## Perché da zero

Da un pannello appena resettato passano per forza le strade che un cliente fa una volta sola e che nessuno ripercorre:
installazione, fiducia del certificato, abbinamento al cloud, primo deploy. E le voci sospese di `COLLAUDI_IN_SOSPESO.md`
sono ~120, accumulate su rc.12 → rc.20: provarle su un'immagine sola, con tutto dentro, dice cosa vale **oggi**.

## Il punto di partenza (19-11-2026)

- `main` contiene tutto fino al 17-11 (l'IA a scelta del cliente, la correzione della CPU dei tag calcolati), **non in
  nessuna immagine**: l'ultima è la `2.26.0-rc.20` (16-11).
- L'editor dei simboli, fase 1, è sul ramo **`feat/symbol-def`** (pushato il 19-11 per arrivare su `theobroma`), non
  mergiato. Le sue prove sono nel blocco di `STATUS.md` «editor dei simboli».
- I certificati dell'IDE di prova di `ufficio` sono tornati a posto; su `theobroma` l'IDE di sviluppo è il suo.

## Il percorso, nell'ordine

Ogni passo rimanda alle voci di `docs/COLLAUDI_IN_SOSPESO.md` per sezione e numero: il testo delle prove sta lì e
non si copia qui. Gli esiti si spuntano lì, come sempre.

**0. Avvio su `theobroma`** — `/riprendi` (lancia `session_start.sh`), poi `git checkout feat/symbol-def`.

**1. L'editor dei simboli nell'IDE, dal ramo** (IDE di sviluppo 8460, progetto di prova). Le quattro prove del blocco
STATUS: variante di una pompa (tutte cambiano, tag intatti), «Torna all'originale», «Salva come…» da un oggetto,
«+ Nuovo simbolo» con un ingresso «Rotazione». Il login all'IDE lo fa il maintainer. Le anomalie si correggono sul
ramo prima di andare avanti.

**2. La rc.21** — solo se il passo 1 passa:
- squash merge di `feat/symbol-def`, controllo degli alberi, ramo eliminato;
- `NOVITA.yaml`: il blocco 2.26.0 è pieno a 15 voci, il maintainer sceglie le due da fondere per far posto all'editor;
- decidere se serve l'avviso al deploy per i pannelli che non conoscono `overrides` (sulla rc.21 non serve: il WP630
  la avrà);
- tag `2.26.0-rc.21` **quando si costruisce** (regola di `CLAUDE.md`), immagini arm64 e amd64 (in ufficio fino a
  50 minuti), VPS allineato. **Durante la build il checkout non si tocca.**
- Mentre costruisce, le voci **solo IDE** che non chiedono il pannello: «Lo stile sobrio» 1-5, «L'occhio sulle
  password» 2-3, «La 2.25.1» 14 (nomi tradotti).

**3. Factory reset del WP630** (lo fa il maintainer). Poi, da `theobroma`, i due comandi di `HOWTO.md` §9 —
`ssh-keygen -R` e `ssh-copy-id` — li lancia il maintainer: il reset cambia le chiavi host e cancella `authorized_keys`.

**4. Installazione della rc.21 da zero**:
- «B. Lo schema `http`/`https`» 5-6 (l'installatore, in chiaro e con TLS);
- «A-bis. La fiducia del browser del pannello» 1-4 (`fiducia-browser`, HTTPS da solo, card «il browser si fida»);
- «C. Il certificato» 10-11 e «D. L'impronta» 12-14, al primo collegamento dall'IDE.

**5. Abbinamento al cloud**:
- «Dai piani archiviati il 16-11» 1-3 (QR dal telefono, «Abbina un pannello…», un utente con due aziende);
- «A-sexies. Il tunnel» 1-3 (vivo, spento, perso).

**6. Primo deploy e i viewer** (Montagna e i gemelli `demo-items-*`, sul WP630):
- «Il viewer leggero» 1, 6-14 (30 minuti su Montagna, web e LVGL, dati in ritardo, login lento);
- «Collaudo 2.26.0-rc.15» 2-6, 9-12 (LVGL: testi, disegno, bottoni con funzione, finestre, comando critico, TLS);
- «La serie L0 → F2 → F3» 1, 3-5 (script sul pannello, conferme);
- «A-terdecies» 1-2 (il cloud passa dal pannello);
- **l'editor sul pannello**: una pagina con la variante della pompa, deploy, la variante si vede uguale sul web e
  sul LVGL.

**7. L'IA nel cloud** (dopo che il VPS ha la rc.21):
- «L'IA a scelta del cliente» 6-8; «Le chiavi IA dell'account» 1-5;
- «L'assistente: faceplate e sfondi» 3-5 e «L'assistente, secondo giro» 1-3, se si vuole spendere.

**8. Il pannello come dispositivo**, in fondo perché lo cambiano:
- «Dai piani archiviati il 16-11» 7-8 (luce, «Calibra»);
- «Collaudo 2.26.0-rc.19» 2-5, 8 (tastiera, angoli, verticale, voce divisa, rotazione);
- «Collaudo 2.26.0-rc.19» 6 (**elimina progetto e abbinamento**): per ultimo, e poi si riabbina col QR — è il
  passo 5 rifatto, gratis.

## Cosa resta fuori, e perché

- **Il TC620 e la casa**: quadlet 8 e drop-in (16-11, 4-6), CasaDomotica, Zigbee2MQTT (A-septies), il modulo 5AD
  (A-ter). Si fanno da `ufficio`.
- **«Aggiorna ora»** (10-11, rc.15 1, 2.25.1 9): serve una versione più nuova nel canale. Si prova alla rc.22, non
  si costruisce una rc apposta (regola delle build non sprecate).
- **Hardware o account che non ci sono**: touch resistivo, Twilio a pagamento, Sparkplug B, OPC-UA con strutture
  (G, G-bis, G-ter), UPS e chiavetta Wi-Fi — restano dove sono, a meno che in ufficio ci sia il materiale.
- Il TY570 si aggiorna alla rc.21 col pacchetto vero (STATUS 17-11, punto 1), ma non fa parte di questo giro.

## Come si chiude

Gli esiti in `COLLAUDI_IN_SOSPESO.md` e in `STATUS.md`; le anomalie che pesano sull'uso diventano subito un piano e la
rc.22 (regola del 09-11). Le voci che non passano e non pesano restano spuntate a metà, con la data. Poi questo piano
va in archivio.
