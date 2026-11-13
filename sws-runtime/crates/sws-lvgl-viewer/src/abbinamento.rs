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

use crate::model::SynopticPage;
use crate::tls::pinned_client_config;

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
    /// The link the pairing QR carries (`<cloud>/#pair=<code>`); absent when
    /// the runtime has no cloud address or no waiting tunnel.
    #[serde(default)]
    pub cloud_link: Option<String>,
}

/// Cosa mostrare al posto della pagina del progetto.
#[derive(Debug, Clone, PartialEq)]
pub enum Schermata {
    /// In attesa: il codice da inserire nell'IDE.
    Codice {
        codice: String,
        nome: String,
        /// The QR content, when there is a cloud to pair with.
        link: Option<String>,
    },
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
        return Some(Schermata::PrimoProgetto {
            cloud: s.cloud.clone().unwrap_or_else(|| s.nome.clone()),
        });
    }
    Some(Schermata::Codice {
        codice: s.codice.clone()?,
        nome: s.nome.clone(),
        link: s.cloud_link.clone().filter(|l| !l.is_empty()),
    })
}

/// La pagina della schermata, 800×480 come la pagina predefinita del viewer.
pub fn pagina_per(s: &Schermata) -> anyhow::Result<SynopticPage> {
    match s {
        Schermata::Codice {
            codice,
            nome,
            link: None,
        } => pagina(codice, nome),
        Schermata::Codice {
            codice,
            nome,
            link: Some(_),
        } => page_with_qr(codice, nome),
        Schermata::PrimoProgetto { cloud } => pagina_primo_progetto(cloud),
    }
}

fn pagina_primo_progetto(cloud: &str) -> anyhow::Result<SynopticPage> {
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

/// Un testo centrato delle due schermate. `alto` è dove comincia il testo: dalla
/// rc.15 un testo senza riquadro ha la `y` sulla linea di base, come sul web
/// (`alla_linea_di_base` in `lvgl_render.rs`), e queste pagine scritte col
/// bordo alto erano salite di un corpo — il codice usciva dalla sua cornice
/// (visto sul Tiny TY il 12-11-2026). L'ascesa di DejaVu Sans è 0,93 corpi.
fn testo(id: &str, alto: u32, h: u32, corpo: u32, colore: &str, t: &str) -> serde_json::Value {
    let base = alto + (corpo as f32 * 0.93).round() as u32;
    serde_json::json!({
        // Con `text_anchor: middle` la `x` è il CENTRO del testo, come in
        // SVG — non il bordo sinistro.
        "id": id, "type": "text", "x": 400, "y": base, "width": 720, "height": h,
        "text": t, "font_size": corpo, "color": colore, "text_anchor": "middle",
    })
}

/// La pagina col codice.
pub fn pagina(codice: &str, nome: &str) -> anyhow::Result<SynopticPage> {
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
            testo("codice", 210, 70, 44, "#f8fafc", codice),
            testo("oppure", 320, 50, 15, "#94a3b8",
                "Oppure apri la pagina di questo pannello dal browser (porta 7443 o 7444)\ne crea lì il suo amministratore."),
            testo("en", 400, 50, 13, "#64748b",
                "Panel waiting to be paired: enter this code in the IDE («Connect») or in the cloud."),
        ],
    });
    Ok(serde_json::from_value(v)?)
}

/// Where the QR goes on the page with QR: the square of the code itself (the
/// white quiet zone around it is a page `rect`, so it shows in snapshots too).
pub const QR_X: i16 = 570;
pub const QR_Y: i16 = 150;
pub const QR_SIZE: i16 = 180;
const QR_MARGIN: u32 = 12;

/// A text centred on `cx`, its top edge at `top` (see [`testo`]).
#[allow(clippy::too_many_arguments)]
fn text_at(
    id: &str,
    cx: u32,
    top: u32,
    w: u32,
    h: u32,
    size: u32,
    color: &str,
    t: &str,
) -> serde_json::Value {
    let mut v = testo(id, top, h, size, color, t);
    v["x"] = cx.into();
    v["width"] = w.into();
    v
}

