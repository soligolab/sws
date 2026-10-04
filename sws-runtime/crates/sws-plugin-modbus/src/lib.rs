//! Il plugin Modbus, TCP e RTU (Fase 3 del piano tag, 04-10-2026).
//!
//! Prima: un holding register per tag, letto come `u16`; un errore qualsiasi
//! chiudeva la sessione, e la sorgente aspettava il watchdog del supervisore.
//! Ora:
//! - le quattro aree (holding, input, coil, discrete input), scelta per mappatura;
//! - il numero di registri e la decodifica dal **tipo dichiarato** del tag, e una
//!   radice composita (istanza di un tipo, array) letta come **un blocco**, una
//!   foglia per pezzo ([`codec`]); i nomi di tipo storici leggono come prima;
//! - l'ordine di parole e byte dalla sorgente;
//! - un registro che risponde con un'eccezione marca Bad **i suoi** tag e il giro
//!   continua; una connessione persa marca Bad tutto e si riapre con
//!   [`sws_core::riconnessione::con_attesa`];
//! - la scrittura su una foglia scrive solo i suoi registri.
//!
//! Statically linked for the PoC. Dynamic .so loading via a C ABI is deferred
//! until third-party plugin support is needed (OPEN_QUESTIONS Q3).

pub mod codec;

use std::{collections::HashSet, io, sync::Arc, time::Duration};
use sws_core::{
    AreaModbus, ModbusRtuConfig, ModbusTcpConfig, OrdineModbus, RegisterMapping, TagDb, TagQuality, TagValue,
    TagWriteBus, WriteRequest,
};
use tokio::sync::{mpsc, Mutex};
use tokio_modbus::prelude::*;
use tokio_serial::{DataBits, Parity, SerialPortBuilderExt, StopBits};
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

use codec::Slot;

/// Quanto aspettare una risposta prima di considerare la richiesta persa.
const TIMEOUT: Duration = Duration::from_secs(3);
/// Giri consecutivi in cui **nessuna** mappatura ha risposto: allora non è un
/// registro sbagliato, è il dispositivo che non c'è più, e si riconnette.
const GIRI_MUTI_PER_RICONNETTERE: u32 = 3;

/// Quel che arriva da una lettura.
#[derive(Debug, Clone, PartialEq)]
pub enum Letti {
    Registri(Vec<u16>),
    Bit(Vec<bool>),
}

/// Le operazioni che servono, sopra il client vero o uno finto nei test.
#[allow(async_fn_in_trait)]
pub trait Dispositivo {
    async fn leggi(&mut self, area: AreaModbus, addr: u16, n: u16) -> io::Result<Letti>;
    async fn scrivi_registri(&mut self, addr: u16, regs: &[u16]) -> io::Result<()>;
    async fn scrivi_bit(&mut self, addr: u16, bit: &[bool]) -> io::Result<()>;
}

impl Dispositivo for client::Context {
    async fn leggi(&mut self, area: AreaModbus, addr: u16, n: u16) -> io::Result<Letti> {
        Ok(match area {
            AreaModbus::Holding => Letti::Registri(self.read_holding_registers(addr, n).await?),
            AreaModbus::Input => Letti::Registri(self.read_input_registers(addr, n).await?),
            AreaModbus::Coil => Letti::Bit(self.read_coils(addr, n).await?),
            AreaModbus::Discrete => Letti::Bit(self.read_discrete_inputs(addr, n).await?),
        })
    }
    async fn scrivi_registri(&mut self, addr: u16, regs: &[u16]) -> io::Result<()> {
        match regs {
            [r] => self.write_single_register(addr, *r).await,
            _ => self.write_multiple_registers(addr, regs).await,
        }
    }
    async fn scrivi_bit(&mut self, addr: u16, bit: &[bool]) -> io::Result<()> {
        match bit {
            [b] => self.write_single_coil(addr, *b).await,
            _ => self.write_multiple_coils(addr, bit).await,
        }
    }
}

/// Un errore di **trasporto** (la connessione non c'è più) e non una risposta
/// del dispositivo: un'eccezione Modbus arriva come `ErrorKind::Other`.
pub fn e_trasporto(e: &io::Error) -> bool {
    use io::ErrorKind::*;
    matches!(
        e.kind(),
        BrokenPipe | ConnectionReset | ConnectionAborted | NotConnected | UnexpectedEof | ConnectionRefused
    )
}

