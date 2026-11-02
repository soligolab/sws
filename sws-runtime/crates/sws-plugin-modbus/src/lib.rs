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
pub mod trama_rtu;
pub mod solarman;
pub mod trasporti;

use std::{
    collections::{HashMap, HashSet},
    io,
    sync::Arc,
    time::Duration,
};
use sws_core::stato_sorgenti::{Collegamento, StatoSorgenti};
use sws_core::{
    AreaModbus, DispositivoModbus, ModbusRtuConfig, ModbusTcpConfig, OrdineModbus, RegisterMapping, TagDb,
    BloccoModbus, ModoTesti, TagQuality, TagValue, TagWriteBus, TestiRegistro, TrasportoTcp, WriteRequest,
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
    /// I limiti di plausibilità (01-11-2026).
    pub min: Option<f64>,
    pub max: Option<f64>,
    /// Il testo al posto del numero.
    pub testi: Option<TestiRegistro>,
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
                min: r.min,
                max: r.max,
                testi: r.testi.clone(),
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
            min: r.min,
            max: r.max,
            testi: r.testi.clone(),
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
    /// Mappature (o blocchi) chiesti in questo giro: un giro in cui tocca solo
    /// a blocchi lenti non chiede niente, e non vuol dire che il dispositivo
    /// taccia.
    pub chieste: usize,
    /// Il primo errore del giro, per lo stato del dispositivo.
    pub errore: Option<String>,
    /// I contatori di diagnostica del giro (01-11-2026).
    pub diagnostica: Diagnostica,
}

/// Cosa è andato storto, contato (01-11-2026).
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Diagnostica {
    /// Richieste senza risposta nel tempo massimo.
    pub timeout: u64,
    /// Risposte arrivate rotte (CRC, checksum, pezzi mescolati) anche dopo i tentativi.
    pub risposte_rotte: u64,
    /// Valori fuori dai limiti di plausibilità.
    pub non_plausibili: u64,
}

impl Diagnostica {
    fn somma(&mut self, o: Diagnostica) {
        self.timeout += o.timeout;
        self.risposte_rotte += o.risposte_rotte;
        self.non_plausibili += o.non_plausibili;
    }
}

/// Il blocco che contiene per intero `n` registri da `addr` nell'area `area`.
fn blocco_di(blocchi: &[BloccoModbus], area: AreaModbus, addr: u16, n: u16) -> Option<usize> {
    let fine = addr as u32 + n.max(1) as u32 - 1;
    blocchi.iter().position(|b| b.area == area && addr >= b.da && fine <= b.a as u32)
}

/// Il pezzo di un blocco letto che serve a una mappatura.
fn ritaglia(l: &Letti, da: u16, addr: u16, n: u16) -> Option<Letti> {
    let (a, b) = ((addr - da) as usize, (addr - da) as usize + n as usize);
    match l {
        Letti::Registri(r) if r.len() >= b => Some(Letti::Registri(r[a..b].to_vec())),
        Letti::Bit(x) if x.len() >= b => Some(Letti::Bit(x[a..b].to_vec())),
        _ => None,
    }
}

/// Fuori dai limiti di plausibilità? Solo i numeri.
fn fuori_limiti(m: &Mappatura, v: &TagValue) -> bool {
    let x = match v {
        TagValue::Float(f) => *f,
        TagValue::Int(i) => *i as f64,
        _ => return false,
    };
    m.min.is_some_and(|lo| x < lo) || m.max.is_some_and(|hi| x > hi)
}

/// Il testo di un numero: la voce del valore, o le voci dei bit accesi.
pub fn testo_di(testi: &TestiRegistro, v: &TagValue) -> TagValue {
    let n = match v {
        TagValue::Int(i) => *i as u32,
        TagValue::Float(f) => f.round() as u32,
        TagValue::Bool(b) => *b as u32,
        altro => return altro.clone(),
    };
    TagValue::Str(match testi.modo {
        ModoTesti::Valore => testi.voci.get(&n).cloned().unwrap_or_else(|| n.to_string()),
        ModoTesti::Bit => (0..32)
            .filter(|b| n & (1 << b) != 0)
            .map(|b| testi.voci.get(&b).cloned().unwrap_or_else(|| format!("bit {b}")))
            .collect::<Vec<_>>()
            .join("; "),
    })
}

/// Un errore di lettura che non è di trasporto, per i contatori.
fn conta(d: &mut Diagnostica, esito: &Result<io::Result<Letti>, tokio::time::error::Elapsed>) {
    match esito {
        Err(_) => d.timeout += 1,
        Ok(Err(e)) if e.kind() == io::ErrorKind::InvalidData => d.risposte_rotte += 1,
        _ => {}
    }
}