/// The pairing page when there is a cloud: texts and code on the left, the QR
/// on the right (maintainer's choice, 13-11-2026). The code stays: it is the
/// way in from a local IDE, or when the QR cannot be read.
pub fn page_with_qr(codice: &str, nome: &str) -> anyhow::Result<SynopticPage> {
    let (qx, qy, qs, m) = (QR_X as u32, QR_Y as u32, QR_SIZE as u32, QR_MARGIN);
    let qr_cx = qx + qs / 2;
    let v = serde_json::json!({
        "id": "__abbinamento",
        "name": "abbinamento",
        "background": "#0f172a",
        "width": 800,
        "height": 480,
        "objects": [
            testo("titolo", 30, 40, 26, "#e2e8f0", &format!("Pannello «{nome}» da abbinare")),
            testo("spiega", 80, 60, 16, "#94a3b8",
                "Questo pannello non ha ancora utenti e non lascia entrare nessuno.\nInquadra il QR col telefono, oppure inserisci il codice nell'IDE («Connetti») o nel cloud:"),
            { "id": "riquadro", "type": "rect", "x": 30, "y": 170, "width": 480, "height": 90,
              "fill": "#1e293b", "stroke": "#334155" },
            text_at("codice", 270, 193, 470, 60, 36, "#f8fafc", codice),
            text_at("oppure", 270, 290, 480, 70, 14, "#94a3b8",
                "Oppure apri la pagina di questo pannello dal browser\n(porta 7443 o 7444) e crea lì il suo amministratore."),
            { "id": "qr_fondo", "type": "rect", "x": qx - m, "y": qy - m,
              "width": qs + 2 * m, "height": qs + 2 * m, "fill": "#ffffff", "stroke": "#ffffff" },
            text_at("qr_spiega", qr_cx, qy + qs + m + 10, 240, 30, 14, "#94a3b8",
                "Inquadra col telefono"),
            testo("en", 410, 50, 13, "#64748b",
                "Panel waiting to be paired: scan the QR, or enter this code in the IDE («Connect») or in the cloud."),
        ],
    });
    Ok(serde_json::from_value(v)?)
}

/// Draws the QR of `link` on the active screen, over the white square of
/// [`page_with_qr`]. `lv_qrcode` keeps its own canvas buffer in the LVGL heap
/// (`QR_SIZE`² × 2 bytes, about 63 KB): the page lives only while the panel
/// waits for pairing, when no project is competing for RAM.
pub fn draw_qr(link: &str) {
    let dark: lvgl_sys::lv_color_t = lvgl::Color::from_rgb((0, 0, 0)).into();
    let light: lvgl_sys::lv_color_t = lvgl::Color::from_rgb((255, 255, 255)).into();
    unsafe {
        let qr = lvgl_sys::lv_qrcode_create(
            lvgl_sys::lv_disp_get_scr_act(core::ptr::null_mut()),
            QR_SIZE,
            dark,
            light,
        );
        if qr.is_null() {
            eprintln!("[abbinamento] QR: lv_qrcode_create failed");
            return;
        }
        lvgl_sys::lv_obj_set_pos(qr, QR_X, QR_Y);
        let res = lvgl_sys::lv_qrcode_update(qr, link.as_ptr().cast(), link.len() as u32);
        if res != lvgl_sys::LV_RES_OK as lvgl_sys::lv_res_t {
            eprintln!(
                "[abbinamento] QR: the link does not fit ({} bytes)",
                link.len()
            );
        }
    }
}

