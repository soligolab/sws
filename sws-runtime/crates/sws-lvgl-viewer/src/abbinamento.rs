//! Il pannello **in attesa di abbinamento**, sullo schermo (11-10-2026).
//!
//! Un runtime senza utenti non lascia entrare nessuno (decisione CRA 4, piano
//! `docs/archive/2026-10-11-abbinamento-e-primo-accesso.md`): pagine, tag e
//! allarmi rispondono 401, e il viewer non avrebbe niente da disegnare. Mostra
//! invece il **codice di abbinamento**, grande, con due righe su cosa farne.
//!
//! La schermata è una pagina sinottica costruita qui, in memoria, e passata
//! alla stessa pipeline di ogni altra pagina: niente disegno a parte da tenere
//! allineato, e `--istantanea` la fotografa come qualunque pagina.
//!
//! Finché il pannello è in attesa, un thread richiede lo stato ogni pochi
//! secondi; appena qualcuno ha creato l'amministratore il viewer **si
//! riavvia da sé** (`exec` di sé stesso, stessi argomenti) e riparte come al
//! solito, sulla pagina del progetto.

use std::time::Duration;

use serde::Deserialize;

use crate::tls::pinned_client_config;
use crate::model::SynopticPage;

#[derive(Debug, Clone, Deserialize)]
pub struct StatoAbbinamento {
    pub in_attesa: bool,
    #[serde(default)]
    pub codice: Option<String>,
    #[serde(default)]
    pub nome: String,
    /// Il nome nel cloud, se abbinato.
    #[serde(default)]
    pub cloud: Option<String>,
    /// Abbinato al cloud ma ancora senza utenti (fetta E).
    #[serde(default)]
    pub abbinato_cloud_senza_utenti: bool,
}

/// Cosa mostrare al posto della pagina del progetto.
#[derive(Debug, Clone, PartialEq)]
pub enum Schermata {
    /// In attesa: il codice da inserire nell'IDE.
    Codice { codice: String, nome: String },
    /// Abbinato al cloud, senza utenti: il primo progetto li porterà.
    PrimoProgetto { cloud: String },
}

/// `GET /api/abbinamento`. `None` per un runtime più vecchio (la rotta non
/// c'è) o irraggiungibile: allora si prosegue come sempre.
pub async fn stato(base_url: &str) -> Option<StatoAbbinamento> {
    let url = format!("{}/api/abbinamento", base_url.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .use_preconfigured_tls(pinned_client_config(base_url).ok()?)
        .timeout(Duration::from_secs(5))
        .build()
        .ok()?;
    let r = client.get(url).send().await.ok()?;
    if !r.status().is_success() {
        return None;
    }
    r.json().await.ok()
}

/// La schermata da mostrare, se il pannello è in attesa.
pub fn da_mostrare(s: &Option<StatoAbbinamento>) -> Option<Schermata> {
    let s = s.as_ref()?;
    if !s.in_attesa {
        return None;
    }
    if s.abbinato_cloud_senza_utenti {
        return Some(Schermata::PrimoProgetto { cloud: s.cloud.clone().unwrap_or_else(|| s.nome.clone()) });
    }
    Some(Schermata::Codice { codice: s.codice.clone()?, nome: s.nome.clone() })
}

/// La pagina della schermata, 800×480 come la pagina predefinita del viewer.
pub fn pagina_per(s: &Schermata) -> anyhow::Result<SynopticPage> {
    match s {
        Schermata::Codice { codice, nome } => pagina(codice, nome),
        Schermata::PrimoProgetto { cloud } => pagina_primo_progetto(cloud),
    }
}

fn pagina_primo_progetto(cloud: &str) -> anyhow::Result<SynopticPage> {
    let testo = |id: &str, y: u32, h: u32, corpo: u32, colore: &str, t: &str| {
        serde_json::json!({
            "id": id, "type": "text", "x": 400, "y": y, "width": 720, "height": h,
            "text": t, "font_size": corpo, "color": colore, "text_anchor": "middle",
        })
    };
    let v = serde_json::json!({
        "id": "__abbinamento",
        "name": "abbinamento",
        "background": "#0f172a",
        "width": 800,
        "height": 480,
        "objects": [
            testo("titolo", 150, 50, 28, "#e2e8f0", &format!("Abbinato al cloud come «{cloud}»")),
            testo("spiega", 230, 70, 17, "#94a3b8",
                "In attesa del primo progetto: gli utenti li porterà lui.\nFino ad allora il pannello si gestisce solo dall'IDE nel cloud."),
            testo("en", 400, 50, 13, "#64748b",
                "Paired with the cloud: waiting for the first project, which will bring the users."),
        ],
    });
    Ok(serde_json::from_value(v)?)
}

/// La pagina col codice.
pub fn pagina(codice: &str, nome: &str) -> anyhow::Result<SynopticPage> {
    let testo = |id: &str, y: u32, h: u32, corpo: u32, colore: &str, t: &str| {
        serde_json::json!({
            // Con `text_anchor: middle` la `x` è il CENTRO del testo, come in
            // SVG — non il bordo sinistro.
            "id": id, "type": "text", "x": 400, "y": y, "width": 720, "height": h,
            "text": t, "font_size": corpo, "color": colore, "text_anchor": "middle",
        })
    };
    let v = serde_json::json!({
        "id": "__abbinamento",
        "name": "abbinamento",
        "background": "#0f172a",
        "width": 800,
        "height": 480,
        "objects": [
            testo("titolo", 40, 40, 26, "#e2e8f0", &format!("Pannello «{nome}» da abbinare")),
            testo("spiega", 96, 60, 16, "#94a3b8",
                "Questo pannello non ha ancora utenti e non lascia entrare nessuno.\nInserisci il codice nell'IDE («Connetti») o nel cloud:"),
            { "id": "riquadro", "type": "rect", "x": 100, "y": 180, "width": 600, "height": 110,
              "fill": "#1e293b", "stroke": "#334155" },
            testo("codice", 200, 70, 44, "#f8fafc", codice),
            testo("oppure", 320, 50, 15, "#94a3b8",
                "Oppure apri la pagina di questo pannello dal browser (porta 7443 o 7444)\ne crea lì il suo amministratore."),
            testo("en", 400, 50, 13, "#64748b",
                "Panel waiting to be paired: enter this code in the IDE («Connect») or in the cloud."),
        ],
    });
    Ok(serde_json::from_value(v)?)
}

/// Controlla lo stato ogni pochi secondi e, appena il pannello non è più in
/// attesa — o la schermata da mostrare cambia (codice → «in attesa del primo
/// progetto», fetta E) — riavvia il viewer con gli stessi argomenti.
pub fn avvia_attesa(rt: tokio::runtime::Handle, base_url: String, mostrata: Schermata) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(5));
        let s = rt.block_on(stato(&base_url));
        if matches!(s, Some(StatoAbbinamento { in_attesa: false, .. })) {
            eprintln!("[abbinamento] pannello abbinato: riparto sulla pagina del progetto");
            riavvia();
        }
        if s.is_some() && da_mostrare(&s).as_ref() != Some(&mostrata) {
            eprintln!("[abbinamento] la schermata è cambiata: riparto");
            riavvia();
        }
    });
}

