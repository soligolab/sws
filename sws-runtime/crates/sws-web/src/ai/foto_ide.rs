//! L'istantanea di un progetto **web**: la fa il browser dell'IDE collegato
//! alla chat, con lo stesso `SvgCanvas` dell'editor.
//!
//! # Perché non il viewer LVGL, per questi progetti
//!
//! Decisione del maintainer del 10-11-2026: `istantanea_pagina` fotografa la
//! pagina **con il motore del progetto**. Fino ad allora la foto la faceva
//! sempre il viewer LVGL (`crate::istantanea`), anche per i progetti col motore
//! «Web (browser)»: il modello giudicava un disegno che l'utente non avrebbe
//! mai visto, con altri font, altri colori (RGB565) e altri limiti. E nel cloud,
//! dove l'immagine x86_64 non porta il viewer, la foto non funzionava affatto.
//!
//! Il motore web **è** il browser: l'unico posto dove disegnarlo fedelmente è
//! una finestra dell'IDE. La chat è già lì, col suo WebSocket.
//!
//! # Il giro
//!
//! 1. Il server compone **quello che vede il modello** — la pagina intera (da
//!    `pagina`, dalla tavola delle bozze, o letta dal disco come la legge
//!    `leggi_pagina`), le bozze `prj:` compilate, gli sfondi del banco che la
//!    pagina usa, i faceplate (disco + predefiniti, con sopra quelli proposti)
//!    — e lo manda alla chat nel frame `fotografa`.
//! 2. Il browser disegna con `boot/rasterizza.ts` e risponde col frame `foto`
//!    (`png` in base64, o `errore`). Se la chat è staccata, la foto la fa la
//!    finestra dell'editor via ponte, che ha lo store del progetto.
//! 3. Il server aspetta al massimo [`ATTESA_FOTO`]: a tempo scaduto un errore
//!    che dice al modello (e alla persona) cosa manca.
//!
//! # Perché un lettore a parte in `sessione`
//!
//! Il turno gira **dentro** il ciclo che legge il socket: mentre il modello
//! aspetta la foto, nessuno leggerebbe la risposta. Quindi in `sessione` un
//! compito legge il socket, consegna qui i frame `foto` e passa al ciclo tutto
//! il resto, nello stesso ordine di prima.
//!
//! # Perché un `task_local` e non un argomento in più
//!
//! L'istantanea si chiede tre livelli sotto `sessione` (`vero_giro` →
//! `istantanea_per_il_modello`), e il filo verso l'IDE esiste solo lì. Un
//! argomento in più avrebbe cambiato la firma di `vero_giro` e `finto_giro`
//! per uno strumento solo; [`IDE`] vale per la durata del turno, e chi gira
//! fuori da una chat (un test, un futuro chiamante) lo trova vuoto e riceve
//! l'errore che dice «serve l'IDE aperto».

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::Engine as _;
use serde_json::{json, Value};
use tokio::sync::{mpsc, oneshot};

/// Quanto si aspetta la foto dal browser. Una pagina con cinque sfondi JPEG si
/// disegna in qualche secondo; un minuto è il segno che dall'altra parte non
/// c'è nessuno (chat chiusa, scheda congelata).
pub(crate) const ATTESA_FOTO: Duration = Duration::from_secs(60);

/// Quello che il browser rimanda.
#[derive(Debug)]
pub(crate) struct Foto {
    pub png: Vec<u8>,
    pub larghezza: u32,
    pub altezza: u32,
    /// Ciò che il PNG non contiene e il browser lo sa (un `<foreignObject>`
    /// tolto, un'immagine di un altro sito): va al modello come le note del
    /// viewer LVGL.
    pub avvisi: Vec<String>,
}

type Attesa = oneshot::Sender<Result<Foto, String>>;

/// Il filo verso l'IDE di una conversazione: chi manda i frame alla chat, e le
/// foto chieste che aspettano risposta.
#[derive(Clone)]
pub(crate) struct Ide {
    tx: mpsc::UnboundedSender<String>,
    attese: Arc<Mutex<HashMap<String, Attesa>>>,
}

tokio::task_local! {
    /// L'IDE della conversazione in corso: lo mette `sessione` attorno al turno.
    pub(crate) static IDE: Ide;
}

static PROSSIMA: AtomicU64 = AtomicU64::new(1);

