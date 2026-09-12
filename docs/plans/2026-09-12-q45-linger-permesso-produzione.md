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

---

## Testo originale della scheda (spostato da `docs/OPEN_QUESTIONS.md` il 2026-09-12)

## Q45 — Il container di produzione non riparte dopo un reboot senza un permesso che l'utente finale non ha

*Aperta il 2026-09-08 durante l'allineamento alla specifica SSH. Nessuna decisione presa.*

**Il fatto.** `deploy/container/install-container.sh` è rootless da cima a fondo — verificato: non
esegue un solo `sudo` — ma a un certo punto deve abilitare il **linger** dell'utente, altrimenti i
servizi `systemd --user` muoiono al logout e **non ripartono al boot**. Lo script ci prova
(`loginctl enable-linger "$USER"`), e se non ci riesce stampa:

```
ATTENZIONE: non ho potuto abilitare il linger (serve un permesso).
            Esegui:  sudo loginctl enable-linger user
            Senza, il container NON riparte dopo il reboot.
```

**Perché è una questione e non un dettaglio.** La specifica dice che `user` sono le credenziali
**limitate** dell'utente finale e che `pixsys` — l'accesso privilegiato — serve solo in fase di test:
nessun comando di produzione può presupporlo. Ma quel `sudo loginctl` è esattamente un comando di
produzione che lo presuppone. Oggi il caso non si vede perché in laboratorio si installa con un
account che può fare `sudo`; su un dispositivo consegnato al cliente, l'installazione riesce, il
messaggio scorre via nel registro, e il guasto si manifesta **al primo riavvio** — settimane dopo,
lontano da chi ha installato. È la forma di guasto più cara: silenziosa e differita.

**Le strade, senza sceglierne una.**

1. **Il linger è già attivo di fabbrica** per l'account utente dell'immagine Pixsys. Da verificare
   sul dispositivo (`loginctl show-user user | grep Linger`) — se è così, non c'è niente da fare se
   non documentarlo e far fallire l'installazione quando non lo è.
2. **Una regola polkit nell'immagine**, come `17-chromium.rules` fa già per il riavvio del browser:
   concede quel singolo verbo senza dare `sudo`. Va chiesto a chi costruisce l'immagine Yocto.
3. **Un'unità di sistema** al posto di quella utente, il che però riapre tutto il tema dei permessi
   che il rootless serviva a chiudere.
4. **Installazione che si rifiuta di riuscire a metà**: senza linger, errore invece di avviso.
   Onesto, ma blocca chi sta solo provando.

**Da misurare prima di decidere**: sul WP630 appena resettato, `loginctl show-user user`.

---
