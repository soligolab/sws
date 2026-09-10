//! La sonda del dispositivo (Q52, 2026-09-09): `POST /api/device/probe`.
//!
//! Prima di installare il container su una macchina che l'utente ha scelto in
//! rete, l'editor si collega via ssh con le credenziali che gli vengono date e
//! **guarda** che macchina è e se è pronta: architettura, podman e versione,
//! mappature per il rootless, linger, sessione systemd utente, spazio, cartella
//! dati, un SWS già presente. Il risultato è una lista di controlli — verde,
//! avviso, errore — ognuno con il rimedio accanto.
//!
//! Divisione del lavoro, che è la ragione di questo modulo:
//!
//! - `deploy/container/sonda-dispositivo.sh` gira **sul dispositivo** e stampa
//!   solo fatti (`SONDA chiave=valore`). POSIX sh, nessun giudizio, esce 0.
//! - qui si **giudica**: `valuta_sonda` trasforma i fatti in controlli. È una
//!   funzione pura, e si prova con `cargo test` senza avere un dispositivo.
//!
//! La sessione ssh è UNA: lo script viaggia su stdin a `sh -s`, niente scp e
//! niente file lasciati sul dispositivo. Passa da `run_ssh_cmd_stdin` di
//! `packaging.rs`, così sshpass (`-e`, password nell'ambiente), `accept-new` e
//! il riconoscimento «chiave host cambiata» restano in un posto solo.

