← [Indice](MAIN.md) | [← Package Builder](11_packaging_deploy.md) | [Successivo → API](13_api_reference.md) →

---

# 12 — GitOps

> Il versionamento del **progetto** con git, dall'IDE: agganciarlo a un repository, commit, push, la storia, la
> prova di una versione vecchia, il fork, i tag; e la firma che dice se un pannello ha la stessa versione dell'IDE.
> Per chi progetta e consegna impianti. Non riguarda il codice di SWS, solo la cartella del progetto.
>
> Misurato sul codice il 19-10-2026.

---

## In breve

- **Dove**: **Configurazione → Progetto → Git** (`sws-editor/src/config/schede/GitTab.tsx`). La scheda c'è dove
  gira l'IDE: sul PC (`start_editor.sh`) e nel cloud, nel container del progetto. Un pannello non ha IDE: il
  progetto ci arriva col **deploy**, non con git.
- **Cosa si versiona**: la cartella del progetto (`project.yaml`, `synoptics/`, `cornici/`, `faceplates/`, …).
  Restano fuori, con un `.gitignore` che SWS scrive e completa da sé, `secrets.yaml`, lo storico (`*.db`) e
  `backups/`.
- **Come**: SWS lancia il binario `git` (`sws-web/src/git_deploy.rs`), nessuna libreria. Git e il client SSH sono
  nell'immagine, con le chiavi di GitHub, GitLab e Bitbucket già fidate (`/etc/ssh/ssh_known_hosts`).

| Operazione | Ruolo minimo | Rotta |
|---|---|---|
| Stato, storia, file cambiati, diff, elenco tag, firma | qualunque utente autenticato | `GET /api/project/git-status`, `/git/log`, `/git/changes`, `/git/diff`, `/git/tags`, `/api/project/fingerprint` |
| Pull (`↑ Deploy (git pull)`) | Admin | `POST /api/project/deploy` |
| Commit, nuovo tag | Supervisor | `POST /api/project/git/commit`, `POST /api/project/git/tags` |
| Aggancio, chiave SSH, autore, push, rollback, prova, fork, push ed eliminazione dei tag | Admin | `POST /api/project/git/init`, `/git/ssh-key*`, `/git/identity`, `/git/push`, `/api/project/rollback`, `/git/prova*`, `/git/fork`, `/git/tags/:name*` |

Le rotte stanno in `sws-web/src/router.rs` (righe 440-506, 804-806, 864-873); l'elenco completo nel
[capitolo 13](13_api_reference.md).

---

## 1. Agganciare il progetto a un repository

Un progetto non agganciato mostra «Questo progetto non è ancora agganciato a un repository» e il campo
**URL del repository**:

- **vuoto**: un repository solo locale, con storia e tag ma senza push;
- **un URL SSH** (`git@github.com:utente/repository.git`): il push va lì. Con una chiave SSH serve la forma SSH,
  non quella `https://` copiata dal browser — l'IDE la rifiuta e suggerisce quella giusta, perché git su HTTPS
  chiederebbe una password che dall'IDE nessuno può digitare.

**Imposta URL** fa `git init` se serve e imposta (o sostituisce) `origin`.

### La chiave SSH

Due possibilità, nel riquadro **Chiave SSH**:

| Chiave | Dove vive | Quando |
|---|---|---|
| **Chiave del progetto** | `.git/sws-ssh/` dentro il progetto | la scelta normale, e l'unica nel cloud. La genera SWS (**Genera la chiave del progetto**), la privata non esce mai dal runtime, la pubblica si copia con **Copia la chiave pubblica** |
| una chiave di `~/.ssh` | la home dell'utente che fa girare l'IDE | sul PC, per chi ha già una chiave registrata |

La chiave del progetto sta sotto `.git/`, quindi non entra in nessun commit, esportazione o backup; e resta col
progetto, che nel cloud è l'unica cosa che sopravvive al container. La pubblica va registrata sul repository come
**deploy key con permesso di scrittura** (GitHub: *Settings → Deploy keys → Add deploy key*, «Allow write
access»).

SSH parte sempre con `BatchMode=yes` (non si ferma mai a chiedere) e `StrictHostKeyChecking=accept-new`: un server
git aziendale si memorizza al primo contatto, e se poi la sua chiave cambia ssh rifiuta.

### L'autore dei commit

**Autore dei commit**: nome ed email con cui si firmano i commit di questo progetto (`user.name`/`user.email`
locali). Vuoti, vale l'identità globale di git della macchina.

---

## 2. Commit, push, pull, rollback

I quattro pulsanti della scheda. **Cosa fanno questi bottoni** ne ripete la spiegazione nell'IDE.

| Pulsante | Cosa fa |
|---|---|
| **💾 Commit** | `git add -A` + commit col messaggio dato. Prima completa il `.gitignore`; si ferma se un file supera i 50 MB, con il nome del file |
| **↑ Push** (con il numero di commit da pubblicare) | `git push` verso `origin`. Il primo push crea il ramo anche lì. Si ferma prima di partire se i commit contengono file oltre i 100 MB, che GitHub rifiuterebbe |
| **↑ Deploy (git pull)** | `git pull --ff-only` e ricarica del progetto. Si ferma se le due storie hanno preso strade diverse: non unisce niente da sé |
| **↓ Rollback (HEAD~1)** | `git reset --hard HEAD~1` e ricarica: toglie l'ultimo commit **e** le modifiche non committate. Non si annulla |

