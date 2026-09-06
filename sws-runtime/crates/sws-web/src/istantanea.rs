//! L'istantanea di una pagina: come il motore **LVGL** la disegna davvero.
//!
//! # A cosa serve
//!
//! Il motore LVGL e quello del browser disegnano lo stesso progetto in due modi
//! diversi, e le differenze si scoprivano solo andando fisicamente davanti a un
//! dispositivo — spesso settimane dopo averle introdotte. Il 2026-08-31, con
//! `sws-lvgl-viewer --istantanea` usato a mano, sono venuti fuori nove difetti
//! in una giornata, sette dei quali non davano **nessun** segnale altrove.
//!
//! Questo modulo rende quel gesto una cosa che il runtime sa fare da sé, così
//! l'assistente può **guardare** quello che ha disegnato invece di dichiararlo
//! fatto (fase 3 di `docs/plans/2026-08-31-chat-ai-nelleditor.md`).
//!
//! # Perché serve un banco di prova, e non basta il runtime che sta girando
//!
//! Il viewer LVGL legge il progetto da un runtime vivo (`--base-url`), e quella
//! URL deve essere una **porta viewer**. L'IDE dove si chatta però gira di
//! norma sull'**editor**, che per definizione non ha un viewer
//! (`start_editor.sh`), e dalla 2.4.0 i deploy partono con `--no-admin`, quindi
//! sul dispositivo l'IDE non c'è più affatto: appoggiarsi al viewer «di questo
//! processo» avrebbe prodotto uno strumento che funziona solo in una
//! configurazione che non si spedisce.
//!
//! Quindi si avvia un runtime **usa e getta**: una copia del progetto in una
//! directory temporanea, porte libere, il tempo di scattare, e via. Costa un
//! paio di secondi e in cambio funziona in tutte le configurazioni — e apre la
//! strada a fotografare una modifica **non ancora applicata**, che è il motivo
//! per cui il piano lo chiedeva (§4.4).
//!
//! # Due cose imparate provando, che ingannerebbero chi guarda
//!
//! - **I colori tornano quantizzati.** LVGL lavora in RGB565, quindi un
//!   `#3b82f6` esce come `rgb(57,129,246)`. Confrontare i colori esatti fa
//!   concludere che il rendering è sbagliato quando è corretto.
//! - **Un'istantanea presa troppo presto coglie una pagina a metà.** LVGL
//!   disegna dentro `task_handler()` e widget come il gauge o i grafici hanno
//!   bisogno di più di un giro; il default di 500 ms copre una pagina piena, ma
//!   con i tocchi va alzato perché si distribuiscono nel tempo disponibile.
//!
//! # `ms` è tempo LVGL **simulato**, non un'attesa
//!
//! Va scritto perché mi ha ingannato per tre misure: il ciclo dello scatto fa
//! `task_handler()` e poi `tick_inc(PASSO_MS)`, cioè avanza l'orologio di LVGL
//! a passi senza dormire. 600 ms di tempo LVGL costano ~145 ms di orologio, e
//! 3000 ms ne costano ~290: il costo cresce col lavoro da disegnare, non col
//! numero. Chiedere 2000 ms non fa quindi aspettare due secondi.
//!
//! Ne segue una proprietà comoda: **le fasi sono deterministiche**. Un blink o
//! un'animazione, allo stesso `ms`, si fotografano sempre nello stesso punto —
//! due istantanee della stessa pagina sono confrontabili.

use std::path::{Path, PathBuf};
use std::time::Duration;

/// Cosa fotografare.
pub struct Richiesta {
    /// La directory del progetto da fotografare. Viene **copiata**: il banco di
    /// prova non tocca mai l'originale, e una modifica proposta si fotografa
    /// scrivendola nella copia.
    pub progetto: PathBuf,
    /// La pagina da cui partire. `None` = quella iniziale del progetto, come
    /// fa il viewer vero.
    pub pagina: Option<String>,
    /// Tocchi da fare prima dello scatto, `x,y` separati da `;` — le stesse
    /// coordinate che si leggono nell'IDE.
    pub tocca: Option<String>,
    /// Millisecondi di rendering prima dello scatto.
    pub ms: Option<u64>,
}

