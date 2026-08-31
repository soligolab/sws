# Trasloco dell'ambiente di lavoro su `pixsys@frodo.local`

## Contesto

`theobroma` (questo server) è al **99%**: 24 GB liberi su 1,5 TB. Il lavoro si sposta su
`frodo.local`, che ne ha **102 GB su 119**. Theobroma resta intatto come via di ritorno — nessuna
cancellazione, nessun ramo spostato, nessun file rimosso.

Frodo è una macchina **nuda**: Debian 13 trixie con git 2.47.3, Python 3.13.5 e Docker. Mancano
Rust, Node, pnpm, npm, podman, clang e l'SDK Yocto. «Riprendere senza fastidi» quindi non è un
clone: è un ambiente da costruire.

Il maintainer ha scelto: **frodo deve saper fare tutto**, immagini container comprese; il lavoro
passa da **GitHub** (push da qui, clone di là); le chiavi SSH le ha già create lui.

### Le due cose che questo piano deve soprattutto non sbagliare

1. **Otto commit, un tag e due rami esistono solo sul disco al 99%.** `main` è avanti di 8 commit su
   `origin/main`, il tag `2.3.4` è locale, e `fix/sws-display-path-loop` / `feat/lvgl-gap` non sono
   mai stati pushati. Il push della fase 1 non è un passaggio burocratico: finché non è fatto,
   una giornata di lavoro sta su un solo disco quasi pieno.

2. **La memoria di Claude Code cambia nome nel trasloco.** Vive in
   `~/.claude/projects/<percorso-con-trattini>/memory/`, e il nome deriva dal percorso del progetto:
   oggi `-home-ut1-sws`, su frodo `-home-pixsys-sws`. Copiata com'è finirebbe in una cartella che
   nessuno legge, e le undici note si perderebbero **in silenzio** — che è il modo peggiore.

---

## Fase 0 — Sbloccare GitHub su frodo (4 righe, ed è già rotto)

Il maintainer ha creato `id_ed25519_soligo` su frodo e l'ha registrata su GitHub, ma
`git@github.com` risponde ancora **`Permission denied (publickey)`**.

Causa, diagnosticata: `~/.ssh/config` su frodo ha voci per `gitlab.com` e `git.pixsys.com`, **nessuna
per `github.com`**. SSH prova solo i nomi predefiniti (`id_rsa`, `id_ecdsa`, `id_ed25519`), che su
frodo non esistono: la chiave nuova non viene mai offerta.

Aggiungere a `~/.ssh/config` di frodo:

```
Host github.com
    HostName github.com
    IdentityFile ~/.ssh/id_ed25519_soligo
    IdentitiesOnly yes
```

Verifica: `ssh -T git@github.com` deve rispondere `Hi <utente>!`.

---

## Fase 1 — Mettere al sicuro il lavoro (da theobroma)

```
git push origin main
git push origin 2.3.4
git push origin fix/sws-display-path-loop feat/lvgl-gap
```

I due rami sono già stati mergiati in squash dentro `main`, quindi il **contenuto** è salvo; a
mancare sarebbe la storia granulare dei tredici commit. Costa nulla portarli e li toglie dal disco
unico.

Verifica, contro il remoto e non contro la memoria: SHA di `main` uguale a `origin/main`, il tag
`2.3.4` risolve allo stesso commit, e `git status` pulito.

---

## Fase 2 — Clonare, e portare ciò che git non porta

```
git clone git@github.com:soligolab/sws.git ~/sws
cd ~/sws && git config user.email mauro@soligo.net && git config user.name "Mauro Soligo"
```

**L'identità cambia nel trasloco, di proposito.** Su theobroma i commit sono
`pixsysedp <edp@pixsys.net>`; su frodo il maintainer vuole `mauro@soligo.net`. È coerente con la
proprietà del codice — Soligonet, AGPL-3.0-only, con Pixsys cliente e non proprietaria — quindi non
è solo una preferenza di macchina.

Impostata **locale al repo** (`git config` senza `--global`) e non globale: frodo può ospitare altri
lavori con l'identità dell'ufficio, e una `--global` li firmerebbe tutti da Soligonet senza che
nessuno se ne accorga.