impl Ide {
    pub(crate) fn nuovo(tx: mpsc::UnboundedSender<String>) -> Self {
        Ide {
            tx,
            attese: Default::default(),
        }
    }

    /// Se `testo` è un frame `foto`, lo consegna a chi lo aspetta e dice `true`
    /// (anche quando nessuno lo aspetta più: una foto arrivata dopo la
    /// scadenza non è un messaggio per il ciclo).
    pub(crate) fn consegna_se_foto(&self, testo: &str) -> bool {
        // Un controllo da poco prima di analizzare: ogni frame passa di qui.
        if !testo.contains("\"foto\"") {
            return false;
        }
        let Ok(v) = serde_json::from_str::<Value>(testo) else {
            return false;
        };
        if v.get("t").and_then(Value::as_str) != Some("foto") {
            return false;
        }
        let id = v.get("id").and_then(Value::as_str).unwrap_or("");
        let attesa = self.attese.lock().ok().and_then(|mut a| a.remove(id));
        if let Some(a) = attesa {
            let _ = a.send(leggi_foto(&v));
        } else {
            tracing::debug!(target: "sws_ai", id, "foto arrivata senza nessuno che la aspetti");
        }
        true
    }

    /// Il socket è chiuso: chi aspetta una foto lo sa subito invece di
    /// aspettare il minuto intero.
    pub(crate) fn chiudi(&self) {
        if let Ok(mut a) = self.attese.lock() {
            a.clear();
        }
    }

    /// Manda la richiesta e aspetta la foto, al massimo `attesa`.
    pub(crate) async fn chiedi(
        &self,
        mut richiesta: Value,
        attesa: Duration,
    ) -> Result<Foto, String> {
        let id = format!("foto-{}", PROSSIMA.fetch_add(1, Ordering::Relaxed));
        let (o_tx, o_rx) = oneshot::channel();
        if let Ok(mut a) = self.attese.lock() {
            a.insert(id.clone(), o_tx);
        }
        richiesta["t"] = json!("fotografa");
        richiesta["id"] = json!(id);
        let togli = || {
            if let Ok(mut a) = self.attese.lock() {
                a.remove(&id);
            }
        };
        if self.tx.send(richiesta.to_string()).is_err() {
            togli();
            return Err("la chat non è più collegata: nessun IDE può fotografare la pagina".into());
        }
        match tokio::time::timeout(attesa, o_rx).await {
            Ok(Ok(esito)) => esito,
            Ok(Err(_)) => {
                Err("la chat si è scollegata prima che l'IDE fotografasse la pagina".into())
            }
            Err(_) => {
                togli();
                Err(format!(
                    "nessun IDE collegato ha fotografato la pagina entro {} s. In un progetto web \
                     la foto la fa il browser dell'IDE dove la chat è aperta (la finestra \
                     dell'editor, se la chat è staccata): controlla che sia aperto e non sospeso, \
                     poi riprova.",
                    attesa.as_secs()
                ))
            }
        }
    }
}

/// Il frame `foto` → la foto, o l'errore che il browser ha mandato.
fn leggi_foto(v: &Value) -> Result<Foto, String> {
    if let Some(e) = v.get("errore").and_then(Value::as_str) {
        return Err(format!(
            "il browser dell'IDE non è riuscito a fotografare la pagina: {e}"
        ));
    }
    let b64 = v
        .get("png")
        .and_then(Value::as_str)
        .ok_or("il browser ha risposto senza l'immagine")?;
    let png = base64::engine::general_purpose::STANDARD
        .decode(b64.trim())
        .map_err(|e| format!("l'immagine del browser non è base64 valido: {e}"))?;
    let (larghezza, altezza) = misura_png(&png)?;
    let avvisi = v
        .get("avvisi")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    Ok(Foto {
        png,
        larghezza,
        altezza,
        avvisi,
    })
}

/// Larghezza e altezza dall'intestazione IHDR. Un'immagine che non è un PNG
/// arriverebbe al modello come un errore dell'API, senza dire perché.
fn misura_png(png: &[u8]) -> Result<(u32, u32), String> {
    if png.len() < 24 || &png[..8] != b"\x89PNG\r\n\x1a\n" || &png[12..16] != b"IHDR" {
        return Err("il browser ha mandato qualcosa che non è un PNG".into());
    }
    let n = |i: usize| u32::from_be_bytes([png[i], png[i + 1], png[i + 2], png[i + 3]]);
    Ok((n(16), n(20)))
}

