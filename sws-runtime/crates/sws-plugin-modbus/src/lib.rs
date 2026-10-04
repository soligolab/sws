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
//! Bus e dispositivi (04-10-2026): una sorgente è un **bus** (una porta seriale,
//! un indirizzo TCP) con più **dispositivi** (unit id), interrogati a turno da
//! una sola sessione, ognuno col suo ordine, intervallo e timeout. Uno slave che
//! non risponde marca Bad i suoi tag e basta; il bus si riapre solo per un
//! guasto di trasporto o se tutti i dispositivi tacciono.
//!
//! Statically linked for the PoC. Dynamic .so loading via a C ABI is deferred
//! until third-party plugin support is needed (OPEN_QUESTIONS Q3).

pub mod codec;

use std::{
    collections::{HashMap, HashSet},
    io,
    sync::Arc,
    time::Duration,
};
use sws_core::stato_sorgenti::{Collegamento, StatoSorgenti};
use sws_core::{
    AreaModbus, DispositivoModbus, ModbusRtuConfig, ModbusTcpConfig, OrdineModbus, RegisterMapping, TagDb,
    TagQuality, TagValue, TagWriteBus, WriteRequest,
};
use tokio::time::Instant;
use tokio::sync::{mpsc, Mutex};
use tokio_modbus::prelude::*;
use tokio_serial::{DataBits, Parity, SerialPortBuilderExt, StopBits};
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

use codec::Slot;

/// Giri consecutivi in cui **nessuna** mappatura di un dispositivo ha risposto:
/// allora non è un registro sbagliato, è il dispositivo che non c'è. Se tacciono
/// così **tutti** i dispositivi del bus, si riconnette.
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
    /// Il dispositivo del bus a cui vanno le richieste seguenti.
    fn imposta_unita(&mut self, unita: u8);
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
    fn imposta_unita(&mut self, unita: u8) {
        self.set_slave(Slave(unita));
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
    /// Il tipo sul filo, se la mappatura lo dichiara (catalogo, 04-10-2026).
    pub formato: Option<sws_core::TipoScalare>,
    /// Un bit di un registro.
    pub bit: Option<u8>,
    pub sola_lettura: bool,
}

/// Il layout di ogni mappatura, dai tipi e dalle forme che il `TagDb` conosce
/// adesso (un salvataggio delle Variabili li cambia senza riavviare la sorgente).
pub async fn prepara(db: &TagDb, registri: &[RegisterMapping]) -> Vec<Mappatura> {
    let mut out = Vec::with_capacity(registri.len());
    for r in registri {
        // Formato sul filo o bit (catalogo, 04-10-2026): un registro (o il
        // formato) letto così, qualunque sia il tipo del tag.
        let formato = r.formato.as_deref().and_then(sws_core::TipoScalare::parse);
        if r.bit.is_some() || formato.is_some() {
            let tipo = if r.bit.is_some() { sws_core::TipoScalare::U16 } else { formato.clone().unwrap() };
            let n = tipo.registri();
            out.push(Mappatura {
                tag: r.tag.clone(),
                area: r.area,
                address: r.address,
                scale: r.scale,
                slots: vec![Slot { percorso: r.tag.clone(), tipo: Some(tipo), offset: 0, n }],
                formato: if r.bit.is_some() { None } else { formato },
                bit: r.bit,
                sola_lettura: r.sola_lettura,
            });
            continue;
        }
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
            formato: None,
            bit: None,
            sola_lettura: r.sola_lettura,
        });
    }
    out
}

async fn marca_bad(db: &TagDb, m: &Mappatura) {
    for s in &m.slots {
        db.marca_qualita(&s.percorso, TagQuality::Bad).await;
    }
}

/// Com'è andato un giro su un dispositivo.
#[derive(Debug, Default)]
pub struct EsitoGiro {
    /// Mappature che hanno risposto.
    pub risposte: usize,
    /// Il primo errore del giro, per lo stato del dispositivo.
    pub errore: Option<String>,
}