/// Una mappatura col suo layout, calcolato dal tipo dichiarato.
#[derive(Debug, Clone)]
pub struct Mappatura {
    pub tag: String,
    pub area: AreaModbus,
    pub address: u16,
    pub scale: f64,
    pub slots: Vec<Slot>,
}

/// Il layout di ogni mappatura, dai tipi e dalle forme che il `TagDb` conosce
/// adesso (un salvataggio delle Variabili li cambia senza riavviare la sorgente).
pub async fn prepara(db: &TagDb, registri: &[RegisterMapping]) -> Vec<Mappatura> {
    let mut out = Vec::with_capacity(registri.len());
    for r in registri {
        let foglie: Vec<(String, sws_core::TipoScalare)> = match db.forma(&r.tag).await {
            Some(f) => f.foglie(&r.tag, &[]).into_iter().map(|f| (f.percorso, f.tipo)).collect(),
            None => Vec::new(),
        };
        let tipo_piatto = if foglie.is_empty() {
            codec::tipo_effettivo(db.tipo_dichiarato(&r.tag).await.as_deref())
        } else {
            None
        };
        out.push(Mappatura {
            tag: r.tag.clone(),
            area: r.area,
            address: r.address,
            scale: r.scale,
            slots: codec::layout(&r.tag, tipo_piatto, &foglie, r.area.a_bit()),
        });
    }
    out
}

async fn marca_bad(db: &TagDb, m: &Mappatura) {
    for s in &m.slots {
        db.marca_qualita(&s.percorso, TagQuality::Bad).await;
    }
}

/// Un giro di lettura. `Err` solo per un guasto di trasporto (o troppi giri
/// muti): chi chiama chiude la sessione e riconnette.
pub async fn leggi_giro<D: Dispositivo>(
    dev: &mut D,
    db: &TagDb,
    mappature: &[Mappatura],
    ordine: OrdineModbus,
    in_errore: &mut HashSet<String>,
    giri_muti: &mut u32,
    sorgente: &str,
) -> anyhow::Result<()> {
    let mut risposte = 0usize;
    for m in mappature {
        let n = codec::totale(&m.slots);
        let esito = tokio::time::timeout(TIMEOUT, dev.leggi(m.area, m.address, n)).await;
        let letti = match esito {
            Ok(Ok(l)) => l,
            Ok(Err(e)) if e_trasporto(&e) => {
                return Err(anyhow::anyhow!("lettura di {} @{}: {e}", m.tag, m.address));
            }
            Ok(Err(e)) => {
                if in_errore.insert(m.tag.clone()) {
                    warn!(source = %sorgente, tag = %m.tag, address = m.address, "Modbus: il dispositivo risponde con un errore: {e} — tag Bad, gli altri continuano");
                }
                marca_bad(db, m).await;
                continue;
            }
            Err(_) => {
                if in_errore.insert(m.tag.clone()) {
                    warn!(source = %sorgente, tag = %m.tag, address = m.address, "Modbus: nessuna risposta in {} s — tag Bad", TIMEOUT.as_secs());
                }
                marca_bad(db, m).await;
                continue;
            }
        };
        risposte += 1;
        if in_errore.remove(&m.tag) {
            info!(source = %sorgente, tag = %m.tag, "Modbus: la mappatura risponde di nuovo");
        }
        for s in &m.slots {
            let (a, b) = (s.offset as usize, (s.offset + s.n) as usize);
            let valore = match &letti {
                Letti::Registri(r) if r.len() >= b => codec::decodifica(s.tipo.as_ref(), &r[a..b], ordine, m.scale),
                Letti::Bit(bit) if bit.len() > a => Ok(codec::decodifica_bit(s.tipo.as_ref(), bit[a])),
                _ => Err("risposta più corta del blocco".into()),
            };
            match valore {
                Ok(v) => db.ingest(s.percorso.clone(), v, TagQuality::Good).await,
                Err(e) => {
                    warn!(source = %sorgente, tag = %s.percorso, "Modbus: non decodificabile: {e}");
                    db.marca_qualita(&s.percorso, TagQuality::Bad).await;
                }
            }
        }
    }
    if !mappature.is_empty() && risposte == 0 {
        *giri_muti += 1;
        if *giri_muti >= GIRI_MUTI_PER_RICONNETTERE {
            *giri_muti = 0;
            return Err(anyhow::anyhow!("nessuna risposta per {GIRI_MUTI_PER_RICONNETTERE} giri"));
        }
    } else {
        *giri_muti = 0;
    }
    Ok(())
}

