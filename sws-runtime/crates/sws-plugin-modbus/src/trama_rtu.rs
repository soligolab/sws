//! Le trame Modbus RTU fatte a mano (01-11-2026, piano
//! docs/archive/2026-11-01-inverter-solarman.md, fase 1). Tutto puro.
//!
//! Sul bus seriale e su TCP le trame le fa tokio-modbus, dentro di sé. Una
//! chiavetta Solarman V5 invece vuole la trama RTU **intera**, CRC compreso,
//! dentro il suo pacchetto ([`crate::solarman`]): bisogna saperla fare e leggere
//! da soli. Qui ci sono le funzioni che il trait [`crate::Dispositivo`] usa —
//! lettura delle quattro aree, scrittura di registri e di bit — e niente altro.
//!
//! Gli errori seguono la regola del plugin ([`crate::e_trasporto`]): un'eccezione
//! del dispositivo è `ErrorKind::Other`, e marca Bad solo i suoi tag; una
//! risposta rotta è `InvalidData`, che non chiude la sessione.

use std::io;

/// Il CRC16 Modbus (polinomio 0xA001 riflesso, valore iniziale 0xFFFF). Sul
/// filo va byte basso per primo.
pub fn crc16(dati: &[u8]) -> u16 {
    let mut crc = 0xFFFFu16;
    for b in dati {
        crc ^= *b as u16;
        for _ in 0..8 {
            crc = if crc & 1 != 0 {
                (crc >> 1) ^ 0xA001
            } else {
                crc >> 1
            };
        }
    }
    crc
}

fn con_crc(mut t: Vec<u8>) -> Vec<u8> {
    let c = crc16(&t);
    t.extend_from_slice(&c.to_le_bytes());
    t
}

/// La richiesta di lettura di `n` registri o bit da `addr` con la funzione `fc`
/// (1 coil, 2 discrete input, 3 holding, 4 input).
pub fn richiesta_lettura(unita: u8, fc: u8, addr: u16, n: u16) -> Vec<u8> {
    let mut t = vec![unita, fc];
    t.extend_from_slice(&addr.to_be_bytes());
    t.extend_from_slice(&n.to_be_bytes());
    con_crc(t)
}

/// La scrittura di registri: FC6 per uno solo, FC16 per più di uno, come fa
/// tokio-modbus sul TCP.
pub fn richiesta_scrittura_registri(unita: u8, addr: u16, regs: &[u16]) -> Vec<u8> {
    let mut t = vec![unita];
    if let [r] = regs {
        t.push(6);
        t.extend_from_slice(&addr.to_be_bytes());
        t.extend_from_slice(&r.to_be_bytes());
    } else {
        t.push(16);
        t.extend_from_slice(&addr.to_be_bytes());
        t.extend_from_slice(&(regs.len() as u16).to_be_bytes());
        t.push((regs.len() * 2) as u8);
        for r in regs {
            t.extend_from_slice(&r.to_be_bytes());
        }
    }
    con_crc(t)
}

/// La scrittura di bit: FC5 per uno solo (`0xFF00` acceso), FC15 per più di uno.
pub fn richiesta_scrittura_bit(unita: u8, addr: u16, bit: &[bool]) -> Vec<u8> {
    let mut t = vec![unita];
    if let [b] = bit {
        t.push(5);
        t.extend_from_slice(&addr.to_be_bytes());
        t.extend_from_slice(&(if *b { 0xFF00u16 } else { 0 }).to_be_bytes());
    } else {
        t.push(15);
        t.extend_from_slice(&addr.to_be_bytes());
        t.extend_from_slice(&(bit.len() as u16).to_be_bytes());
        let n = bit.len().div_ceil(8);
        t.push(n as u8);
        let mut byte = vec![0u8; n];
        for (i, b) in bit.iter().enumerate() {
            if *b {
                byte[i / 8] |= 1 << (i % 8);
            }
        }
        t.extend_from_slice(&byte);
    }
    con_crc(t)
}

fn rotta(msg: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, msg.into())
}

/// Controlla CRC, unità e funzione di una risposta, e restituisce i byte fra la
/// funzione e il CRC. Un'eccezione (funzione | 0x80) è `ErrorKind::Other`.
pub fn corpo_risposta(unita: u8, fc: u8, t: &[u8]) -> io::Result<&[u8]> {
    if t.len() < 5 {
        return Err(rotta(format!(
            "risposta RTU troppo corta: {} byte",
            t.len()
        )));
    }
    let (dati, crc) = t.split_at(t.len() - 2);
    if crc16(dati).to_le_bytes() != [crc[0], crc[1]] {
        return Err(rotta("CRC RTU sbagliato"));
    }
    if dati[0] != unita {
        return Err(rotta(format!(
            "risposta dall'unità {} invece che {unita}",
            dati[0]
        )));
    }
    if dati[1] == fc | 0x80 {
        return Err(io::Error::other(format!(
            "eccezione Modbus {} sulla funzione {fc}",
            dati[2]
        )));
    }
    if dati[1] != fc {
        return Err(rotta(format!(
            "risposta alla funzione {} invece che {fc}",
            dati[1]
        )));
    }
    Ok(&dati[2..])
}

