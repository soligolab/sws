//! Il motore Modbus su un dispositivo finto (Fase 3, 04-10-2026): niente rete,
//! solo registri in memoria, eccezioni e guasti a comando.

use super::*;
use std::collections::HashMap;
use sws_core::{Forma, Membro, TagDef, TypeDef};

#[derive(Default)]
struct Finto {
    registri: HashMap<u16, u16>,
    bit: HashMap<u16, bool>,
    /// Indirizzi a cui il dispositivo risponde con un'eccezione.
    eccezioni: HashSet<u16>,
    /// Ogni operazione fallisce come una connessione chiusa.
    caduto: bool,
    scritture: Vec<(u16, Vec<u16>)>,
    /// Il dispositivo selezionato sul bus (bus e dispositivi, 04-10-2026).
    unita: u8,
    /// Registri propri di un'unità: vincono su `registri`.
    per_unita: HashMap<(u8, u16), u16>,
    /// Unità che non rispondono mai (la richiesta resta appesa).
    mute: HashSet<u8>,
    /// Le unità a cui sono andate le scritture, in ordine.
    scritture_a: Vec<u8>,
    /// Quante letture sono arrivate al dispositivo.
    letture: u32,
}

impl Dispositivo for Finto {
    async fn leggi(&mut self, area: AreaModbus, addr: u16, n: u16) -> io::Result<Letti> {
        self.letture += 1;
        if self.mute.contains(&self.unita) {
            std::future::pending::<()>().await;
        }
        if self.caduto {
            return Err(io::Error::new(io::ErrorKind::BrokenPipe, "chiuso"));
        }
        if self.eccezioni.contains(&addr) {
            return Err(io::Error::new(io::ErrorKind::Other, "Illegal data address"));
        }
        Ok(if area.a_bit() {
            Letti::Bit((addr..addr + n).map(|a| *self.bit.get(&a).unwrap_or(&false)).collect())
        } else {
            Letti::Registri(
                (addr..addr + n)
                    .map(|a| *self.per_unita.get(&(self.unita, a)).or(self.registri.get(&a)).unwrap_or(&0))
                    .collect(),
            )
        })
    }
    async fn scrivi_registri(&mut self, addr: u16, regs: &[u16]) -> io::Result<()> {
        if self.caduto {
            return Err(io::Error::new(io::ErrorKind::BrokenPipe, "chiuso"));
        }
        for (i, r) in regs.iter().enumerate() {
            self.registri.insert(addr + i as u16, *r);
        }
        self.scritture.push((addr, regs.to_vec()));
        self.scritture_a.push(self.unita);
        Ok(())
    }
    async fn scrivi_bit(&mut self, addr: u16, bit: &[bool]) -> io::Result<()> {
        for (i, b) in bit.iter().enumerate() {
            self.bit.insert(addr + i as u16, *b);
        }
        Ok(())
    }
    fn imposta_unita(&mut self, unita: u8) {
        self.unita = unita;
    }
}

fn mappa(tag: &str, address: u16, area: AreaModbus) -> RegisterMapping {
    RegisterMapping { tag: tag.into(), address, scale: 1.0, area, formato: None, bit: None, sola_lettura: false }
}

fn membro(nome: &str, tipo: &str) -> Membro {
    serde_yaml::from_str(&format!("name: {nome}\ndata_type: {tipo}\n")).unwrap()
}

/// Un `TagDb` con i tipi installati come fa `apply_tags`.
async fn db_con(tags: &[TagDef], types: &[TypeDef]) -> TagDb {
    let db = TagDb::new(64);
    let mut tipi = HashMap::new();
    let mut forme = HashMap::new();
    for t in tags {
        match Forma::da_tag(t, types).unwrap() {
            Some(f) => {
                for fo in f.foglie(&t.id, types) {
                    tipi.insert(fo.percorso.clone(), fo.tipo.nome());
                }
                db.set(t.id.clone(), f.valore_iniziale(), TagQuality::Uncertain).await;
                forme.insert(t.id.clone(), f);
            }
            None => {
                tipi.insert(t.id.clone(), t.data_type.clone());
            }
        }
    }
    db.set_forme(forme).await;
    db.set_data_types(tipi).await;
    db
}

fn tag(id: &str, tipo: &str) -> TagDef {
    serde_yaml::from_str(&format!("id: {id}\ndata_type: {tipo}\n")).unwrap()
}

