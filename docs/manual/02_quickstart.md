← [Indice](MAIN.md) | [← Panoramica](01_overview.md) | [Successivo → Architettura](03_architecture.md) →

---

# 02 — Quick Start

> Installa, entra, abbina: il minimo per avere un pannello e un IDE che si parlano. Per chi installa SWS la prima
> volta. Come si costruisce poi un progetto, passo per passo, è nel tutorial (Parte II del manuale); qui ci si
> ferma al primo collegamento.
>
> Misurato sul codice il 19-10-2026.

---

## In breve

| Passo | Pannello | IDE |
|---|---|---|
| **Installa** | `install-container.sh --pull` sul pannello | `start_editor.sh` sul PC, o l'IDE nel cloud |
| **Entra** | — (un pannello nuovo è chiuso) | il **codice di primo accesso** stampato all'avvio |
| **Abbina** | mostra un **codice di abbinamento** | «Connetti» col codice: nasce l'Admin del dispositivo |

Nessuna istanza parte aperta a tutti: il perché e i dettagli sono nel [capitolo 09](09_auth_rbac.md).

---

## 1. Installa

### Il pannello (TC620, WP630, un PC in reparto)

Sul dispositivo, come utente normale (podman rootless, niente `sudo`):

```bash
./deploy/container/install-container.sh --pull
```

Lo script:
1. riconosce l'architettura (`uname -m`) e scarica l'immagine `latest-<arch>` da `ghcr.io/soligolab/sws-runtime`;
2. prepara `/data/user/sws/{projects,config,logs}`;
3. installa il quadlet `sws-runtime.container`, abilita il linger e avvia il servizio;
4. alla fine stampa il **codice di abbinamento**.

Le altre opzioni (`--image` per i dispositivi senza rete, `--bridge`, il viewer LVGL) sono in testa allo script e
nel [capitolo 18, §2](18_container_e_comunicazione.md#2-sul-pannello).

### L'IDE

| Dove | Come | Indirizzo |
|---|---|---|
| **Sul PC** | `./scripts/start_editor.sh` da un checkout del repo | `http://localhost:8460` |
| **Nel cloud** | niente da installare | `https://sws.soligo.net` |

`start_editor.sh` compila il runtime al primo avvio (qualche minuto) e tiene i progetti in `~/sws_projects`.
Servono Rust ≥ 1.88, Node 22, pnpm 9 e Python 3 con gli header (vedi [Indice](MAIN.md#prerequisiti-e-porte)).

---

## 2. Entra nell'IDE

Un'IDE appena installata non ha utenti e stampa all'avvio, nel terminale, un **codice di primo accesso** monouso.
Si apre l'indirizzo dell'IDE e la schermata del primo amministratore chiede il codice, un'email, un nome e una
password: nasce il primo **Amministratore** dell'installazione, e il codice smette di valere. Un riavvio prima di
usarlo ne genera un altro. Lo stesso vale per il gateway del cloud al suo primo avvio. Dettagli: [capitolo 09, §2](09_auth_rbac.md#2-il-primo-accesso-di-uninstallazione-ide).

---

## 3. Abbina il pannello

Un pannello senza utenti risponde solo con la schermata del codice, sullo schermo e in rete:

```
7KQ2-M9XD-3HWP-T4BZ
```

Il codice si legge anche nel log (`podman logs sws-runtime | grep -i abbinamento`) e in coda all'output di
`install-container.sh`.

**In rete locale**: dall'IDE, **Configurazione → Istanza → Device → Connessione → «Connetti»**, con l'indirizzo
del pannello (`http://<ip-del-pannello>:7444`). Compare il campo del codice: si inseriscono codice, nome utente e
una password di almeno 8 caratteri, e nasce l'**Admin del dispositivo**. Da lì l'IDE fa deploy, backup,
aggiornamenti e legge i log del pannello.

**Dal cloud**: il pannello chiama da solo il gateway e si presenta in attesa; dall'IDE nel cloud,
**«Abbina un pannello»** col codice. Dettagli e i due casi (pannello con o senza utenti) nel
[capitolo 09, §1](09_auth_rbac.md#1-un-pannello-nuovo-è-chiuso-labbinamento).

---

## 4. Verifica

```bash
curl http://<ip-del-pannello>:7443/health
# → ok
```

Con il TLS attivo l'indirizzo diventa `https://` (aggiungere `-k` per il certificato autofirmato); al primo accesso
dal browser conviene aprire `http://<ip-del-pannello>:8080`, che spiega come accettare il certificato
([capitolo 10](10_deployment.md)).

Gli operatori vedono le pagine su `http://<ip-del-pannello>:7443`, o sullo schermo del pannello. Le porte e cosa
aprire sul firewall: [capitolo 18, §4](18_container_e_comunicazione.md#4-le-porte).

---

## Per chi sviluppa SWS

Dal checkout, il runtime completo sulla macchina locale (viewer 7443, IDE 7444, 8080 col TLS attivo):

```bash
cd sws-editor && pnpm install && cd ..
./scripts/start_runtime.sh
```

Lo stato sta in `.run/` (`rm -rf .run` per ripartire da zero). Il progetto `default` non ha utenti, quindi il
runtime è chiuso come un pannello e stampa il codice di abbinamento nel log; in alternativa
`SWS_ADMIN_USER`/`SWS_ADMIN_PASSWORD` creano un Admin all'avvio. Le opzioni degli script sono in
`scripts/README.md`, la struttura interna nel [capitolo 03](03_architecture.md).

---

## Prossimi passi

- [04 — Guida all'editor](04_editor_guide.md): le pagine, il canvas, la configurazione
- [06 — Protocolli](06_protocols.md): collegare SWS a PLC reali
- [18 — Container e comunicazione](18_container_e_comunicazione.md): dove gira cosa e chi parla con chi

---

← [Indice](MAIN.md) | [← Panoramica](01_overview.md) | [Successivo → Architettura](03_architecture.md) →
