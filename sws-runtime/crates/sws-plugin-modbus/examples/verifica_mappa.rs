//! Legge un dispositivo con una mappa del catalogo e stampa ogni punto
//! (01-11-2026, piano docs/archive/2026-11-01-inverter-solarman.md, fase 6).
//!
//! Lo strumento per verificare una mappa sul campo, prima di metterla in un
//! progetto: legge i blocchi della voce attraverso il trasporto vero, decodifica
//! ogni registro col codec del runtime (formato, ordine, scala, testi) e dice
//! valore, unità e plausibilità. Con `--giri` ripete la lettura e alla fine conta
//! timeout e risposte rotte: la prova di durata.
//!
//! ```text
//! cargo run -p sws-plugin-modbus --example verifica_mappa -- \
//!     --catalogo catalogo/dispositivi/zcs/azzurro-hyd-zss.json \
//!     --host 192.168.1.29 --seriale 1786079474 [--porta 8899] [--unita 1] \
//!     [--giri 1] [--ogni 10] [--diagnostica] [--traccia grid_power,battery_power]
//! ```
//!
//! **Un client alla volta**: le chiavette Solarman non reggono due lettori. Prima
//! di lanciarlo, chi altro legge la chiavetta (Home Assistant) va fermato.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::Value;
use sws_core::{AreaModbus, ModoTesti, OrdineModbus, TagValue, TestiRegistro, TipoScalare};
use sws_plugin_modbus::trasporti::{ClientSolarman, Ritmato};
use sws_plugin_modbus::{codec, testo_di, Dispositivo, Letti};

fn arg(nome: &str) -> Option<String> {
    let a: Vec<String> = std::env::args().collect();
    a.iter().position(|x| x == nome).and_then(|i| a.get(i + 1).cloned())
}

/// La voce con gli include risolti, come `catalogo.rs`.
fn voce(radice: &Path, id: &str) -> (Value, Vec<Value>) {
    let m: Value = serde_json::from_str(&std::fs::read_to_string(radice.join(format!("{id}.json"))).expect("file del catalogo"))
        .expect("JSON del catalogo");
    let mut regs: Vec<Value> = Vec::new();
    for inc in m["includi"].as_array().into_iter().flatten() {
        for r in voce(radice, inc.as_str().unwrap()).1 {
            regs.retain(|x| x["nome"] != r["nome"]);
            regs.push(r);
        }
    }
    for r in m["registri"].as_array().into_iter().flatten() {
        regs.retain(|x| x["nome"] != r["nome"]);
        regs.push(r.clone());
    }
    (m, regs)
}

/// Il valore di un registro della voce, dai registri letti nel giro.
fn decodifica(r: &Value, letti: &HashMap<(AreaModbus, u16), u16>, ordine: OrdineModbus) -> Option<TagValue> {
    let a = area(r["area"].as_str());
    let addr = r["indirizzo"].as_u64()? as u16;
    let formato = TipoScalare::parse(r["formato"].as_str().unwrap_or("u16"))?;
    let grezzi: Option<Vec<u16>> = (0..formato.registri()).map(|i| letti.get(&(a, addr + i)).copied()).collect();
    codec::decodifica_formato(&formato, &grezzi?, ordine, r["scala"].as_f64().unwrap_or(1.0)).ok()
}