/// I registri di una risposta a FC3/FC4.
pub fn registri_letti(unita: u8, fc: u8, n: u16, t: &[u8]) -> io::Result<Vec<u16>> {
    let c = corpo_risposta(unita, fc, t)?;
    let attesi = n as usize * 2;
    if c.first().map(|b| *b as usize) != Some(attesi) || c.len() != attesi + 1 {
        return Err(rotta(format!(
            "attesi {n} registri, arrivati {} byte",
            c.len().saturating_sub(1)
        )));
    }
    Ok(c[1..]
        .chunks_exact(2)
        .map(|w| u16::from_be_bytes([w[0], w[1]]))
        .collect())
}

/// I bit di una risposta a FC1/FC2, il primo nel bit meno significativo.
pub fn bit_letti(unita: u8, fc: u8, n: u16, t: &[u8]) -> io::Result<Vec<bool>> {
    let c = corpo_risposta(unita, fc, t)?;
    let attesi = (n as usize).div_ceil(8);
    if c.first().map(|b| *b as usize) != Some(attesi) || c.len() != attesi + 1 {
        return Err(rotta(format!(
            "attesi {n} bit, arrivati {} byte",
            c.len().saturating_sub(1)
        )));
    }
    Ok((0..n as usize)
        .map(|i| c[1 + i / 8] & (1 << (i % 8)) != 0)
        .collect())
}

/// La conferma di una scrittura: l'eco di indirizzo e quantità (o valore).
pub fn scrittura_confermata(unita: u8, fc: u8, t: &[u8]) -> io::Result<()> {
    let c = corpo_risposta(unita, fc, t)?;
    if c.len() != 4 {
        return Err(rotta("conferma di scrittura di lunghezza sbagliata"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crc_della_letteratura() {
        // L'esempio classico delle specifiche Modbus: unità 1, FC3, 0x0000, 10
        // registri → CRC `C5 CD` sul filo.
        assert_eq!(
            richiesta_lettura(1, 3, 0, 10),
            [0x01, 0x03, 0x00, 0x00, 0x00, 0x0A, 0xC5, 0xCD]
        );
    }

    #[test]
    fn lettura_dei_blocchi_dello_zcs() {
        let r = richiesta_lettura(1, 3, 0x0200, 0x56);
        assert_eq!(&r[..6], &[0x01, 0x03, 0x02, 0x00, 0x00, 0x56]);
        assert_eq!(crc16(&r), 0, "una trama col suo CRC ha CRC zero");
    }

    #[test]
    fn registri_da_una_risposta() {
        let t = con_crc(vec![1, 3, 4, 0x00, 0x11, 0xFF, 0xFE]);
        assert_eq!(registri_letti(1, 3, 2, &t).unwrap(), vec![0x0011, 0xFFFE]);
    }

    #[test]
    fn eccezione_e_other_risposta_rotta_e_invalid_data() {
        let ecc = con_crc(vec![1, 0x83, 2]);
        let e = registri_letti(1, 3, 1, &ecc).unwrap_err();
        assert_eq!(e.kind(), io::ErrorKind::Other);
        assert!(!crate::e_trasporto(&e));

        let mut rotta = con_crc(vec![1, 3, 2, 0, 1]);
        rotta[3] ^= 0xFF;
        assert_eq!(
            registri_letti(1, 3, 1, &rotta).unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );
        assert_eq!(
            registri_letti(1, 3, 1, &[1, 3]).unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );
        // Due registri chiesti, uno arrivato.
        assert!(registri_letti(1, 3, 2, &con_crc(vec![1, 3, 2, 0, 1])).is_err());
        // Un'altra unità.
        assert!(registri_letti(2, 3, 1, &con_crc(vec![1, 3, 2, 0, 1])).is_err());
    }

    #[test]
    fn bit_e_scritture() {
        let t = con_crc(vec![1, 1, 2, 0b0000_0101, 0b0000_0001]);
        assert_eq!(
            bit_letti(1, 1, 9, &t).unwrap(),
            vec![true, false, true, false, false, false, false, false, true]
        );

        assert_eq!(
            &richiesta_scrittura_registri(1, 0x10, &[7])[..6],
            &[1, 6, 0, 0x10, 0, 7]
        );
        assert_eq!(
            &richiesta_scrittura_registri(1, 0x10, &[7, 8])[..11],
            &[1, 16, 0, 0x10, 0, 2, 4, 0, 7, 0, 8]
        );
        assert_eq!(
            &richiesta_scrittura_bit(1, 3, &[true])[..6],
            &[1, 5, 0, 3, 0xFF, 0]
        );
        assert_eq!(
            &richiesta_scrittura_bit(1, 3, &[true, false, true])[..7],
            &[1, 15, 0, 3, 0, 3, 1]
        );

        let eco = con_crc(vec![1, 6, 0, 0x10, 0, 7]);
        assert!(scrittura_confermata(1, 6, &eco).is_ok());
    }
}