use axum::{
    extract::{Json as EJson, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use crate::packaging::{
    destinazione_ssh_sicura, run_ssh_cmd_stdin, sshpass_available, validate_remote_path,
};
use crate::router::AppState;

/// La sonda, dentro il binario come i file di deploy di Q48: un editor senza
/// il checkout del repo deve poterla mandare lo stesso.
pub(crate) const SONDA_DISPOSITIVO_SH: &str =
    include_str!("../../../../deploy/container/sonda-dispositivo.sh");

/// Quanto aspettare la sonda, ssh compreso. `podman info` su una SD lenta può
/// prendere qualche secondo; il ConnectTimeout di ssh è 10.
const TEMPO_MASSIMO: std::time::Duration = std::time::Duration::from_secs(30);

/// Spazio richiesto nello storage di podman: la stessa formula dell'installer
/// per `--pull` (500 MB di immagine × 3, install-container.sh L276), in KB.
const SPAZIO_MINIMO_KB: u64 = 500 * 1024 * 3;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProbeBody {
    pub host: String,
    #[serde(default = "porta_ssh_default")]
    pub port: u16,
    pub user: String,
    #[serde(default)]
    pub password: String,
    /// La cartella dati scelta nel modulo (`install-container.sh --data`);
    /// vuota = il default dello script. La sonda controlla quella.
    #[serde(default)]
    pub data_path: String,
}

fn porta_ssh_default() -> u16 {
    22
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Esito {
    Ok,
    Avviso,
    Errore,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct Controllo {
    pub id: &'static str,
    pub esito: Esito,
    pub titolo: &'static str,
    pub dettaglio: String,
    pub rimedio: Option<String>,
}

#[derive(Debug, Default, Serialize)]
pub struct Os {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Default, Serialize)]
pub struct Dispositivo {
    pub hostname: String,
    pub arch: String,
    pub os: Os,
    pub kernel: String,
    pub utente: String,
    pub uid: Option<u32>,
}

#[derive(Debug, Default, Serialize)]
pub struct SwsInstallato {
    pub installato: bool,
    pub versione: Option<String>,
    pub immagine: Option<String>,
    pub attivo: Option<bool>,
    pub data_path: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct Sonda {
    pub ok_ssh: bool,
    pub chiave_host_cambiata: bool,
    pub sshpass: bool,
    pub dispositivo: Option<Dispositivo>,
    pub controlli: Vec<Controllo>,
    pub variante_immagine: Option<&'static str>,
    pub sws: SwsInstallato,
    pub pronto: bool,
    /// Le righe di ssh quando il collegamento non è riuscito: «Permission
    /// denied», «Connection refused», «Host key verification failed». Vuota
    /// quando `ok_ssh`. Mai la password: viaggia in `SSHPASS`, non in argv.
    pub diagnostica: Vec<String>,
}

pub(crate) type Fatti = BTreeMap<String, String>;

/// Da `"    SONDA arch=aarch64"` a `("arch", "aarch64")`. Le righe che non
/// cominciano per `SONDA ` (banner del dispositivo, «Warning: Permanently
/// added…», i nostri `ERROR:`) sono rumore e si ignorano. Se una chiave
/// compare due volte vince l'ultima: è la forma più semplice e la sonda non
/// ripete chiavi.
pub(crate) fn analizza_righe_sonda(righe: &[String]) -> Fatti {
    let mut f = Fatti::new();
    for r in righe {
        let r = r.trim();
        let Some(resto) = r.strip_prefix("SONDA ") else {
            continue;
        };
        if let Some((k, v)) = resto.split_once('=') {
            f.insert(k.trim().to_string(), v.trim().to_string());
        }
    }
    f
}

/// L'architettura decide l'immagine, con le regole di install-container.sh
/// L183-199. Dalla 2.7.2 (Q53) l'immagine aarch64 è **una sola**,
/// `latest-arm64`, cross-compilata e valida per qualunque board arm64;
/// `latest-arm64-generic` è solo un alias di transizione e non si propone più.
/// Fino al 2026-09-09 qui si sceglieva fra SDK Pixsys e generica leggendo
/// `os-release`: i due parametri restano nella firma per il giorno in cui un
/// sistema dovesse davvero volere un'immagine diversa, oggi non li usa nessuno.
/// È una **proposta**: finisce nel campo «riferimento immagine» e l'utente la
/// cambia. Le altre architetture (armv7l, riscv…) non hanno un'immagine
/// pubblicata e il controllo lo dice.
pub(crate) fn variante_immagine(arch: &str, _os_id: &str, _os_name: &str) -> Option<&'static str> {
    match arch.trim() {
        "aarch64" | "arm64" => Some("latest-arm64"),
        "x86_64" | "amd64" => Some("latest-amd64"),
        _ => None,
    }
}

/// `"4.9.4-dev"` → `(4, 9)` ≥ `(4, 4)`: quadlet, che l'installer usa per
/// l'avvio automatico, c'è dalla 4.4.
pub(crate) fn versione_podman_ok(v: &str) -> Option<bool> {
    let mut parti = v.trim().split(|c: char| !c.is_ascii_digit());
    let major: u32 = parti.next()?.parse().ok()?;
    let minor: u32 = parti.next().and_then(|m| m.parse().ok()).unwrap_or(0);
    Some((major, minor) >= (4, 4))
}

/// `"ghcr.io/soligolab/sws-runtime:2026.7.0-arm64"` → `Some("2026.7.0")`;
/// `"…:latest-arm64"` → `None`. L'immagine non porta una label di versione
/// (il Containerfile mette solo source/description/licenses), quindi la
/// versione si legge dal tag e solo quando il tag la dice.
pub(crate) fn versione_da_tag_immagine(img: &str) -> Option<String> {
    let tag = img.rsplit_once(':')?.1;
    let tag = tag
        .strip_suffix("-arm64-generic")
        .or_else(|| tag.strip_suffix("-arm64"))
        .or_else(|| tag.strip_suffix("-amd64"))
        .unwrap_or(tag);
    let e_versione = !tag.is_empty()
        && tag.chars().next().is_some_and(|c| c.is_ascii_digit())
        && tag.chars().all(|c| c.is_ascii_digit() || c == '.');
    e_versione.then(|| tag.to_string())
}

fn fatto<'a>(f: &'a Fatti, k: &str) -> &'a str {
    f.get(k).map(String::as_str).unwrap_or("")
}

fn controllo(
    id: &'static str,
    esito: Esito,
    titolo: &'static str,
    dettaglio: impl Into<String>,
    rimedio: Option<&str>,
) -> Controllo {
    Controllo {
        id,
        esito,
        titolo,
        dettaglio: dettaglio.into(),
        rimedio: rimedio.map(str::to_string),
    }
}

/// Il giudizio: fatti dentro, controlli fuori. Ogni riga qui corrisponde a un
/// motivo per cui `install-container.sh` si fermerebbe, o a una cosa che
/// l'utente deve sapere prima di premere «Installa».
pub(crate) fn valuta_sonda(
    f: &Fatti,
) -> (
    Dispositivo,
    Vec<Controllo>,
    Option<&'static str>,
    SwsInstallato,
) {
    let dispositivo = Dispositivo {
        hostname: fatto(f, "hostname").to_string(),
        arch: fatto(f, "arch").to_string(),
        os: Os {
            name: fatto(f, "os_name").to_string(),
            version: fatto(f, "os_version").to_string(),
        },
        kernel: fatto(f, "kernel").to_string(),
        utente: fatto(f, "utente").to_string(),
        uid: fatto(f, "uid").parse().ok(),
    };
    let utente = if dispositivo.utente.is_empty() {
        "<utente>".to_string()
    } else {
        dispositivo.utente.clone()
    };

    let mut c: Vec<Controllo> = Vec::new();

    // ── architettura → immagine ────────────────────────────────────────────
    let variante = variante_immagine(&dispositivo.arch, fatto(f, "os_id"), fatto(f, "os_name"));
    match variante {
        Some(v) => c.push(controllo(
            "architettura",
            Esito::Ok,
            "Architettura",
            format!("{} → immagine {v}", dispositivo.arch),
            None,
        )),
        None => c.push(controllo(
            "architettura",
            Esito::Errore,
            "Architettura",
            format!(
                "«{}» non riconosciuta: sono pubblicate solo latest-arm64 e latest-amd64",
                dispositivo.arch
            ),
            Some("passa il riferimento dell'immagine per esteso, oppure installa da archivio (--image <file>)"),
        )),
    }

    // ── podman ─────────────────────────────────────────────────────────────
    if fatto(f, "podman") == "1" {
        let v = fatto(f, "podman_versione");
        match versione_podman_ok(v) {
            Some(true) => c.push(controllo(
                "podman",
                Esito::Ok,
                "podman",
                format!("versione {v}"),
                None,
            )),
            Some(false) => c.push(controllo(
                "podman",
                Esito::Errore,
                "podman",
                format!("versione {v}: serve ≥ 4.4 (quadlet, per l'avvio automatico)"),
                Some("aggiorna podman dal gestore pacchetti del sistema"),
            )),
            None => c.push(controllo(
                "podman",
                Esito::Avviso,
                "podman",
                "presente, versione non leggibile",
                Some("l'installer richiede ≥ 4.4: verifica con `podman --version`"),
            )),
        }
    } else {
        c.push(controllo(
            "podman",
            Esito::Errore,
            "podman",
            "non installato",
            Some("installa podman ≥ 4.4 dal gestore pacchetti del sistema"),
        ));
    }

    // ── rootless: subuid/subgid ────────────────────────────────────────────
    let subuid = fatto(f, "subuid") == "1";
    let subgid = fatto(f, "subgid") == "1";
    if subuid && subgid {
        c.push(controllo(
            "subuid_subgid",
            Esito::Ok,
            "Mappature rootless",
            "subuid e subgid presenti",
            None,
        ));
    } else {
        let manca = match (subuid, subgid) {
            (false, false) => "mancano subuid e subgid",
            (false, true) => "manca subuid",
            _ => "manca subgid",
        };
        c.push(controllo(
            "subuid_subgid",
            Esito::Errore,
            "Mappature rootless",
            format!("{manca} per {utente}: podman senza root non può partire"),
            Some(&format!(
                "da un amministratore: sudo usermod --add-subuids 100000-165535 --add-subgids 100000-165535 {utente} && podman system migrate"
            )),
        ));
    }

    // ── linger ─────────────────────────────────────────────────────────────
    match fatto(f, "linger") {
        "yes" => c.push(controllo("linger", Esito::Ok, "Linger", "attivo: il container riparte al riavvio", None)),
        "no" => c.push(controllo(
            "linger",
            Esito::Avviso,
            "Linger",
            "spento: senza, il container non riparte dopo il reboot",
            Some(&format!(
                "l'installer prova ad abilitarlo; se non ha il permesso: sudo loginctl enable-linger {utente}"
            )),
        )),
        _ => c.push(controllo(
            "linger",
            Esito::Avviso,
            "Linger",
            "non verificabile (loginctl assente)",
            Some("senza systemd-logind il riavvio automatico va garantito in altro modo"),
        )),
    }

    // ── sessione systemd utente ────────────────────────────────────────────
    match fatto(f, "systemd_user") {
        "running" => c.push(controllo("systemd_user", Esito::Ok, "systemd --user", "raggiungibile", None)),
        "degraded" => c.push(controllo(
            "systemd_user",
            Esito::Avviso,
            "systemd --user",
            "raggiungibile ma con unit fallite",
            Some("sul dispositivo: systemctl --user --failed"),
        )),
        s => c.push(controllo(
            "systemd_user",
            Esito::Errore,
            "systemd --user",
            format!("non risponde ({s}): l'installer usa unit quadlet dell'utente"),
            Some(&format!(
                "serve la sessione utente (XDG_RUNTIME_DIR): accedi una volta al dispositivo o abilita il linger di {utente}"
            )),
        )),
    }

    // ── spazio ─────────────────────────────────────────────────────────────
    let storage = fatto(f, "storage_root");
    match fatto(f, "spazio_kb").parse::<u64>() {
        Ok(kb) if kb >= SPAZIO_MINIMO_KB => c.push(controllo(
            "spazio",
            Esito::Ok,
            "Spazio",
            format!("{} MB liberi in {storage}", kb / 1024),
            None,
        )),
        Ok(kb) => c.push(controllo(
            "spazio",
            Esito::Errore,
            "Spazio",
            format!(
                "{} MB liberi in {storage}, ne servono ~{} MB",
                kb / 1024,
                SPAZIO_MINIMO_KB / 1024
            ),
            Some("libera spazio: podman image prune -a, oppure --data su un'altra partizione"),
        )),
        Err(_) => c.push(controllo(
            "spazio",
            Esito::Avviso,
            "Spazio",
            "non misurabile",
            Some("l'installer lo misura di nuovo prima di scaricare l'immagine"),
        )),
    }

    // ── cartella dati ──────────────────────────────────────────────────────
    let data_path = fatto(f, "data_path");
    match fatto(f, "data_stato") {
        "scrivibile" => c.push(controllo("cartella_dati", Esito::Ok, "Cartella dati", format!("{data_path} scrivibile"), None)),
        "assente-creabile" => c.push(controllo(
            "cartella_dati",
            Esito::Avviso,
            "Cartella dati",
            format!("{data_path} non esiste: la crea l'installer"),
            None,
        )),
        "non-scrivibile" => c.push(controllo(
            "cartella_dati",
            Esito::Errore,
            "Cartella dati",
            format!("{data_path} esiste ma {utente} non può scriverci"),
            Some("cambia proprietario o permessi, oppure indica un'altra cartella dati"),
        )),
        _ => c.push(controllo(
            "cartella_dati",
            Esito::Errore,
            "Cartella dati",
            format!("{data_path} non esiste e {utente} non può crearla"),
            Some("crea la cartella da un amministratore e assegnala all'utente, oppure indica un'altra cartella dati"),
        )),
    }

    // ── utente ─────────────────────────────────────────────────────────────
    if dispositivo.uid == Some(0) {
        c.push(controllo(
            "utente_non_root",
            Esito::Avviso,
            "Utente",
            "stai per installare come root: il container sarebbe rootful",
            Some("il percorso previsto è un utente normale, senza sudo"),
        ));
    }

    // ── SWS già presente ───────────────────────────────────────────────────
    let mut sws = SwsInstallato {
        data_path: (!data_path.is_empty()).then(|| data_path.to_string()),
        ..Default::default()
    };
    if fatto(f, "container_sws") == "1" {
        let img = fatto(f, "container_sws_immagine");
        sws.installato = true;
        sws.immagine = (!img.is_empty()).then(|| img.to_string());
        sws.versione = versione_da_tag_immagine(img);
        sws.attivo = match fatto(f, "container_sws_attivo") {
            "active" => Some(true),
            "inactive" | "failed" => Some(false),
            _ => None,
        };
        let stato = match sws.attivo {
            Some(true) => "attivo",
            Some(false) => "fermo",
            None => "stato sconosciuto",
        };
        c.push(controllo(
            "sws_presente",
            Esito::Avviso,
            "SWS già installato",
            match &sws.versione {
                Some(v) => format!("versione {v}, {stato}: l'installazione lo aggiorna"),
                None => format!("{img}, {stato}: l'installazione lo aggiorna"),
            },
            None,
        ));
    }

    // ── la sonda è arrivata in fondo? ──────────────────────────────────────
    if fatto(f, "fine") != "1" && !f.is_empty() {
        c.push(controllo(
            "sonda_incompleta",
            Esito::Errore,
            "Sonda",
            "si è interrotta prima della fine: sh non POSIX o un comando bloccato",
            Some("riprova; se persiste, installa a mano con install-container.sh"),
        ));
    }

    (dispositivo, c, variante, sws)
}

/// Pronto = ssh riuscito, sonda arrivata in fondo, nessun errore. Gli avvisi
/// non fermano: sono cose da sapere, non da sistemare per forza.
pub(crate) fn pronto(ok_ssh: bool, f: &Fatti, controlli: &[Controllo]) -> bool {
    ok_ssh && fatto(f, "fine") == "1" && controlli.iter().all(|c| c.esito != Esito::Errore)
}

/// La riga di ssh che spiega il fallimento, se ce n'è una riconoscibile.
fn motivo_ssh(righe: &[String]) -> String {
    let noti = [
        "Permission denied",
        "Connection refused",
        "Connection timed out",
        "No route to host",
        "Could not resolve hostname",
        "Host key verification failed",
        "Connection closed",
    ];
    righe
        .iter()
        .map(|r| r.trim())
        .find(|r| noti.iter().any(|n| r.contains(n)))
        .map(str::to_string)
        .unwrap_or_else(|| "ssh non è riuscito a collegarsi".to_string())
}

/// `POST /api/device/probe` — una sessione ssh, la sonda su stdin, JSON fuori.
/// Admin per posizione nel router. Password mai memorizzata né loggata.
pub async fn sonda_dispositivo(
    State(s): State<AppState>,
    axum::Extension(user): axum::Extension<crate::router::AuthUser>,
    EJson(req): EJson<ProbeBody>,
) -> Response {
    if let Err(m) = destinazione_ssh_sicura(&req.user, &req.host) {
        return (StatusCode::BAD_REQUEST, format!("{m}\n")).into_response();
    }
    if req.port == 0 {
        return (StatusCode::BAD_REQUEST, "porta SSH non valida\n").into_response();
    }
    // Stesse regole del deploy (`validate_remote_path`): assoluto, niente `..`,
    // solo caratteri innocui — finisce in una riga di comando remota.
    let data_path = req.data_path.trim().to_string();
    if !data_path.is_empty() && !validate_remote_path(&data_path) {
        return (
            StatusCode::BAD_REQUEST,
            "cartella dati non valida: percorso assoluto, senza «..», solo lettere, numeri, - _ . /\n",
        )
            .into_response();
    }

    let use_sshpass = sshpass_available();
    let righe: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let send = {
        let r = Arc::clone(&righe);
        move |l: &str| r.lock().unwrap().push(l.to_string())
    };
    let host_str = format!("{}@{}", req.user, req.host);
    let port_str = req.port.to_string();
    // `sh -s -- <cartella>`: lo script su stdin, la cartella dati come $1.
    let comando_remoto = if data_path.is_empty() {
        "sh -s".to_string()
    } else {
        format!("sh -s -- {data_path}")
    };

    let esito = tokio::time::timeout(
        TEMPO_MASSIMO,
        run_ssh_cmd_stdin(
            use_sshpass,
            &req.password,
            "ssh",
            &[
                "-p",
                &port_str,
                "-o",
                "StrictHostKeyChecking=accept-new",
                &host_str,
                &comando_remoto,
            ],
            Some(SONDA_DISPOSITIVO_SH),
            &send,
        ),
    )
    .await;

    let righe = std::mem::take(&mut *righe.lock().unwrap());
    let ok_ssh = matches!(esito, Ok(true));
    let chiave_host_cambiata = righe
        .iter()
        .any(|l| l.trim() == "AZIONE: chiave-host-cambiata");
    let fatti = analizza_righe_sonda(&righe);
    // Senza fatti non si giudica: valutare una mappa vuota produrrebbe una
    // fila di «errori» («architettura sconosciuta», «podman non installato»)
    // che parlano di un dispositivo che non abbiamo mai raggiunto.
    let (dispositivo, mut controlli, variante, sws) = if fatti.is_empty() {
        (
            Dispositivo::default(),
            Vec::new(),
            None,
            SwsInstallato::default(),
        )
    } else {
        valuta_sonda(&fatti)
    };

    if esito.is_err() {
        controlli.insert(
            0,
            controllo(
                "ssh",
                Esito::Errore,
                "Connessione SSH",
                format!("tempo scaduto ({} s)", TEMPO_MASSIMO.as_secs()),
                Some("verifica host e porta, e che il dispositivo risponda"),
            ),
        );
    } else if !ok_ssh {
        let rimedio = if chiave_host_cambiata {
            "la chiave del dispositivo è cambiata (factory reset?): usa «Dimentica la vecchia chiave e riprova»"
        } else if !use_sshpass {
            "sshpass non è installato su questo PC: si può entrare solo con la chiave pubblica (ssh-copy-id), la password viene ignorata"
        } else {
            "controlla host, porta, utente e password"
        };
        controlli.insert(
            0,
            controllo(
                "ssh",
                Esito::Errore,
                "Connessione SSH",
                motivo_ssh(&righe),
                Some(rimedio),
            ),
        );
    }

    let pronto = pronto(ok_ssh, &fatti, &controlli);
    // Senza fatti non c'è un dispositivo da descrivere: `null` è più onesto di
    // una struttura di stringhe vuote.
    let dispositivo = (!fatti.is_empty()).then_some(dispositivo);
    let diagnostica: Vec<String> = if ok_ssh {
        Vec::new()
    } else {
        righe
            .iter()
            .map(|l| l.trim())
            .filter(|l| !l.starts_with("SONDA ") && !l.is_empty())
            .map(str::to_string)
            .collect()
    };

    s.audit.log(
        "device.probe",
        Some(user.username),
        serde_json::json!({
            "host": req.host, "port": req.port, "user": req.user,
            "ok_ssh": ok_ssh, "pronto": pronto, "chiave_host_cambiata": chiave_host_cambiata,
            "errori": controlli.iter().filter(|c| c.esito == Esito::Errore).map(|c| c.id).collect::<Vec<_>>(),
        }),
    );

    axum::Json(Sonda {
        ok_ssh,
        chiave_host_cambiata,
        sshpass: use_sshpass,
        dispositivo,
        controlli,
        variante_immagine: variante,
        sws,
        pronto,
        diagnostica,
    })
    .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fatti(coppie: &[(&str, &str)]) -> Fatti {
        coppie
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    /// Un dispositivo «tutto a posto», da cui i test tolgono una cosa alla volta.
    fn dispositivo_pronto() -> Fatti {
        fatti(&[
            ("hostname", "wp630"),
            ("arch", "aarch64"),
            ("kernel", "5.10"),
            ("utente", "user"),
            ("uid", "1000"),
            ("os_name", "Pixsys OS 2.1"),
            ("os_id", "pixsys"),
            ("os_version", "2.1"),
            ("podman", "1"),
            ("podman_versione", "4.9.4"),
            ("storage_root", "/data/user/.local/share/containers/storage"),
            ("spazio_kb", "8000000"),
            ("subuid", "1"),
            ("subgid", "1"),
            ("linger", "yes"),
            ("xdg_runtime_dir", "1"),
            ("systemd_user", "running"),
            ("data_path", "/data/user/sws"),
            ("data_stato", "scrivibile"),
            ("container_sws", "0"),
            ("fine", "1"),
        ])
    }

    fn per_id<'a>(c: &'a [Controllo], id: &str) -> &'a Controllo {
        c.iter()
            .find(|x| x.id == id)
            .unwrap_or_else(|| panic!("manca il controllo {id}"))
    }

    /// La sonda incorporata è quella del repo, ed è POSIX: `sh -s` su busybox
    /// non perdona bashismi.
    #[test]
    fn la_sonda_incorporata_e_identica_al_file_nel_repo_ed_e_posix() {
        let repo = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
        let dal_repo =
            std::fs::read_to_string(repo.join("deploy/container/sonda-dispositivo.sh")).unwrap();
        assert_eq!(dal_repo, SONDA_DISPOSITIVO_SH);
        assert!(SONDA_DISPOSITIVO_SH.starts_with("#!/bin/sh\n"));
        for bashismo in ["[[", "local ", "BASH_SOURCE", "function ", "$'"] {
            assert!(
                !SONDA_DISPOSITIVO_SH.contains(bashismo),
                "bashismo «{bashismo}» nella sonda: deve girare con sh -s"
            );
        }
    }

    #[test]
    fn le_righe_sonda_si_leggono_e_il_rumore_ssh_si_ignora() {
        let righe: Vec<String> = [
            "    Warning: Permanently added 'wp630' (ED25519) to the list of known hosts.",
            "    SONDA arch=aarch64",
            "    SONDA os_name=Debian GNU/Linux 12 (bookworm)",
            "    Benvenuto sul pannello",
            "    SONDA fine=1",
            "ERROR: ssh fallito (exit 255)",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        let f = analizza_righe_sonda(&righe);
        assert_eq!(f.len(), 3);
        assert_eq!(f["arch"], "aarch64");
        // Il valore può contenere `=` e parentesi: si spezza solo al primo `=`.
        assert_eq!(f["os_name"], "Debian GNU/Linux 12 (bookworm)");
        assert_eq!(f["fine"], "1");
    }

    #[test]
    fn arch_diventa_variante_immagine() {
        // Q53: una sola immagine aarch64, qualunque sia il sistema. Valori veri
        // del TC620 (Pixsys OS 2.1.1, 2026-09-09) e di una Debian generica.
        assert_eq!(
            variante_immagine("aarch64", "", "Pixsys OS 2.1.1"),
            Some("latest-arm64")
        );
        assert_eq!(
            variante_immagine("aarch64", "debian", "Debian"),
            Some("latest-arm64")
        );
        assert_eq!(
            variante_immagine("x86_64", "ubuntu", "Ubuntu"),
            Some("latest-amd64")
        );
        assert_eq!(variante_immagine("armv7l", "raspbian", ""), None);
        assert_eq!(variante_immagine("", "", ""), None);
    }

    #[test]
    fn versione_podman_e_confrontata_per_numeri() {
        assert_eq!(versione_podman_ok("4.9.4-dev"), Some(true));
        assert_eq!(versione_podman_ok("4.4"), Some(true));
        assert_eq!(versione_podman_ok("4.3.1"), Some(false));
        assert_eq!(versione_podman_ok("3.4.4"), Some(false));
        assert_eq!(versione_podman_ok("5.0.0"), Some(true));
        assert_eq!(versione_podman_ok(""), None);
    }

    #[test]
    fn la_versione_si_legge_dal_tag_solo_quando_il_tag_la_dice() {
        assert_eq!(
            versione_da_tag_immagine("ghcr.io/soligolab/sws-runtime:2026.7.0-arm64"),
            Some("2026.7.0".to_string())
        );
        assert_eq!(
            versione_da_tag_immagine("ghcr.io/soligolab/sws-runtime:2.7.1-arm64-generic"),
            Some("2.7.1".to_string())
        );
        assert_eq!(
            versione_da_tag_immagine("ghcr.io/soligolab/sws-runtime:latest-arm64"),
            None
        );
        assert_eq!(
            versione_da_tag_immagine("ghcr.io/soligolab/sws-runtime:d1fde9e-amd64"),
            None
        );
        assert_eq!(versione_da_tag_immagine("senza-tag"), None);
    }

    #[test]
    fn un_dispositivo_a_posto_e_pronto_senza_errori() {
        let f = dispositivo_pronto();
        let (d, c, v, sws) = valuta_sonda(&f);
        assert_eq!(d.hostname, "wp630");
        assert_eq!(d.uid, Some(1000));
        assert_eq!(v, Some("latest-arm64"));
        assert!(!sws.installato);
        assert!(c.iter().all(|x| x.esito == Esito::Ok), "{c:?}");
        assert!(pronto(true, &f, &c));
    }

    #[test]
    fn podman_troppo_vecchio_e_un_errore_con_rimedio() {
        let mut f = dispositivo_pronto();
        f.insert("podman_versione".into(), "4.3.1".into());
        let (_, c, _, _) = valuta_sonda(&f);
        let p = per_id(&c, "podman");
        assert_eq!(p.esito, Esito::Errore);
        assert!(p.rimedio.is_some());
        assert!(!pronto(true, &f, &c));
    }

    #[test]
    fn podman_assente_e_un_errore() {
        let mut f = dispositivo_pronto();
        f.insert("podman".into(), "0".into());
        f.remove("podman_versione");
        let (_, c, _, _) = valuta_sonda(&f);
        assert_eq!(per_id(&c, "podman").esito, Esito::Errore);
    }

    #[test]
    fn linger_spento_e_un_avviso_non_un_errore() {
        let mut f = dispositivo_pronto();
        f.insert("linger".into(), "no".into());
        let (_, c, _, _) = valuta_sonda(&f);
        assert_eq!(per_id(&c, "linger").esito, Esito::Avviso);
        // L'installer prova ad abilitarlo da solo: non si ferma nessuno prima.
        assert!(pronto(true, &f, &c));
    }

    #[test]
    fn spazio_sotto_la_soglia_e_un_errore() {
        let mut f = dispositivo_pronto();
        f.insert("spazio_kb".into(), "300000".into());
        let (_, c, _, _) = valuta_sonda(&f);
        let s = per_id(&c, "spazio");
        assert_eq!(s.esito, Esito::Errore);
        assert!(s.dettaglio.contains("292 MB"), "{}", s.dettaglio);
    }

    #[test]
    fn cartella_dati_assente_ma_creabile_e_un_avviso() {
        let mut f = dispositivo_pronto();
        f.insert("data_stato".into(), "assente-creabile".into());
        let (_, c, _, _) = valuta_sonda(&f);
        assert_eq!(per_id(&c, "cartella_dati").esito, Esito::Avviso);
        assert!(pronto(true, &f, &c));
        f.insert("data_stato".into(), "assente-non-creabile".into());
        let (_, c, _, _) = valuta_sonda(&f);
        assert_eq!(per_id(&c, "cartella_dati").esito, Esito::Errore);
    }

    #[test]
    fn mappature_mancanti_e_systemd_utente_assente_fermano() {
        let mut f = dispositivo_pronto();
        f.insert("subgid".into(), "0".into());
        let (_, c, _, _) = valuta_sonda(&f);
        let m = per_id(&c, "subuid_subgid");
        assert_eq!(m.esito, Esito::Errore);
        assert!(m.dettaglio.contains("manca subgid"));
        assert!(m.rimedio.as_deref().unwrap().contains("usermod"));

        let mut f = dispositivo_pronto();
        f.insert("systemd_user".into(), "non-raggiungibile".into());
        let (_, c, _, _) = valuta_sonda(&f);
        assert_eq!(per_id(&c, "systemd_user").esito, Esito::Errore);
    }

    #[test]
    fn sws_gia_presente_e_un_avviso_informativo_con_versione_e_stato() {
        let mut f = dispositivo_pronto();
        f.insert("container_sws".into(), "1".into());
        f.insert(
            "container_sws_immagine".into(),
            "ghcr.io/soligolab/sws-runtime:2.7.1-arm64".into(),
        );
        f.insert("container_sws_attivo".into(), "active".into());
        let (_, c, _, sws) = valuta_sonda(&f);
        assert!(sws.installato);
        assert_eq!(sws.versione.as_deref(), Some("2.7.1"));
        assert_eq!(sws.attivo, Some(true));
        let p = per_id(&c, "sws_presente");
        assert_eq!(p.esito, Esito::Avviso);
        assert!(p.dettaglio.contains("2.7.1") && p.dettaglio.contains("attivo"));
        assert!(pronto(true, &f, &c));
    }

    #[test]
    fn pronto_solo_senza_errori_e_con_la_riga_fine() {
        let f = dispositivo_pronto();
        let (_, c, _, _) = valuta_sonda(&f);
        assert!(pronto(true, &f, &c));
        assert!(!pronto(false, &f, &c), "ssh fallito: mai pronto");

        let mut senza_fine = dispositivo_pronto();
        senza_fine.remove("fine");
        let (_, c, _, _) = valuta_sonda(&senza_fine);
        assert_eq!(per_id(&c, "sonda_incompleta").esito, Esito::Errore);
        assert!(!pronto(true, &senza_fine, &c));
    }

    #[test]
    fn root_e_un_avviso() {
        let mut f = dispositivo_pronto();
        f.insert("uid".into(), "0".into());
        f.insert("utente".into(), "root".into());
        let (_, c, _, _) = valuta_sonda(&f);
        assert_eq!(per_id(&c, "utente_non_root").esito, Esito::Avviso);
    }

    #[test]
    fn il_motivo_ssh_e_la_riga_riconoscibile_o_una_frase_neutra() {
        let righe: Vec<String> = vec![
            "    user@wp630: Permission denied (publickey,password).".into(),
            "ERROR: ssh fallito (exit 255)".into(),
        ];
        assert!(motivo_ssh(&righe).contains("Permission denied"));
        assert_eq!(motivo_ssh(&[]), "ssh non è riuscito a collegarsi");
    }

    #[test]
    fn il_corpo_rifiuta_campi_sconosciuti_e_ha_la_porta_22_di_default() {
        let b: ProbeBody = serde_json::from_str(r#"{"host":"wp630","user":"user"}"#).unwrap();
        assert_eq!(b.port, 22);
        assert_eq!(b.password, "");
        assert_eq!(b.data_path, "");
        let b: ProbeBody =
            serde_json::from_str(r#"{"host":"h","user":"u","data_path":"/mnt/dati/sws"}"#).unwrap();
        assert_eq!(b.data_path, "/mnt/dati/sws");
        assert!(serde_json::from_str::<ProbeBody>(r#"{"host":"h","user":"u","pw":"x"}"#).is_err());
    }
}