/// Lo scatto.
pub struct Scatto {
    pub png: Vec<u8>,
    pub larghezza: u32,
    pub altezza: u32,
    /// Quello che il viewer ha stampato: i comandi che i tocchi hanno prodotto,
    /// le pagine richieste, gli avvisi di rendering.
    ///
    /// Non è decorazione: un pulsante che apre la finestra giusta e poi scrive
    /// il valore sbagliato, **in una fotografia, sembrerebbe funzionare**.
    pub note: Vec<String>,
}

/// Quanto si aspetta il runtime del banco di prova prima di rinunciare.
const ATTESA_RUNTIME: Duration = Duration::from_secs(20);
/// Quanto si concede al viewer per disegnare e uscire. Generoso rispetto ai
/// 500 ms di rendering: la prima volta deve anche caricare il progetto via
/// HTTP, e su un dispositivo lento non è istantaneo.
const ATTESA_VIEWER: Duration = Duration::from_secs(60);

/// Scatta. Errori come `Err(String)` leggibile: finiscono davanti al modello e
/// all'utente, non in un log.
pub async fn scatta(r: Richiesta) -> Result<Scatto, String> {
    let (runtime_bin, viewer_bin) = binari()?;

    let tmp = tempfile::tempdir()
        .map_err(|e| format!("non riesco a creare la directory di prova: {e}"))?;
    let radice = tmp.path().join("projects");
    let nome = r
        .progetto
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "progetto".into());
    let copia = radice.join(&nome);
    copia_progetto(&r.progetto, &copia).await?;

    let porta = porta_libera()?;

    // `kill_on_drop`: qualunque cosa vada storta sotto, il runtime di prova
    // muore con questa funzione. Senza, un errore a metà lascerebbe un processo
    // in ascolto su una porta casuale, e nessuno saprebbe che c'è.
    let mut figlio = tokio::process::Command::new(&runtime_bin)
        .arg("--config").arg(tmp.path().join("config"))
        .arg("--projects-root").arg(&radice)
        .arg("--project").arg(&copia)
        .arg("--viewer-port").arg(porta.to_string())
        // Anche l'admin va spostato: il default è 8444, cioè la porta di chi ci
        // ha chiamato, e il banco di prova non deve rubargliela.
        .arg("--admin-port").arg(porta_libera()?.to_string())
        .env("RUST_LOG", "warn")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("non riesco ad avviare il runtime di prova: {e}"))?;

    attendi_salute(porta, &mut figlio).await?;

    let base = format!("http://127.0.0.1:{porta}");
    let ppm = tmp.path().join("scatto.ppm");
    let mut cmd = tokio::process::Command::new(&viewer_bin);
    cmd.arg("--base-url").arg(&base)
        .arg("--istantanea").arg(&ppm)
        .arg("--istantanea-ms").arg(r.ms.unwrap_or(500).clamp(50, 10_000).to_string());
    if let Some(p) = &r.pagina {
        cmd.arg("--page").arg(p);
    }
    if let Some(t) = &r.tocca {
        cmd.arg("--tocca").arg(t);
    }
    let uscita = tokio::time::timeout(ATTESA_VIEWER, cmd.output())
        .await
        .map_err(|_| {
            format!("il viewer non ha finito entro {} s", ATTESA_VIEWER.as_secs())
        })?
        .map_err(|e| format!("non riesco ad avviare il viewer LVGL: {e}"))?;

    if !uscita.status.success() {
        let err = String::from_utf8_lossy(&uscita.stderr);
        return Err(format!(
            "il viewer LVGL è uscito con errore ({}). Ultime righe:\n{}",
            uscita.status,
            ultime_righe(&err, 8)
        ));
    }

    let grezzo = tokio::fs::read(&ppm)
        .await
        .map_err(|e| format!("il viewer non ha prodotto l'immagine: {e}"))?;
    let (larghezza, altezza, pixel) = leggi_ppm(&grezzo)?;
    let png = a_png(larghezza, altezza, pixel)?;

    Ok(Scatto {
        png,
        larghezza,
        altezza,
        note: note_utili(&String::from_utf8_lossy(&uscita.stderr)),
    })
}