fn riavvia() -> ! {
    use std::os::unix::process::CommandExt as _;
    let exe = std::env::current_exe().unwrap_or_else(|_| "sws-lvgl-viewer".into());
    let errore = std::process::Command::new(exe).args(std::env::args_os().skip(1)).exec();
    // `exec` torna solo se fallisce: si esce, e ci pensa systemd a ripartire.
    eprintln!("[abbinamento] riavvio fallito ({errore}): esco");
    std::process::exit(75);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_pagina_porta_il_codice() {
        let p = pagina("7KQ2-M9XD-3HWP-T4BZ", "tc620").unwrap();
        assert_eq!(p.width, Some(800.0));
        let codice = p.objects.iter().find(|o| o.id.as_deref() == Some("codice")).unwrap();
        assert_eq!(codice.text.as_deref(), Some("7KQ2-M9XD-3HWP-T4BZ"));
        assert!(p.objects.iter().any(|o| o.text.as_deref().is_some_and(|t| t.contains("tc620"))));
    }

    #[test]
    fn si_mostra_solo_in_attesa_e_con_un_codice() {
        let s = |a: bool, c: Option<&str>| Some(StatoAbbinamento {
            in_attesa: a,
            codice: c.map(Into::into),
            nome: "x".into(),
            cloud: None,
            abbinato_cloud_senza_utenti: false,
        });
        assert!(da_mostrare(&s(true, Some("A"))).is_some());
        assert!(da_mostrare(&s(false, Some("A"))).is_none());
        assert!(da_mostrare(&s(true, None)).is_none());
        assert!(da_mostrare(&None).is_none(), "runtime vecchio: si va avanti");
        let cloud = Some(StatoAbbinamento {
            in_attesa: true,
            codice: None,
            nome: "x".into(),
            cloud: Some("tc620-casa".into()),
            abbinato_cloud_senza_utenti: true,
        });
        assert_eq!(da_mostrare(&cloud), Some(Schermata::PrimoProgetto { cloud: "tc620-casa".into() }));
        assert!(pagina_per(&Schermata::PrimoProgetto { cloud: "tc620-casa".into() }).is_ok());
    }
}
