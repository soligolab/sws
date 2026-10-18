//! Banco di prova delle prestazioni del runtime (P5 dell'onda 2, 17-10-2026, piano
//! `docs/archive/2026-10-17-onda-2-prestazioni-e-protezioni.md`).
//!
//! Per ogni casella della griglia (N tag × K client):
//! - prepara un progetto senza utenti con N tag e un tag d'eco, attraverso le API di
//!   gestione (`--gestione`);
//! - un **produttore** scrive gli N tag una volta al secondo dal WebSocket dei tag,
//!   come farebbe un driver, e ogni secondo scrive anche l'eco;
//! - K **client** si collegano al WebSocket del viewer (`--viewer`), come un
//!   browser, e contano gli aggiornamenti; la latenza è il tempo fra la scrittura
//!   dell'eco e il suo arrivo a ogni client, misurata su questa macchina — non
//!   dipende dagli orologi delle due;
//! - CPU e memoria della macchina del runtime da `/metrics`, un campione al secondo.
//!
//! Perché i valori li scrive il banco e non i generatori dei tag: un generatore si
//! ricalcola ogni 100 ms e il database dei tag trasmette ogni `set`, anche uguale al
//! precedente, quindi un tag generato fa 10 aggiornamenti al secondo, non 1.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use clap::Parser;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio_tungstenite::tungstenite::Message;

const PROGETTO: &str = "banco-prestazioni";
const ECO: &str = "banco.eco";

#[derive(Parser, Debug)]
#[command(about = "Banco di prova delle prestazioni del runtime SWS")]
struct Args {
    /// Le API di gestione (creano e aprono il progetto), es. http://127.0.0.1:8444
    #[arg(long)]
    gestione: String,
    /// Dove si collegano i client, come un browser (es. http://192.168.1.204:8443).
    /// Assente = la stessa di `--gestione`.
    #[arg(long)]
    viewer: Option<String>,
    #[arg(long)]
    utente: Option<String>,
    #[arg(long, env = "SWS_BANCO_PASSWORD")]
    password: Option<String>,
    /// Numeri di tag, separati da virgola.
    #[arg(long, default_value = "100,1000,5000")]
    tag: String,
    /// Numeri di client, separati da virgola.
    #[arg(long, default_value = "1,5,20")]
    client: String,
    /// Secondi di misura per casella.
    #[arg(long, default_value_t = 60)]
    durata: u64,
    /// Il nome della macchina, per la tabella (es. «TC620», «x86 ufficio»).
    #[arg(long, default_value = "?")]
    macchina: String,
    /// Il progetto da riaprire alla fine.
    #[arg(long)]
    ripristina: Option<String>,
    /// Dove scrivere i risultati (JSON).
    #[arg(long)]
    uscita: Option<String>,
}

#[derive(serde::Serialize, Debug, Clone)]
struct Casella {
    tag: usize,
    client: usize,
    durata_s: u64,
    /// Aggiornamenti attesi al secondo per client (N tag, 1 al secondo ciascuno).
    attesi_al_s: f64,
    /// Aggiornamenti arrivati al secondo, in media sui client.
    arrivati_al_s: f64,
    /// Il client più lento.
    arrivati_min_al_s: f64,
    latenza_mediana_ms: Option<f64>,
    latenza_p95_ms: Option<f64>,
    echi_persi: usize,
    cpu_media_pct: Option<f64>,
    cpu_max_pct: Option<f64>,
    memoria_media_mb: Option<f64>,
    memoria_max_mb: Option<f64>,
    errori_scrittura: u64,
}

fn elenco(s: &str) -> Vec<usize> {
    s.split(',').filter_map(|x| x.trim().parse().ok()).collect()
}

fn ws_url(base: &str, token: Option<&str>) -> String {
    let b = base.trim_end_matches('/').replacen("https://", "wss://", 1).replacen("http://", "ws://", 1);
    match token {
        Some(t) => format!("{b}/ws/tags?token={t}"),
        None => format!("{b}/ws/tags"),
    }
}

