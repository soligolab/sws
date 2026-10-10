//! Parlare con podman, dal gateway.
//!
//! PERCHÉ QUESTO E NON ALTRO
//!
//! Il gateway avvia un container per ogni progetto aperto e lo spegne quando
//! nessuno lo usa più. Scelta del maintainer (09-10-2026) fra tre strade:
//! l'API di podman sul socket, le unità systemd come sul pannello, o il
//! comando `podman` da riga di comando. Ha scelto l'API — e la prova sul VPS
//! dello stesso giorno ha mostrato che da dentro un container si può.
//!
//! Il prezzo, dichiarato: systemd non sorveglia niente, quindi **riavvio e
//! pulizia li fa il gateway**. In particolare, al proprio avvio deve
//! ritrovare i container che aveva lasciato accesi e riadottarli: senza, dopo
//! un riavvio resterebbero orfani, a occupare il tetto dei progetti aperti
//! senza che nessuno li conti. Per questo i nomi hanno un prefisso
//! riconoscibile — vedi [`NOME_PREFISSO`].
//!
//! PERCHÉ SCRITTO A MANO E NON CON `reqwest`
//!
//! `reqwest` non parla con i socket unix. `hyper` sì, con una decina di righe,
//! e `hyper`/`hyper-util`/`http-body-util` erano già nell'albero come
//! dipendenze indirette di axum: dichiararle non ha scaricato niente.
//!
//! LA VERSIONE NELL'URL
//!
//! `/v1.0.0/libpod/...`. Podman accetta qualunque versione da 1.0.0 in su e
//! poi serve la propria semantica, quindi la stessa riga vale sulla 4.3.1 di
//! `theobroma` e sulla 5.4.2 del VPS — verificato su entrambe il 09-10-2026.
//! Scrivere la versione vera della macchina vorrebbe dire chiederla prima, e
//! un giro in più per niente.

use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use std::path::{Path, PathBuf};

/// Il prefisso dei container che il gateway possiede.
///
/// Serve a due cose, e la seconda è quella che conta: distinguerli da
/// qualunque altro container sulla macchina, e **ritrovarli dopo un riavvio
/// del gateway**. Un container senza questo prefisso non è suo e non lo
/// tocca, nemmeno per sbaglio.
pub const NOME_PREFISSO: &str = "sws-p-";

/// Il nome del container di un progetto: `sws-p-<azienda>-<nome>`.
///
/// Dall'indirizzo del progetto, che è già `<azienda>/<nome>` (Fase 3b). I
/// caratteri che podman non accetta in un nome diventano `-`: `safe_project_name`
/// e `cartella_da_nome` hanno già ripulito le due parti, ma la barra in mezzo
/// no, e un nome con la barra podman lo rifiuta.
pub fn nome_container(azienda: &str, progetto: &str) -> String {
    let pulisci = |s: &str| {
        s.chars()
            .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '_' { c } else { '-' })
            .collect::<String>()
    };
    format!("{NOME_PREFISSO}{}-{}", pulisci(azienda), pulisci(progetto))
}

/// L'indirizzo del progetto ricavato dal nome del container, se è dei nostri.
///
/// Il giro inverso non è esatto — `pulisci` perde informazione — quindi si
/// restituisce il nome com'è, buono per riconoscere e per fermare, non per
/// ricostruire l'indirizzo. Chi deve sapere di che progetto si tratta lo
/// chiede all'etichetta, non al nome (vedi [`ETICHETTA_RIFERIMENTO`]).
pub fn e_nostro(nome: &str) -> bool {
    nome.trim_start_matches('/').starts_with(NOME_PREFISSO)
}

/// L'etichetta in cui si scrive il riferimento vero del progetto.
///
/// Il nome del container è ripulito e non si può invertire; l'etichetta porta
/// `<azienda>/<nome>` esatto. È così che il gateway, riadottando i container
/// dopo un riavvio, sa a quale progetto corrisponde ciascuno.
pub const ETICHETTA_RIFERIMENTO: &str = "net.soligo.sws.progetto";

#[derive(Debug, Clone)]
pub struct Contenitore {
    pub id: String,
    pub nome: String,
    /// `<azienda>/<nome>`, dall'etichetta. `None` se l'etichetta manca — un
    /// container nostro di una versione precedente, o scritto a mano.
    pub riferimento: Option<String>,
    /// `running`, `exited`, `created`…
    pub stato: String,
}

