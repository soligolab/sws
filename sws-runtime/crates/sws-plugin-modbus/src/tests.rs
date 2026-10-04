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
}

impl Dispositivo for Finto {
    async fn leggi(&mut self, area: AreaModbus, addr: u16, n: u16) -> io::Result<Letti> {
        if self.caduto {
            return Err(io::Error::new(io::ErrorKind::BrokenPipe, "chiuso"));
        }
        if self.eccezioni.contains(&addr) {
            return Err(io::Error::new(io::ErrorKind::Other, "Illegal data address"));
        }
        Ok(if area.a_bit() {
            Letti::Bit((addr..addr + n).map(|a| *self.bit.get(&a).unwrap_or(&false)).collect())
        } else {
            Letti::Registri((addr..addr + n).map(|a| *self.registri.get(&a).unwrap_or(&0)).collect())
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
        Ok(())
    }
    async fn scrivi_bit(&mut self, addr: u16, bit: &[bool]) -> io::Result<()> {
        for (i, b) in bit.iter().enumerate() {
            self.bit.insert(addr + i as u16, *b);
        }
        Ok(())
    }
}

fn mappa(tag: &str, address: u16, area: AreaModbus) -> RegisterMapping {
    RegisterMapping { tag: tag.into(), address, scale: 1.0, area }
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

async fn giro(dev: &mut Finto, db: &TagDb, regs: &[RegisterMapping], ordine: OrdineModbus) -> anyhow::Result<()> {
    let m = prepara(db, regs).await;
    leggi_giro(dev, db, &m, ordine, &mut HashSet::new(), &mut 0, "prova").await
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
async fn un_guasto_di_trasporto_chiude_la_sessione_e_tre_giri_muti_anche() {
    let db = db_con(&[tag("a", "u16")], &[]).await;
    let regs = [mappa("a", 0, AreaModbus::Holding)];
    let mut dev = Finto { caduto: true, ..Default::default() };
    assert!(giro(&mut dev, &db, &regs, OrdineModbus::Abcd).await.is_err());
    // Solo eccezioni, giro dopo giro: al terzo si riconnette.
    let mut dev = Finto::default();
    dev.eccezioni.insert(0);
    let m = prepara(&db, &regs).await;
    let (mut err, mut muti) = (HashSet::new(), 0u32);
    for _ in 0..2 {
        assert!(leggi_giro(&mut dev, &db, &m, OrdineModbus::Abcd, &mut err, &mut muti, "p").await.is_ok());
    }
    assert!(leggi_giro(&mut dev, &db, &m, OrdineModbus::Abcd, &mut err, &mut muti, "p").await.is_err());
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