async fn accedi(http: &reqwest::Client, base: &str, utente: &str, password: &str) -> Result<String> {
    let r: Value = http
        .post(format!("{base}/api/auth/login"))
        .json(&json!({ "username": utente, "password": password }))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    r["token"].as_str().map(str::to_owned).context("nessun token nella risposta del login")
}

/// Lo ZIP di un progetto senza utenti con N tag float e l'eco, come lo carica un
/// deploy: un pannello (`--no-admin`) non crea progetti, li riceve soltanto.
/// `utente`: un Admin che il progetto porta con sé. Serve sul pannello, dove gli
/// utenti stanno nel progetto aperto: un progetto senza utenti lascerebbe il
/// pannello «da abbinare» e respingerebbe tutte le chiamate del banco (visto il
/// 17-10-2026, con il pannello rimasto sul progetto di prova).
fn zip_progetto(ids: &[String], utente: Option<(&str, &str)>) -> Result<Vec<u8>> {
    use std::io::Write;
    let mut yaml = format!("meta: {{ name: {PROGETTO}, version: '1' }}\nsources: []\nalarms: []\ntags:\n");
    for id in ids {
        yaml.push_str(&format!("  - {{ id: {id}, data_type: float }}\n"));
    }
    yaml.push_str(&format!("  - {{ id: {ECO}, data_type: int }}\n"));
    let mut buf = std::io::Cursor::new(Vec::new());
    {
        let mut z = zip::ZipWriter::new(&mut buf);
        let o = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        z.start_file("manifest.json", o)?;
        z.write_all(json!({ "format_version": "1", "name": PROGETTO, "exported_at_ms": 0, "secrets_masked": true }).to_string().as_bytes())?;
        z.start_file("project.yaml", o)?;
        z.write_all(yaml.as_bytes())?;
        if let Some((u, p)) = utente {
            let hash = sws_auth::hash_password(p)?;
            z.start_file("users.yaml", o)?;
            z.write_all(format!("users:\n- username: {u}\n  password_hash: '{hash}'\n  role: Admin\n").as_bytes())?;
        }
        z.finish()?;
    }
    Ok(buf.into_inner())
}

/// Apre un progetto: l'indirizzo con l'azienda (`/api/projects/-/<nome>/open`, il
/// solo che un pannello conosce), oppure quello breve del runtime di sviluppo.
async fn apri(http: &reqwest::Client, base: &str, token: Option<&str>, nome: &str) -> Result<()> {
    for url in [format!("{base}/api/projects/-/{nome}/open"), format!("{base}/api/projects/{nome}/open")] {
        let mut r = http.post(&url);
        if let Some(t) = token {
            r = r.bearer_auth(t);
        }
        let risp = r.send().await?;
        if risp.status().is_success() {
            return Ok(());
        }
        if risp.status() != reqwest::StatusCode::NOT_FOUND && risp.status() != reqwest::StatusCode::METHOD_NOT_ALLOWED {
            anyhow::bail!("aprire «{nome}»: {}", risp.status());
        }
    }
    anyhow::bail!("aprire «{nome}»: nessuna delle due rotte risponde")
}

/// Carica (crea o sostituisce) e apre il progetto del banco con N tag.
async fn prepara(http: &reqwest::Client, base: &str, token: Option<&str>, n: usize, utente: Option<(&str, &str)>) -> Result<Vec<String>> {
    let ids: Vec<String> = (0..n).map(|i| format!("banco.t{i:05}")).collect();
    let corpo = zip_progetto(&ids, utente)?;
    // La prima volta lo crea; se c'è già, lo sostituisce come fa la seconda metà di un deploy.
    for extra in ["", "&deploy=true"] {
        // `replace_users`: il deploy di solito tiene gli utenti del dispositivo;
        // qui il banco porta il suo e deve valere.
        let mut r = http.post(format!("{base}/api/projects/upload?name={PROGETTO}{extra}&replace_users=true"))
            .header("Content-Type", "application/zip").body(corpo.clone());
        if let Some(t) = token {
            r = r.bearer_auth(t);
        }
        let risp = r.send().await?;
        if risp.status().is_success() {
            apri(http, base, token, PROGETTO).await?;
            tokio::time::sleep(Duration::from_secs(2)).await;
            return Ok(ids);
        }
        if risp.status() != reqwest::StatusCode::CONFLICT {
            let st = risp.status();
            anyhow::bail!("caricare il progetto del banco: {st} {}", risp.text().await.unwrap_or_default());
        }
    }
    anyhow::bail!("caricare il progetto del banco: c'è già e non si sostituisce")
}