/// I due binari che servono: il runtime (per il banco di prova) e il viewer
/// LVGL, che stanno **nella stessa directory** — `target/debug/` in sviluppo,
/// `/usr/local/bin/` nel container, dove `COPY bin/` li mette entrambi.
///
/// # Perché per nome e non `current_exe()` per il runtime
///
/// `current_exe()` è il runtime solo quando questo codice gira dentro il
/// runtime. Dentro un test è il binario del test, che avviato con
/// `--viewer-port` non è un runtime: cercarlo per nome rende l'orchestrazione
/// verificabile invece di lasciarla come l'unico pezzo mai provato. Per la
/// stessa ragione si prova anche la directory **padre**: `cargo test` esegue da
/// `target/debug/deps/`, e i binari sono un livello sopra.
///
/// **Il viewer non c'è in tutte le immagini**: `Containerfile.x86_64` copia solo
/// `bin/sws-runtime`, quindi sull'immagine amd64 questo strumento non funziona.
/// Meglio dirlo con un messaggio che nominare un file misterioso.
fn binari() -> Result<(PathBuf, PathBuf), String> {
    let mio = std::env::current_exe()
        .map_err(|e| format!("non trovo il mio stesso binario: {e}"))?;
    let mut cercate = Vec::new();
    let mut d = mio.parent();
    for _ in 0..2 {
        let Some(dir) = d else { break };
        let rt = dir.join("sws-runtime");
        let vw = dir.join("sws-lvgl-viewer");
        if rt.is_file() && vw.is_file() {
            return Ok((rt, vw));
        }
        cercate.push(dir.display().to_string());
        d = dir.parent();
    }
    Err(format!(
        "non trovo `sws-runtime` e `sws-lvgl-viewer` nella stessa directory \
         (cercati in: {}). L'immagine container x86_64 non porta il viewer; \
         quella arm64 sì. In sviluppo: `cargo build -p sws-lvgl-viewer`.",
        cercate.join(", ")
    ))
}

/// Una porta libera, chiesta al sistema con `:0`.
///
/// Fra il rilascio e l'uso c'è una finestra in cui qualcun altro può prenderla.
/// È accettata di proposito: l'alternativa — tenere il socket aperto e passarlo
/// al figlio — vorrebbe ereditare un descrittore, e per uno strumento che gira
/// a richiesta su una macchina sola il rischio è remoto e il fallimento
/// rumoroso (il runtime di prova non parte, e lo diciamo).
fn porta_libera() -> Result<u16, String> {
    let l = std::net::TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("non riesco a trovare una porta libera: {e}"))?;
    l.local_addr()
        .map(|a| a.port())
        .map_err(|e| format!("non riesco a leggere la porta: {e}"))
}

/// Aspetta che il runtime di prova risponda, **e** che non sia già morto.
///
/// Il secondo controllo è quello che serve: senza, un runtime che esce subito
/// (porta occupata, progetto illeggibile) faceva aspettare i venti secondi
/// interi per poi dire «non risponde», nascondendo il motivo vero che era già
/// stampato sul suo stderr.
async fn attendi_salute(porta: u16, figlio: &mut tokio::process::Child) -> Result<(), String> {
    let url = format!("http://127.0.0.1:{porta}/health");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| format!("client HTTP: {e}"))?;
    let scadenza = tokio::time::Instant::now() + ATTESA_RUNTIME;
    loop {
        if let Ok(Some(stato)) = figlio.try_wait() {
            return Err(format!(
                "il runtime di prova è uscito subito ({stato}) senza mettersi in ascolto"
            ));
        }
        if client.get(&url).send().await.map(|r| r.status().is_success()).unwrap_or(false) {
            return Ok(());
        }
        if tokio::time::Instant::now() >= scadenza {
            return Err(format!(
                "il runtime di prova non risponde su :{porta} entro {} s",
                ATTESA_RUNTIME.as_secs()
            ));
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
    }
}

/// Copia il progetto nel banco di prova: `project.yaml`, i sinottici, i
/// faceplate, le immagini.
///
/// Non lo storico né i backup: sono grossi e non cambiano un pixel. Una
/// fotografia di un impianto con anni di storico non deve costare la copia di
/// quello storico.
///
/// E **non le sorgenti**: vedi [`sterilizza`], che è la parte importante.
async fn copia_progetto(da: &Path, a: &Path) -> Result<(), String> {
    const SERVE: &[&str] = &["project.yaml", "synoptics", "faceplates", "images", "recipes"];
    tokio::fs::create_dir_all(a)
        .await
        .map_err(|e| format!("non riesco a creare {}: {e}", a.display()))?;
    for voce in SERVE {
        let src = da.join(voce);
        if !src.exists() {
            continue;
        }
        copia_ricorsiva(&src, &a.join(voce))
            .map_err(|e| format!("copia di {voce}: {e}"))?;
    }
    let yaml = a.join("project.yaml");
    if !yaml.exists() {
        return Err(format!(
            "in {} non c'è nessun project.yaml da fotografare",
            da.display()
        ));
    }
    let testo = tokio::fs::read_to_string(&yaml)
        .await
        .map_err(|e| format!("non riesco a rileggere la copia di project.yaml: {e}"))?;
    tokio::fs::write(&yaml, sterilizza(&testo)?)
        .await
        .map_err(|e| format!("non riesco a scrivere la copia sterilizzata: {e}"))?;
    Ok(())
}

