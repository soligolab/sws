//! Il pacchetto Solarman V5 (01-11-2026, piano
//! docs/archive/2026-11-01-inverter-solarman.md, fase 1). Tutto puro.
//!
//! Le chiavette Wi-Fi Solarman (moduli Hi-Flying, porta 8899) che stanno su
//! molti inverter ibridi — Sofar/ZCS, Deye, Solis… — non parlano Modbus TCP:
//! incapsulano una trama Modbus RTU **intera**, CRC compreso ([`crate::trama_rtu`]),
//! in un pacchetto loro. Senza il numero di serie della chiavetta non
//! rispondono.
//!
//! Il formato è quello di `pysolarmanv5` (MIT, Jonathan McCrohan), letto nel
//! sorgente il 01-11-2026 e non ricostruito a memoria:
//!
//! ```text
//! A5 | lunghezza u16 LE | 10 45 | sequenza u16 LE | seriale u32 LE | carico | checksum | 15
//! ```
//!
//! - la lunghezza conta il **carico** (15 + trama RTU in richiesta); il pacchetto
//!   intero è lungo 13 + lunghezza;
//! - il carico della richiesta è `02`, `00 00`, tre `u32` a zero, poi la trama;
//!   in risposta la trama RTU comincia al byte 25 e finisce prima del checksum;
//! - il codice di controllo della risposta è quello della richiesta meno 0x30
//!   (`0x45` → `0x15`); il byte 5 ripete la sequenza della richiesta;
//! - il checksum è la somma, modulo 256, dei byte dal secondo fino a quello
//!   prima del checksum.
//!
//! La chiavetta manda anche **pacchetti di servizio** non richiesti (stretta di
//! mano 0x41, dati 0x42, informazioni 0x43, battito 0x47, rapporto 0x48), a volte
//! appiccicati in coda a una risposta. Non sono dati: si risponde come fa la
//! libreria, con l'ora, e si scartano.

/// Il codice di controllo di una richiesta Modbus incapsulata.
pub const RICHIESTA: u8 = 0x45;
/// Quello della risposta.
pub const RISPOSTA: u8 = RICHIESTA - 0x30;
/// I pacchetti di servizio che la chiavetta manda da sé.
const SERVIZIO: [u8; 5] = [0x41, 0x42, 0x43, 0x47, 0x48];
/// Il pacchetto più corto che abbia senso: intestazione (11) + checksum e fine.
const MINIMO: usize = 13;

/// La somma dei byte, modulo 256.
pub fn checksum(dati: &[u8]) -> u8 {
    dati.iter().fold(0u8, |s, b| s.wrapping_add(*b))
}

fn intestazione(lunghezza: u16, controllo: u8, seq: [u8; 2], seriale: u32) -> Vec<u8> {
    let mut t = vec![0xA5];
    t.extend_from_slice(&lunghezza.to_le_bytes());
    t.push(0x10);
    t.push(controllo);
    t.extend_from_slice(&seq);
    t.extend_from_slice(&seriale.to_le_bytes());
    t
}

fn chiudi(mut t: Vec<u8>) -> Vec<u8> {
    let c = checksum(&t[1..]);
    t.push(c);
    t.push(0x15);
    t
}

/// Una trama RTU dentro un pacchetto V5 di richiesta.
pub fn incapsula(seriale: u32, seq: u8, rtu: &[u8]) -> Vec<u8> {
    let mut t = intestazione(15 + rtu.len() as u16, RICHIESTA, [seq, 0], seriale);
    t.push(0x02);
    t.extend_from_slice(&[0; 14]);
    t.extend_from_slice(rtu);
    chiudi(t)
}

/// Toglie dalla testa di `buf` il primo pacchetto completo. I byte prima di un
/// `A5` sono rumore e si buttano; un pacchetto a metà resta dov'è, in attesa del
/// resto.
pub fn separa(buf: &mut Vec<u8>) -> Option<Vec<u8>> {
    let inizio = buf.iter().position(|b| *b == 0xA5);
    match inizio {
        None => {
            buf.clear();
            return None;
        }
        Some(i) => {
            buf.drain(..i);
        }
    }
    if buf.len() < 3 {
        return None;
    }
    let totale = MINIMO + u16::from_le_bytes([buf[1], buf[2]]) as usize;
    if buf.len() < totale {
        return None;
    }
    Some(buf.drain(..totale).collect())
}

/// Che cos'è un pacchetto arrivato dalla chiavetta.
#[derive(Debug, Clone, PartialEq)]
pub enum Arrivato {
    /// La risposta a una richiesta: la sequenza ripetuta e la trama RTU.
    Risposta { seq: u8, rtu: Vec<u8> },
    /// Un pacchetto di servizio: la risposta da rimandarle, poi si scarta.
    Servizio { risposta: Vec<u8> },
    /// Niente di utilizzabile, col perché.
    Scarto(String),
}

