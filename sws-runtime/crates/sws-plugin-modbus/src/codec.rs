//! Valori ↔ registri Modbus (Fase 3 del piano tag, 04-10-2026). Tutto puro.
//!
//! Prima ogni tag era **un** holding register letto come `u16` senza segno: un
//! `i16` negativo arrivava come un grande positivo, un `f32` su due registri non
//! si poteva leggere. Ora il numero di registri e la decodifica vengono dal **tipo
//! dichiarato** del tag (o della foglia), e l'ordine di parole e byte dalla
//! sorgente.
//!
//! **Compatibilità:** un tag piatto col nome di tipo storico (`float`, `int`,
//! `bool`, `string`, o senza tipo) si legge come prima, un registro `u16` per la
//! scala della mappatura: il default `float` vuol dire `f64`, e senza questa
//! regola ogni progetto vecchio comincerebbe a leggere quattro registri.

use sws_core::tipo::TipoScalare;
use sws_core::{OrdineModbus, TagValue};

/// I nomi dei quattro tipi di prima della Fase 1a: su un tag piatto mappato a un
/// registro vogliono dire «un `u16`, come sempre».
const NOMI_STORICI: &[&str] = &["float", "int", "bool", "string", ""];

/// Il tipo con cui decodificare un tag **piatto** mappato a un registro.
/// `None` = modo storico (un `u16` × scala).
pub fn tipo_effettivo(nome_dichiarato: Option<&str>) -> Option<TipoScalare> {
    let n = nome_dichiarato?.trim();
    if NOMI_STORICI.contains(&n.to_ascii_lowercase().as_str()) {
        return None;
    }
    TipoScalare::parse(n)
}

/// Un pezzo del blocco di una mappatura: una foglia (o il tag stesso), dove sta
/// e quanto occupa. `tipo = None` = modo storico.
#[derive(Debug, Clone, PartialEq)]
pub struct Slot {
    pub percorso: String,
    pub tipo: Option<TipoScalare>,
    /// In registri (o in bit, per coil e discrete input).
    pub offset: u16,
    pub n: u16,
}

/// Quanti registri (o bit) occupa una foglia. Un bit per foglia sulle aree a
/// bit; un registro per un bool (scelta del maintainer, 04-10-2026).
pub fn larghezza(tipo: Option<&TipoScalare>, a_bit: bool) -> u16 {
    if a_bit {
        return 1;
    }
    tipo.map(|t| t.registri()).unwrap_or(1)
}

/// Il layout di una mappatura. `foglie` = le foglie di una radice composita,
/// nell'ordine dichiarato; vuoto = tag piatto, di tipo `tipo_piatto`.
pub fn layout(tag: &str, tipo_piatto: Option<TipoScalare>, foglie: &[(String, TipoScalare)], a_bit: bool) -> Vec<Slot> {
    if foglie.is_empty() {
        let n = larghezza(tipo_piatto.as_ref(), a_bit);
        return vec![Slot { percorso: tag.to_string(), tipo: tipo_piatto, offset: 0, n }];
    }
    let mut offset = 0u16;
    foglie
        .iter()
        .map(|(p, t)| {
            let n = larghezza(Some(t), a_bit);
            let s = Slot { percorso: p.clone(), tipo: Some(t.clone()), offset, n };
            offset = offset.saturating_add(n);
            s
        })
        .collect()
}

/// Quanti registri (o bit) legge una mappatura.
pub fn totale(slots: &[Slot]) -> u16 {
    slots.iter().map(|s| s.offset + s.n).max().unwrap_or(0)
}

/// I byte del valore in ordine «big-endian» (ABCD), dati i registri così come
/// arrivano e l'ordine del dispositivo. La stessa permutazione, applicata due
/// volte, torna all'originale: serve anche per scrivere.
fn permuta(byte: &mut [u8], ordine: OrdineModbus) {
    match ordine {
        OrdineModbus::Abcd => {}
        OrdineModbus::Dcba => byte.reverse(),
        OrdineModbus::Badc => byte.chunks_mut(2).for_each(|w| w.swap(0, 1)),
        OrdineModbus::Cdab => {
            // Parole in ordine inverso, byte di ciascuna come sono.
            let parole: Vec<[u8; 2]> = byte.chunks(2).map(|w| [w[0], *w.get(1).unwrap_or(&0)]).collect();
            for (i, w) in parole.iter().rev().enumerate() {
                byte[2 * i] = w[0];
                if 2 * i + 1 < byte.len() {
                    byte[2 * i + 1] = w[1];
                }
            }
        }
    }
}

