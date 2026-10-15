# Seme — git nei progetti del cloud (e dei pannelli in container)

> **Seme — decisione.** Segnalazione del maintainer, 15-10-2026: «ora che il progetto è su sws.soligo.net mi sembra
> che qualcosa non funzioni a partire dalla chiave ssh». Diagnosi misurata lo stesso giorno sul codice e sul VPS
> (in sola lettura, dentro il container `sws-p---CasaMauro`).
>
> **Quando questo lavoro inizia, il primo passo è una sessione di plan approfondita per definirne tutti i dettagli.**

## Diagnosi: quattro guasti, ognuno basta da solo

1. **Nell'immagine non c'è git, né ssh.** `podman exec sws-p---CasaMauro git --version` → `git: not found`, e
   `which ssh` non trova nulla. I Containerfile (`deploy/container/Containerfile.x86_64` e `.aarch64`) installano
   solo `ca-certificates`, `curl`, `python3` e RestrictedPython. Quindi **ogni** funzione git (init, commit, log, diff,
   tag, push, la prova di un ramo) fallisce nel cloud e su qualunque pannello che gira in container. In locale
   funziona perché `start_editor.sh` usa il git della macchina.
2. **Le chiavi SSH vengono da `~/.ssh` del processo** (`git_deploy.rs`, `chiavi_ssh_disponibili`): nel container
   la home è `/root`, e `/root/.ssh` non esiste. L'elenco nell'IDE è vuoto.
3. **Non c'è modo di averne una**: nessuna rotta genera o carica una chiave. E anche una chiave messa a mano
   sparirebbe, perché il gateway **ricrea** il container a ogni apertura (`gateway/progetti.rs`: monta solo
   `/progetto`; configurazione e home restano dentro il container). La chiave non può nemmeno stare nella cartella
   del progetto: è il repository, finirebbe nei commit.
4. **`known_hosts`**: il comando SSH (`SUFFISSO_SSH` = `-o IdentitiesOnly=yes`) non dice cosa fare con un host mai
   visto. Senza terminale, il primo push verso GitHub finisce in «Host key verification failed».

## Le strade (da decidere nella sessione di plan)

- **Prerequisito, comunque si scelga**: `git` e `openssh-client` nell'immagine (stimati 10–15 MB; da misurare anche
  sui pannelli, dove l'immagine è più delicata), più `known_hosts` precaricato con le impronte pubblicate di
  GitHub, GitLab e Bitbucket, e `StrictHostKeyChecking=accept-new` per gli altri host (fiducia al primo contatto,
  coerente col resto di SWS — vedi il seme [certificati in un posto solo](2026-10-15-certificati-in-un-posto-solo.md)).
- **Chiavi gestite dal gateway**: «Genera chiave» nell'IDE; la chiave privata vive nella configurazione del gateway,
  per azienda o per utente, ed è montata **in sola lettura** nel container del progetto; l'IDE mostra la chiave
  pubblica da incollare come *deploy key* su GitHub. Pro: niente segreti nel progetto. Da decidere: per azienda o
  per utente, rotazione, cancellazione.
- **HTTPS con token**: l'URL `https://` e un token personale salvato fra i segreti dell'azienda (credential helper).
  Più semplice per GitHub e GitLab, nessun `known_hosts`; ma un token ha permessi più larghi di una deploy key.
- **Sui pannelli** la domanda è diversa: serve davvero git sul pannello, o basta il deploy dall'IDE? Se serve, la
  chiave vive nella configurazione del pannello (`/data/user/sws/config`), che è già persistente.

## Cosa si può fare subito, senza decidere

Il prerequisito (git, ssh e `known_hosts` nell'immagine) non chiude nessuna strada e rende di nuovo utilizzabili
init, commit, log, diff e tag in locale al container; il push resta da sistemare con la decisione sulle chiavi.