pub struct Podman {
    socket: PathBuf,
}

impl Podman {
    pub fn nuovo(socket: impl Into<PathBuf>) -> Self {
        Self { socket: socket.into() }
    }

    /// Il socket rootless dell'utente corrente, se c'è.
    ///
    /// `XDG_RUNTIME_DIR` non è garantita: in un container senza sessione
    /// utente manca, e allora si prova il percorso che systemd userebbe.
    pub fn predefinito() -> Option<Self> {
        let da_env = std::env::var("XDG_RUNTIME_DIR")
            .ok()
            .map(|d| PathBuf::from(d).join("podman/podman.sock"));
        let da_uid = PathBuf::from(format!("/run/user/{}/podman/podman.sock", unsafe { libc_getuid() }));
        for p in [da_env, Some(da_uid)].into_iter().flatten() {
            if p.exists() {
                return Some(Self::nuovo(p));
            }
        }
        None
    }

    pub fn percorso(&self) -> &Path {
        &self.socket
    }

    async fn chiama(
        &self,
        metodo: &str,
        percorso: &str,
        corpo: Option<serde_json::Value>,
    ) -> anyhow::Result<(u16, String)> {
        let stream = tokio::net::UnixStream::connect(&self.socket).await.map_err(|e| {
            anyhow::anyhow!("socket di podman {}: {e}", self.socket.display())
        })?;
        let io = hyper_util::rt::TokioIo::new(stream);
        let (mut mittente, connessione) = hyper::client::conn::http1::handshake(io).await?;
        // La connessione va fatta girare: senza, `send_request` resta appesa.
        // Muore da sé quando `mittente` cade.
        tokio::spawn(async move {
            let _ = connessione.await;
        });

        let (tipo, dati) = match &corpo {
            Some(v) => ("application/json", Bytes::from(serde_json::to_vec(v)?)),
            None => ("application/json", Bytes::new()),
        };
        // `Host` serve perché HTTP/1.1 lo pretende, ma su un socket unix non
        // significa niente: podman lo ignora.
        let richiesta = hyper::Request::builder()
            .method(metodo)
            .uri(format!("http://d/v1.0.0/libpod{percorso}"))
            .header(hyper::header::HOST, "d")
            .header(hyper::header::CONTENT_TYPE, tipo)
            .body(Full::new(dati))?;

        let risposta = mittente.send_request(richiesta).await?;
        let stato = risposta.status().as_u16();
        let testo = String::from_utf8_lossy(&risposta.into_body().collect().await?.to_bytes())
            .into_owned();
        Ok((stato, testo))
    }

    pub async fn raggiungibile(&self) -> bool {
        matches!(self.chiama("GET", "/_ping", None).await, Ok((200, _)))
    }

    /// I container **del gateway**, in qualunque stato.
    ///
    /// `all=true` di proposito: uno fermo occupa comunque un nome e va
    /// ritrovato, altrimenti il tentativo di ricrearlo fallisce con «esiste
    /// già» e il progetto non si apre più.
    pub async fn elenca_nostri(&self) -> anyhow::Result<Vec<Contenitore>> {
        let (stato, corpo) = self.chiama("GET", "/containers/json?all=true", None).await?;
        if stato != 200 {
            anyhow::bail!("elenco container: HTTP {stato} — {corpo}");
        }
        let righe: Vec<serde_json::Value> = serde_json::from_str(&corpo)?;
        Ok(righe
            .into_iter()
            .filter_map(|c| {
                let nome = c
                    .get("Names")
                    .and_then(|n| n.as_array())
                    .and_then(|a| a.first())
                    .and_then(|n| n.as_str())?
                    .trim_start_matches('/')
                    .to_string();
                if !e_nostro(&nome) {
                    return None;
                }
                Some(Contenitore {
                    id: c.get("Id").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                    riferimento: c
                        .get("Labels")
                        .and_then(|l| l.get(ETICHETTA_RIFERIMENTO))
                        .and_then(|v| v.as_str())
                        .map(String::from),
                    stato: c
                        .get("State")
                        .and_then(|v| v.as_str())
                        .unwrap_or("?")
                        .to_string(),
                    nome,
                })
            })
            .collect())
    }

