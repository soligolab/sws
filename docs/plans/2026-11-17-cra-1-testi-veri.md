# CRA, sessione 1: testi veri e scheletro della valutazione del rischio

> **Fatto il 18-11-2026, da validare col maintainer.** Passi 1 e 2, due revisioni indipendenti (verità e coerenza),
> le loro correzioni. In più del previsto: README, quickstart e capitoli 03, 09, 10, 18 (altre frasi false trovate
> dalle revisioni), `docs/CONTEXT.md` (una nota datata), D2, D3 e D5 riscritte.
>
> Piano della sessione 1 delle [sessioni CRA del 17-11-2026](2026-11-17-cra-sessioni-e-decisioni.md).
> Ramo `docs/cra-1-true-statements`. Scritto il 17-11-2026, misurato sul codice del ramo (`4770ea36`, che per il
> codice è `main` a `4db7e228`, 2.26.0-rc.20).
>
> **Solo documenti e commenti: nessun comportamento del prodotto cambia.** Due scopi:
> (A) togliere quello che oggi è falso in pubblico o nei documenti, con la frase vera più corta;
> (B) far nascere `docs/sicurezza/LEGGIMI.md` e `docs/sicurezza/valutazione-rischio.md`, bozza che cresce a ogni
> sessione. La riscrittura del capitolo 17 è la sessione 7, non questa.

## Cosa ho corretto del brief, guardando il codice

| # | Il brief diceva | Il codice e i file dicono | Cosa fa il piano |
|---|---|---|---|
| 1 | Prendere il nome dello CSIRT italiano da `web-cra.md` §6 | Il rapporto **non lo verifica**: `tmp/cra/web-cra.md:448` e `:621` lo marcano «[NV]». Il nome c'è già in `docs/sicurezza/procedura-art14.md:16` («CSIRT Italia, ACN»), scritto il 15-10 senza fonte | Il nome resta, marcato «non verificato sull'elenco ENISA del 04-09-2026». La voce `:56-57` resta aperta |
| 2 | `docs/plans/README.md:42` dà aperti P5 e C6 (lista di `critic.md` §6.1) | Già corretto in `4770ea36` (oggi riga 43) | Niente |
| 3 | «Sui pannelli Pixsys col marcatore il TLS è acceso» | Vero, ma il marcatore lo scrive l'installatore dove trova `certutil`, non per marca (`deploy/container/install-container.sh:562-564`, `:580-581`). E il capitolo 17 (`:127`) descrive la strada del 25-10 («lo propone»), che `main.rs:562-571` dichiara ritirata | Il testo dice «dove l'installatore trova `certutil` (i pannelli Pixsys)» e toglie la strada ritirata |
| 4 | — (non nel brief) | Il manuale dice che col TLS attivo il pannello apre la **8080** per accettare il certificato. L'immagine non passa `--http-port` (`deploy/container/Containerfile.aarch64:258-265`, nessuna occorrenza in `deploy/`) e senza quell'argomento la porta non nasce (`sws-runtime/src/main.rs:1809-1810`). Vale solo per `start_runtime.sh` e `start_editor.sh` | Si corregge nelle righe sul TLS che si toccano comunque (`17:136`, `18:555`) e in `02_quickstart.md:96-98`, `18:299` |
| 5 | — | Altri commenti dicono «solo su loopback» per `--senza-autenticazione`, e il codice rifiuta solo un indirizzo pubblico (`main.rs:1330-1349`, `:2285-2302`): `main.rs:164-166`, `:636-637`, `sws-web/src/router.rs:117-119`, `:2325-2327`, `:13943` | Entrano nello step 1 |
| 6 | — | `sws-web/src/gateway/ritorno.rs:13-14`: «un container non può ricavare [la chiave] di un altro, perché non conosce il segreto». Lo conosce: `gateway/progetti.rs:659`. Lo chiude la sessione 2 | Una frase in più nel commento, che la sessione 2 toglierà: oggi non è vero |
| 7 | — | `deploy/editor/README.md:38` dice che `SWS_ADMIN_USER`/`SWS_ADMIN_PASSWORD` «enables the login». Un'istanza IDE usa sempre `identita.db` (`router.rs:2347-2374`, `main.rs:1359`): lo step 1 verifica se quelle due variabili hanno ancora un effetto prima di tenere la riga | Step 1 |
| 8 | Dove si aggiunge un default sicuro, una guardia | Qui non si aggiunge nessun default. Ma le frasi corrette possono tornare false in silenzio | Una guardia nuova sui documenti, nello step 2 (vedi «Prove») |