/// Toglie dal progetto del banco di prova tutto ciò che **toccherebbe il
/// mondo**.
///
/// # Perché è la parte più importante di questo modulo
///
/// Il banco di prova è un runtime vero, e un runtime vero apre le sorgenti
/// dichiarate nel progetto, avvia gli script globali e accende le notifiche.
/// Fotografare una pagina di un impianto in servizio avrebbe quindi voluto
/// dire, ogni volta:
///
/// - **collegarsi al campo** — Modbus, OPC-UA, S7, EtherNet/IP — e nel caso di
///   MQTT presentarsi al broker **con lo stesso client id** del runtime vero,
///   che è precisamente l'incidente del 2026-08-21: due client con lo stesso id
///   si buttano fuori a vicenda in un takeover infinito (vedi
///   `AppState::project_switch_lock`);
/// - **far girare gli script globali**, che scrivono tag;
/// - **mandare le notifiche**: email e messaggi Telegram, per una fotografia.
///
/// Nessuna di queste cose serve a disegnare un pixel. Quindi il progetto copiato
/// resta con le pagine, i tag e i faceplate, e perde sorgenti, script globali,
/// notifiche e datastore.
///
/// **La conseguenza, da sapere leggendo l'immagine:** i tag valgono il loro
/// valore iniziale, non quello del campo. L'istantanea verifica **come è fatta
/// la pagina** — posizioni, dimensioni, colori, testi, quali widget LVGL
/// disegna e quali no — non cosa mostra l'impianto in questo momento. Per quello
/// serve guardare il pannello vero.
///
/// Lavora sullo YAML **grezzo** e non sulla struct tipizzata: passare di lì
/// perderebbe le chiavi che questo binario non conosce, che è il difetto di Q10
/// per cui esiste `merge_preserved`.
fn sterilizza(testo: &str) -> Result<String, String> {
    const VIA: &[&str] = &["sources", "global_scripts", "notifications", "datastores"];
    let mut doc: serde_yaml::Value = serde_yaml::from_str(testo)
        .map_err(|e| format!("il project.yaml da fotografare non si legge: {e}"))?;
    if let Some(m) = doc.as_mapping_mut() {
        for k in VIA {
            m.remove(serde_yaml::Value::String((*k).to_string()));
        }
    }
    serde_yaml::to_string(&doc).map_err(|e| format!("serializzazione: {e}"))
}

fn copia_ricorsiva(da: &Path, a: &Path) -> std::io::Result<()> {
    if da.is_dir() {
        std::fs::create_dir_all(a)?;
        for e in std::fs::read_dir(da)? {
            let e = e?;
            copia_ricorsiva(&e.path(), &a.join(e.file_name()))?;
        }
    } else {
        std::fs::copy(da, a)?;
    }
    Ok(())
}

/// Legge un PPM P6 come lo scrive il viewer: `P6\n<w> <h>\n255\n` e poi i byte.
///
/// Non un parser PPM generale — niente commenti, niente maxval diverso da 255:
/// l'unico produttore è il nostro viewer, e un parser che accetta più di quello
/// che riceve è codice che nessuno prova.
fn leggi_ppm(d: &[u8]) -> Result<(u32, u32, &[u8]), String> {
    let testa = |d: &[u8], da: usize| -> Option<(usize, usize)> {
        let mut i = da;
        while i < d.len() && d[i].is_ascii_whitespace() {
            i += 1;
        }
        let inizio = i;
        while i < d.len() && !d[i].is_ascii_whitespace() {
            i += 1;
        }
        (i > inizio).then_some((inizio, i))
    };
    if !d.starts_with(b"P6") {
        return Err("l'immagine del viewer non è un PPM P6".into());
    }
    let mut pos = 2usize;
    let mut campi = [0u32; 3];
    for c in campi.iter_mut() {
        let (a, b) = testa(d, pos).ok_or("intestazione PPM troncata")?;
        *c = std::str::from_utf8(&d[a..b])
            .ok()
            .and_then(|s| s.parse().ok())
            .ok_or("intestazione PPM illeggibile")?;
        pos = b;
    }
    let [w, h, max] = campi;
    if max != 255 {
        return Err(format!("PPM con maxval {max}: atteso 255"));
    }
    // Un solo byte di separazione fra l'intestazione e i dati, come da formato.
    let dati = &d[pos + 1..];
    let attesi = (w as usize) * (h as usize) * 3;
    if dati.len() < attesi {
        return Err(format!(
            "immagine troncata: {} byte invece di {attesi}",
            dati.len()
        ));
    }
    Ok((w, h, &dati[..attesi]))
}