fn istanza(id: &str, tipo: &str) -> TagDef {
    serde_yaml::from_str(&format!("id: {id}\ntype_ref: {tipo}\n")).unwrap()
}

fn tipo_motore() -> TypeDef {
    TypeDef {
        id: "motore".into(),
        description: String::new(),
        members: vec![membro("marcia", "bool"), membro("velocita", "f32"), membro("ore", "u32")],
    }
}

const T: Duration = Duration::from_secs(3);

async fn giro(dev: &mut Finto, db: &TagDb, regs: &[RegisterMapping], ordine: OrdineModbus) -> anyhow::Result<EsitoGiro> {
    let m = prepara(db, regs).await;
    leggi_giro(dev, db, &m, ordine, T, &mut HashSet::new(), "prova").await
}

async fn val(db: &TagDb, id: &str) -> (TagValue, TagQuality) {
    let s = db.get(id).await.unwrap_or_else(|| panic!("{id} assente"));
    (s.value, s.quality)
}

#[tokio::test]
async fn ogni_tag_si_legge_col_suo_tipo() {
    let db = db_con(&[tag("t", "i16"), tag("vecchio", "float"), tag("f", "f32"), tag("allarme", "i32")], &[]).await;
    let mut dev = Finto::default();
    dev.registri.insert(0, 0xFFFE); // -2 come i16
    dev.registri.insert(1, 0xFFFE); // il tag «float» storico: un u16
    dev.registri.insert(10, 0x0000); // 1.5 f32 in CDAB: parola bassa prima
    dev.registri.insert(11, 0x3FC0);
    dev.bit.insert(5, true);
    let regs = [
        mappa("t", 0, AreaModbus::Holding),
        RegisterMapping { scale: 0.1, ..mappa("vecchio", 1, AreaModbus::Holding) },
        mappa("f", 10, AreaModbus::Input),
        mappa("allarme", 5, AreaModbus::Coil),
    ];
    giro(&mut dev, &db, &regs, OrdineModbus::Cdab).await.unwrap();
    assert_eq!(val(&db, "t").await.0, TagValue::Int(-2), "i16 con segno");
    assert!(
        matches!(val(&db, "vecchio").await.0, TagValue::Float(f) if (f - 65534.0 * 0.1).abs() < 1e-9),
        "nome storico: u16 × scala, come prima"
    );
    assert_eq!(val(&db, "f").await.0, TagValue::Float(1.5));
    assert_eq!(val(&db, "allarme").await.0, TagValue::Int(1), "coil su un intero: 0/1");
}

#[tokio::test]
async fn una_struttura_si_legge_a_blocco() {
    let db = db_con(&[istanza("m1", "motore")], &[tipo_motore()]).await;
    let mut dev = Finto::default();
    dev.registri.insert(100, 1); // marcia
    dev.registri.insert(101, 0x4248); // velocita 50.0 f32 = 0x42480000
    dev.registri.insert(102, 0x0000);
    dev.registri.insert(103, 0x0001); // ore u32 = 65536 + 2
    dev.registri.insert(104, 0x0002);
    giro(&mut dev, &db, &[mappa("m1", 100, AreaModbus::Holding)], OrdineModbus::Abcd).await.unwrap();
    assert_eq!(val(&db, "m1.marcia").await, (TagValue::Bool(true), TagQuality::Good));
    assert_eq!(val(&db, "m1.velocita").await.0, TagValue::Float(50.0));
    assert_eq!(val(&db, "m1.ore").await.0, TagValue::Int(65538));
}

#[tokio::test]
async fn un_registro_in_errore_non_ferma_gli_altri() {
    let db = db_con(&[tag("a", "u16"), tag("b", "u16")], &[]).await;
    let mut dev = Finto::default();
    dev.registri.insert(1, 7);
    dev.eccezioni.insert(0);
    let regs = [mappa("a", 0, AreaModbus::Holding), mappa("b", 1, AreaModbus::Holding)];
    db.set("a".into(), TagValue::Int(3), TagQuality::Good).await;
    giro(&mut dev, &db, &regs, OrdineModbus::Abcd).await.expect("un'eccezione non chiude la sessione");
    assert_eq!(val(&db, "a").await, (TagValue::Int(3), TagQuality::Bad), "resta l'ultimo valore, Bad");
    assert_eq!(val(&db, "b").await, (TagValue::Int(7), TagQuality::Good));
}