/// Un giro di lettura su un dispositivo. `Err` solo per un guasto di
/// trasporto: chi chiama chiude la sessione e riconnette.
pub async fn leggi_giro<D: Dispositivo>(
    dev: &mut D,
    db: &TagDb,
    mappature: &[Mappatura],
    ordine: OrdineModbus,
    timeout: Duration,
    in_errore: &mut HashSet<String>,
    sorgente: &str,
) -> anyhow::Result<EsitoGiro> {
    let mut esito_giro = EsitoGiro::default();
    // Una lettura per blocco in un giro: dieci bit della stessa word sono una
    // richiesta sola (catalogo, 04-10-2026).
    let mut cache: HashMap<(AreaModbus, u16, u16), Letti> = HashMap::new();
    for m in mappature {
        let n = codec::totale(&m.slots);
        let chiave = (m.area, m.address, n);
        let esito = match cache.get(&chiave) {
            Some(l) => Ok(Ok(l.clone())),
            None => tokio::time::timeout(timeout, dev.leggi(m.area, m.address, n)).await,
        };
        if let Ok(Ok(l)) = &esito {
            cache.insert(chiave, l.clone());
        }
        let letti = match esito {
            Ok(Ok(l)) => l,
            Ok(Err(e)) if e_trasporto(&e) => {
                return Err(anyhow::anyhow!("lettura di {} @{}: {e}", m.tag, m.address));
            }
            Ok(Err(e)) => {
                if in_errore.insert(m.tag.clone()) {
                    warn!(source = %sorgente, tag = %m.tag, address = m.address, "Modbus: il dispositivo risponde con un errore: {e} — tag Bad, gli altri continuano");
                }
                esito_giro.errore.get_or_insert_with(|| format!("{} @{}: {e}", m.tag, m.address));
                marca_bad(db, m).await;
                continue;
            }
            Err(_) => {
                if in_errore.insert(m.tag.clone()) {
                    warn!(source = %sorgente, tag = %m.tag, address = m.address, "Modbus: nessuna risposta in {} ms — tag Bad", timeout.as_millis());
                }
                esito_giro.errore.get_or_insert_with(|| format!("nessuna risposta in {} ms", timeout.as_millis()));
                marca_bad(db, m).await;
                continue;
            }
        };
        esito_giro.risposte += 1;
        if in_errore.remove(&m.tag) {
            info!(source = %sorgente, tag = %m.tag, "Modbus: la mappatura risponde di nuovo");
        }
        for s in &m.slots {
            let (a, b) = (s.offset as usize, (s.offset + s.n) as usize);
            let valore = match &letti {
                Letti::Registri(r) if r.len() >= b && m.bit.is_some() => {
                    Ok(TagValue::Bool(codec::estrai_bit(r[a], m.bit.unwrap_or(0))))
                }
                Letti::Registri(r) if r.len() >= b && m.formato.is_some() => {
                    codec::decodifica_formato(m.formato.as_ref().unwrap(), &r[a..b], ordine, m.scale)
                }
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
    Ok(esito_giro)
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
    if !m.area.scrivibile() || m.sola_lettura {
        warn!(source = %sorgente, %tag, area = ?m.area, "Modbus: scrittura rifiutata, registro di sola lettura");
        return Ok(());
    }
    if let Some(bit) = m.bit {
        return scrivi_bit_di_registro(dev, db, m, bit, &valore, sorgente).await;
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
            let codificato = match &m.formato {
                Some(f) => codec::codifica_formato(f, &v, ordine, m.scale),
                None => codec::codifica(slot.tipo.as_ref(), &v, ordine, m.scale),
            };
            match codificato {
                Ok(regs) => {
                    let eco = match &m.formato {
                        Some(f) => codec::decodifica_formato(f, &regs, ordine, m.scale),
                        None => codec::decodifica(slot.tipo.as_ref(), &regs, ordine, m.scale),
                    };
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

/// La scrittura di un bit dentro un registro: si legge il registro, si cambia
/// il bit, si riscrive. Fra la lettura e la scrittura il dispositivo può aver
/// cambiato un altro bit della stessa word: è il limite del leggi-modifica-
/// scrivi su Modbus, che non ha una scrittura di bit nei registri.
async fn scrivi_bit_di_registro<D: Dispositivo>(
    dev: &mut D,
    db: &TagDb,
    m: &Mappatura,
    bit: u8,
    valore: &TagValue,
    sorgente: &str,
) -> anyhow::Result<()> {
    let acceso = match codec::codifica_bit(valore) {
        Ok(b) => b,
        Err(e) => {
            warn!(source = %sorgente, tag = %m.tag, "Modbus: scrittura rifiutata: {e}");
            return Ok(());
        }
    };
    let prima = match dev.leggi(m.area, m.address, 1).await {
        Ok(Letti::Registri(r)) if !r.is_empty() => r[0],
        Ok(_) => return Ok(()),
        Err(e) if e_trasporto(&e) => return Err(anyhow::anyhow!("lettura di {} @{}: {e}", m.tag, m.address)),
        Err(e) => {
            warn!(source = %sorgente, tag = %m.tag, "Modbus: il dispositivo rifiuta la lettura prima della scrittura del bit: {e}");
            return Ok(());
        }
    };
    let dopo = codec::imposta_bit(prima, bit, acceso);
    match dev.scrivi_registri(m.address, &[dopo]).await {
        Ok(()) => {
            db.ingest(m.tag.clone(), TagValue::Bool(acceso), TagQuality::Good).await;
            info!(source = %sorgente, tag = %m.tag, addr = m.address, bit, "Modbus: scrittura del bit OK");
            Ok(())
        }
        Err(e) if e_trasporto(&e) => Err(anyhow::anyhow!("scrittura di {} @{}: {e}", m.tag, m.address)),
        Err(e) => {
            warn!(source = %sorgente, tag = %m.tag, "Modbus: il dispositivo rifiuta la scrittura del bit: {e}");
            Ok(())
        }
    }
}

/// Un dispositivo del bus durante una sessione: la sua configurazione e il suo
/// stato di lettura.
#[derive(Debug)]
pub struct Unita {
    pub unit_id: u8,
    pub ordine: OrdineModbus,
    pub timeout: Duration,
    pub intervallo: Duration,
    pub registri: Vec<RegisterMapping>,
    in_errore: HashSet<String>,
    giri_muti: u32,
    prossimo: Instant,
}

impl Unita {
    pub fn da(d: &DispositivoModbus, poll_bus_ms: u64) -> Self {
        Self {
            unit_id: d.unit_id,
            ordine: d.ordine,
            timeout: Duration::from_millis(d.timeout_ms.max(10)),
            intervallo: Duration::from_millis(d.poll_interval_ms.unwrap_or(poll_bus_ms).max(10)),
            registri: d.registers.clone(),
            in_errore: HashSet::new(),
            giri_muti: 0,
            prossimo: Instant::now(),
        }
    }

    /// Muto da abbastanza giri da far pensare che il guasto sia del bus.
    pub fn muto(&self) -> bool {
        self.giri_muti >= GIRI_MUTI_PER_RICONNETTERE
    }

    fn possiede(&self, tag: &str) -> bool {
        self.registri.iter().any(|r| r.tag == tag)
    }
}

/// Un giro su un dispositivo: lo seleziona, legge, aggiorna il suo stato.
/// `Err` solo per un guasto di trasporto.
pub async fn giro_unita<D: Dispositivo>(
    dev: &mut D,
    db: &TagDb,
    u: &mut Unita,
    stato: &StatoSorgenti,
    sorgente: &str,
) -> anyhow::Result<()> {
    dev.imposta_unita(u.unit_id);
    let m = prepara(db, &u.registri).await;
    let esito = leggi_giro(dev, db, &m, u.ordine, u.timeout, &mut u.in_errore, sorgente).await?;
    if m.is_empty() {
        return Ok(());
    }
    if esito.risposte == 0 {
        u.giri_muti += 1;
        if stato.dispositivo(sorgente, u.unit_id, Collegamento::NonRisponde, esito.errore) {
            warn!(source = %sorgente, unit_id = u.unit_id, "Modbus: il dispositivo non risponde — i suoi tag Bad, gli altri continuano");
        }
    } else {
        u.giri_muti = 0;
        if stato.dispositivo(sorgente, u.unit_id, Collegamento::Ok, esito.errore) {
            info!(source = %sorgente, unit_id = u.unit_id, "Modbus: il dispositivo risponde");
        }
    }
    Ok(())
}

/// Una sessione sul bus: i dispositivi a turno, ognuno col suo intervallo, e le
/// scritture, finché la connessione regge.
pub async fn sessione<D: Dispositivo>(
    mut dev: D,
    sorgente: &str,
    unita: &mut [Unita],
    db: &TagDb,
    stato: &StatoSorgenti,
    write_rx: &Mutex<mpsc::Receiver<WriteRequest>>,
    cancel: &CancellationToken,
) -> anyhow::Result<()> {
    let mut rx = write_rx.lock().await;
    for u in unita.iter_mut() {
        u.prossimo = Instant::now();
        u.giri_muti = 0;
    }
    loop {
        let prossimo = unita.iter().map(|u| u.prossimo).min().unwrap_or_else(|| Instant::now() + Duration::from_secs(3600));
        tokio::select! {
            _ = cancel.cancelled() => return Ok(()),
            _ = tokio::time::sleep_until(prossimo) => {
                let adesso = Instant::now();
                for u in unita.iter_mut().filter(|u| u.prossimo <= adesso) {
                    giro_unita(&mut dev, db, u, stato, sorgente).await?;
                    u.prossimo = Instant::now() + u.intervallo;
                }
                if !unita.is_empty() && unita.iter().all(Unita::muto) {
                    return Err(anyhow::anyhow!("nessun dispositivo risponde da {GIRI_MUTI_PER_RICONNETTERE} giri"));
                }
            }
            Some(req) = rx.recv() => {
                let Some(u) = unita.iter_mut().find(|u| u.possiede(&req.0)) else { continue };
                dev.imposta_unita(u.unit_id);
                let m = prepara(db, &u.registri).await;
                scrivi(&mut dev, db, &m, u.ordine, req, sorgente).await?;
            }
        }
    }
}

/// Tutte le mappature del bus, di tutti i dispositivi.
fn tutti_i_registri(dispositivi: &[DispositivoModbus]) -> Vec<RegisterMapping> {
    dispositivi.iter().flat_map(|d| d.registers.iter().cloned()).collect()
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

/// Esegue una sessione e ne riporta l'esito nello stato del bus.
async fn con_stato(stato: &StatoSorgenti, sorgente: &str, r: anyhow::Result<()>) -> anyhow::Result<()> {
    if let Err(e) = &r {
        stato.caduta(sorgente, e.to_string());
    }
    r
}

/// Modbus TCP: sessioni una dopo l'altra finché `cancel` non scatta. Più
/// dispositivi = più unit id dietro lo stesso indirizzo (un gateway).
pub async fn run(cfg: ModbusTcpConfig, db: Arc<TagDb>, bus: Arc<TagWriteBus>, stato: Arc<StatoSorgenti>, cancel: CancellationToken) {
    let dispositivi = cfg.dispositivi();
    let registri = tutti_i_registri(&dispositivi);
    stato.registra(&cfg.id, dispositivi.iter().map(|d| d.unit_id));
    let rx = registra(&bus, &registri).await;
    let addr: std::net::SocketAddr = match format!("{}:{}", cfg.host, cfg.port).parse() {
        Ok(a) => a,
        Err(e) => {
            warn!(source = %cfg.id, "Modbus TCP: indirizzo non valido «{}:{}»: {e} — ferma finché non si corregge la configurazione", cfg.host, cfg.port);
            stato.caduta(&cfg.id, format!("indirizzo non valido: {e}"));
            tutti_bad(&db, &registri).await;
            return;
        }
    };
    let mut unita: Vec<Unita> = dispositivi.iter().map(|d| Unita::da(d, cfg.poll_interval_ms)).collect();
    let primo = unita.first().map(|u| u.unit_id).unwrap_or(cfg.unit_id);
    let unita = Mutex::new(&mut unita);
    sws_core::riconnessione::con_attesa(
        &cfg.id,
        cancel.clone(),
        || async {
            info!(source = %cfg.id, %addr, dispositivi = dispositivi.len(), "Modbus TCP: connessione");
            let r = async {
                let ctx = tcp::connect_slave(addr, Slave(primo))
                    .await
                    .map_err(|e| anyhow::anyhow!("connessione a {addr}: {e}"))?;
                info!(source = %cfg.id, "Modbus TCP: connesso");
                stato.bus(&cfg.id, Collegamento::Ok, None);
                let mut u = unita.lock().await;
                sessione(ctx, &cfg.id, u.as_mut_slice(), &db, &stato, &rx, &cancel).await
            }
            .await;
            con_stato(&stato, &cfg.id, r).await
        },
        || tutti_bad(&db, &registri),
    )
    .await;
}

/// Modbus RTU (seriale): la porta si apre una volta per tutto il bus, gli
/// slave si interrogano a turno.
pub async fn run_rtu(cfg: ModbusRtuConfig, db: Arc<TagDb>, bus: Arc<TagWriteBus>, stato: Arc<StatoSorgenti>, cancel: CancellationToken) {
    let dispositivi = cfg.dispositivi();
    let registri = tutti_i_registri(&dispositivi);
    stato.registra(&cfg.id, dispositivi.iter().map(|d| d.unit_id));
    let rx = registra(&bus, &registri).await;
    let parity = match cfg.parity.to_ascii_uppercase().as_str() {
        "E" => Parity::Even,
        "O" => Parity::Odd,
        _ => Parity::None,
    };
    let data_bits = if cfg.data_bits == 7 { DataBits::Seven } else { DataBits::Eight };
    let stop_bits = if cfg.stop_bits == 2 { StopBits::Two } else { StopBits::One };
    let mut unita: Vec<Unita> = dispositivi.iter().map(|d| Unita::da(d, cfg.poll_interval_ms)).collect();
    let primo = unita.first().map(|u| u.unit_id).unwrap_or(cfg.unit_id);
    let unita = Mutex::new(&mut unita);
    sws_core::riconnessione::con_attesa(
        &cfg.id,
        cancel.clone(),
        || async {
            info!(source = %cfg.id, device = %cfg.device, baud = cfg.baud_rate, dispositivi = dispositivi.len(), "Modbus RTU: apertura");
            let r = async {
                let stream = tokio_serial::new(&cfg.device, cfg.baud_rate)
                    .parity(parity)
                    .data_bits(data_bits)
                    .stop_bits(stop_bits)
                    .open_native_async()
                    .map_err(|e| anyhow::anyhow!("apertura di {}: {e}", cfg.device))?;
                let ctx = rtu::connect_slave(stream, Slave(primo))
                    .await
                    .map_err(|e| anyhow::anyhow!("connessione RTU {}: {e}", cfg.device))?;
                info!(source = %cfg.id, "Modbus RTU: porta aperta");
                stato.bus(&cfg.id, Collegamento::Ok, None);
                let mut u = unita.lock().await;
                sessione(ctx, &cfg.id, u.as_mut_slice(), &db, &stato, &rx, &cancel).await
            }
            .await;
            con_stato(&stato, &cfg.id, r).await
        },
        || tutti_bad(&db, &registri),
    )
    .await;
}

#[cfg(test)]
mod tests;