fn in_byte(regs: &[u16]) -> Vec<u8> {
    regs.iter().flat_map(|r| r.to_be_bytes()).collect()
}

fn in_registri(byte: &[u8]) -> Vec<u16> {
    byte.chunks(2).map(|w| u16::from_be_bytes([w[0], *w.get(1).unwrap_or(&0)])).collect()
}

/// I registri di una foglia → il valore. `tipo = None` è il modo storico
/// (`u16` × `scala`); per i tipi dichiarati la scala della mappatura non si
/// applica (le scale stanno sul tag o sul membro, e le applica il `TagDb`).
pub fn decodifica(tipo: Option<&TipoScalare>, regs: &[u16], ordine: OrdineModbus, scala: f64) -> Result<TagValue, String> {
    let Some(tipo) = tipo else {
        let r = *regs.first().ok_or("nessun registro")?;
        return Ok(TagValue::Float(r as f64 * scala));
    };
    let serve = tipo.registri() as usize;
    if regs.len() < serve {
        return Err(format!("servono {serve} registri, arrivati {}", regs.len()));
    }
    let mut b = in_byte(&regs[..serve]);
    if !matches!(tipo, TipoScalare::Stringa { .. }) {
        permuta(&mut b, ordine);
    } else if matches!(ordine, OrdineModbus::Badc | OrdineModbus::Dcba) {
        // Il testo va carattere per carattere: dell'ordine conta solo se i due
        // byte di ogni registro sono scambiati.
        permuta(&mut b, OrdineModbus::Badc);
    }
    let a2 = |b: &[u8]| [b[0], b[1]];
    let a4 = |b: &[u8]| [b[0], b[1], b[2], b[3]];
    let a8 = |b: &[u8]| [b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7]];
    use TipoScalare as T;
    Ok(match tipo {
        T::Bool => TagValue::Bool(regs[0] != 0),
        T::I8 | T::I16 => TagValue::Int(i16::from_be_bytes(a2(&b)) as i64),
        T::U8 | T::U16 => TagValue::Int(u16::from_be_bytes(a2(&b)) as i64),
        T::I32 => TagValue::Int(i32::from_be_bytes(a4(&b)) as i64),
        T::U32 => TagValue::Int(u32::from_be_bytes(a4(&b)) as i64),
        T::F32 => TagValue::Float(f32::from_be_bytes(a4(&b)) as f64),
        T::I64 => TagValue::Int(i64::from_be_bytes(a8(&b))),
        T::U64 | T::DateTime => TagValue::Int(i64::try_from(u64::from_be_bytes(a8(&b))).unwrap_or(i64::MAX)),
        T::F64 => TagValue::Float(f64::from_be_bytes(a8(&b))),
        T::Stringa { .. } => {
            let fine = b.iter().position(|&c| c == 0).unwrap_or(b.len());
            TagValue::Str(String::from_utf8_lossy(&b[..fine]).into_owned())
        }
    })
}

fn numero(v: &TagValue) -> Option<f64> {
    match v {
        TagValue::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
        TagValue::Int(i) => Some(*i as f64),
        TagValue::Float(f) if f.is_finite() => Some(*f),
        TagValue::Str(s) => s.trim().parse().ok(),
        _ => None,
    }
}

fn intero(v: &TagValue) -> Option<i64> {
    match v {
        TagValue::Int(i) => Some(*i),
        TagValue::Str(s) => s.trim().parse::<i64>().ok().or_else(|| numero(v).map(|f| f.round() as i64)),
        _ => numero(v).map(|f| f.round() as i64),
    }
}