#[tokio::test]
async fn un_guasto_di_trasporto_chiude_la_sessione() {
    let db = db_con(&[tag("a", "u16")], &[]).await;
    let regs = [mappa("a", 0, AreaModbus::Holding)];
    let mut dev = Finto { caduto: true, ..Default::default() };
    assert!(giro(&mut dev, &db, &regs, OrdineModbus::Abcd).await.is_err());
    // Un'eccezione invece è una risposta del dispositivo: il giro va avanti.
    let mut dev = Finto::default();
    dev.eccezioni.insert(0);
    let e = giro(&mut dev, &db, &regs, OrdineModbus::Abcd).await.unwrap();
    assert_eq!(e.risposte, 0);
    assert!(e.errore.unwrap().contains("Illegal data address"));
}

#[tokio::test]
async fn una_scrittura_su_una_foglia_tocca_solo_i_suoi_registri() {
    let db = db_con(&[istanza("m1", "motore")], &[tipo_motore()]).await;
    let mut dev = Finto::default();
    let regs = [mappa("m1", 100, AreaModbus::Holding)];
    let m = prepara(&db, &regs).await;
    scrivi(&mut dev, &db, &m, OrdineModbus::Abcd, ("m1".into(), Some(".velocita".into()), TagValue::Float(50.0)), "p")
        .await
        .unwrap();
    assert_eq!(dev.scritture, vec![(101, vec![0x4248, 0x0000])], "solo i due registri della velocità");
    assert_eq!(val(&db, "m1.velocita").await.0, TagValue::Float(50.0), "l'eco");
}

#[tokio::test]
async fn una_scrittura_sul_tag_storico_usa_la_scala_una_volta() {
    let db = db_con(&[tag("v", "float")], &[]).await;
    let mut dev = Finto::default();
    let regs = [RegisterMapping { scale: 0.1, ..mappa("v", 3, AreaModbus::Holding) }];
    let m = prepara(&db, &regs).await;
    scrivi(&mut dev, &db, &m, OrdineModbus::Abcd, ("v".into(), None, TagValue::Float(12.3)), "p").await.unwrap();
    assert_eq!(dev.registri.get(&3), Some(&123));
    let (v, _) = val(&db, "v").await;
    assert!(matches!(v, TagValue::Float(f) if (f - 12.3).abs() < 1e-9), "eco 12.3, non 1.23 né 123: {v:?}");
}

#[tokio::test]
async fn sulle_aree_di_sola_lettura_non_si_scrive() {
    let db = db_con(&[tag("i", "u16")], &[]).await;
    let mut dev = Finto::default();
    let m = prepara(&db, &[mappa("i", 0, AreaModbus::Input)]).await;
    scrivi(&mut dev, &db, &m, OrdineModbus::Abcd, ("i".into(), None, TagValue::Int(5)), "p").await.unwrap();
    assert!(dev.scritture.is_empty());
}

// ── Bus e dispositivi (04-10-2026) ──────────────────────────────────────────

fn disp(unit_id: u8, regs: Vec<RegisterMapping>) -> DispositivoModbus {
    DispositivoModbus {
        unit_id,
        nome: String::new(),
        modello: None,
        ordine: OrdineModbus::Abcd,
        poll_interval_ms: None,
        timeout_ms: 500,
        registers: regs,
    }
}

/// Fa girare una sessione per `per` (tempo virtuale) e la ferma.
async fn sessione_per(
    dev: Finto,
    db: &TagDb,
    unita: &mut [Unita],
    stato: &StatoSorgenti,
    rx: mpsc::Receiver<WriteRequest>,
    per: Duration,
) -> anyhow::Result<()> {
    let cancel = CancellationToken::new();
    let c = cancel.clone();
    let rx = Mutex::new(rx);
    let fermo = async move {
        tokio::time::sleep(per).await;
        c.cancel();
    };
    let (r, ()) = tokio::join!(sessione(dev, "bus", unita, db, stato, &rx, &cancel), fermo);
    r
}

