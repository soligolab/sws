# Il repository su un server di casa, con un backup cifrato (seme)

> Nato il 22-11-2026, dal maintainer: «vorrei valutare di spostare il repository su un server locale, principalmente
> per motivi di privacy rispetto a github, ma al tempo stesso vorrei avere un backup di sicurezza».

**Stato: seme — decisione.** Quando questo lavoro comincerà, il primo passo è una sessione di plan approfondita e
dedicata, per sviscerarne tutti i dettagli. Qui ci sono l'idea, le misure di oggi e le opzioni viste, non un progetto.

## L'idea
Un server git (Forgejo o Gitea) sul **Proxmox di casa** del maintainer, lo stesso che ospiterà la chiave intermedia di
firma del C7 ([sessioni CRA](../2026-11-17-cra-sessioni-e-decisioni.md)), al posto di GitHub come `origin`. Il
guadagno vero è la privacy: un repository privato su GitHub non è pubblico, ma il codice sta comunque sui server di
un'azienda americana. Il trasloco di rami e tag è la parte facile; la parte da progettare è tutto quello che oggi
dipende da GitHub, e il backup.

## Cosa dipende da GitHub oggi (22-11-2026)
- `origin` è `git@github.com:soligolab/sws.git`; `scripts/session_start.sh` confronta tutto con origin.
- La CI: `.github/workflows/ci.yml` (GitHub Actions, le mail «CI failed» del capitolo 11 di `docs/HOWTO.md`).
- Le immagini: `ghcr.io/soligolab/sws-runtime`, citato in 12 file fra `scripts/`, `deploy/` e il codice (canali
  `rc-*`/`latest-*`, il gateway del VPS, `install-container.sh`, l'aggiornamento dei pannelli).
- 54 file di documenti e script citano `github.com`; `gh` si usa poco.
- Le macchine: `ufficio` (casa), `theobroma` ed `elitedesk` (ufficio), il VPS, che non compila ma tira le immagini.

## Le opzioni già visibili
1. **Il server**: Forgejo su un container (LXC) del Proxmox; raggiunto dall'ufficio con **WireGuard**, oppure con un
   passaggio dal VPS (Traefik + tunnel verso casa). Se la linea o la corrente di casa cadono, dall'ufficio niente push
   né pull: si decide se basta, o se serve uno specchio leggibile altrove.
2. **La CI**: Forgejo Actions (compatibili con i workflow di GitHub) o Woodpecker, su un runner del Proxmox.
3. **Le immagini**: restano su ghcr finché non si fa il C7; poi un registry sul VPS (i pannelli le prendono da
   internet, quindi non può stare in casa), che è anche il posto del download riservato ai dispositivi abbinati.
4. **Il backup**, regola 3-2-1:
   - fuori casa e **cifrato dal client** (restic o borg) verso uno storage europeo o il disco del VPS: il fornitore
     tiene dati che non sa leggere;
   - uno **specchio git cifrato** con `git-remote-gcrypt`, tenibile anche su GitHub (vede solo cifrato, si ricostruisce
     con la sola chiave);
   - un **`git bundle` periodico** su un disco offline, insieme alla chiave radice.
   Le chiavi del backup le custodisce il maintainer, come la radice del C7: senza, il backup non serve.

## Raccomandazione vista il 22-11
Forgejo sul Proxmox con WireGuard dall'ufficio; restic cifrato fuori casa più lo specchio gcrypt; immagini su ghcr
fino al C7, poi sul VPS. Da riscrivere quando si comincia: `session_start.sh`, il capitolo 11 di `HOWTO.md`,
`docs/TEST_SETUPS.md` e i link nei documenti.