/// Il valore → i registri di una foglia. Rifiuta ciò che non ci sta (fuori
/// intervallo, testo troppo lungo, valore composito su uno scalare): scrivere
/// un valore troncato su un PLC è peggio di non scriverlo.
pub fn codifica(tipo: Option<&TipoScalare>, v: &TagValue, ordine: OrdineModbus, scala: f64) -> Result<Vec<u16>, String> {
    let Some(tipo) = tipo else {
        let f = numero(v).ok_or("valore non numerico")?;
        let raw = (f / scala).round();
        if !(0.0..=u16::MAX as f64).contains(&raw) {
            return Err(format!("{raw} non sta in un registro (0..=65535)"));
        }
        return Ok(vec![raw as u16]);
    };
    use TipoScalare as T;
    let fuori = |x: i64| format!("{x} fuori dall'intervallo del tipo");
    let int_in = |lo: i64, hi: i64| -> Result<i64, String> {
        let x = intero(v).ok_or("valore non numerico")?;
        if x < lo || x > hi { Err(fuori(x)) } else { Ok(x) }
    };
    let mut b: Vec<u8> = match tipo {
        T::Bool => vec![0, if numero(v).ok_or("valore non booleano")? != 0.0 { 1 } else { 0 }],
        T::I8 => (int_in(i8::MIN as i64, i8::MAX as i64)? as i16).to_be_bytes().to_vec(),
        T::I16 => (int_in(i16::MIN as i64, i16::MAX as i64)? as i16).to_be_bytes().to_vec(),
        T::U8 => (int_in(0, u8::MAX as i64)? as u16).to_be_bytes().to_vec(),
        T::U16 => (int_in(0, u16::MAX as i64)? as u16).to_be_bytes().to_vec(),
        T::I32 => (int_in(i32::MIN as i64, i32::MAX as i64)? as i32).to_be_bytes().to_vec(),
        T::U32 => (int_in(0, u32::MAX as i64)? as u32).to_be_bytes().to_vec(),
        T::I64 => int_in(i64::MIN, i64::MAX)?.to_be_bytes().to_vec(),
        T::U64 | T::DateTime => (int_in(0, i64::MAX)? as u64).to_be_bytes().to_vec(),
        T::F32 => (numero(v).ok_or("valore non numerico")? as f32).to_be_bytes().to_vec(),
        T::F64 => numero(v).ok_or("valore non numerico")?.to_be_bytes().to_vec(),
        T::Stringa { .. } => {
            let s = match v {
                TagValue::Str(s) => s.clone(),
                altro => numero(altro).map(|f| f.to_string()).ok_or("valore non testuale")?,
            };
            let posti = tipo.registri() as usize * 2;
            let mut b = s.into_bytes();
            if b.len() > posti {
                return Err(format!("testo di {} byte, ce ne stanno {posti}", b.len()));
            }
            b.resize(posti, 0);
            if matches!(ordine, OrdineModbus::Badc | OrdineModbus::Dcba) {
                permuta(&mut b, OrdineModbus::Badc);
            }
            return Ok(in_registri(&b));
        }
    };
    permuta(&mut b, ordine);
    Ok(in_registri(&b))
}

/// Un bit (coil, discrete input) → il valore, secondo il tipo: un bool resta
/// bool, un numero diventa 0/1 (la conversione al tipo rifiuterebbe un bool su
/// un numero).
pub fn decodifica_bit(tipo: Option<&TipoScalare>, bit: bool) -> TagValue {
    match tipo {
        None | Some(TipoScalare::Bool) => TagValue::Bool(bit),
        Some(TipoScalare::Stringa { .. }) => TagValue::Str(if bit { "1" } else { "0" }.into()),
        Some(_) => TagValue::Int(bit as i64),
    }
}