#[tokio::test(start_paused = true)]
async fn due_dispositivi_sullo_stesso_bus_ognuno_col_suo_ordine() {
    let db = db_con(&[tag("a", "f32"), tag("b", "f32")], &[]).await;
    let mut dev = Finto::default();
    // 1.5 = 0x3FC0_0000: unità 1 in ABCD, unità 2 in CDAB, stessi indirizzi.
    dev.per_unita.insert((1, 0), 0x3FC0);
    dev.per_unita.insert((1, 1), 0x0000);
    dev.per_unita.insert((2, 0), 0x0000);
    dev.per_unita.insert((2, 1), 0x3FC0);
    let d2 = DispositivoModbus { ordine: OrdineModbus::Cdab, ..disp(2, vec![mappa("b", 0, AreaModbus::Holding)]) };
    let mut unita = vec![Unita::da(&disp(1, vec![mappa("a", 0, AreaModbus::Holding)]), 1000), Unita::da(&d2, 1000)];
    let stato = StatoSorgenti::new();
    let (_tx, rx) = mpsc::channel(4);
    sessione_per(dev, &db, &mut unita, &stato, rx, Duration::from_millis(100)).await.unwrap();
    assert_eq!(val(&db, "a").await, (TagValue::Float(1.5), TagQuality::Good));
    assert_eq!(val(&db, "b").await, (TagValue::Float(1.5), TagQuality::Good));
    let s = stato.istantanea();
    assert_eq!(s["bus"].dispositivi[&1].stato, Collegamento::Ok);
    assert_eq!(s["bus"].dispositivi[&2].stato, Collegamento::Ok);
}

#[tokio::test(start_paused = true)]
async fn uno_slave_muto_non_ferma_il_bus_tutti_muti_si() {
    let db = db_con(&[tag("a", "u16"), tag("b", "u16")], &[]).await;
    let mut dev = Finto::default();
    dev.registri.insert(0, 7);
    dev.mute.insert(2);
    db.set("b".into(), TagValue::Int(0), TagQuality::Uncertain).await;
    let mut unita = vec![
        Unita::da(&disp(1, vec![mappa("a", 0, AreaModbus::Holding)]), 1000),
        Unita::da(&disp(2, vec![mappa("b", 0, AreaModbus::Holding)]), 1000),
    ];
    let stato = StatoSorgenti::new();
    let (_tx, rx) = mpsc::channel(4);
    // Dieci giri: lo slave 2 tace sempre, la sessione regge.
    sessione_per(dev, &db, &mut unita, &stato, rx, Duration::from_secs(10)).await.expect("il bus resta su");
    assert_eq!(val(&db, "a").await, (TagValue::Int(7), TagQuality::Good));
    assert_eq!(val(&db, "b").await.1, TagQuality::Bad);
    let s = stato.istantanea();
    assert_eq!(s["bus"].dispositivi[&1].stato, Collegamento::Ok);
    assert_eq!(s["bus"].dispositivi[&2].stato, Collegamento::NonRisponde);
    assert!(s["bus"].dispositivi[&2].errore.as_deref().unwrap().contains("500 ms"));

    // Tutti muti: al terzo giro la sessione esce per riconnettere.
    let mut dev = Finto::default();
    dev.mute.extend([1, 2]);
    let (_tx, rx) = mpsc::channel(4);
    let r = sessione_per(dev, &db, &mut unita, &stato, rx, Duration::from_secs(60)).await;
    assert!(r.unwrap_err().to_string().contains("nessun dispositivo risponde"));
}

#[tokio::test(start_paused = true)]
async fn ogni_dispositivo_col_suo_intervallo() {
    let db = db_con(&[tag("a", "u16"), tag("b", "u16")], &[]).await;
    let dev = Finto::default();
    let veloce = DispositivoModbus { poll_interval_ms: Some(100), ..disp(1, vec![mappa("a", 0, AreaModbus::Holding)]) };
    let mut unita = vec![Unita::da(&veloce, 1000), Unita::da(&disp(2, vec![mappa("b", 0, AreaModbus::Holding)]), 1000)];
    assert_eq!(unita[0].intervallo, Duration::from_millis(100));
    assert_eq!(unita[1].intervallo, Duration::from_millis(1000), "vuoto = quello del bus");
    let stato = StatoSorgenti::new();
    let (_tx, rx) = mpsc::channel(4);
    sessione_per(dev, &db, &mut unita, &stato, rx, Duration::from_millis(50)).await.unwrap();
}