## I fatti, riverificati oggi sul codice

Percorsi senza prefisso: `sws-runtime/crates/`.

| Tema | Fatto | Dove |
|---|---|---|
| Aggiornamenti | Il pilota automatico nasce spento: `Programma` deriva `Default`, `pilota: None`; senza file vale il default | `sws-web/src/aggiornamento_finestra.rs:32-37`, `:214-218` |
| | Il quadlet ha `AutoUpdate=registry` ma «non parte da solo»; l'installatore non accende nessun timer e lo scrive | `deploy/container/sws-runtime.container:203-207`; `install-container.sh:784` (zero occorrenze di `podman-auto-update`) |
| | L'IDE: «Spento: le versioni nuove si installano solo quando qualcuno le approva» | `sws-editor/src/i18n/it.json:3444`, `:3432` |
| | Tiny TY: nessun `SWS_IMAGE` in `deploy/tiny-ty/`, quindi canale sconosciuto: né controllo né avviso | `sws-web/src/aggiornamento.rs:35`, `:62` |
| | Le frasi false | `SECURITY.md:8`; `docs/manual/17_sicurezza.md:88-89`, `:142` |
| Fabbricante | «Soligonet» in due file, «Mauro Soligo […] Soligonet» negli altri | `SECURITY.md:3`; `docs/sicurezza/procedura-art14.md:13-14`, `:53`; giusti: `17_sicurezza.md:18`, `LICENSING.md:9` |
| Reset | Esiste dal 15-11. Toglie tutta la cartella dei progetti e cinque voci della configurazione: `abbinamento.json` (resta con `keep_cloud`), `utenti_dispositivo.yaml`, `known_projects.json`, `boot-image`, `cache`. Tutto il resto di `config/` resta | `sws-web/src/control_panel/reset.rs:31-41`, `:62-90`; rifiutato su un IDE `:122` |
| | Sullo schermo si chiama «Eliminare progetto e abbinamento» e «Eliminare solo il progetto, restando nel cloud» | `sws-editor/src/i18n/it.json:5283-5293` |
| | L'istantanea prima di un aggiornamento è una copia di config e progetti in `<config>/istantanea/`: il reset non la tocca | `sws-web/src/istantanea_dati.rs:7-10` |
| | Il manuale lo dà come mancante («onda 4») e parla di «factory reset» senza dire quale | `17_sicurezza.md:129`; `09_auth_rbac.md:63-64` |
| TLS | Senza `tls.crt` il runtime serve in chiaro. Col marcatore `fiducia-browser` genera il certificato al primo avvio | `sws-runtime/src/main.rs:552-555`, `:562-582` |
| | Tiny TY: l'installatore non genera niente; il viewer segue `tls.crt` se c'è | `deploy/tiny-ty/sws-lvgl-viewer-launch.sh:92-97` |
| | Il manuale dice «HTTP plain di default», «HTTP di base», «lo propone» | `10_deployment.md:313-323`; `18_container_e_comunicazione.md:555`; `17_sicurezza.md:127`, `:136` |
| IDE portatile | `run-editor.sh` non passa `--viewer-port`: è un'istanza IDE, apre `identita.db` e stampa il codice di primo accesso | `deploy/editor/run-editor.sh`; `main.rs:704`, `:1359`, `:1371-1396`. Falso: `deploy/editor/README.md:19-21` |
| Commenti | OpenPLC: «solo su 127.0.0.1». L'installatore pubblica cinque porte su tutte le interfacce; è il runtime che chiama `127.0.0.1` | `sws-web/src/openplc.rs:25`, `:73`; `install-container.sh:326` |
| | «Sul pannello il runtime pubblica le porte su una rete rootless». Il default è `Network=host`; la rete rootless c'è solo con `--bridge` | `sws-web/src/prestazioni.rs:9-12`; `install-container.sh:741-747`; `sws-runtime.container:62-67` |
| | «TLS is opt-in», seguito dal blocco che lo accende da sé | `main.rs:552-555` |
| Pannello di controllo | Montato nei tre gruppi aperti; PIN iniziale = ultime sei cifre del MAC, «not a secret»; `/info` lo rimanda; PIN sbagliati solo nel log | `sws-web/src/router.rs:1541`, `:2099`, `:2250`; `control_panel/pin.rs:7-13`; `control_panel/mod.rs:391`, `:326` |
| Cloud | Il segreto radice nell'ambiente di ogni container; espressioni con `exec` senza sandbox; `_getattr_` è `getattr` | `sws-web/src/gateway/progetti.rs:659`; `sws-pyscript/src/lib.rs:1147-1150`, `:348` |
| Credenziali | `admin`/`admin` nelle due installazioni native | `deploy/yocto/sws-runtime-launch.sh:24`, `deploy/generic-linux/sws-runtime-launch.sh:25`, i due `install.sh` (`:85`, `:111`) |
| Catena | `cargo audit` e `pnpm audit --audit-level=critical` in CI; nessuna firma (`cosign`, `policy.json`: zero occorrenze); `RestrictedPython>=7.0` senza versione; Tiny TY: sha256 sullo stesso server, cinque pacchetti tenuti | `.github/workflows/ci.yml:117`, `:210`; `Containerfile.aarch64:84`; `scripts/publish_tiny_ty_package.sh:20`, `:42` |
| Date del CRA | Requisiti dall'11-12-2027, art. 14 dall'11-09-2026 (art. 71, letto su uno specchio della GU) | `tmp/cra/web-cra.md:25-41` |