/// CPU % e memoria (MB) del **processo del runtime** da `/metrics`
/// (`sws_process_*`, dal 17-10-2026); un runtime più vecchio dà solo quelle della
/// macchina, che si usano come ripiego.
async fn campione(http: &reqwest::Client, base: &str, token: Option<&str>) -> Option<(f64, f64)> {
    let mut r = http.get(format!("{base}/metrics"));
    if let Some(t) = token {
        r = r.bearer_auth(t);
    }
    let testo = r.send().await.ok()?.text().await.ok()?;
    let valore = |nome: &str| {
        testo.lines().find(|l| l.starts_with(nome) && !l.starts_with('#'))
            .and_then(|l| l.split_whitespace().last()).and_then(|v| v.parse::<f64>().ok())
    };
    let cpu = valore("sws_process_cpu_pct").or_else(|| valore("sws_cpu_usage_pct"))?;
    let mem = valore("sws_process_rss_bytes").or_else(|| valore("sws_memory_used_bytes"))?;
    Some((cpu, mem / 1_048_576.0))
}

fn percentile(v: &mut [f64], p: f64) -> Option<f64> {
    if v.is_empty() {
        return None;
    }
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let i = ((v.len() - 1) as f64 * p).round() as usize;
    Some(v[i])
}

async fn misura(args: &Args, http: &reqwest::Client, token: Option<&str>, ids: &[String], k: usize) -> Result<Casella> {
    let viewer = args.viewer.clone().unwrap_or_else(|| args.gestione.clone());
    let fine = Arc::new(AtomicBool::new(false));
    let inviati: Arc<Mutex<HashMap<i64, Instant>>> = Arc::default();
    let latenze: Arc<Mutex<Vec<f64>>> = Arc::default();
    let echi_visti: Arc<Mutex<Vec<std::collections::HashSet<i64>>>> = Arc::new(Mutex::new(vec![Default::default(); k]));
    let contatori: Vec<Arc<AtomicU64>> = (0..k).map(|_| Arc::new(AtomicU64::new(0))).collect();

    // I client: contano le voci di ogni delta, e registrano l'arrivo dell'eco.
    let mut compiti = Vec::new();
    for c in 0..k {
        let url = ws_url(&viewer, token);
        let (fine, inviati, latenze, echi_visti, conta) =
            (fine.clone(), inviati.clone(), latenze.clone(), echi_visti.clone(), contatori[c].clone());
        compiti.push(tokio::spawn(async move {
            let (mut ws, _) = tokio_tungstenite::connect_async(&url).await.context("client: connessione")?;
            ws.send(Message::Text(json!({ "type": "subscribe", "tags": ["*"] }).to_string())).await?;
            while !fine.load(Ordering::Relaxed) {
                let Ok(Some(Ok(Message::Text(t)))) = tokio::time::timeout(Duration::from_millis(500), ws.next()).await else { continue };
                let Ok(v) = serde_json::from_str::<Value>(&t) else { continue };
                if v["type"] != "delta" {
                    continue;
                }
                let adesso = Instant::now();
                for e in v["changed"].as_array().into_iter().flatten() {
                    if e["id"] == ECO {
                        if let Some(n) = e["value"].as_i64() {
                            if echi_visti.lock().unwrap()[c].insert(n) {
                                if let Some(t0) = inviati.lock().unwrap().get(&n) {
                                    latenze.lock().unwrap().push(adesso.duration_since(*t0).as_secs_f64() * 1000.0);
                                }
                            }
                        }
                    } else {
                        conta.fetch_add(1, Ordering::Relaxed);
                    }
                }
            }
            anyhow::Ok(())
        }));
    }
    tokio::time::sleep(Duration::from_secs(2)).await; // i client sono collegati e hanno avuto lo snapshot
    contatori.iter().for_each(|c| c.store(0, Ordering::Relaxed));

    // Il produttore: N scritture al secondo, più l'eco.
    let errori = Arc::new(AtomicU64::new(0));
    let produttore = {
        let url = ws_url(&args.gestione, token);
        let (ids, fine, inviati, errori) = (ids.to_vec(), fine.clone(), inviati.clone(), errori.clone());
        tokio::spawn(async move {
            let (ws, _) = tokio_tungstenite::connect_async(&url).await.context("produttore: connessione")?;
            let (mut tx, mut rx) = ws.split();
            let errori2 = errori.clone();
            let lettore = tokio::spawn(async move {
                while let Some(Ok(Message::Text(t))) = rx.next().await {
                    if t.contains("\"ack\"") && t.contains("\"ok\":false") {
                        errori2.fetch_add(1, Ordering::Relaxed);
                    }
                }
            });
            let mut giro: i64 = 0;
            let mut battito = tokio::time::interval(Duration::from_secs(1));
            while !fine.load(Ordering::Relaxed) {
                battito.tick().await;
                giro += 1;
                inviati.lock().unwrap().insert(giro, Instant::now());
                tx.send(Message::Text(json!({ "type": "write", "tag": ECO, "value": giro }).to_string())).await?;
                for (i, id) in ids.iter().enumerate() {
                    let v = ((giro as f64) + i as f64 * 0.001) % 100.0;
                    tx.send(Message::Text(json!({ "type": "write", "tag": id, "value": v }).to_string())).await?;
                }
            }
            lettore.abort();
            anyhow::Ok(())
        })
    };

    // Le risorse, un campione al secondo, mentre si misura.
    let mut cpu = Vec::new();
    let mut mem = Vec::new();
    let inizio = Instant::now();
    while inizio.elapsed() < Duration::from_secs(args.durata) {
        tokio::time::sleep(Duration::from_secs(1)).await;
        if let Some((c, m)) = campione(http, &args.gestione, token).await {
            cpu.push(c);
            mem.push(m);
        }
    }
    let secondi = inizio.elapsed().as_secs_f64();
    fine.store(true, Ordering::Relaxed);
    tokio::time::sleep(Duration::from_millis(800)).await;
    let _ = produttore.await;
    for c in compiti {
        let _ = c.await;
    }

    let per_client: Vec<f64> = contatori.iter().map(|c| c.load(Ordering::Relaxed) as f64 / secondi).collect();
    let mut lat = latenze.lock().unwrap().clone();
    let scritti = inviati.lock().unwrap().len();
    let visti: usize = echi_visti.lock().unwrap().iter().map(|s| s.len()).sum();
    let media = |v: &[f64]| (!v.is_empty()).then(|| v.iter().sum::<f64>() / v.len() as f64);
    let massimo = |v: &[f64]| v.iter().cloned().fold(None, |m: Option<f64>, x| Some(m.map_or(x, |m| m.max(x))));
    Ok(Casella {
        tag: ids.len(),
        client: k,
        durata_s: args.durata,
        attesi_al_s: ids.len() as f64,
        arrivati_al_s: media(&per_client).unwrap_or(0.0),
        arrivati_min_al_s: per_client.iter().cloned().fold(f64::INFINITY, f64::min),
        latenza_mediana_ms: percentile(&mut lat, 0.5),
        latenza_p95_ms: percentile(&mut lat, 0.95),
        echi_persi: (scritti * k).saturating_sub(visti),
        cpu_media_pct: media(&cpu),
        cpu_max_pct: massimo(&cpu),
        memoria_media_mb: media(&mem),
        memoria_max_mb: massimo(&mem),
        errori_scrittura: errori.load(Ordering::Relaxed),
    })
}