Da sapere: i commit già fatti su theobroma restano firmati `edp@pixsys.net` — riscrivere la storia
per uniformarli cambierebbe otto SHA appena pushati, e non vale il prezzo.

Il clone scarica ~229 MB e include `.claude/settings.json` (è versionato: i permessi degli strumenti
viaggiano da soli).

**Quello che git non porta**, da copiare via SSH da theobroma:

| Cosa | Da | A | Perché |
|---|---|---|---|
| Memoria Claude (11 note, 48 KB) | `~/.claude/projects/-home-ut1-sws/memory/` | `~/.claude/projects/`**`-home-pixsys-sws`**`/memory/` | Non è in git. Attenzione al nome nuovo |
| Piani (3 file, 48 KB) | `~/.claude/plans/` | `~/.claude/plans/` | Per-macchina per costruzione (vedi CLAUDE.md) |
| Progetti locali (18 MB) | `sws/.run-editor/projects/` | idem | `lvgl1`, `ProvaDemoWeb`, `VUOTO` — dati di prova, ma sono suoi |

---

## Fase 3 — Toolchain utente (nessuna password)

Tutto sotto `$HOME`, nessun `sudo`:

- **Rust**: `rustup` da rustup.rs, poi `rustup target add aarch64-unknown-linux-gnu`.
  Qui gira `rustc 1.94.1`; il workspace dichiara `rust-version = "1.75"` come minimo.
- **Node + pnpm**: `nvm install 21` (qui: v21.7.3), poi `corepack enable`. La versione di pnpm è
  **fissata nel repo** (`packageManager: "pnpm@9.15.0"` in `sws-editor/package.json`): corepack la
  prende da sola, non va scelta a mano.
- **Claude Code**: il CLI oggi è assente su frodo, e serve all'estensione VSCode.

---

## Fase 4 — Pacchetti di sistema (serve la password del maintainer)

`pixsys@frodo` ha `sudo` **con password**, quindi questa fase non è automatizzabile.

```
sudo apt install clang libclang-dev libsdl2-dev libfreetype-dev python3-yaml \
                 podman qemu-user-static binfmt-support
```

Motivazioni, dalla documentazione del repo e non inventate:

- `clang`, `libclang-dev`, `libsdl2-dev`, `libfreetype-dev`: obbligatori **da quando
  `sws-lvgl-viewer` è entrato nel workspace** (2026-08-25). Senza, `cargo check --workspace` non
  compila affatto — non è un requisito solo per chi cross-compila (`docs/YOCTO_CROSSCOMPILE.md` §1.6).
- `python3-yaml`: assente su frodo, e le guardie (`check_templates.sh`, `check_demo_templates.sh`,
  `check_lvgl_types.sh`…) fanno `import yaml`.
- `podman`: otto script lo invocano per nome (`build_container*.sh`, `check_static.sh`,
  `install-container.sh`). Frodo ha Docker, che **non** è un sostituto qui. I due convivono.
- `qemu-user-static` + `binfmt-support`: `build_container_aarch64_generic.sh:164` si ferma se
  `/proc/sys/fs/binfmt_misc/qemu-aarch64` non esiste.

---

## Fase 5 — SDK Yocto Pixsys (6,1 GB)

Il percorso `/usr/local/oecore-x86_64/` è **cablato in tre script**
(`build_container.sh:66`, `build_containers_all.sh:68`, `yocto/build.sh:41`): l'SDK deve stare
esattamente lì, non altrove.

Non ho trovato un installer su theobroma, quindi si copia l'albero installato:

1. da theobroma: `rsync -aH --info=progress2 /usr/local/oecore-x86_64/ pixsys@frodo.local:~/oecore-staging/`
2. su frodo: `sudo mkdir -p /usr/local/oecore-x86_64 && sudo rsync -aH ~/oecore-staging/ /usr/local/oecore-x86_64/`
3. liberare lo staging.

`-H` non è decorativo: l'SDK contiene hard link, e senza si gonfia.

Verifica — i quattro controlli già documentati in `docs/YOCTO_CROSSCOMPILE.md` §1.5 e §1.7:

```
test -f /usr/local/oecore-x86_64/environment-setup-cortexa35-pixsys-linux
ls .../sysroots/cortexa35-pixsys-linux/usr/include/python3.12/Python.h
ls .../sysroots/cortexa35-pixsys-linux/usr/lib/pkgconfig/sdl2.pc
ls .../sysroots/cortexa35-pixsys-linux/usr/include/libdrm
```

---

## Fase 6 — Credenziali che restano da dare

- **`podman login ghcr.io`** — serve solo per `build_containers_all.sh --push`. Su theobroma è
  autenticato come `mauro@soligo.net`.
- **Chiave per il WP630** — su frodo non c'è. Serve solo per provare sul dispositivo; scelta del
  maintainer se copiarla o autorizzare la nuova.

---

## Verifica finale su frodo

La definizione di fatto del repo, controllando i **codici di uscita** e non contando le righe:

```
cd ~/sws/sws-runtime && cargo check --workspace && cargo test --workspace
cd ~/sws/sws-editor  && pnpm install --frozen-lockfile && pnpm build && pnpm test
cd ~/sws             && ./scripts/check_static.sh          # 7 guardie
```

Attese: 318 test Rust, 78 test editor, sette guardie verdi. Se `cargo check` fallisce su
`sws-lvgl-viewer`, manca uno dei pacchetti della fase 4.

Per la capacità container, senza costruire nulla:
`./scripts/build_containers_all.sh --help` e il controllo binfmt della fase 4.

---

## Cosa NON viene toccato su theobroma

Nessuna cancellazione: repo, worktree (`sws-fix-path`, `sws-lvgl-gap`), `.run*`, target di build,
SDK e immagini restano dove sono. L'unica scrittura è il `git push` della fase 1, che **aggiunge** al
remoto e non modifica niente in locale.

I 24 GB liberi non aumentano: liberare spazio è un lavoro a parte, e `scripts/clean_disk_space.sh`
esiste già per quello. Va fatto **dopo** che frodo ha superato la verifica finale, mai prima.

---

## Appendice — podman 4 (theobroma) → podman 5 (frodo): tre differenze pagate a caro prezzo

*Aggiunta la sera del 2026-08-31, dopo aver rimesso in piedi la catena di build su frodo.*
Nessuna è documentata negli script del repo, e tutte e tre si presentano **come errori che
sembrano parlare d'altro**.

1. **`podman login` fallisce con `command required for rootless mode with multiple IDs: exec:
   "newuidmap": executable file not found`.** Non è il registry né le credenziali: manca il
   pacchetto **`uidmap`**, che su Debian 13 non è una dipendenza di `podman`. Le mappature in
   `/etc/subuid` c'erano già (`pixsys:100000:65536`). Rimedio: `sudo apt install uidmap`, poi
   `podman system migrate`.

2. **`podman build` fallisce con `setup network: could not find pasta, the network namespace
   can't be configured`** — e fallisce **all'ultimo passo**, dopo dieci minuti di compilazione
   Rust andati a buon fine. Podman 5 usa `pasta` (pacchetto **`passt`**) come rete rootless di
   default, dove podman 4 usava `slirp4netns`. Rimedio scelto: `sudo apt install passt`.
   L'alternativa senza password è imporre la rete vecchia, che resta però più lenta e vale per
   ogni container della macchina:

   ```bash
   printf '[network]\ndefault_rootless_network_cmd = "slirp4netns"\n' \
       > ~/.config/containers/containers.conf
   ```

   Quando succede, **non rifare la compilazione**: `--no-rust --no-spa` riusa binario e SPA e
   riparte dallo `STEP 1/11`.

3. **Sparisce il falso allarme del graph driver.** Su theobroma ogni comando podman stampava
   `User-selected graph driver "vfs" overwritten by graph driver "overlay" from database`: era
   rumore, residuo di una configurazione precedente. Su frodo non compare, perché lo storage è
   nuovo. Utile saperlo per non cercarlo come sintomo.

La morale che vale oltre podman: su frodo **nessun `containers.conf` esiste**, né utente né di
sistema. La catena di build non poggia su configurazione locale, solo su pacchetti installati —
il che è una buona notizia per la prossima macchina, purché i pacchetti ci siano.