/// Controlla lo stato ogni pochi secondi e, appena il pannello non è più in
/// attesa — o la schermata da mostrare cambia (codice → «in attesa del primo
/// progetto», fetta E) — riavvia il viewer con gli stessi argomenti.
pub fn avvia_attesa(rt: tokio::runtime::Handle, base_url: String, mostrata: Schermata) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(5));
        let s = rt.block_on(stato(&base_url));
        if matches!(
            s,
            Some(StatoAbbinamento {
                in_attesa: false,
                ..
            })
        ) {
            eprintln!("[abbinamento] pannello abbinato: riparto sulla pagina del progetto");
            riavvia();
        }
        if s.is_some() && da_mostrare(&s).as_ref() != Some(&mostrata) {
            eprintln!("[abbinamento] la schermata è cambiata: riparto");
            riavvia();
        }
    });
}

/// Il viewer riparte da sé, stessi argomenti. Lo usa anche `riavvio.rs`.
pub(crate) fn riavvia() -> ! {
    use std::os::unix::process::CommandExt as _;
    let exe = std::env::current_exe().unwrap_or_else(|_| "sws-lvgl-viewer".into());
    let errore = std::process::Command::new(exe)
        .args(std::env::args_os().skip(1))
        .exec();
    // `exec` torna solo se fallisce: si esce, e ci pensa systemd a ripartire.
    eprintln!("[abbinamento] riavvio fallito ({errore}): esco");
    std::process::exit(75);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn with_a_link_the_page_keeps_the_code_and_makes_room_for_the_qr() {
        let s = Schermata::Codice {
            codice: "7KQ2-M9XD-3HWP-T4BZ".into(),
            nome: "ty570".into(),
            link: Some("https://sws.soligo.net/#pair=7KQ2-M9XD-3HWP-T4BZ".into()),
        };
        let p = pagina_per(&s).unwrap();
        let id = |n: &str| p.objects.iter().find(|o| o.id.as_deref() == Some(n));
        assert_eq!(
            id("codice").unwrap().text.as_deref(),
            Some("7KQ2-M9XD-3HWP-T4BZ")
        );
        assert!(id("qr_fondo").is_some());
        let no_link = Schermata::Codice {
            codice: "7KQ2-M9XD-3HWP-T4BZ".into(),
            nome: "ty570".into(),
            link: None,
        };
        let p = pagina_per(&no_link).unwrap();
        assert!(!p
            .objects
            .iter()
            .any(|o| o.id.as_deref() == Some("qr_fondo")));
    }

    #[test]
    fn la_pagina_porta_il_codice() {
        let p = pagina("7KQ2-M9XD-3HWP-T4BZ", "tc620").unwrap();
        assert_eq!(p.width, Some(800.0));
        let codice = p
            .objects
            .iter()
            .find(|o| o.id.as_deref() == Some("codice"))
            .unwrap();
        assert_eq!(codice.text.as_deref(), Some("7KQ2-M9XD-3HWP-T4BZ"));
        assert!(p
            .objects
            .iter()
            .any(|o| o.text.as_deref().is_some_and(|t| t.contains("tc620"))));
    }

    #[test]
    fn si_mostra_solo_in_attesa_e_con_un_codice() {
        let s = |a: bool, c: Option<&str>| {
            Some(StatoAbbinamento {
                in_attesa: a,
                codice: c.map(Into::into),
                nome: "x".into(),
                cloud: None,
                abbinato_cloud_senza_utenti: false,
                cloud_link: None,
            })
        };
        assert!(da_mostrare(&s(true, Some("A"))).is_some());
        assert!(da_mostrare(&s(false, Some("A"))).is_none());
        assert!(da_mostrare(&s(true, None)).is_none());
        assert!(
            da_mostrare(&None).is_none(),
            "runtime vecchio: si va avanti"
        );
        let cloud = Some(StatoAbbinamento {
            in_attesa: true,
            codice: None,
            nome: "x".into(),
            cloud: Some("tc620-casa".into()),
            abbinato_cloud_senza_utenti: true,
            cloud_link: None,
        });
        assert_eq!(
            da_mostrare(&cloud),
            Some(Schermata::PrimoProgetto {
                cloud: "tc620-casa".into()
            })
        );
        assert!(pagina_per(&Schermata::PrimoProgetto {
            cloud: "tc620-casa".into()
        })
        .is_ok());
    }
}