    /// La porta sull'host a cui podman ha legato `porta_interna`.
    ///
    /// Serve solo quando il gateway e un **processo** sulla macchina: da li
    /// l'indirizzo interno di un container rootless non si raggiunge, perche
    /// vive in un'altra rete. Si lascia scegliere la porta a podman (`0`) e
    /// poi gliela si richiede: cercarne una libera per conto proprio vuol
    /// dire una corsa fra il momento in cui la si trova e quello in cui la si
    /// usa.
    ///
    /// `Ok(None)` = il container c'e ma quella porta non risulta pubblicata.
    pub async fn porta_pubblicata(
        &self,
        nome: &str,
        porta_interna: u16,
    ) -> anyhow::Result<Option<u16>> {
        let (stato, corpo) = self.chiama("GET", &format!("/containers/{nome}/json"), None).await?;
        if stato != 200 {
            anyhow::bail!("stato di {nome}: HTTP {stato} — {corpo}");
        }
        let v: serde_json::Value = serde_json::from_str(&corpo)?;
        // `NetworkSettings.Ports` e una mappa "8444/tcp" -> [{HostIp, HostPort}].
        let porte = v.get("NetworkSettings").and_then(|n| n.get("Ports"));
        let Some(voci) = porte.and_then(|p| p.get(format!("{porta_interna}/tcp"))) else {
            return Ok(None);
        };
        Ok(voci
            .as_array()
            .and_then(|a| a.first())
            .and_then(|m| m.get("HostPort"))
            .and_then(|h| h.as_str())
            .and_then(|h| h.parse().ok()))
    }

    /// L'indirizzo IP del container **su quella rete**.
    ///
    /// Si usa questo e non il nome, e vale la pena dire perche': il nome
    /// funziona solo se la rete ha il risolutore acceso, e quello dipende da
    /// come e' fatta la macchina. Con podman 5 e netavark c'e' (aardvark-dns);
    /// con podman 4 e il vecchio CNI serve il plugin `dnsname`, che su questo
    /// dev server **non c'e'** — `podman network inspect` dice `dns=false`, e
    /// il 09-10-2026 il gateway dentro un container ha passato un minuto a
    /// chiedere `http://sws-p---impianto:8444` a un risolutore che non sapeva
    /// rispondere. L'IP invece lo sa dire podman stesso, dappertutto.
    ///
    /// Cambia a ogni avvio del container, quindi si legge quando serve e non
    /// si memorizza oltre la vita dell'apertura.
    pub async fn ip_sulla_rete(&self, nome: &str, rete: &str) -> anyhow::Result<Option<String>> {
        let (stato, corpo) = self.chiama("GET", &format!("/containers/{nome}/json"), None).await?;
        if stato != 200 {
            anyhow::bail!("stato di {nome}: HTTP {stato} — {corpo}");
        }
        let v: serde_json::Value = serde_json::from_str(&corpo)?;
        Ok(v.get("NetworkSettings")
            .and_then(|n| n.get("Networks"))
            .and_then(|r| r.get(rete))
            .and_then(|x| x.get("IPAddress"))
            .and_then(|x| x.as_str())
            .filter(|x| !x.is_empty())
            .map(|x| x.to_string()))
    }

    pub async fn crea(&self, spec: serde_json::Value) -> anyhow::Result<String> {
        let (stato, corpo) = self.chiama("POST", "/containers/create", Some(spec)).await?;
        if stato != 200 && stato != 201 {
            anyhow::bail!("creazione container: HTTP {stato} — {corpo}");
        }
        let v: serde_json::Value = serde_json::from_str(&corpo)?;
        Ok(v.get("Id").and_then(|x| x.as_str()).unwrap_or_default().to_string())
    }

    pub async fn avvia(&self, nome: &str) -> anyhow::Result<()> {
        let (stato, corpo) = self.chiama("POST", &format!("/containers/{nome}/start"), None).await?;
        // 204 avviato, 304 era già avviato: tutti e due vanno bene.
        if stato != 204 && stato != 304 {
            anyhow::bail!("avvio di {nome}: HTTP {stato} — {corpo}");
        }
        Ok(())
    }

    /// Ferma un container, aspettando al massimo `attesa_s` prima di
    /// terminarlo. 204 fermato, 304 era già fermo, 404 non c'è più.
    pub async fn ferma(&self, nome: &str, attesa_s: u32) -> anyhow::Result<()> {
        let (stato, corpo) = self
            .chiama("POST", &format!("/containers/{nome}/stop?timeout={attesa_s}"), None)
            .await?;
        if !matches!(stato, 204 | 304 | 404) {
            anyhow::bail!("arresto di {nome}: HTTP {stato} — {corpo}");
        }
        Ok(())
    }