/// Il progetto in `dir` si disegna col motore web? Assente = web, come per
/// ogni progetto nato prima del campo `target`. Un progetto che non si legge
/// resta sul percorso di prima (il viewer LVGL), che sa dire perché.
pub(crate) fn motore_web(dir: &std::path::Path) -> bool {
    use sws_core::ProjectTargetKind as K;
    match sws_core::Project::load(dir) {
        Ok(p) => !matches!(
            p.target.map(|t| t.kind),
            Some(K::LvglFramebuffer | K::LvglWayland)
        ),
        Err(_) => false,
    }
}

/// Fotografa col browser dell'IDE e impacchetta per il modello.
pub(crate) async fn istantanea(
    dir: &std::path::Path,
    input: &Value,
    banco: &super::Banco,
) -> Result<Value, String> {
    istantanea_con(dir, input, banco, ATTESA_FOTO).await
}

pub(crate) async fn istantanea_con(
    dir: &std::path::Path,
    input: &Value,
    banco: &super::Banco,
    attesa: Duration,
) -> Result<Value, String> {
    let ide = IDE.try_with(Ide::clone).map_err(|_| {
        "questo progetto si disegna col motore web, e la sua foto la fa il browser dell'IDE: \
         serve l'IDE aperto con la chat dell'assistente. Da qui non c'è nessun IDE collegato."
            .to_string()
    })?;
    let richiesta = richiesta(dir, input, banco).await?;
    let foto = ide.chiedi(richiesta, attesa).await?;
    Ok(blocchi(&foto, input))
}

/// Il frame `fotografa`, senza `t` e `id` (li mette [`Ide::chiedi`]).
pub(crate) async fn richiesta(
    dir: &std::path::Path,
    input: &Value,
    banco: &super::Banco,
) -> Result<Value, String> {
    let pagina = pagina_da_fotografare(dir, input, banco).await?;
    let testo_pagina = pagina.to_string();

    // Le bozze compilate: il browser non ha il compilatore, e il modello le
    // vede già così (`valida` e la tavola).
    let simboli: Vec<Value> = banco
        .simboli
        .iter()
        .filter_map(|d| sws_core::simboli_prj::compila_e_controlla(d).ok())
        .map(|c| json!({ "voce": c.voce, "svg": c.svg }))
        .collect();

    // Solo gli sfondi che la pagina usa: possono essere megabyte l'uno.
    let sfondi: Vec<Value> = banco
        .sfondi
        .iter()
        .filter(|f| testo_pagina.contains(&f.src()))
        .map(|f| {
            json!({ "src": f.src(),
                    "jpg": base64::engine::general_purpose::STANDARD.encode(&f.jpg) })
        })
        .collect();

    // I faceplate come li vede il modello: quelli del disco e i predefiniti,
    // con sopra quelli che sta proponendo.
    let mut faceplates: Vec<crate::synoptic::FaceplateDef> =
        crate::router::faceplate_disponibili(dir)
            .await
            .into_iter()
            .map(|(f, _)| f)
            .collect();
    for p in super::tools::faceplate_proposti(input)? {
        match faceplates.iter().position(|f| f.id == p.id) {
            Some(i) => faceplates[i] = p,
            None => faceplates.push(p),
        }
    }

    let misura = |k: &str, d: u64| {
        pagina
            .get(k)
            .and_then(Value::as_f64)
            .map(|x| x.round() as u64)
            .unwrap_or(d)
    };
    Ok(json!({
        "pagina": pagina,
        "simboli": simboli,
        "sfondi": sfondi,
        "faceplates": faceplates,
        "misura": { "larghezza": misura("width", 1280), "altezza": misura("height", 800) },
    }))
}