fn area(s: Option<&str>) -> AreaModbus {
    match s {
        Some("input") => AreaModbus::Input,
        Some("coil") => AreaModbus::Coil,
        Some("discrete") => AreaModbus::Discrete,
        _ => AreaModbus::Holding,
    }
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let file = PathBuf::from(arg("--catalogo").expect("--catalogo <file .json>"));
    let radice = file.parent().and_then(Path::parent).expect("catalogo/dispositivi/<marca>/<modello>.json").to_path_buf();
    let id = format!(
        "{}/{}",
        file.parent().unwrap().file_name().unwrap().to_string_lossy(),
        file.file_stem().unwrap().to_string_lossy()
    );
    let (m, regs) = voce(&radice, &id);
    let mb = &m["modbus"];
    let host = arg("--host").expect("--host");
    let porta = arg("--porta").map(|p| p.parse().unwrap()).or(mb["porta"].as_u64()).unwrap_or(8899);
    let seriale: u32 = arg("--seriale").expect("--seriale").parse().expect("seriale numerico");
    let unita: u8 = arg("--unita").map(|u| u.parse().unwrap()).unwrap_or(1);
    let giri: u32 = arg("--giri").map(|g| g.parse().unwrap()).unwrap_or(1);
    let ogni = Duration::from_secs(arg("--ogni").map(|g| g.parse().unwrap()).unwrap_or(10));
    let diagnostica = std::env::args().any(|a| a == "--diagnostica");
    // `--traccia grid_power,battery_power`: una riga CSV per giro (ora unix e
    // valori), per seguire i segni lungo la giornata durante la prova di durata.
    let traccia: Vec<String> = arg("--traccia").map(|t| t.split(',').map(str::to_string).collect()).unwrap_or_default();
    let timeout = Duration::from_millis(mb["timeout_ms"].as_u64().unwrap_or(5000));
    let ordine: OrdineModbus = serde_json::from_value(mb["ordine"].clone()).unwrap_or_default();
    let blocchi: Vec<(AreaModbus, u16, u16)> = mb["blocchi"]
        .as_array()
        .expect("la voce non ha modbus.blocchi")
        .iter()
        .map(|b| (area(b["area"].as_str()), b["da"].as_u64().unwrap() as u16, b["a"].as_u64().unwrap() as u16))
        .collect();

    let s = tokio::net::TcpStream::connect((host.as_str(), porta as u16)).await.expect("connessione alla chiavetta");
    let client = ClientSolarman::nuovo(s, seriale, unita);
    let scartati = client.scartati.clone();
    let mut dev = Ritmato::nuovo(client, mb["pausa_ms"].as_u64().unwrap_or(200), mb["tentativi"].as_u64().unwrap_or(2) as u8);
    println!("{} {} — {host}:{porta}, seriale {seriale}, unità {unita}, {} registri, {} blocchi\n", m["marca"], m["modello"], regs.len(), blocchi.len());

    let (mut timeout_n, mut rotte, mut fuori, mut ok) = (0u32, 0u32, 0u32, 0u32);
    for giro in 0..giri {
        let mut letti: HashMap<(AreaModbus, u16), u16> = HashMap::new();
        for &(a, da, fino) in &blocchi {
            match tokio::time::timeout(timeout, dev.leggi(a, da, fino - da + 1)).await {
                Ok(Ok(Letti::Registri(r))) => {
                    ok += 1;
                    for (i, v) in r.into_iter().enumerate() {
                        letti.insert((a, da + i as u16), v);
                    }
                }
                Ok(Ok(Letti::Bit(_))) => {}
                Ok(Err(e)) => {
                    if e.kind() == std::io::ErrorKind::InvalidData {
                        rotte += 1;
                    }
                    eprintln!("giro {giro}: blocco 0x{da:04X}..0x{fino:04X}: {e}");
                }
                Err(_) => {
                    timeout_n += 1;
                    eprintln!("giro {giro}: blocco 0x{da:04X}..0x{fino:04X}: nessuna risposta in {timeout:?}");
                }
            }
        }
        if !traccia.is_empty() {
            let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();
            let mut riga = vec![t.to_string()];
            for nome in &traccia {
                riga.push(
                    regs.iter()
                        .find(|r| r["nome"] == nome.as_str())
                        .and_then(|r| decodifica(r, &letti, ordine))
                        .map(|v| match v {
                            TagValue::Float(f) => format!("{f:.2}"),
                            TagValue::Int(i) => i.to_string(),
                            altro => format!("{altro:?}"),
                        })
                        .unwrap_or_default(),
                );
            }
            println!("traccia,{}", riga.join(","));
        }
        if giro == 0 || giro + 1 == giri {
            println!("── giro {} ──", giro + 1);
            for r in &regs {
                let gruppo = r["gruppo"].as_str().unwrap_or("");
                if gruppo == "diagnostics" && !diagnostica {
                    continue;
                }
                let a = area(r["area"].as_str());
                let addr = r["indirizzo"].as_u64().unwrap() as u16;
                let formato = TipoScalare::parse(r["formato"].as_str().unwrap_or("u16")).unwrap();
                let n = formato.registri();
                let grezzi: Option<Vec<u16>> = (0..n).map(|i| letti.get(&(a, addr + i)).copied()).collect();
                let Some(grezzi) = grezzi else {
                    println!("  {:<26} 0x{addr:04X}  (non letto)", r["nome"].as_str().unwrap());
                    continue;
                };
                let v = codec::decodifica_formato(&formato, &grezzi, ordine, r["scala"].as_f64().unwrap_or(1.0)).unwrap();
                let num = match &v {
                    TagValue::Float(f) => Some(*f),
                    TagValue::Int(i) => Some(*i as f64),
                    _ => None,
                };
                let fuori_limiti = num.is_some_and(|x| {
                    r["min"].as_f64().is_some_and(|lo| x < lo) || r["max"].as_f64().is_some_and(|hi| x > hi)
                });
                if fuori_limiti {
                    fuori += 1;
                }
                let mostrato = match r.get("testi") {
                    Some(t) => {
                        let tx = TestiRegistro {
                            modo: if t["modo"] == "bit" { ModoTesti::Bit } else { ModoTesti::Valore },
                            voci: t["voci"]
                                .as_object()
                                .unwrap()
                                .iter()
                                .map(|(k, v)| (k.parse().unwrap(), v["it"].as_str().unwrap_or("").to_string()))
                                .collect(),
                        };
                        format!("{:?}", testo_di(&tx, &v))
                    }
                    None => match v {
                        TagValue::Float(f) => format!("{f:.3}"),
                        altro => format!("{altro:?}"),
                    },
                };
                println!(
                    "  {:<26} 0x{addr:04X} {:<4} {:>16} {:<4} {}{}",
                    r["nome"].as_str().unwrap(),
                    r["formato"].as_str().unwrap_or("u16"),
                    mostrato,
                    r["unita"].as_str().unwrap_or(""),
                    grezzi.iter().map(|g| format!("{g:04X}")).collect::<Vec<_>>().join(" "),
                    if fuori_limiti { "  ⚠ FUORI DAI LIMITI" } else { "" },
                );
            }
        }
        if giro + 1 < giri {
            tokio::time::sleep(ogni).await;
        }
    }
    println!(
        "\nrichieste di blocco riuscite {ok}, timeout {timeout_n}, risposte rotte {rotte}, pacchetti scartati {}, punti fuori limiti (primo e ultimo giro) {fuori}",
        scartati.load(std::sync::atomic::Ordering::Relaxed)
    );
}