/// Gli slot da scrivere per una richiesta del bus, con il valore di ciascuno.
/// `percorso` è ciò che il bus aggiunge alla radice (`.velocita`, `[2]`).
pub fn da_scrivere(m: &Mappatura, percorso: Option<&str>, valore: &TagValue) -> Result<Vec<(Slot, TagValue)>, String> {
    match percorso {
        Some(p) => {
            let pieno = format!("{}{p}", m.tag);
            m.slots
                .iter()
                .find(|s| s.percorso == pieno)
                .map(|s| vec![(s.clone(), valore.clone())])
                .ok_or_else(|| format!("«{pieno}» non è una parte di questa mappatura"))
        }
        None if m.slots.len() == 1 => Ok(vec![(m.slots[0].clone(), valore.clone())]),
        None => m
            .slots
            .iter()
            .map(|s| {
                let rel = s.percorso.strip_prefix(m.tag.as_str()).unwrap_or("");
                let seg = sws_core::percorso::parse_segmenti(rel).ok_or("percorso non valido")?;
                let v = sws_core::percorso::leggi(valore, &seg)
                    .ok_or_else(|| format!("il valore non ha «{}»", s.percorso))?
                    .clone();
                Ok((s.clone(), v))
            })
            .collect(),
    }
}

/// Una scrittura dal bus. `Err` solo per un guasto di trasporto.
pub async fn scrivi<D: Dispositivo>(
    dev: &mut D,
    db: &TagDb,
    mappature: &[Mappatura],
    ordine: OrdineModbus,
    req: WriteRequest,
    sorgente: &str,
) -> anyhow::Result<()> {
    let (tag, percorso, valore) = req;
    let Some(m) = mappature.iter().find(|m| m.tag == tag) else { return Ok(()) };
    if !m.area.scrivibile() {
        warn!(source = %sorgente, %tag, area = ?m.area, "Modbus: scrittura rifiutata, area di sola lettura");
        return Ok(());
    }
    let pezzi = match da_scrivere(m, percorso.as_deref(), &valore) {
        Ok(p) => p,
        Err(e) => {
            warn!(source = %sorgente, %tag, "Modbus: scrittura rifiutata: {e}");
            return Ok(());
        }
    };
    for (slot, v) in pezzi {
        let addr = m.address + slot.offset;
        let (esito, eco) = if m.area.a_bit() {
            match codec::codifica_bit(&v) {
                Ok(b) => (dev.scrivi_bit(addr, &[b]).await, Ok(codec::decodifica_bit(slot.tipo.as_ref(), b))),
                Err(e) => {
                    warn!(source = %sorgente, tag = %slot.percorso, "Modbus: scrittura rifiutata: {e}");
                    continue;
                }
            }
        } else {
            match codec::codifica(slot.tipo.as_ref(), &v, ordine, m.scale) {
                Ok(regs) => {
                    let eco = codec::decodifica(slot.tipo.as_ref(), &regs, ordine, m.scale);
                    (dev.scrivi_registri(addr, &regs).await, eco)
                }
                Err(e) => {
                    warn!(source = %sorgente, tag = %slot.percorso, "Modbus: scrittura rifiutata: {e}");
                    continue;
                }
            }
        };
        match esito {
            // L'eco è ciò che il dispositivo ha adesso, decodificato come la
            // lettura: lo stesso percorso, quindi la stessa scala, una volta.
            Ok(()) => {
                if let Ok(e) = eco {
                    db.ingest(slot.percorso.clone(), e, TagQuality::Good).await;
                }
                info!(source = %sorgente, tag = %slot.percorso, addr, "Modbus: scrittura OK");
            }
            Err(e) if e_trasporto(&e) => return Err(anyhow::anyhow!("scrittura di {} @{addr}: {e}", slot.percorso)),
            Err(e) => warn!(source = %sorgente, tag = %slot.percorso, addr, "Modbus: il dispositivo rifiuta la scrittura: {e}"),
        }
    }
    Ok(())
}