#[tokio::test(start_paused = true)]
async fn una_scrittura_va_allo_slave_che_mappa_il_tag() {
    let db = db_con(&[tag("a", "u16"), tag("b", "u16")], &[]).await;
    let dev = Finto::default();
    let mut unita = vec![
        Unita::da(&disp(1, vec![mappa("a", 0, AreaModbus::Holding)]), 60_000),
        Unita::da(&disp(5, vec![mappa("b", 9, AreaModbus::Holding)]), 60_000),
    ];
    let stato = StatoSorgenti::new();
    let (tx, rx) = mpsc::channel(4);
    tx.send(("b".into(), None, TagValue::Int(42))).await.unwrap();
    let cancel = CancellationToken::new();
    let rx = Mutex::new(rx);
    let c = cancel.clone();
    let mut dev = dev;
    // La sessione consuma il dispositivo: si osserva l'eco nel TagDb.
    let fermo = async move {
        tokio::time::sleep(Duration::from_millis(50)).await;
        c.cancel();
    };
    dev.imposta_unita(1);
    let (r, ()) = tokio::join!(sessione(dev, "bus", &mut unita, &db, &stato, &rx, &cancel), fermo);
    r.unwrap();
    assert_eq!(val(&db, "b").await, (TagValue::Int(42), TagQuality::Good), "eco della scrittura");
}

#[tokio::test]
async fn la_scrittura_seleziona_l_unita_giusta() {
    // Lo stesso instradamento, guardando il dispositivo finto dopo.
    let db = db_con(&[tag("b", "u16")], &[]).await;
    let mut dev = Finto::default();
    let u = Unita::da(&disp(5, vec![mappa("b", 9, AreaModbus::Holding)]), 1000);
    dev.imposta_unita(u.unit_id);
    let m = prepara(&db, &u.registri).await;
    scrivi(&mut dev, &db, &m, u.ordine, ("b".into(), None, TagValue::Int(42)), "p").await.unwrap();
    assert_eq!(dev.scritture_a, vec![5]);
    assert_eq!(dev.scritture, vec![(9, vec![42])]);
}

// ── Formato sul filo, bit, sola lettura (catalogo dei dispositivi, 04-10-2026) ──

fn con(r: RegisterMapping, f: impl FnOnce(&mut RegisterMapping)) -> RegisterMapping {
    let mut r = r;
    f(&mut r);
    r
}

#[tokio::test]
async fn formato_e_scala_portano_il_segno_e_i_decimali_in_un_f32() {
    // Il caso Pixsys: PV su un i16 con un decimale implicito, −12.5 °C.
    let db = db_con(&[tag("pv", "f32")], &[]).await;
    let mut dev = Finto::default();
    dev.registri.insert(1000, (-125i16) as u16);
    let r = con(mappa("pv", 1000, AreaModbus::Holding), |r| {
        r.formato = Some("i16".into());
        r.scale = 0.1;
    });
    giro(&mut dev, &db, &[r], OrdineModbus::Abcd).await.unwrap();
    let (v, q) = val(&db, "pv").await;
    assert!(matches!(v, TagValue::Float(f) if (f + 12.5).abs() < 1e-6), "{v:?}");
    assert_eq!(q, TagQuality::Good);
}

#[tokio::test]
async fn i_bit_della_stessa_word_sono_una_lettura_sola() {
    let db = db_con(&[tag("a1", "bool"), tag("a2", "bool"), tag("man", "bool")], &[]).await;
    let mut dev = Finto::default();
    dev.registri.insert(1004, 0b10_0000_0001); // bit 0 e bit 9
    let bit = |t: &str, b: u8| con(mappa(t, 1004, AreaModbus::Holding), |r| r.bit = Some(b));
    giro(&mut dev, &db, &[bit("a1", 0), bit("a2", 1), bit("man", 9)], OrdineModbus::Abcd).await.unwrap();
    assert_eq!(val(&db, "a1").await.0, TagValue::Bool(true));
    assert_eq!(val(&db, "a2").await.0, TagValue::Bool(false));
    assert_eq!(val(&db, "man").await.0, TagValue::Bool(true));
    assert_eq!(dev.letture, 1, "tre bit, un registro, una richiesta");
}

#[tokio::test]
async fn scrivere_un_bit_cambia_solo_quel_bit() {
    let db = db_con(&[tag("do3", "bool")], &[]).await;
    let mut dev = Finto::default();
    dev.registri.insert(20, 0b0001);
    let m = prepara(&db, &[con(mappa("do3", 20, AreaModbus::Holding), |r| r.bit = Some(3))]).await;
    scrivi(&mut dev, &db, &m, OrdineModbus::Abcd, ("do3".into(), None, TagValue::Bool(true)), "p").await.unwrap();
    assert_eq!(dev.registri[&20], 0b1001, "bit 0 intatto, bit 3 acceso");
    scrivi(&mut dev, &db, &m, OrdineModbus::Abcd, ("do3".into(), None, TagValue::Bool(false)), "p").await.unwrap();
    assert_eq!(dev.registri[&20], 0b0001);
    assert_eq!(val(&db, "do3").await.0, TagValue::Bool(false), "l'eco");
}