/// Classifica un pacchetto separato da [`separa`]. `ora_unix` serve solo alla
/// risposta ai pacchetti di servizio.
pub fn classifica(t: &[u8], seriale: u32, ora_unix: u32) -> Arrivato {
    if t.len() < MINIMO || t[0] != 0xA5 || t[t.len() - 1] != 0x15 {
        return Arrivato::Scarto("inizio o fine del pacchetto sbagliati".into());
    }
    if t[t.len() - 2] != checksum(&t[1..t.len() - 2]) {
        return Arrivato::Scarto("checksum V5 sbagliato".into());
    }
    if t[7..11] != seriale.to_le_bytes() {
        return Arrivato::Scarto("numero di serie della chiavetta diverso".into());
    }
    let controllo = t[4];
    if SERVIZIO.contains(&controllo) {
        let mut seq = [t[5], t[6]];
        seq[0] = seq[0].wrapping_add(1);
        let mut r = intestazione(10, controllo - 0x30, seq, seriale);
        r.extend_from_slice(&0x0100u16.to_le_bytes());
        r.extend_from_slice(&ora_unix.to_le_bytes());
        r.extend_from_slice(&0u32.to_le_bytes());
        return Arrivato::Servizio {
            risposta: chiudi(r),
        };
    }
    if controllo != RISPOSTA {
        return Arrivato::Scarto(format!("codice di controllo 0x{controllo:02X} sconosciuto"));
    }
    if t.len() < 25 + 2 || t[11] != 0x02 {
        return Arrivato::Scarto("risposta V5 senza una trama Modbus".into());
    }
    let rtu = t[25..t.len() - 2].to_vec();
    if rtu.len() < 5 {
        return Arrivato::Scarto("la trama Modbus della risposta è troppo corta".into());
    }
    Arrivato::Risposta { seq: t[5], rtu }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::trama_rtu as rtu;

    const SERIALE: u32 = 1786079474;

    /// Una risposta come la manda la chiavetta: carico di 14 byte prima della
    /// trama (tipo, stato, tre tempi), poi la trama RTU.
    fn risposta(seq: u8, rtu: &[u8]) -> Vec<u8> {
        let mut t = intestazione(14 + rtu.len() as u16, RISPOSTA, [seq, 0x33], SERIALE);
        t.push(0x02);
        t.push(0x01);
        t.extend_from_slice(&[0; 12]);
        t.extend_from_slice(rtu);
        chiudi(t)
    }

    #[test]
    fn la_richiesta_dello_zcs() {
        let rtu = rtu::richiesta_lettura(1, 3, 0x0200, 0x56);
        let t = incapsula(SERIALE, 0x12, &rtu);
        assert_eq!(t.len(), 13 + 15 + rtu.len());
        assert_eq!(
            &t[..11],
            &[0xA5, 23, 0, 0x10, 0x45, 0x12, 0, 0xF2, 0x68, 0x75, 0x6A]
        );
        assert_eq!(
            &t[11..26],
            &[0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        );
        assert_eq!(&t[26..34], &rtu[..]);
        assert_eq!(t[t.len() - 2], checksum(&t[1..t.len() - 2]));
        assert_eq!(t[t.len() - 1], 0x15);
    }

    #[test]
    fn una_risposta_si_riconosce() {
        let rtu = vec![1, 3, 2, 0x00, 0x11, 0x78, 0x48];
        let t = risposta(0x12, &rtu);
        assert_eq!(
            classifica(&t, SERIALE, 0),
            Arrivato::Risposta { seq: 0x12, rtu }
        );
    }

    #[test]
    fn checksum_o_seriale_sbagliati_si_scartano() {
        let mut t = risposta(1, &[1, 3, 2, 0, 1, 0, 0]);
        let n = t.len();
        t[n - 2] ^= 1;
        assert!(matches!(classifica(&t, SERIALE, 0), Arrivato::Scarto(_)));
        let t = risposta(1, &[1, 3, 2, 0, 1, 0, 0]);
        assert!(matches!(
            classifica(&t, SERIALE + 1, 0),
            Arrivato::Scarto(_)
        ));
    }

    #[test]
    fn il_battito_ha_una_risposta_con_l_ora() {
        let mut b = intestazione(1, 0x47, [0x07, 0x01], SERIALE);
        b.push(0);
        let b = chiudi(b);
        let Arrivato::Servizio { risposta } = classifica(&b, SERIALE, 0x6543_2100) else {
            panic!()
        };
        assert_eq!(
            &risposta[..11],
            &[0xA5, 10, 0, 0x10, 0x17, 0x08, 0x01, 0xF2, 0x68, 0x75, 0x6A]
        );
        assert_eq!(&risposta[11..13], &[0x00, 0x01]);
        assert_eq!(&risposta[13..17], &0x6543_2100u32.to_le_bytes());
        assert_eq!(risposta.len(), 13 + 10);
    }

    #[test]
    fn separa_rumore_pezzi_e_battito_in_coda() {
        let r = risposta(5, &[1, 3, 2, 0, 1, 0, 0]);
        let mut b = intestazione(1, 0x47, [1, 0], SERIALE);
        b.push(0);
        let b = chiudi(b);

        let mut buf = vec![0x00, 0x42];
        buf.extend_from_slice(&r[..10]);
        assert_eq!(separa(&mut buf), None, "a metà si aspetta");
        buf.extend_from_slice(&r[10..]);
        buf.extend_from_slice(&b);
        assert_eq!(separa(&mut buf).as_deref(), Some(&r[..]));
        assert_eq!(separa(&mut buf).as_deref(), Some(&b[..]));
        assert!(buf.is_empty());

        let mut solo_rumore = vec![1, 2, 3];
        assert_eq!(separa(&mut solo_rumore), None);
        assert!(solo_rumore.is_empty());
    }
}