fn riga(c: &Casella) -> String {
    let f = |v: Option<f64>| v.map(|x| format!("{x:.0}")).unwrap_or_else(|| "—".into());
    format!(
        "| {} | {} | {:.0} | {:.0} | {:.0} | {} | {} | {} | {} | {} |",
        c.tag, c.client, c.attesi_al_s, c.arrivati_al_s, c.arrivati_min_al_s,
        f(c.latenza_mediana_ms), f(c.latenza_p95_ms), f(c.cpu_media_pct), f(c.cpu_max_pct), f(c.memoria_max_mb),
    )
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    let http = reqwest::Client::builder().timeout(Duration::from_secs(30)).build()?;
    let token = match (&args.utente, &args.password) {
        (Some(u), Some(p)) => Some(accedi(&http, &args.gestione, u, p).await?),
        _ => None,
    };
    // Sul pannello il progetto del banco porta lo stesso Admin con cui si è
    // entrati; in locale (runtime senza autenticazione) nessun utente.
    let utente_banco = args.utente.as_deref().zip(args.password.as_deref());
    let mut token_banco = token.clone();
    let esito = griglia(&args, &http, &mut token_banco, utente_banco).await;
    // Il ripristino si fa **sempre**, anche se la misura è fallita: un errore a
    // metà lasciava il pannello sul progetto del banco.
    if let Some(p) = &args.ripristina {
        match apri(&http, &args.gestione, token_banco.as_deref().or(token.as_deref()), p).await {
            Ok(()) => println!("\nriaperto il progetto «{p}»"),
            Err(e) => eprintln!("\nATTENZIONE: non sono riuscito a riaprire «{p}»: {e:#}"),
        }
    }
    let risultati = esito?;
    if let Some(u) = &args.uscita {
        let doc = json!({ "macchina": args.macchina, "gestione": args.gestione, "viewer": args.viewer, "durata_s": args.durata, "caselle": risultati });
        std::fs::write(u, serde_json::to_string_pretty(&doc)?)?;
        println!("risultati in {u}");
    }
    Ok(())
}

