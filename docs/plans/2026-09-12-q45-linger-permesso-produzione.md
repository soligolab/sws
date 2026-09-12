# Q45 — Il container di produzione non riparte dopo un reboot senza un permesso che l'utente finale non ha

> Trasferito da `docs/OPEN_QUESTIONS.md` (Q45) il 2026-09-12, aperta il 2026-09-08. Nessuna
> decisione presa nella scheda originale — rileggerla per intero prima di agire.

## Contesto

`install-container.sh` è rootless da cima a fondo, ma deve abilitare il **linger**
dell'utente (`loginctl enable-linger "$USER"`), altrimenti i servizi `systemd --user` muoiono
al logout e non ripartono al boot. Se il comando fallisce (manca il permesso), lo script
stampa un avviso e continua — il guasto si manifesta solo **al primo riavvio**, settimane dopo
l'installazione, lontano da chi ha installato. È in tensione con la specifica delle credenziali
(l'utente finale non ha `sudo`, solo `pixsys` in fase di test).

## Da misurare prima di decidere (passo 0, non richiede scegliere fra le opzioni)

Sul WP630/TC620 (dispositivo di fabbrica, appena resettato se possibile):
```
loginctl show-user user | grep Linger
```
Se il linger è **già attivo di fabbrica** sull'immagine Pixsys, la domanda si chiude da sola
(niente da fare se non documentarlo e far fallire l'installazione quando non lo è, invece del
solo avviso attuale). Ora che il TC620 è raggiungibile e aggiornato (2.7.3), questa misura è
fattibile in pochi minuti — non serve aspettare un'altra sessione per il solo passo 0.

## Opzioni (dalla scheda originale, nessuna scelta ancora)

1. **Linger già di fabbrica** — se il passo 0 lo conferma, basta documentarlo e trasformare
   l'avviso attuale in un errore bloccante quando manca.
2. **Una regola polkit nell'immagine**, come `17-chromium.rules` fa già per il riavvio del
   browser — concede quel singolo verbo senza dare `sudo`. Va chiesto a chi costruisce
   l'immagine Yocto (fuori dal controllo di questo repo).
3. **Un'unità di sistema** al posto di quella utente — riapre il tema dei permessi che il
   rootless serviva a chiudere. Probabilmente da evitare.
4. **Installazione che si rifiuta di riuscire a metà**: senza linger, errore invece di avviso.
   Onesto, ma blocca chi sta solo provando in laboratorio (dove il linger manca spesso e non è
   un problema).

## Prossimo passo

Fare la misura (passo 0) e portarla al maintainer — la scelta fra 1/2/3/4 dipende dal suo
esito, non ha senso indovinarla prima.

## File coinvolti (se serve codice, dopo la decisione)

`deploy/container/install-container.sh` (il punto che chiama `loginctl enable-linger` e
gestisce il fallimento).