**Il Rollback è per un commit appena fatto e non ancora pubblicato.** Se l'ultimo commit è già sul remoto,
l'IDE avvisa: dopo il Rollback il Push verrebbe rifiutato. Per tornare a una versione pubblicata si usa la
[prova](#3-la-storia-e-la-prova-di-una-versione) e **Riparti da qui**, che non riscrivono niente.

---

## 3. La storia e la prova di una versione

Il riquadro **Storia** (`GitStoria.tsx`) elenca i commit (con **Commit più vecchi…** per andare indietro) e le
**modifiche non committate**. Per ogni commit si vedono i file cambiati e il diff; **Confronta** mette a confronto
due commit qualsiasi.

### Prova la versione

Su un commit vecchio, **🧪 Prova la versione** riporta il progetto com'era a quel commit e ricarica l'IDE:

- serve un albero pulito: con modifiche non salvate o non committate l'IDE chiede prima di salvare e fare commit;
- **finché la prova dura non si salva niente**. Le rotte che cambiano il progetto (`/api/project/`, pagine,
  cornici, faceplate, ricette, utenti…) rispondono con un rifiuto; restano aperte quelle dell'impianto (scrivere un
  tag, confermare un allarme, applicare una ricetta) e l'uscita dalla prova (`rotta_bloccata_in_prova`,
  `git_deploy.rs`);
- un banner dice quale versione si sta provando e su quale ramo è al sicuro l'ultima.

Da lì due uscite:

| Pulsante | Cosa succede |
|---|---|
| **Torna all'ultima** | si torna al ramo di partenza, all'ultimo commit |
| **Riparti da qui** | sul ramo si scrive un commit **nuovo** con i file della versione provata. La storia resta intera — i commit successivi ci sono ancora — e si pubblica con il Push di sempre |

### Fork

**⑂ Fork** da un commit della storia crea un **progetto nuovo** com'era a quel commit, con la sua storia fino a lì
(`fork_in`, `git_deploy.rs`):

- il ramo è `main`, sul commit scelto;
- **`origin` non c'è**: il nuovo progetto non può pubblicare sul repository dell'originale, e si aggancia al suo
  dalla sua scheda Git;
- l'autore dei commit è lo stesso, la chiave SSH no (una deploy key vale per un repository solo);
- le **credenziali** (`secrets.yaml`, che git non porta) si scelgono: **nuove** (il fork parte senza, per un
  impianto diverso) o **le stesse di questo progetto**;
- storico e backup non si copiano mai.

---

## 4. I tag

Un tag è un nome fisso su un commit (`v1.2.0`), per ritrovare una versione consegnata.

- **+ Nuovo tag** lo crea sul commit attuale: annotato se si scrive un messaggio, leggero altrimenti;
- **↑ Push** accanto al tag lo pubblica;
- **Elimina** lo toglie in locale e, se c'è un remoto, anche lì.

---

## 5. La firma: il pannello ha la stessa versione?

La **firma** (`GET /api/project/fingerprint`) è uno SHA-256 calcolato sui file che il deploy porta
(`calcola_impronta`, `router.rs`):

- `project.yaml`;
- i file `.yaml` di `synoptics/`, in ordine di nome, nome compreso;
- dal 15 e 17-10-2026 anche `cornici/`, `faceplates/`, `recipes/` e le immagini di `images/`.

Non dipende da git: la espongono anche i pannelli, sulla porta di gestione. Due runtime con la stessa firma
mostrano lo stesso progetto.

### Dispositivi registrati

**Configurazione → Istanza → Device → Dispositivi** (`DevicesTab.tsx`) elenca i dispositivi salvati, con **Stato**
(raggiungibile o no) e **Firma** (uguale a quella dell'IDE o diversa), e i pulsanti per connettersi e fare il
deploy.

- **Aggiungi dispositivo**: etichetta, URL della gestione (`http(s)://<ip>:8444`), utente SWS. L'utente è quello
  del progetto o l'Admin del dispositivo, non l'utente SSH; vuoto per un pannello ancora da abbinare.
- **Cerca dispositivi in rete** li trova via mDNS.
- La lista sta sul server, in `<cartella progetti>/.ambiente/dispositivi.yaml`: etichetta, URL e utente, **mai la
  password**, che resta in memoria finché la pagina è aperta.
- Prima di un deploy l'IDE salva le modifiche pendenti; dopo, rilegge la firma.

---

## Un flusso tipico

```
IDE sul PC o nel cloud
  → modifica pagine e configurazione, Salva
  → Git: 💾 Commit «aggiunta pompa P3»
  → Git: ↑ Push                     (il repository è la storia condivisa)
  → Device: deploy sul pannello     (il pannello riceve il progetto, non il repository)
  → Device: la Firma del pannello è uguale a quella dell'IDE

Un altro IDE, sullo stesso repository
  → Git: ↑ Deploy (git pull)        (scarica i commit fatti altrove e ricarica)

Una versione consegnata da ritrovare
  → Git: + Nuovo tag v1.2.0, ↑ Push
  → più avanti: Storia → 🧪 Prova la versione → Riparti da qui
```

Il deploy verso i pannelli e i suoi controlli (utenti, abbinamento, conferma) sono nel
[capitolo 10](10_deployment.md) e nel [capitolo 18, §5.2](18_container_e_comunicazione.md#52-lide-in-rete-locale-e-il-pannello).

---

← [Indice](MAIN.md) | [← Package Builder](11_packaging_deploy.md) | [Successivo → API](13_api_reference.md) →