/// La pagina intera che il modello sta guardando: quella che passa lui, la
/// tavola delle bozze, o quella sul disco col nome chiesto (per nome o per
/// id, come `leggi_pagina`), o la pagina iniziale del progetto.
async fn pagina_da_fotografare(
    dir: &std::path::Path,
    input: &Value,
    banco: &super::Banco,
) -> Result<Value, String> {
    if let Some(p) = input.get("pagina").filter(|p| p.is_object()) {
        return Ok(p.clone());
    }
    let nome = input.get("nome").and_then(Value::as_str);
    if nome.is_none() && !banco.simboli.is_empty() {
        return Ok(super::tavola_delle_bozze(&banco.simboli));
    }
    let pagine = pagine_in(dir).await;
    let scelta = match nome {
        Some(n) => pagine
            .iter()
            .find(|p| p.name == n)
            .or_else(|| pagine.iter().find(|p| p.id == n))
            .ok_or_else(|| {
                format!(
                    "la pagina `{n}` non esiste. Ci sono (nome — id): {}",
                    pagine
                        .iter()
                        .map(|p| format!("{} — {}", p.name, p.id))
                        .collect::<Vec<_>>()
                        .join(", ")
                )
            })?,
        None => {
            let home = sws_core::Project::load(dir)
                .ok()
                .and_then(|p| p.page_layout)
                .and_then(|l| l.home_page_id);
            home.and_then(|h| pagine.iter().find(|p| p.id == h))
                .or_else(|| {
                    pagine
                        .iter()
                        .find(|p| p.kind.is_none() && p.finestra.is_none())
                })
                .or(pagine.first())
                .ok_or("il progetto non ha pagine da fotografare")?
        }
    };
    serde_json::to_value(scelta).map_err(|e| e.to_string())
}

/// Le pagine sul disco di `dir`, come le legge `leggi_pagina`
/// (`tools::carica_pagine`, che però parte dal progetto aperto).
async fn pagine_in(dir: &std::path::Path) -> Vec<crate::synoptic::SynopticPage> {
    let mut out = Vec::new();
    let Ok(mut entries) = tokio::fs::read_dir(crate::router::synoptics_dir_at(dir)).await else {
        return out;
    };
    while let Ok(Some(e)) = entries.next_entry().await {
        let path = e.path();
        if path.extension().and_then(|x| x.to_str()) != Some("yaml") {
            continue;
        }
        if let Ok(testo) = tokio::fs::read_to_string(&path).await {
            if let Ok(p) = serde_yaml::from_str(&testo) {
                out.push(p);
            }
        }
    }
    out.sort_by(|a: &crate::synoptic::SynopticPage, b| a.name.cmp(&b.name));
    out
}