async fn griglia(args: &Args, http: &reqwest::Client, token: &mut Option<String>, utente: Option<(&str, &str)>) -> Result<Vec<Casella>> {
    let mut risultati = Vec::new();
    println!("Banco di prova — {} ({}), {} s per casella\n", args.macchina, args.gestione, args.durata);
    println!("| tag | client | attesi/s | arrivati/s | il più lento/s | latenza mediana ms | latenza p95 ms | CPU runtime media % | CPU runtime max % | memoria runtime max MB |");
    println!("|---|---|---|---|---|---|---|---|---|---|");
    for n in elenco(&args.tag) {
        let ids = prepara(http, &args.gestione, token.as_deref(), n, utente).await?;
        // Con il progetto del banco aperto valgono i suoi utenti: si rientra.
        if let Some((u, p)) = utente {
            *token = Some(accedi(http, &args.gestione, u, p).await.context("entrare nel progetto del banco")?);
        }
        for k in elenco(&args.client) {
            let c = misura(args, http, token.as_deref(), &ids, k).await?;
            anyhow::ensure!(c.arrivati_al_s > 0.0, "nessun aggiornamento arrivato ai client: misura non valida");
            println!("{}", riga(&c));
            risultati.push(c);
        }
    }
    Ok(risultati)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percentile_e_url() {
        let mut v = vec![5.0, 1.0, 3.0, 2.0, 4.0];
        assert_eq!(percentile(&mut v, 0.5), Some(3.0));
        assert_eq!(percentile(&mut v, 0.95), Some(5.0));
        assert_eq!(percentile(&mut [], 0.5), None);
        assert_eq!(ws_url("http://h:8443/", None), "ws://h:8443/ws/tags");
        assert_eq!(ws_url("https://h", Some("x")), "wss://h/ws/tags?token=x");
        assert_eq!(elenco("100, 1000,x"), vec![100, 1000]);
    }
}