/// Il valore → un bit.
pub fn codifica_bit(v: &TagValue) -> Result<bool, String> {
    match v {
        TagValue::Bool(b) => Ok(*b),
        TagValue::Str(s) => match s.trim().to_ascii_lowercase().as_str() {
            "true" | "1" | "on" => Ok(true),
            "false" | "0" | "off" => Ok(false),
            _ => Err(format!("«{s}» non è un bit")),
        },
        altro => numero(altro).map(|f| f != 0.0).ok_or_else(|| "valore non booleano".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use OrdineModbus::*;

    fn t(n: &str) -> TipoScalare {
        TipoScalare::parse(n).unwrap()
    }

    #[test]
    fn i_nomi_storici_leggono_come_prima() {
        for n in ["float", "int", "bool", "string", "Float", ""] {
            assert!(tipo_effettivo(Some(n)).is_none(), "{n}");
        }
        assert!(tipo_effettivo(None).is_none());
        assert_eq!(tipo_effettivo(Some("i16")), Some(t("i16")));
        assert_eq!(decodifica(None, &[0xFFFF], Abcd, 0.1).unwrap(), TagValue::Float(6553.5));
        assert_eq!(codifica(None, &TagValue::Float(12.3), Abcd, 0.1).unwrap(), vec![123]);
        assert!(codifica(None, &TagValue::Float(-1.0), Abcd, 1.0).is_err());
    }

    #[test]
    fn interi_con_e_senza_segno() {
        assert_eq!(decodifica(Some(&t("i16")), &[0xFFFE], Abcd, 1.0).unwrap(), TagValue::Int(-2));
        assert_eq!(decodifica(Some(&t("u16")), &[0xFFFE], Abcd, 1.0).unwrap(), TagValue::Int(65534));
        assert_eq!(codifica(Some(&t("i16")), &TagValue::Int(-2), Abcd, 1.0).unwrap(), vec![0xFFFE]);
        assert!(codifica(Some(&t("u16")), &TagValue::Int(70_000), Abcd, 1.0).is_err());
        assert!(codifica(Some(&t("u8")), &TagValue::Int(256), Abcd, 1.0).is_err());
    }

    #[test]
    fn i_quattro_ordini_su_un_u32_e_un_f32() {
        // 0x11223344 = 287454020
        let v = TagValue::Int(0x1122_3344);
        let casi = [(Abcd, [0x1122, 0x3344]), (Cdab, [0x3344, 0x1122]), (Badc, [0x2211, 0x4433]), (Dcba, [0x4433, 0x2211])];
        for (o, regs) in casi {
            assert_eq!(decodifica(Some(&t("u32")), &regs, o, 1.0).unwrap(), v, "{o:?}");
            assert_eq!(codifica(Some(&t("u32")), &v, o, 1.0).unwrap(), regs.to_vec(), "{o:?}");
        }
        // 1.5f32 = 0x3FC00000
        assert_eq!(decodifica(Some(&t("f32")), &[0x3FC0, 0x0000], Abcd, 1.0).unwrap(), TagValue::Float(1.5));
        assert_eq!(decodifica(Some(&t("f32")), &[0x0000, 0x3FC0], Cdab, 1.0).unwrap(), TagValue::Float(1.5));
    }

    #[test]
    fn sessantaquattro_bit_e_ritorno() {
        for o in [Abcd, Cdab, Badc, Dcba] {
            for (tipo, v) in [("f64", TagValue::Float(-1234.5678)), ("i64", TagValue::Int(-9_000_000_000)), ("u64", TagValue::Int(9_000_000_000))] {
                let r = codifica(Some(&t(tipo)), &v, o, 1.0).unwrap();
                assert_eq!(r.len(), 4);
                assert_eq!(decodifica(Some(&t(tipo)), &r, o, 1.0).unwrap(), v, "{tipo} {o:?}");
            }
        }
    }

    #[test]
    fn testo_due_caratteri_per_registro() {
        let tipo = t("string(6)");
        assert_eq!(tipo.registri(), 3);
        let r = codifica(Some(&tipo), &TagValue::Str("ABCD".into()), Abcd, 1.0).unwrap();
        assert_eq!(r, vec![0x4142, 0x4344, 0x0000]);
        assert_eq!(decodifica(Some(&tipo), &r, Abcd, 1.0).unwrap(), TagValue::Str("ABCD".into()));
        let s = codifica(Some(&tipo), &TagValue::Str("ABCD".into()), Badc, 1.0).unwrap();
        assert_eq!(s, vec![0x4241, 0x4443, 0x0000]);
        assert_eq!(decodifica(Some(&tipo), &s, Badc, 1.0).unwrap(), TagValue::Str("ABCD".into()));
        assert!(codifica(Some(&tipo), &TagValue::Str("ABCDEFG".into()), Abcd, 1.0).is_err());
    }

    #[test]
    fn il_layout_di_una_struttura() {
        let foglie = vec![
            ("m.marcia".to_string(), t("bool")),
            ("m.velocita".to_string(), t("f32")),
            ("m.ore".to_string(), t("u32")),
            ("m.nome".to_string(), t("string(4)")),
        ];
        let l = layout("m", None, &foglie, false);
        let posti: Vec<(u16, u16)> = l.iter().map(|s| (s.offset, s.n)).collect();
        assert_eq!(posti, vec![(0, 1), (1, 2), (3, 2), (5, 2)]);
        assert_eq!(totale(&l), 7);
        // Sulle aree a bit ogni foglia è un bit.
        assert_eq!(totale(&layout("m", None, &foglie, true)), 4);
        // Un tag piatto: uno slot.
        assert_eq!(layout("x", Some(t("f64")), &[], false), vec![Slot { percorso: "x".into(), tipo: Some(t("f64")), offset: 0, n: 4 }]);
        assert_eq!(totale(&layout("x", None, &[], false)), 1);
    }

    #[test]
    fn i_bit() {
        assert_eq!(decodifica_bit(None, true), TagValue::Bool(true));
        assert_eq!(decodifica_bit(Some(&t("i32")), true), TagValue::Int(1));
        assert_eq!(codifica_bit(&TagValue::Int(0)).unwrap(), false);
        assert_eq!(codifica_bit(&TagValue::Str("on".into())).unwrap(), true);
        assert!(codifica_bit(&TagValue::Str("forse".into())).is_err());
    }
}
