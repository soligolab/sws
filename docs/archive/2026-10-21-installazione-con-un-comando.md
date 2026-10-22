# Installare il pannello con un comando solo, come ZeroTier — seme

> Nato il 21-10-2026, finendo la guida di installazione che l'IDE nel cloud mostra al posto del
> modulo SSH (squash `3f13d083`). Il maintainer, dopo averla vista: «Ancora meglio sarebbe il
> singolo comando come fa zerotier».
>
> **Quando questo lavoro comincia, il primo passo è una sessione di plan approfondita** per
> decidere ogni dettaglio: qui ci sono l'idea, le misure di oggi e le strade che si vedono già,
> non un progetto.

## L'idea

Oggi la guida è **cinque comandi** da copiare uno per uno: entra via SSH, scarica l'immagine,
crea una cartella, estrai l'installer dall'immagine, lancialo. ZeroTier ne ha uno
(`curl -s https://install.zerotier.com | sudo bash`), e la differenza non è di eleganza: cinque
copia-incolla in una sessione SSH sono cinque occasioni di sbagliare, e il quarto comando va a
capo.

## Cosa è stato misurato il 21-10-2026

- **Perché sono cinque e non uno.** L'installer (`deploy/container/install-container.sh`, 831
  righe) **vive dentro l'immagine**, in `/usr/share/sws/quadlet/` insieme ai quadlet
  (`Containerfile.aarch64:125`). Per lanciarlo bisogna prima procurarsi l'immagine, e per
  estrarlo bisogna sapere che è una cartella e non un file solo. I tre comandi centrali della
  guida esistono solo per questo.
- **Dove non può stare.** Il repository è **privato** (`git@github.com:soligolab/sws.git`),
  quindi niente `raw.githubusercontent.com` anonimo. L'immagine su ghcr.io è pubblica e non
  vuole credenziali: è l'unica cosa nostra che oggi si scarica senza autenticarsi.
- **Dove potrebbe stare.** Il gateway ha una **lista corta e dichiarata** di rotte raggiungibili
  senza sessione: `/health`, `/.well-known/security.txt`, `/cert`, `/sw.js`,
  `/branding/:marchio/:file` (`sws-web/src/router.rs:1131-1153`). Servire lo script significa
  aggiungere una voce a quella lista — cioè una decisione sulla superficie pre-autenticazione,
  che dal 06-10 è esattamente la cosa che teniamo corta per il CRA.
- **Cosa non serve nel comando.** Il pannello non ha bisogno di segreti per installarsi:
  dall'11-10 chiama da solo il gateway dell'immagine e si abbina **col codice** mostrato sul suo
  schermo. Un `curl … | sh` non dovrebbe portare né token né identificativi d'azienda — che è
  la parte che in ZeroTier invece c'è (`zerotier-cli join <id>`, in un secondo comando).

## Le strade che si vedono già

1. **Lo script sul gateway**, su una rotta pre-auth: `curl -sSL https://sws.soligo.net/installa | sh`.
   Lo script si procura l'immagine e poi **si fa da parte**: esegue l'installer vero preso
   dall'immagine, così la versione dell'installer è sempre quella dell'immagine installata e non
   quella del server. Una voce in più nella lista pre-auth.
2. **Un installer che si estrae da solo.** Niente HTTP nostro: `podman run --rm ghcr.io/... installa`
   come unico comando, con un entrypoint alternativo nell'immagine che fa tutto. Resta un
   comando lungo da copiare, ma non aggiunge superficie e non dipende dal nostro server.
3. **Lasciare cinque comandi** e ridurli a tre, unendo i tre centrali in una pipeline sola.
   Costa niente e non risolve.

## Domande per la sessione di plan

- Una rotta pre-auth in più sul gateway vale la semplificazione? (È il tipo di decisione che la
  [gap analysis CRA](2026-10-05-cra-gap-analysis.md) tiene sotto osservazione.)
- `curl | sh` lo accettiamo come forma, visto che lo facciamo accettare a un cliente? Con quale
  verifica — impronta dello script mostrata nell'IDE, firma, o la sola TLS del nostro dominio?
- Il comando deve funzionare anche **senza cloud** (pannello e IDE sulla stessa LAN), dove non
  c'è un `sws.soligo.net` da interrogare?
- La guida di oggi resta come strada alternativa, o sparisce quando c'è il comando unico?


---

## Esito (22-10-2026)

**Deciso dal maintainer**: non `curl … | sh`, e nemmeno sostituire i cinque passi. Si
**aggiunge** una forma, e si lascia l'altra: *«lascia il default dei comandi singoli e aggiungi
una opzione "Comando aggregato"»*.

Fatto in `WelcomeScreen.tsx`: due pulsanti, «A passi» (predefinito) e «Comando aggregato». Il
secondo mostra l'SSH e poi i quattro passi uniti in una riga sola.

Perché `&&` e non `;`, che è l'unico dettaglio tecnico della cosa: con `;` un `podman pull`
andato male lascerebbe proseguire l'estrazione dei quadlet, che fallirebbe in un modo che non
somiglia alla causa. Con `&&` si ferma dove si è rotto. La riga è stata data in pasto a `bash -n`
per essere sicuri che si incolli davvero, invece di guardarla e convincersi.

**Le due strade non scelte restano qui**, perché sono l'unica cosa viva del file:

1. `curl https://sws.soligo.net/installa | sh`: vuole una rotta pre-auth sul gateway — una voce
   in più nella lista corta che il CRA ci fa tenere corta — e una risposta alla domanda «come si
   verifica lo script che si scarica».
2. Un entrypoint `installa` dentro l'immagine, che toglierebbe il passo dei quadlet ma non quello
   del `podman pull`, quindi da cinque si andrebbe a tre e non a uno.