    pub async fn rimuovi(&self, nome: &str) -> anyhow::Result<()> {
        let (stato, corpo) = self
            .chiama("DELETE", &format!("/containers/{nome}?force=true"), None)
            .await?;
        if !matches!(stato, 200 | 204 | 404) {
            anyhow::bail!("rimozione di {nome}: HTTP {stato} — {corpo}");
        }
        Ok(())
    }
}

/// `getuid` senza tirarsi dentro la crate `libc` per una riga sola.
///
/// Serve solo al percorso di ripiego del socket, quando `XDG_RUNTIME_DIR`
/// manca — e manca proprio nel caso che conta, un container senza sessione
/// utente.
unsafe fn libc_getuid() -> u32 {
    extern "C" {
        fn getuid() -> u32;
    }
    getuid()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Il nome e' ripulito perche' podman non accetta tutto, ma resta
    /// riconoscibile.
    #[test]
    fn il_nome_del_container_e_riconoscibile() {
        assert_eq!(nome_container("acme", "impianto"), "sws-p-acme-impianto");
        // L'azienda implicita e' `-` nell'indirizzo: resta un trattino.
        assert_eq!(nome_container("-", "collaudo"), "sws-p---collaudo");
        // Un nome con caratteri che podman rifiuta non lo fa fallire.
        assert_eq!(nome_container("acme", "linea 3/b"), "sws-p-acme-linea-3-b");
        assert_eq!(nome_container("acme", "F2.2"), "sws-p-acme-F2.2");
    }

    /// Il giro completo contro il podman **vero** della macchina.
    ///
    /// `#[ignore]` perche' tocca il sistema e in CI non c'e' un socket: si
    /// lancia a mano con
    /// `cargo test -p sws-web --lib -- --ignored giro_completo --nocapture`.
    /// Senza socket si ferma da sola, senza fallire: un test che fallisce
    /// dove non puo' girare si impara a ignorare.
    ///
    /// Usa `alpine`, che dev'essere gia' scaricata: il client non fa il pull,
    /// e scaricare dentro un test lo renderebbe lento e dipendente dalla rete.
    #[tokio::test]
    #[ignore]
    async fn giro_completo_contro_podman_vero() {
        let Some(p) = Podman::predefinito() else {
            eprintln!("nessun socket podman: prova saltata");
            return;
        };
        if !p.raggiungibile().await {
            eprintln!("socket presente ma podman non risponde: prova saltata");
            return;
        }
        let nome = nome_container("prova", "giro");
        // Se un giro precedente e' morto a meta', si riparte pulito.
        let _ = p.rimuovi(&nome).await;

        let id = p
            .crea(serde_json::json!({
                "image": "docker.io/library/alpine:latest",
                "command": ["echo", "sono-il-figlio"],
                "name": nome,
                "labels": { ETICHETTA_RIFERIMENTO: "prova/giro" },
            }))
            .await
            .expect("creazione");
        assert!(!id.is_empty(), "creato senza id");

        p.avvia(&nome).await.expect("avvio");

        let nostri = p.elenca_nostri().await.expect("elenco");
        let mio = nostri.iter().find(|c| c.nome == nome).expect("non lo ritrovo");
        assert_eq!(
            mio.riferimento.as_deref(),
            Some("prova/giro"),
            "l'etichetta col riferimento non e' tornata indietro: senza, dopo un \
             riavvio il gateway non sa a che progetto corrisponde"
        );

        p.ferma(&nome, 2).await.expect("arresto");
        p.rimuovi(&nome).await.expect("rimozione");

        let dopo = p.elenca_nostri().await.expect("elenco finale");
        assert!(!dopo.iter().any(|c| c.nome == nome), "rimasto li dopo la rimozione");
    }

    /// Riconoscere i propri e' cio' che permette di riadottarli dopo un
    /// riavvio del gateway. Un container di qualcun altro non si tocca.
    #[test]
    fn si_riconoscono_solo_i_nostri() {
        assert!(e_nostro("sws-p-acme-impianto"));
        assert!(e_nostro("/sws-p-acme-impianto")); // podman li elenca con la barra
        assert!(!e_nostro("portainer"));
        assert!(!e_nostro("systemd-traefik"));
        // Il runtime del pannello non e' un progetto del gateway.
        assert!(!e_nostro("sws-runtime"));
    }
}