fn a_png(w: u32, h: u32, rgb: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, w, h);
        enc.set_color(png::ColorType::Rgb);
        enc.set_depth(png::BitDepth::Eight);
        let mut w = enc.write_header().map_err(|e| format!("PNG: {e}"))?;
        w.write_image_data(rgb).map_err(|e| format!("PNG: {e}"))?;
    }
    Ok(out)
}

/// Le righe del viewer che dicono qualcosa a chi guarda, senza il rumore di
/// LVGL.
///
/// LVGL stampa decine di righe `[Info] lv_obj_update_layout` che non
/// significano niente per chi legge: passarle al modello costa contesto e gli
/// insegna a ignorare l'uscita dello strumento.
fn note_utili(stderr: &str) -> Vec<String> {
    const INTERESSANTI: &[&str] = &[
        "comando prodotto",
        "navigazione richiesta",
        "il tocco non ha prodotto",
        "[Warn]",
        "[Error]",
        "sconosciut",
        "non trovat",
    ];
    let mut out: Vec<String> = stderr
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .filter(|l| INTERESSANTI.iter().any(|k| l.contains(k)))
        .map(|l| l.to_string())
        .collect();
    out.dedup();
    out.truncate(20);
    out
}

fn ultime_righe(s: &str, n: usize) -> String {
    let righe: Vec<&str> = s.lines().filter(|l| !l.trim().is_empty()).collect();
    righe[righe.len().saturating_sub(n)..].join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Un PPM come lo scrive il viewer, letto correttamente.
    /// **La prova che conta: tutta la catena.** Avvia il runtime di prova, gli
    /// fa disegnare una pagina, e riapre il PNG per verificare che dentro ci
    /// sia davvero quello che c'era scritto nel progetto.
    ///
    /// `#[ignore]` e non un salto silenzioso: vuole `sws-lvgl-viewer`
    /// compilato, cosa che `cargo test` non fa. Un test che si salta da sé
    /// quando un prerequisito manca è verde e cieco — in questo progetto è già
    /// capitato. Lo lancia `scripts/check_istantanea.sh`, che prima compila.
    #[tokio::test]
    #[ignore = "vuole i binari compilati: lo lancia scripts/check_istantanea.sh"]
    async fn scatta_davvero_e_dentro_c_e_la_pagina() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        std::fs::write(
            p.join("project.yaml"),
            "meta:\n  name: occhi\n  version: \"1\"\ntags: []\nsources: []\n",
        )
        .unwrap();
        std::fs::create_dir_all(p.join("synoptics")).unwrap();
        // Un rettangolo di un colore inconfondibile, grande: se il rendering
        // non è avvenuto l'immagine non lo contiene, e non c'è modo di
        // confondere un buffer vuoto con una pagina disegnata.
        std::fs::write(
            p.join("synoptics/Prova.yaml"),
            "id: pv\nname: Prova\nwidth: 480\nheight: 272\nobjects:\n\
             - { id: r1, type: rect, x: 40, y: 40, width: 200, height: 100, fill: \"#3b82f6\" }\n",
        )
        .unwrap();

        let scatto = scatta(Richiesta {
            progetto: p.to_path_buf(),
            pagina: Some("Prova".into()),
            tocca: None,
            ms: Some(600),
        })
        .await
        .expect("lo scatto deve riuscire");

        assert_eq!((scatto.larghezza, scatto.altezza), (480, 272));
        assert_eq!(&scatto.png[..8], b"\x89PNG\r\n\x1a\n");

        // Si riapre il PNG e si contano i pixel del rettangolo. Il confronto è
        // TOLLERANTE di proposito: LVGL lavora in RGB565, quindi `#3b82f6`
        // (59,130,246) esce come (57,129,246). Un test che pretendesse il
        // colore esatto sarebbe rosso su un rendering corretto — ed è
        // esattamente l'errore in cui cadrebbe chi legge l'immagine.
        let dec = png::Decoder::new(std::io::Cursor::new(&scatto.png));
        let mut lettore = dec.read_info().unwrap();
        let mut buf = vec![0; lettore.output_buffer_size()];
        let info = lettore.next_frame(&mut buf).unwrap();
        let px = &buf[..info.buffer_size()];
        let vicini = px
            .chunks_exact(3)
            .filter(|c| {
                let d = |a: u8, b: u8| (a as i32 - b as i32).abs();
                d(c[0], 59) <= 4 && d(c[1], 130) <= 4 && d(c[2], 246) <= 4
            })
            .count();
        assert!(
            vicini > 200 * 100 / 2,
            "il rettangolo non c'è nell'immagine: solo {vicini} pixel del suo colore. \
             Il rendering non è avvenuto, o la pagina non è stata caricata."
        );
    }

    /// **Il test che protegge l'impianto.** Il progetto del banco di prova non
    /// deve portarsi dietro niente che tocchi il mondo: un secondo runtime che
    /// apre le sorgenti si presenta al broker MQTT con lo stesso client id di
    /// quello vero (l'incidente del 2026-08-21), e le notifiche manderebbero
    /// email e Telegram per una fotografia.
    #[test]
    fn il_banco_di_prova_non_tocca_il_campo() {
        let vero = "\
meta:\n  name: impianto\n  version: \"1\"\n\
tags:\n  - { id: t1, description: uno }\n\
sources:\n  - { kind: mqtt, id: broker, host: 10.0.0.9, port: 1883, topics: [] }\n\
global_scripts:\n  - { id: s, trigger: { kind: interval, interval_s: 1 }, code: \"x = 1\" }\n\
notifications:\n  smtp: { host: mail.example.com, port: 587 }\n\
datastores:\n  - { id: default, backend: { kind: sqlite, path: history/h.db } }\n\
page_layout: { navbar: true }\n";
        let pulito = sterilizza(vero).unwrap();
        for k in ["sources", "global_scripts", "notifications", "datastores"] {
            assert!(!pulito.contains(k), "`{k}` è rimasto nel progetto di prova:\n{pulito}");
        }
        assert!(!pulito.contains("10.0.0.9"), "l'indirizzo del campo è rimasto:\n{pulito}");
        assert!(!pulito.contains("mail.example.com"), "lo SMTP è rimasto:\n{pulito}");
        // E quello che serve a disegnare resta.
        assert!(pulito.contains("t1"), "i tag servono a disegnare:\n{pulito}");
        assert!(pulito.contains("page_layout"), "il layout serve a disegnare:\n{pulito}");
        assert!(pulito.contains("impianto"));
    }

    /// Un progetto che non ha niente da togliere resta com'è, e non diventa un
    /// errore.
    #[test]
    fn sterilizzare_un_progetto_pulito_non_lo_rompe() {
        let p = sterilizza("meta:\n  name: p\n  version: \"1\"\ntags: []\n").unwrap();
        assert!(p.contains("name: p"));
    }

    /// Uno YAML illeggibile deve **dirlo**: se passasse avanti, il banco di
    /// prova partirebbe col progetto originale — cioè con le sorgenti — e il
    /// difetto che questa funzione esiste per evitare tornerebbe in silenzio.
    #[test]
    fn uno_yaml_illeggibile_ferma_tutto() {
        assert!(sterilizza("questo: [non è: yaml valido").is_err());
    }

    /// Che `sterilizza` funzioni non basta: va provato che la **copia** la
    /// chiami. Sono due cose diverse, e la seconda è quella che protegge
    /// l'impianto — una funzione giusta che nessuno invoca non protegge niente.
    #[tokio::test]
    async fn la_copia_arriva_sterilizzata() {
        let da = tempfile::tempdir().unwrap();
        let a = tempfile::tempdir().unwrap();
        std::fs::write(
            da.path().join("project.yaml"),
            "meta:\n  name: impianto\n  version: \"1\"\n\
             tags: [{ id: t1, description: uno }]\n\
             sources: [{ kind: mqtt, id: b, host: 10.0.0.9, port: 1883, topics: [] }]\n",
        )
        .unwrap();
        std::fs::create_dir_all(da.path().join("synoptics")).unwrap();
        std::fs::write(da.path().join("synoptics/P.yaml"), "id: p\nname: P\nobjects: []\n").unwrap();

        let dest = a.path().join("copia");
        copia_progetto(da.path(), &dest).await.unwrap();

        let testo = std::fs::read_to_string(dest.join("project.yaml")).unwrap();
        assert!(!testo.contains("10.0.0.9"), "la copia porta ancora il campo:\n{testo}");
        assert!(!testo.contains("sources"), "la copia porta ancora le sorgenti:\n{testo}");
        assert!(testo.contains("t1"), "i tag devono restare:\n{testo}");
        assert!(dest.join("synoptics/P.yaml").is_file(), "le pagine devono essere copiate");
        // L'originale non si tocca: è il progetto in servizio.
        let originale = std::fs::read_to_string(da.path().join("project.yaml")).unwrap();
        assert!(originale.contains("10.0.0.9"), "l'originale è stato modificato!");
    }

    #[test]
    fn legge_il_ppm_del_viewer() {
        let mut d = b"P6\n2 1\n255\n".to_vec();
        d.extend_from_slice(&[1, 2, 3, 4, 5, 6]);
        let (w, h, px) = leggi_ppm(&d).unwrap();
        assert_eq!((w, h), (2, 1));
        assert_eq!(px, &[1, 2, 3, 4, 5, 6]);
    }

    /// Un'immagine troncata deve **dirlo**, non produrre un PNG a metà: un PNG
    /// valido con dentro mezza pagina farebbe concludere che il rendering è
    /// rotto.
    #[test]
    fn un_ppm_troncato_e_un_errore() {
        let mut d = b"P6\n2 2\n255\n".to_vec();
        d.extend_from_slice(&[1, 2, 3]);
        let e = leggi_ppm(&d).unwrap_err();
        assert!(e.contains("troncata"), "{e}");
    }

    #[test]
    fn cio_che_non_e_un_ppm_e_un_errore() {
        assert!(leggi_ppm(b"non sono un'immagine").is_err());
        assert!(leggi_ppm(b"P6\n2 2\n15\n").unwrap_err().contains("maxval"));
    }

    /// Il PNG prodotto deve essere un PNG: firma e dimensioni.
    #[test]
    fn produce_un_png_vero() {
        let rgb = vec![255u8, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255];
        let png = a_png(2, 2, &rgb).unwrap();
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n", "firma PNG");
        assert!(png.len() > 20);
    }

    /// Il rumore di LVGL non arriva al modello; quello che conta sì.
    #[test]
    fn le_note_tengono_solo_cio_che_serve() {
        let stderr = "\
[Info]\t(0.000, +0)\t lv_obj_update_layout: Layout update begin\n\
comando prodotto: scrivere Bool(true) su 'demo.cmd.button'\n\
[Info]\t(0.128, +32)\t lv_obj_update_layout: Layout update begin\n\
navigazione richiesta: pagina 'demo_p2'\n\
[Warn]\tqualcosa non torna\n";
        let n = note_utili(stderr);
        assert_eq!(n.len(), 3, "{n:?}");
        assert!(n[0].contains("comando prodotto"));
        assert!(n[1].contains("navigazione richiesta"));
        assert!(n[2].contains("[Warn]"));
        assert!(!n.iter().any(|l| l.contains("lv_obj_update_layout")),
                "il rumore di LVGL non deve arrivare al modello");
    }

    /// I binari si trovano davvero, da dove girano i test — cioè
    /// `target/debug/deps/`, un livello sotto quello giusto.
    ///
    /// Se questo diventa rosso con «cercati in», manca
    /// `cargo build -p sws-lvgl-viewer`: il messaggio lo dice, ed è la metà del
    /// valore di questo test.
    #[test]
    fn i_binari_si_trovano_anche_dai_test() {
        match binari() {
            Ok((rt, vw)) => {
                assert!(rt.is_file() && vw.is_file());
                assert_eq!(rt.parent(), vw.parent(), "devono stare nella stessa directory");
            }
            Err(e) => {
                assert!(e.contains("cercati in"), "{e}");
                assert!(e.contains("x86_64"), "il messaggio deve dire dell'immagine: {e}");
                eprintln!("(salto: {e})");
            }
        }
    }
}