/// Una sessione: il ciclo di lettura e le scritture, finché la connessione regge.
#[allow(clippy::too_many_arguments)]
async fn sessione<D: Dispositivo>(
    mut dev: D,
    sorgente: &str,
    registri: &[RegisterMapping],
    poll_ms: u64,
    ordine: OrdineModbus,
    db: &TagDb,
    write_rx: &Mutex<mpsc::Receiver<WriteRequest>>,
    cancel: &CancellationToken,
) -> anyhow::Result<()> {
    let mut rx = write_rx.lock().await;
    let mut ticker = tokio::time::interval(Duration::from_millis(poll_ms.max(10)));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut in_errore = HashSet::new();
    let mut giri_muti = 0u32;
    loop {
        tokio::select! {
            _ = cancel.cancelled() => return Ok(()),
            _ = ticker.tick() => {
                let m = prepara(db, registri).await;
                leggi_giro(&mut dev, db, &m, ordine, &mut in_errore, &mut giri_muti, sorgente).await?;
            }
            Some(req) = rx.recv() => {
                let m = prepara(db, registri).await;
                scrivi(&mut dev, db, &m, ordine, req, sorgente).await?;
            }
        }
    }
}

/// Registra le mappature sul bus: la radice basta, una scrittura su una foglia
/// arriva come radice più percorso.
async fn registra(bus: &TagWriteBus, registri: &[RegisterMapping]) -> Mutex<mpsc::Receiver<WriteRequest>> {
    let (tx, rx) = mpsc::channel::<WriteRequest>(32);
    for r in registri {
        bus.register(r.tag.clone(), tx.clone()).await;
    }
    Mutex::new(rx)
}

async fn tutti_bad(db: &TagDb, registri: &[RegisterMapping]) {
    for m in prepara(db, registri).await {
        marca_bad(db, &m).await;
    }
}

/// Modbus TCP: sessioni una dopo l'altra finché `cancel` non scatta.
pub async fn run(cfg: ModbusTcpConfig, db: Arc<TagDb>, bus: Arc<TagWriteBus>, cancel: CancellationToken) {
    let rx = registra(&bus, &cfg.registers).await;
    let addr: std::net::SocketAddr = match format!("{}:{}", cfg.host, cfg.port).parse() {
        Ok(a) => a,
        Err(e) => {
            warn!(source = %cfg.id, "Modbus TCP: indirizzo non valido «{}:{}»: {e} — ferma finché non si corregge la configurazione", cfg.host, cfg.port);
            tutti_bad(&db, &cfg.registers).await;
            return;
        }
    };
    sws_core::riconnessione::con_attesa(
        &cfg.id,
        cancel.clone(),
        || async {
            info!(source = %cfg.id, %addr, unit_id = cfg.unit_id, "Modbus TCP: connessione");
            let ctx = tcp::connect_slave(addr, Slave(cfg.unit_id))
                .await
                .map_err(|e| anyhow::anyhow!("connessione a {addr}: {e}"))?;
            info!(source = %cfg.id, "Modbus TCP: connesso");
            sessione(ctx, &cfg.id, &cfg.registers, cfg.poll_interval_ms, cfg.ordine, &db, &rx, &cancel).await
        },
        || tutti_bad(&db, &cfg.registers),
    )
    .await;
}

/// Modbus RTU (seriale): stesso motore, trasporto diverso.
pub async fn run_rtu(cfg: ModbusRtuConfig, db: Arc<TagDb>, bus: Arc<TagWriteBus>, cancel: CancellationToken) {
    let rx = registra(&bus, &cfg.registers).await;
    let parity = match cfg.parity.to_ascii_uppercase().as_str() {
        "E" => Parity::Even,
        "O" => Parity::Odd,
        _ => Parity::None,
    };
    let data_bits = if cfg.data_bits == 7 { DataBits::Seven } else { DataBits::Eight };
    let stop_bits = if cfg.stop_bits == 2 { StopBits::Two } else { StopBits::One };
    sws_core::riconnessione::con_attesa(
        &cfg.id,
        cancel.clone(),
        || async {
            info!(source = %cfg.id, device = %cfg.device, baud = cfg.baud_rate, unit_id = cfg.unit_id, "Modbus RTU: apertura");
            let stream = tokio_serial::new(&cfg.device, cfg.baud_rate)
                .parity(parity)
                .data_bits(data_bits)
                .stop_bits(stop_bits)
                .open_native_async()
                .map_err(|e| anyhow::anyhow!("apertura di {}: {e}", cfg.device))?;
            let ctx = rtu::connect_slave(stream, Slave(cfg.unit_id))
                .await
                .map_err(|e| anyhow::anyhow!("connessione RTU {}: {e}", cfg.device))?;
            info!(source = %cfg.id, "Modbus RTU: connesso");
            sessione(ctx, &cfg.id, &cfg.registers, cfg.poll_interval_ms, cfg.ordine, &db, &rx, &cancel).await
        },
        || tutti_bad(&db, &cfg.registers),
    )
    .await;
}

#[cfg(test)]
mod tests;