/// I blocchi `tool_result`: l'immagine e la riga di testo, come per LVGL.
pub(crate) fn blocchi(foto: &Foto, input: &Value) -> Value {
    let mut testo = format!(
        "Istantanea web (il browser dell'IDE, lo stesso SvgCanvas dell'editor): {}x{} px.",
        foto.larghezza, foto.altezza
    );
    if input.get("tocca").and_then(Value::as_str).is_some() {
        testo.push_str(
            " I tocchi (`tocca`) NON sono stati eseguiti: col motore web la foto è della pagina \
             ferma.",
        );
    }
    if foto.avvisi.is_empty() {
        testo.push_str(" Il browser non ha segnalato nulla.");
    } else {
        testo.push_str(" Il browser ha detto:\n");
        for a in &foto.avvisi {
            testo.push_str("  ");
            testo.push_str(a);
            testo.push('\n');
        }
    }
    json!([
        { "type": "image", "source": {
            "type": "base64", "media_type": "image/png",
            "data": base64::engine::general_purpose::STANDARD.encode(&foto.png) } },
        { "type": "text", "text": testo },
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Un PNG vero 3×2, fatto col codificatore che usa già il viewer.
    fn png_3x2() -> Vec<u8> {
        let mut out = Vec::new();
        {
            let mut enc = png::Encoder::new(&mut out, 3, 2);
            enc.set_color(png::ColorType::Rgb);
            enc.set_depth(png::BitDepth::Eight);
            let mut w = enc.write_header().unwrap();
            w.write_image_data(&[200u8; 18]).unwrap();
        }
        out
    }

    fn progetto(dir: &std::path::Path, target: Option<&str>) {
        let t = target
            .map(|k| format!("target:\n  kind: {k}\n"))
            .unwrap_or_default();
        std::fs::write(
            dir.join("project.yaml"),
            format!("meta:\n  name: foto\n  version: \"1\"\ntags: []\nsources: []\n{t}"),
        )
        .unwrap();
        std::fs::create_dir_all(dir.join("synoptics")).unwrap();
        std::fs::write(
            dir.join("synoptics/Prova.yaml"),
            "id: pv\nname: Prova\nwidth: 480\nheight: 272\nobjects:\n\
             - { id: r1, type: rect, x: 40, y: 40, width: 200, height: 100, fill: \"#3b82f6\" }\n",
        )
        .unwrap();
    }

    fn bozza() -> sws_core::simboli_prj::Descrizione {
        serde_json::from_str(include_str!(
            "../../../../../tests/fixtures/simboli-prj/gabbia-laminazione.json"
        ))
        .unwrap()
    }

    /// Il motore si legge da `target`: assente o web → browser; LVGL → viewer.
    #[test]
    fn il_motore_si_legge_dal_progetto() {
        for (target, web) in [
            (None, true),
            (Some("web"), true),
            (Some("lvgl_wayland"), false),
            (Some("lvgl_framebuffer"), false),
        ] {
            let d = tempfile::tempdir().unwrap();
            progetto(d.path(), target);
            assert_eq!(motore_web(d.path()), web, "target {target:?}");
        }
        // Un progetto che non si legge resta sul percorso di prima.
        let vuota = tempfile::tempdir().unwrap();
        assert!(!motore_web(vuota.path()));
    }

    /// **Il giro intero.** Il server chiede la foto alla chat con la pagina
    /// del modello, le bozze `prj:` compilate e lo sfondo del banco; il
    /// «browser» risponde e il modello riceve l'immagine con le sue misure.
    #[tokio::test]
    async fn il_server_chiede_la_foto_all_ide_e_la_consegna_al_modello() {
        let d = tempfile::tempdir().unwrap();
        progetto(d.path(), None);
        let mut banco = super::super::Banco::default();
        banco.metti(bozza());
        banco.sfondi.push(super::super::immagini::Sfondo {
            id: "sfondo-1".into(),
            jpg: vec![0xff, 0xd8, 0xff, 0xe0],
            da: None,
            luce: None,
            approvata: false,
        });
        banco.sfondi.push(super::super::immagini::Sfondo {
            id: "sfondo-2".into(),
            jpg: vec![1, 2, 3],
            da: None,
            luce: None,
            approvata: false,
        });
        let input = json!({ "pagina": { "id": "nuova", "name": "Nuova", "width": 640, "height": 400,
            "sfondo_immagine": "/api/project/images/ai-sfondo-1.jpg",
            "objects": [{ "id": "g", "type": "symbol", "symbol_id": "prj:gabbia-laminazione",
                          "x": 10, "y": 10, "width": 120, "height": 100 }] },
            "tocca": "10,10" });

        let (tx, mut rx) = mpsc::unbounded_channel::<String>();
        let ide = Ide::nuovo(tx);
        let browser = {
            let ide = ide.clone();
            tokio::spawn(async move {
                let frame: Value = serde_json::from_str(&rx.recv().await.unwrap()).unwrap();
                let risposta = json!({ "t": "foto", "id": frame["id"],
                    "png": base64::engine::general_purpose::STANDARD.encode(png_3x2()),
                    "avvisi": ["1 immagine esterna tolta"] });
                assert!(ide.consegna_se_foto(&risposta.to_string()));
                frame
            })
        };
        let blocchi = IDE
            .scope(
                ide.clone(),
                istantanea_con(d.path(), &input, &banco, Duration::from_secs(5)),
            )
            .await
            .expect("la foto deve arrivare");
        let frame = browser.await.unwrap();

        assert_eq!(frame["t"], "fotografa");
        assert_eq!(
            frame["pagina"]["id"], "nuova",
            "la pagina del modello, non il disco"
        );
        assert_eq!(frame["misura"], json!({ "larghezza": 640, "altezza": 400 }));
        let simboli = frame["simboli"].as_array().unwrap();
        assert_eq!(simboli.len(), 1);
        assert_eq!(simboli[0]["voce"]["id"], "prj:gabbia-laminazione");
        assert!(simboli[0]["svg"].as_str().unwrap().starts_with("<svg"));
        let sfondi = frame["sfondi"].as_array().unwrap();
        assert_eq!(
            sfondi.len(),
            1,
            "solo lo sfondo che la pagina usa: {sfondi:?}"
        );
        assert_eq!(sfondi[0]["src"], "/api/project/images/ai-sfondo-1.jpg");
        assert!(
            frame["faceplates"]
                .as_array()
                .is_some_and(|a| !a.is_empty()),
            "i faceplate predefiniti viaggiano col frame"
        );

        assert_eq!(blocchi[0]["type"], "image");
        assert_eq!(blocchi[0]["source"]["media_type"], "image/png");
        let t = blocchi[1]["text"].as_str().unwrap();
        assert!(t.contains("Istantanea web") && t.contains("3x2"), "{t}");
        assert!(t.contains("immagine esterna tolta"), "{t}");
        assert!(t.contains("NON sono stati eseguiti"), "{t}");
    }

    /// Senza `pagina`, col nome: la pagina sul disco, per nome o per id.
    #[tokio::test]
    async fn col_nome_si_fotografa_la_pagina_del_disco() {
        let d = tempfile::tempdir().unwrap();
        progetto(d.path(), None);
        let banco = super::super::Banco::default();
        for nome in ["Prova", "pv"] {
            let r = richiesta(d.path(), &json!({ "nome": nome }), &banco)
                .await
                .unwrap();
            assert_eq!(r["pagina"]["id"], "pv");
            assert_eq!(r["misura"], json!({ "larghezza": 480, "altezza": 272 }));
        }
        // Senza nome: la prima pagina vera, in mancanza della pagina iniziale.
        let r = richiesta(d.path(), &json!({}), &banco).await.unwrap();
        assert_eq!(r["pagina"]["id"], "pv");
        let e = richiesta(d.path(), &json!({ "nome": "Manca" }), &banco)
            .await
            .unwrap_err();
        assert!(e.contains("Prova — pv"), "{e}");
    }

    /// Nessuno risponde: a tempo scaduto l'errore dice cosa manca.
    #[tokio::test]
    async fn senza_risposta_scade_con_l_errore_giusto() {
        let (tx, _rx) = mpsc::unbounded_channel::<String>();
        let ide = Ide::nuovo(tx);
        let e = ide
            .chiedi(json!({}), Duration::from_millis(50))
            .await
            .unwrap_err();
        assert!(
            e.contains("nessun IDE collegato ha fotografato la pagina"),
            "{e}"
        );
        assert!(
            ide.attese.lock().unwrap().is_empty(),
            "l'attesa scaduta va tolta"
        );
    }

    /// Fuori da una chat (nessun `IDE` nel turno) il progetto web non si
    /// fotografa, e lo si dice.
    #[tokio::test]
    async fn senza_ide_lo_dice() {
        let d = tempfile::tempdir().unwrap();
        progetto(d.path(), None);
        let e = istantanea(d.path(), &json!({}), &super::super::Banco::default())
            .await
            .unwrap_err();
        assert!(e.contains("serve l'IDE aperto"), "{e}");
    }

    /// Il socket si chiude mentre si aspetta: niente minuto intero.
    #[tokio::test]
    async fn la_chat_che_si_chiude_sblocca_l_attesa() {
        let (tx, _rx) = mpsc::unbounded_channel::<String>();
        let ide = Ide::nuovo(tx);
        let chi = ide.clone();
        let attesa = tokio::spawn(async move { chi.chiedi(json!({}), ATTESA_FOTO).await });
        tokio::time::sleep(Duration::from_millis(20)).await;
        ide.chiudi();
        let e = tokio::time::timeout(Duration::from_secs(2), attesa)
            .await
            .expect("l'attesa deve finire subito")
            .unwrap()
            .unwrap_err();
        assert!(e.contains("scollegata"), "{e}");
    }

    /// Le risposte storte diventano errori leggibili, e i frame che non sono
    /// `foto` passano al ciclo.
    #[test]
    fn le_risposte_storte_sono_errori() {
        assert!(leggi_foto(&json!({ "errore": "toBlob" }))
            .unwrap_err()
            .contains("toBlob"));
        assert!(leggi_foto(&json!({ "png": "bm9u" }))
            .unwrap_err()
            .contains("non è un PNG"));
        let (tx, _rx) = mpsc::unbounded_channel::<String>();
        let ide = Ide::nuovo(tx);
        assert!(!ide.consegna_se_foto(r#"{"t":"chiedi","testo":"una foto"}"#));
        assert!(ide.consegna_se_foto(r#"{"t":"foto","id":"nessuno"}"#));
    }
}