## Le decisioni che valgono

D1, D2, D3, D4 e D5 sono nel [registro](2026-11-17-cra-sessioni-e-decisioni.md). **D2, D3 e D5 sono state riscritte il
18-11-2026** dopo le due revisioni: D2 dice che ribalta la decisione 3 del 05-10; da D3 sono usciti 2FA e LDAP (voce
P6, che il maintainer aveva detto necessaria); D5 parte dal fatto che PIN e segreto del gateway erano già pubblici, e
nel capitolo 17 aggiunge la difesa di oggi (il PIN del progetto).

## I passi

### Step 1 — scopo (A): le frasi false corrette

Ogni correzione è la frase vera più corta. Non si rinominano i titoli (`01_overview.md:216` punta a
`#cosa-manca-ancora`). Il rapporto elenca ogni frase, prima e dopo, con la riga di codice che la regge.

1. `SECURITY.md:3` — fabbricante secondo D4. `:8` — niente installazione automatica di default: c'è l'avviso di
   versione nuova e la finestra che un Admin può accendere, con istantanea e ritorno; il pacchetto Tiny TY oggi non
   ha né canale né avviso, si aggiorna a mano.
2. `docs/manual/17_sicurezza.md`:
   - `:12` una riga datata: corretto il 17-11-2026 nei punti falsi, riscrittura alla sessione 7;
   - `:88-89` e `:142` — come `SECURITY.md:8`, col nome che l'IDE dà alla funzione («Pilota automatico»);
   - `:127` (C4) — acceso da sé dove l'installatore trova `certutil` (i pannelli Pixsys); altrove in chiaro finché
     un Admin non genera o carica un certificato; Tiny TY in chiaro di default;
   - `:128` (P6) — non in programma (D3);
   - `:129` (C5) — esiste dal 15-11 ed è parziale: cosa toglie, cosa lascia (certificato e chiave TLS, registro di
     audit, log, impostazioni del pannello, rete e Wi-Fi, e l'istantanea se un aggiornamento non è ancora
     confermato). Il reset completo arriva con la sessione 4;
   - `:136` — niente 8080 sul pannello in container.
3. `docs/manual/10_deployment.md:313-323`, `18_container_e_comunicazione.md:555` e `:299`, `02_quickstart.md:96-98`
   — il TLS detto in un modo solo (i tre casi del punto C4) e la 8080 solo dove chi lancia passa `--http-port`.
4. `docs/manual/09_auth_rbac.md:63-64` — «factory reset» diventa il nome vero della funzione, e dice che il codice
   non cambia con «Eliminare solo il progetto, restando nel cloud».
5. `deploy/editor/README.md:19-21` (e `:38` dopo la verifica del punto 7 qui sopra) — al primo avvio l'IDE stampa
   un codice di primo accesso sul terminale; con quello si crea l'amministratore. In inglese, come il file.
6. `docs/sicurezza/procedura-art14.md` — `:13-14` e `:53` secondo D4; `:16` il nome dello CSIRT marcato «non
   verificato»; `:53-57` restano rimandati, con due fatti di `web-cra.md` §6.3: non serve registrarsi prima, e
   scegliere lo CSIRT sbagliato può invalidare la notifica.
7. Commenti nel codice. **In inglese**: il commento corretto si riscrive tutto in inglese, senza tradurre altro.
   `sws-web/src/openplc.rs:25`; `sws-web/src/prestazioni.rs:9-12`; `sws-runtime/src/main.rs:164-166`, `:552-555`,
   `:636-637`; `sws-web/src/router.rs:117-119`, `:2325-2327`, `:13943`; `sws-web/src/gateway/ritorno.rs:13-14`.
   Nessuna riga di codice cambia.