#[tokio::test]
async fn una_scrittura_con_formato_divide_per_la_scala() {
    let db = db_con(&[tag("sp1", "f32")], &[]).await;
    let mut dev = Finto::default();
    let m = prepara(&db, &[con(mappa("sp1", 2000, AreaModbus::Holding), |r| {
        r.formato = Some("i16".into());
        r.scale = 0.1;
    })])
    .await;
    scrivi(&mut dev, &db, &m, OrdineModbus::Abcd, ("sp1".into(), None, TagValue::Float(-5.5)), "p").await.unwrap();
    assert_eq!(dev.scritture, vec![(2000, vec![(-55i16) as u16])]);
}

#[tokio::test]
async fn sola_lettura_rifiuta_anche_su_holding() {
    let db = db_con(&[tag("pv", "u16")], &[]).await;
    let mut dev = Finto::default();
    let m = prepara(&db, &[con(mappa("pv", 1000, AreaModbus::Holding), |r| r.sola_lettura = true)]).await;
    scrivi(&mut dev, &db, &m, OrdineModbus::Abcd, ("pv".into(), None, TagValue::Int(1)), "p").await.unwrap();
    assert!(dev.scritture.is_empty());
}

#[tokio::test(start_paused = true)]
async fn una_word_muta_si_aspetta_una_volta_sola_per_giro() {
    // Sedici bit della stessa word su uno slave muto: una richiesta, non sedici.
    let tags: Vec<TagDef> = (0..16).map(|i| tag(&format!("b{i}"), "bool")).collect();
    let db = db_con(&tags, &[]).await;
    for i in 0..16 {
        db.set(format!("b{i}"), TagValue::Bool(false), TagQuality::Uncertain).await;
    }
    let mut dev = Finto::default();
    dev.mute.insert(0);
    let regs: Vec<RegisterMapping> = (0..16).map(|i| con(mappa(&format!("b{i}"), 10, AreaModbus::Holding), |r| r.bit = Some(i))).collect();
    let prima = tokio::time::Instant::now();
    let e = giro(&mut dev, &db, &regs, OrdineModbus::Abcd).await.unwrap();
    assert_eq!(e.risposte, 0);
    assert_eq!(dev.letture, 1, "una sola richiesta per la word muta");
    assert!(prima.elapsed() < Duration::from_secs(4), "un timeout, non sedici: {:?}", prima.elapsed());
    assert_eq!(val(&db, "b15").await.1, TagQuality::Bad);
}

/// Tipi annidati dal catalogo (04-10-2026): `io.ingressi.di1` è un bit della word
/// 1000, `io.ingressi.ai1` un i16 × 0.1, su un'istanza il cui tipo ha un membro
/// che è a sua volta un tipo.
#[tokio::test]
async fn le_foglie_annidate_si_leggono_come_le_altre() {
    let ingressi = TypeDef {
        id: "m__ingressi".into(),
        description: String::new(),
        members: vec![membro("di1", "bool"), membro("ai1", "f32")],
    };
    let top: TypeDef = serde_yaml::from_str("id: m\nmembers:\n  - {name: ingressi, type_ref: m__ingressi}\n").unwrap();
    let db = db_con(&[istanza("io", "m")], &[top, ingressi]).await;
    let mut dev = Finto::default();
    dev.registri.insert(1000, 0b1);
    dev.registri.insert(1001, (-125i16) as u16);
    let regs = [
        con(mappa("io.ingressi.di1", 1000, AreaModbus::Holding), |r| r.bit = Some(0)),
        con(mappa("io.ingressi.ai1", 1001, AreaModbus::Holding), |r| {
            r.formato = Some("i16".into());
            r.scale = 0.1;
        }),
    ];
    giro(&mut dev, &db, &regs, OrdineModbus::Abcd).await.unwrap();
    assert_eq!(val(&db, "io.ingressi.di1").await, (TagValue::Bool(true), TagQuality::Good));
    let (v, q) = val(&db, "io.ingressi.ai1").await;
    assert!(matches!(v, TagValue::Float(f) if (f + 12.5).abs() < 1e-6), "{v:?}");
    assert_eq!(q, TagQuality::Good);
}