/// Un giro di lettura su un dispositivo. `Err` solo per un guasto di
/// trasporto: chi chiama chiude la sessione e riconnette.
///
/// Prima i **blocchi** che toccano a questo giro (`giro % ogni == 0`), una
/// richiesta ciascuno; poi le mappature: quella che cade in un blocco si serve
/// da lì (e se il blocco non tocca a questo giro, resta com'è), le altre
/// chiedono per sé come sempre.
#[allow(clippy::too_many_arguments)]
pub async fn leggi_giro<D: Dispositivo>(
    dev: &mut D,
    db: &TagDb,
    mappature: &[Mappatura],
    ordine: OrdineModbus,
    timeout: Duration,
    in_errore: &mut HashSet<String>,
    sorgente: &str,
    blocchi: &[BloccoModbus],
    giro: u64,
) -> anyhow::Result<EsitoGiro> {
    let mut esito_giro = EsitoGiro::default();
    // I blocchi del giro: `None` = non tocca a questo giro, `Some(None)` =
    // chiesto e non risposto.
    let mut letti_blocchi: Vec<Option<Option<Letti>>> = Vec::with_capacity(blocchi.len());
    for b in blocchi {
        if giro % b.ogni.max(1) as u64 != 0 {
            letti_blocchi.push(None);
            continue;
        }
        esito_giro.chieste += 1;
        let n = b.a.saturating_sub(b.da) + 1;
        let esito = tokio::time::timeout(timeout, dev.leggi(b.area, b.da, n)).await;
        conta(&mut esito_giro.diagnostica, &esito);
        letti_blocchi.push(Some(match esito {
            Ok(Ok(l)) => Some(l),
            Ok(Err(e)) if e_trasporto(&e) => return Err(anyhow::anyhow!("lettura del blocco @{}..{}: {e}", b.da, b.a)),
            Ok(Err(e)) => {
                let chiave = format!("blocco@{}", b.da);
                if in_errore.insert(chiave) {
                    warn!(source = %sorgente, da = b.da, a = b.a, "Modbus: il blocco risponde con un errore: {e} — i suoi tag Bad");
                }
                esito_giro.errore.get_or_insert_with(|| format!("blocco @{}..{}: {e}", b.da, b.a));
                None
            }
            Err(_) => {
                let chiave = format!("blocco@{}", b.da);
                if in_errore.insert(chiave) {
                    warn!(source = %sorgente, da = b.da, a = b.a, "Modbus: il blocco non risponde in {} ms — i suoi tag Bad", timeout.as_millis());
                }
                esito_giro.errore.get_or_insert_with(|| format!("nessuna risposta in {} ms", timeout.as_millis()));
                None
            }
        }));
        if letti_blocchi.last().is_some_and(|l| l.as_ref().is_some_and(Option::is_some)) && in_errore.remove(&format!("blocco@{}", b.da)) {
            info!(source = %sorgente, da = b.da, "Modbus: il blocco risponde di nuovo");
        }
    }
    // Una lettura per blocco in un giro: dieci bit della stessa word sono una
    // richiesta sola (catalogo, 04-10-2026).
    let mut cache: HashMap<(AreaModbus, u16, u16), Letti> = HashMap::new();
    // E i blocchi che nel giro non hanno risposto: sedici bit di una word muta
    // erano sedici attese da un secondo (collaudo sul TC620, 04-10-2026).
    let mut muti: HashSet<(AreaModbus, u16, u16)> = HashSet::new();
    for m in mappature {
        let n = codec::totale(&m.slots);
        let letti = if let Some(i) = blocco_di(blocchi, m.area, m.address, n) {
            match &letti_blocchi[i] {
                None => continue,
                Some(None) => {
                    marca_bad(db, m).await;
                    continue;
                }
                Some(Some(l)) => match ritaglia(l, blocchi[i].da, m.address, n) {
                    Some(l) => l,
                    None => {
                        marca_bad(db, m).await;
                        continue;
                    }
                },
            }
        } else {
            let chiave = (m.area, m.address, n);
            if muti.contains(&chiave) {
                marca_bad(db, m).await;
                continue;
            }
            let esito = match cache.get(&chiave) {
                Some(l) => Ok(Ok(l.clone())),
                None => {
                    esito_giro.chieste += 1;
                    let e = tokio::time::timeout(timeout, dev.leggi(m.area, m.address, n)).await;
                    conta(&mut esito_giro.diagnostica, &e);
                    e
                }
            };
            if let Ok(Ok(l)) = &esito {
                cache.insert(chiave, l.clone());
            }
            match esito {
                Ok(Ok(l)) => l,
                Ok(Err(e)) if e_trasporto(&e) => {
                    return Err(anyhow::anyhow!("lettura di {} @{}: {e}", m.tag, m.address));
                }
                Ok(Err(e)) => {
                    muti.insert(chiave);
                    if in_errore.insert(m.tag.clone()) {
                        warn!(source = %sorgente, tag = %m.tag, address = m.address, "Modbus: il dispositivo risponde con un errore: {e} — tag Bad, gli altri continuano");
                    }
                    esito_giro.errore.get_or_insert_with(|| format!("{} @{}: {e}", m.tag, m.address));
                    marca_bad(db, m).await;
                    continue;
                }
                Err(_) => {
                    muti.insert(chiave);
                    if in_errore.insert(m.tag.clone()) {
                        warn!(source = %sorgente, tag = %m.tag, address = m.address, "Modbus: nessuna risposta in {} ms — tag Bad", timeout.as_millis());
                    }
                    esito_giro.errore.get_or_insert_with(|| format!("nessuna risposta in {} ms", timeout.as_millis()));
                    marca_bad(db, m).await;
                    continue;
                }
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
                Ok(v) if fuori_limiti(m, &v) => {
                    esito_giro.diagnostica.non_plausibili += 1;
                    if in_errore.insert(format!("plausibile:{}", s.percorso)) {
                        warn!(source = %sorgente, tag = %s.percorso, valore = ?v, min = ?m.min, max = ?m.max,
                            "Modbus: valore fuori dai limiti di plausibilità — tag Bad (registro o mappa sbagliati?)");
                    }
                    db.marca_qualita(&s.percorso, TagQuality::Bad).await;
                }
                Ok(v) => {
                    in_errore.remove(&format!("plausibile:{}", s.percorso));
                    let v = match &m.testi {
                        Some(t) => testo_di(t, &v),
                        None => v,
                    };
                    db.ingest(s.percorso.clone(), v, TagQuality::Good).await
                }
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
    pub setup: Vec<sws_core::ParametroSetup>,
    /// Il setup è stato applicato **in questa sessione**: si rifà a ogni
    /// ricollegamento, perché è il momento in cui un modulo può essere stato
    /// sostituito o spento.
    setup_fatto: bool,
    in_errore: HashSet<String>,
    giri_muti: u32,
    prossimo: Instant,
    /// I blocchi letti con una richiesta sola, e il numero del giro per quelli
    /// che si leggono un giro su n (01-11-2026).
    pub blocchi: Vec<BloccoModbus>,
    giro: u64,
    /// I contatori dall'avvio della sorgente.
    pub diagnostica: Diagnostica,
    /// La sorgente li pubblica come tag (`<id>.diagnostics.*`).
    pub pubblica_diagnostica: bool,
}

impl Unita {
    pub fn da(d: &DispositivoModbus, poll_bus_ms: u64) -> Self {
        Self {
            unit_id: d.unit_id,
            ordine: d.ordine,
            timeout: Duration::from_millis(d.timeout_ms.max(10)),
            intervallo: Duration::from_millis(d.poll_interval_ms.unwrap_or(poll_bus_ms).max(10)),
            registri: d.registers.clone(),
            setup: d.setup.clone(),
            setup_fatto: false,
            in_errore: HashSet::new(),
            giri_muti: 0,
            prossimo: Instant::now(),
            blocchi: d.blocchi.clone(),
            giro: 0,
            diagnostica: Diagnostica::default(),
            pubblica_diagnostica: false,
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
    let _giro = sws_core::prestazioni::Misura::nuova(format!("sorgente.modbus.{sorgente}"));
    let m = prepara(db, &u.registri).await;
    let esito = leggi_giro(dev, db, &m, u.ordine, u.timeout, &mut u.in_errore, sorgente, &u.blocchi, u.giro).await?;
    u.giro += 1;
    u.diagnostica.somma(esito.diagnostica);
    // Il setup alla prima risposta della sessione. Un dispositivo senza
    // mappature ma con un setup lo riceve lo stesso: lì la lettura dei
    // parametri fa da prova di vita.
    if !u.setup_fatto && !u.setup.is_empty() && (esito.risposte > 0 || m.is_empty()) {
        u.setup_fatto = applica_setup(dev, u, sorgente).await?;
    }
    if m.is_empty() {
        return Ok(());
    }
    if esito.chieste == 0 {
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

/// Il configuratore dei moduli (25-10-2026): legge ogni parametro del setup,
/// lo confronta col progetto e **scrive solo quelli diversi** (decisione del
/// maintainer: vince il progetto, e non si consuma la memoria del modulo
/// riscrivendo valori uguali). Il log dice cosa è cambiato.
///
/// `Ok(true)` = fatto (anche con parametri rifiutati, che si dicono e non si
/// ritentano a ogni giro); `Ok(false)` = il dispositivo non ha risposto, si
/// riprova al prossimo giro; `Err` = la connessione è caduta.
pub async fn applica_setup<D: Dispositivo>(dev: &mut D, u: &Unita, sorgente: &str) -> anyhow::Result<bool> {
    let mut cambiati = 0;
    let mut rifiutati = 0;
    for p in &u.setup {
        let voluto = p.valore as u16;
        let letto = match tokio::time::timeout(u.timeout, dev.leggi(AreaModbus::Holding, p.indirizzo, 1)).await {
            Err(_) => return Ok(false),
            Ok(Err(e)) if e_trasporto(&e) => return Err(e.into()),
            Ok(Err(e)) => {
                warn!(source = %sorgente, unit_id = u.unit_id, parametro = %p.nome, indirizzo = p.indirizzo,
                    "Modbus: setup del modulo — il parametro non si legge ({e}), non lo scrivo");
                rifiutati += 1;
                continue;
            }
            Ok(Ok(Letti::Registri(v))) => v.first().copied(),
            Ok(Ok(Letti::Bit(_))) => None,
        };
        if letto == Some(voluto) {
            continue;
        }
        let dove = p.indirizzo_scrittura.unwrap_or(p.indirizzo);
        match tokio::time::timeout(u.timeout, dev.scrivi_registri(dove, &[voluto])).await {
            Err(_) => return Ok(false),
            Ok(Err(e)) if e_trasporto(&e) => return Err(e.into()),
            Ok(Err(e)) => {
                warn!(source = %sorgente, unit_id = u.unit_id, parametro = %p.nome, indirizzo = dove, valore = p.valore,
                    "Modbus: setup del modulo — il modulo rifiuta il valore ({e})");
                rifiutati += 1;
            }
            Ok(Ok(())) => {
                info!(source = %sorgente, unit_id = u.unit_id, parametro = %p.nome,
                    "Modbus: setup del modulo — {} da {} a {}", p.nome,
                    letto.map(|x| x.to_string()).unwrap_or_else(|| "?".into()), p.valore);
                cambiati += 1;
            }
        }
    }
    if cambiati > 0 || rifiutati > 0 {
        info!(source = %sorgente, unit_id = u.unit_id, cambiati, rifiutati, uguali = u.setup.len() - cambiati - rifiutati,
            "Modbus: setup del modulo applicato");
    }
    Ok(true)
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
    let mut ultima_diagnostica: Option<Diagnostica> = None;
    for u in unita.iter_mut() {
        u.prossimo = Instant::now();
        u.giri_muti = 0;
        u.setup_fatto = false;
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
                if unita.iter().any(|u| u.pubblica_diagnostica) {
                    let mut tot = Diagnostica::default();
                    unita.iter().for_each(|u| tot.somma(u.diagnostica));
                    if ultima_diagnostica != Some(tot) {
                        pubblica_diagnostica(db, sorgente, tot).await;
                        ultima_diagnostica = Some(tot);
                    }
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

/// I nomi dei tag di diagnostica di una sorgente (01-11-2026): in inglese,
/// come ogni nome che SWS dà da sé (decisione del maintainer, 01-11-2026).
pub fn tag_diagnostica(sorgente: &str) -> [String; 3] {
    ["timeouts", "bad_replies", "implausible"].map(|c| format!("{sorgente}.diagnostics.{c}"))
}

async fn pubblica_diagnostica(db: &TagDb, sorgente: &str, d: Diagnostica) {
    let [t, r, p] = tag_diagnostica(sorgente);
    for (id, v) in [(t, d.timeout), (r, d.risposte_rotte), (p, d.non_plausibili)] {
        db.set_tipizzato(id, TagValue::Int(v as i64), TagQuality::Good).await;
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
///
/// Il trasporto (01-11-2026) decide cosa viaggia nel socket: MBAP, la trama RTU
/// nuda, o la trama RTU in un pacchetto Solarman V5 ([`trasporti`]). L'indirizzo
/// si risolve a ogni connessione, così un nome (`inverter.casa.lan`) va bene
/// quanto un IP.
pub async fn run(cfg: ModbusTcpConfig, db: Arc<TagDb>, bus: Arc<TagWriteBus>, stato: Arc<StatoSorgenti>, cancel: CancellationToken) {
    let dispositivi = cfg.dispositivi();
    let registri = tutti_i_registri(&dispositivi);
    stato.registra(&cfg.id, dispositivi.iter().map(|d| d.unit_id));
    let rx = registra(&bus, &registri).await;
    let indirizzo = format!("{}:{}", cfg.host, cfg.port);
    if cfg.trasporto == TrasportoTcp::SolarmanV5 && cfg.seriale_logger.is_none() {
        warn!(source = %cfg.id, "Modbus: Solarman V5 senza il numero di serie della chiavetta — ferma finché non si corregge la configurazione");
        stato.caduta(&cfg.id, "manca il numero di serie della chiavetta Solarman".into());
        tutti_bad(&db, &registri).await;
        return;
    }
    let mut unita: Vec<Unita> = dispositivi
        .iter()
        .map(|d| Unita { pubblica_diagnostica: cfg.diagnostica, ..Unita::da(d, cfg.poll_interval_ms) })
        .collect();
    let primo = unita.first().map(|u| u.unit_id).unwrap_or(cfg.unit_id);
    let unita = Mutex::new(&mut unita);
    sws_core::riconnessione::con_attesa(
        &cfg.id,
        cancel.clone(),
        || async {
            info!(source = %cfg.id, %indirizzo, trasporto = ?cfg.trasporto, dispositivi = dispositivi.len(), "Modbus TCP: connessione");
            let r = async {
                let addr = tokio::net::lookup_host(&indirizzo)
                    .await
                    .map_err(|e| anyhow::anyhow!("indirizzo «{indirizzo}»: {e}"))?
                    .next()
                    .ok_or_else(|| anyhow::anyhow!("indirizzo «{indirizzo}»: nessun risultato"))?;
                let (pausa, tentativi) = (cfg.pausa_ms, cfg.tentativi);
                let mut u = unita.lock().await;
                match cfg.trasporto {
                    TrasportoTcp::Mbap => {
                        let ctx = tcp::connect_slave(addr, Slave(primo))
                            .await
                            .map_err(|e| anyhow::anyhow!("connessione a {addr}: {e}"))?;
                        info!(source = %cfg.id, "Modbus TCP: connesso");
                        stato.bus(&cfg.id, Collegamento::Ok, None);
                        sessione(trasporti::Ritmato::nuovo(ctx, pausa, tentativi), &cfg.id, u.as_mut_slice(), &db, &stato, &rx, &cancel).await
                    }
                    TrasportoTcp::RtuSuTcp => {
                        let s = tokio::net::TcpStream::connect(addr)
                            .await
                            .map_err(|e| anyhow::anyhow!("connessione a {addr}: {e}"))?;
                        let ctx = rtu::connect_slave(s, Slave(primo))
                            .await
                            .map_err(|e| anyhow::anyhow!("RTU su TCP {addr}: {e}"))?;
                        info!(source = %cfg.id, "Modbus RTU su TCP: connesso");
                        stato.bus(&cfg.id, Collegamento::Ok, None);
                        sessione(trasporti::Ritmato::nuovo(ctx, pausa, tentativi), &cfg.id, u.as_mut_slice(), &db, &stato, &rx, &cancel).await
                    }
                    TrasportoTcp::SolarmanV5 => {
                        let s = tokio::net::TcpStream::connect(addr)
                            .await
                            .map_err(|e| anyhow::anyhow!("connessione a {addr}: {e}"))?;
                        let mut client = trasporti::ClientSolarman::nuovo(s, cfg.seriale_logger.unwrap_or(0), primo);
                        // Con i tentativi accesi, una lettura muta si rimanda a metà del
                        // timeout più corto: c'è ancora tempo per la seconda risposta.
                        if tentativi > 0 {
                            if let Some(t) = u.iter().map(|x| x.timeout).min() {
                                client = client.con_ripetizione(t / 2);
                            }
                        }
                        info!(source = %cfg.id, "Modbus su Solarman V5: connesso");
                        stato.bus(&cfg.id, Collegamento::Ok, None);
                        sessione(trasporti::Ritmato::nuovo(client, pausa, tentativi), &cfg.id, u.as_mut_slice(), &db, &stato, &rx, &cancel).await
                    }
                }
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