8. `docs/archive/2026-10-05-cra-gap-analysis.md` — una sola riga datata in testa che rimanda alla rimisura del
   17-11 (questo piano e `docs/sicurezza/valutazione-rischio.md`). Il resto dell'archivio non si tocca.

Non si toccano: `docs/SWS_Project_Specification.md`, `docs/CONTEXT.md`, i semi, il sito del manuale.

### Step 2 — scopo (B): l'indice e la prima bozza

1. `docs/sicurezza/LEGGIMI.md`: cosa c'è nella cartella e in che stato. Oggi: `procedura-art14.md` (in uso),
   `valutazione-rischio.md` (bozza del 17-11). «Da scrivere», senza link, con la sessione che li porta:
   `gestione-vulnerabilita.md` e `periodo-di-supporto.md` (5-6), `descrizione-prodotto.md`,
   `requisiti-essenziali.md`, `rapporti-di-prova.md`, `dichiarazione-ue.md` (7). In coda i campi che può dare solo
   il maintainer (recapito postale, data di fine supporto, repository pubblico sì o no, CSIRT).
2. `docs/sicurezza/valutazione-rischio.md`, con in testa «bozza del 17-11-2026, cresce con le sessioni» e
   l'avviso di D5:
   - le date del CRA, una volta sola, con la riserva: gli articoli vanno riletti sul testo ufficiale prima di
     qualunque dichiarazione;
   - lo scopo (D1) e cosa **non** è nostro: Pixsys OS, il Chromium del pannello, OpenPLC, i fornitori di IA;
   - i beni e gli attori (elenco di `docs.md` §2 e §6.3);
   - la tabella dell'Allegato I parte I: quattordici righe, (1) e (2)(a)–(m), quattro bersagli (pannello in
     container, Tiny TY, istanza IDE, cloud), `file:riga`, e per ogni buco chi lo chiude. Si parte da
     `annex1.md` §2 **corretto** da `critic.md` §1-§2 e dalla tabella dei fatti qui sopra: rete di default
     `Network=host`; OpenPLC su tutte le interfacce; registrazione nel cloud spenta nel repo; TLS acceso dove c'è
     `certutil`; Tiny TY «spento di default», non «sempre in chiaro»; l'aggiornamento spento non è un difetto (D2).
     **Ogni riga si riapre sul codice**: dove il codice dice altro, vince il codice e il rapporto lo scrive;
   - un registro delle revisioni, con la riga di oggi.
3. La riga C8 di `17_sicurezza.md:132` nomina la bozza.
4. La guardia `scripts/check_security_docs.sh` (vedi «Prove»), registrata fra le `STATICHE` di
   `scripts/check_static.sh`. Prima di toccare `check_static.sh`: `ps`, che non stia girando.

Chi chiude ogni buco, per la colonna della tabella:

| Riga | Buco principale | Chi |
|---|---|---|
| (1) | valutazione del rischio e fascicolo assenti | questa bozza, poi 7 |
| (a) | buchi noti della sandbox e del PIN; nessuna scansione dell'immagine | 2, 3, 5 |
| (b) | PIN iniziale dal MAC, `admin`/`admin` nativi; ritorno allo stato originale | 3; 4 |
| (c) | automatico spento; Tiny TY e IDE senza avviso; niente firma | D2; 6; 5 e 6 |
| (d) | pannello di controllo fuori dall'autenticazione; segreto radice nei container; 2FA e LDAP | 3; 2; D3 |
| (e) | TLS non ovunque; segreti in chiaro a riposo; protocolli di campo in chiaro | 7 (dichiara); D3; 7 |
| (f) | nessuna firma né verifica; audit non firmato; CORS `*` | 5 e 6; D3; 7 (dichiara) |
| (g) | codice di abbinamento al cloud di default, `models.dev` ogni giorno | 7 (dichiara) |
| (h) | riavvio e reset col PIN iniziale; blocco del PIN unico; limiti senza effetto nel cloud; zip senza tetto | 3; 3; 7 (seme del 18-10); 2 |
| (i) | hotspot Wi-Fi apribile col PIN iniziale | 3 |
| (j) | rotte aperte e guardia cieca; porte di OpenPLC; bus D-Bus nel container | 3; 3; D3 |
| (k) | espressioni fuori sandbox; un container vale tutto il cloud; comandi sull'host dal container | 2; 2; D3 |
| (l) | PIN sbagliati fuori dall'audit; firma dell'audit | 3; D3 |
| (m) | reset parziale; Tiny TY; dati orfani nel cloud | 4 |

Un buco che nessuna sessione chiude si scrive «dichiarato alla sessione 7», non si lascia senza nome.

## Le prove

Questa sessione non ha codice di prodotto, quindi non ha test Rust o vitest nuovi. Ha una guardia.

`scripts/check_security_docs.sh` (nome e commenti in inglese, gira su file fermi, accetta la radice come primo
argomento per poterla provare su una copia):

1. ogni `.md` di `docs/sicurezza/` è nominato in `LEGGIMI.md`, e ogni link relativo di quella cartella porta a un
   file che esiste;
2. `valutazione-rischio.md` ha le quattordici righe, (1) e (2)(a)–(m);
3. ogni `percorso:riga` citato in `valutazione-rischio.md` indica un file che esiste e ha almeno quelle righe;
4. le frasi false non tornano: `SECURITY.md` e il capitolo 17 non dicono «automatici per default» finché
   l'installatore non accende `podman-auto-update.timer`; `SECURITY.md`, capitolo 17 e `procedura-art14.md`
   nominano lo stesso fabbricante.

Prova negativa, una per regola, su una copia in `tmp/cra/prova-guardia/`: la guardia deve uscire rossa e dire quale
regola. L'esito va nel rapporto dello step 2.

## Cosa può andare storto, e come lo evita il disegno

| Rischio | Come si evita |
|---|---|
| Una frase corretta è a sua volta falsa, o promette più del codice | Ogni frase nuova ha la sua `file:riga` nel rapporto dello step; due revisioni; la regola 4 della guardia |
| La valutazione del rischio nomina difetti aperti (PIN dal MAC, segreto del gateway) e finisce in pubblico prima della correzione | D5: nel manuale pubblico non entrano. Il documento lo dice in testa, e il ramo non va su `main` né si pusha prima delle sessioni 2 e 3 (rami annidati, squash merge in ordine) |
| Un link o un'àncora rotti fermano il sito del manuale (`mkdocs --strict`) | Nessun titolo rinominato; `check_manuale_sito.sh` dopo lo step 1 e dopo lo step 2 |
| Un commento corretto cambia per sbaglio una riga di codice, o `cargo fmt` rimpagina | `git diff` dello step: solo righe di commento. `cargo fmt --check` e `cargo check` |
| I numeri di riga della valutazione invecchiano | In testa il commit della misura; la regola 3 della guardia ferma un file rinominato o accorciato; ogni sessione rimisura le sue righe |
| Altre sessioni lavorano sullo stesso checkout | `git add` solo dei file toccati, per nome |
| Il sito pubblico continua a dire le frasi vecchie | Non si ripubblica qui: è una voce per il maintainer (sotto) |

## La verifica

**Automatica, a ogni step**: `cargo check` e `cargo fmt --check` in `sws-runtime` (lo step 1 tocca commenti Rust);
`./scripts/check_static.sh` verde; `./scripts/check_manuale_sito.sh` (vuole podman, che su questa macchina c'è).
`pnpm build` e `vitest` non servono agli step: nessun file dell'IDE cambia. La *definition of done* completa
(`cargo test`, `pnpm build`, `vitest`) la lancia una volta chi chiude la sessione, dopo le revisioni.

**Su un dispositivo** (diventano voci di `docs/COLLAUDI_IN_SOSPESO.md`; nessun accesso in questa sessione):

- WP630 o TC620 appena installato: parte in HTTPS da sé, e `http://<pannello>:8080` non risponde;
- un pannello installato dove manca `certutil`: parte in chiaro;
- TY570 appena installato: in chiaro, e nessun avviso di versione nuova;
- dopo «Eliminare progetto e abbinamento»: in `config/` restano `tls.key`, `audit.jsonl` e, con un aggiornamento
  non confermato, `istantanea/`;
- con OpenPLC installato: la 1502 risponde da un altro PC della rete.

**Dal maintainer**: il nome dello CSIRT sull'elenco di ENISA; se il repository GitHub è pubblico (`security.txt` e
`01_overview.md:213` lo danno per tale); il recapito postale; ripubblicare il sito del manuale, che fino ad allora
porta le frasi vecchie; la validazione di D5.

## La chiusura

Dopo le due revisioni, chi chiude la sessione aggiunge la voce a `CHANGELOG.md` (`[Unreleased]`), le voci di
collaudo qui sopra a `docs/COLLAUDI_IN_SOSPESO.md` e il riassunto a `STATUS.md`. `NOVITA.yaml` non cambia: chi usa
un pannello non nota niente. Il piano passa in `docs/archive/` quando la serie è validata e mergiata.
