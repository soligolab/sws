//! I trasporti nuovi della sorgente Modbus su TCP (01-11-2026, piano
//! docs/archive/2026-11-01-inverter-solarman.md, fase 2).
//!
//! Il resto del plugin non sa come viaggia una richiesta: parla col trait
//! [`Dispositivo`]. Qui ci sono:
//! - [`ClientSolarman`], che mette ogni trama RTU in un pacchetto V5
//!   ([`crate::solarman`]) e ne aspetta la risposta, scartando quel che non è
//!   suo e rispondendo ai pacchetti di servizio della chiavetta;
//! - [`Ritmato`], che avvolge un qualunque dispositivo con la **pausa** fra due
//!   richieste e i **tentativi** sulle risposte rotte. Le chiavette Wi-Fi non
//!   reggono richieste attaccate, e ogni tanto mescolano due risposte.
//!
//! La trama RTU nuda nel socket (convertitori seriale/Ethernet) non ha bisogno
//! di niente di nuovo: è il client RTU di tokio-modbus su un `TcpStream`.

use std::io;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use sws_core::AreaModbus;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::time::Instant;
use tracing::debug;

use crate::solarman::{self, Arrivato};
use crate::trama_rtu as rtu;
use crate::{Dispositivo, Letti};

fn ora_unix() -> u32 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as u32)
        .unwrap_or(0)
}

fn codice(area: AreaModbus) -> u8 {
    match area {
        AreaModbus::Coil => 1,
        AreaModbus::Discrete => 2,
        AreaModbus::Holding => 3,
        AreaModbus::Input => 4,
    }
}

/// Un client Modbus attraverso una chiavetta Solarman V5. Generico sul flusso,
/// così i test gli danno un `duplex` al posto del socket.
pub struct ClientSolarman<S> {
    flusso: S,
    seriale: u32,
    seq: u8,
    unita: u8,
    buf: Vec<u8>,
    /// Pacchetti arrivati e buttati: rotti, d'altri o di una richiesta vecchia.
    pub scartati: Arc<AtomicU64>,
    /// Una lettura senza risposta entro questo tempo si rimanda una volta,
    /// con una sequenza nuova (02-11-2026). La chiavetta ogni tanto ne perde
    /// una — dopo una riconnessione quasi sempre la prima — e il giro intero
    /// diventava Bad per 10 s. La risposta in ritardo alla prima, se arriva, ha
    /// la sequenza vecchia e si scarta.
    ripeti_dopo: Option<Duration>,
}

impl<S: AsyncRead + AsyncWrite + Unpin> ClientSolarman<S> {
    pub fn nuovo(flusso: S, seriale: u32, unita: u8) -> Self {
        // La libreria parte da un numero a caso: una risposta rimasta in giro
        // da una connessione di prima non deve sembrare la nostra.
        let seq = (std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0)
            & 0xFF) as u8;
        Self { flusso, seriale, seq, unita, buf: Vec::new(), scartati: Arc::default(), ripeti_dopo: None }
    }

    /// Rimanda una lettura rimasta senza risposta dopo `d` (vedi `ripeti_dopo`).
    pub fn con_ripetizione(mut self, d: Duration) -> Self {
        self.ripeti_dopo = Some(d);
        self
    }

    /// Manda una trama RTU e restituisce la trama RTU della risposta. Il tempo
    /// massimo lo mette chi chiama, come per gli altri trasporti. `ripetibile`
    /// solo per le letture: una scrittura rimandata sarebbe fatta due volte.
    async fn scambia(&mut self, richiesta: &[u8], ripetibile: bool) -> io::Result<Vec<u8>> {
        self.manda(richiesta).await?;
        if let (true, Some(d)) = (ripetibile, self.ripeti_dopo) {
            match tokio::time::timeout(d, self.ricevi()).await {
                Ok(r) => return r,
                Err(_) => {
                    debug!(seq = self.seq, "Solarman V5: nessuna risposta in {} ms, rimando la lettura", d.as_millis());
                    self.manda(richiesta).await?;
                }
            }
        }
        self.ricevi().await
    }

    async fn manda(&mut self, richiesta: &[u8]) -> io::Result<()> {
        self.seq = self.seq.wrapping_add(1);
        self.flusso.write_all(&solarman::incapsula(self.seriale, self.seq, richiesta)).await
    }

    /// La risposta alla sequenza corrente; intanto risponde ai pacchetti di
    /// servizio e butta il resto.
    async fn ricevi(&mut self) -> io::Result<Vec<u8>> {
        loop {
            while let Some(p) = solarman::separa(&mut self.buf) {
                match solarman::classifica(&p, self.seriale, ora_unix()) {
                    Arrivato::Risposta { seq, rtu } if seq == self.seq => return Ok(rtu),
                    Arrivato::Risposta { seq, .. } => {
                        self.scartati.fetch_add(1, Ordering::Relaxed);
                        debug!(seq, attesa = self.seq, "Solarman V5: risposta a una richiesta vecchia, scartata");
                    }
                    Arrivato::Servizio { risposta } => self.flusso.write_all(&risposta).await?,
                    Arrivato::Scarto(perche) => {
                        // Poteva essere la nostra risposta, rovinata: si dice
                        // subito, e `Ritmato` decide se riprovare.
                        self.scartati.fetch_add(1, Ordering::Relaxed);
                        return Err(io::Error::new(io::ErrorKind::InvalidData, format!("Solarman V5: {perche}")));
                    }
                }
            }
            let mut pezzo = [0u8; 1024];
            let n = self.flusso.read(&mut pezzo).await?;
            if n == 0 {
                return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "la chiavetta ha chiuso la connessione"));
            }
            self.buf.extend_from_slice(&pezzo[..n]);
        }
    }
}

impl<S: AsyncRead + AsyncWrite + Unpin> Dispositivo for ClientSolarman<S> {
    async fn leggi(&mut self, area: AreaModbus, addr: u16, n: u16) -> io::Result<Letti> {
        let fc = codice(area);
        let t = self.scambia(&rtu::richiesta_lettura(self.unita, fc, addr, n), true).await?;
        Ok(if area.a_bit() {
            Letti::Bit(rtu::bit_letti(self.unita, fc, n, &t)?)
        } else {
            Letti::Registri(rtu::registri_letti(self.unita, fc, n, &t)?)
        })
    }
    async fn scrivi_registri(&mut self, addr: u16, regs: &[u16]) -> io::Result<()> {
        let fc = if regs.len() == 1 { 6 } else { 16 };
        let t = self.scambia(&rtu::richiesta_scrittura_registri(self.unita, addr, regs), false).await?;
        rtu::scrittura_confermata(self.unita, fc, &t)
    }
    async fn scrivi_bit(&mut self, addr: u16, bit: &[bool]) -> io::Result<()> {
        let fc = if bit.len() == 1 { 5 } else { 15 };
        let t = self.scambia(&rtu::richiesta_scrittura_bit(self.unita, addr, bit), false).await?;
        rtu::scrittura_confermata(self.unita, fc, &t)
    }
    fn imposta_unita(&mut self, unita: u8) {
        self.unita = unita;
    }
}

/// Un dispositivo con la pausa fra le richieste e i tentativi sulle letture
/// rotte. Le scritture non si ripetono: una scrittura arrivata con la conferma
/// persa verrebbe fatta due volte.
pub struct Ritmato<D> {
    dev: D,
    pausa: Duration,
    tentativi: u8,
    ultima: Option<Instant>,
}

impl<D: Dispositivo> Ritmato<D> {
    pub fn nuovo(dev: D, pausa_ms: u64, tentativi: u8) -> Self {
        Self { dev, pausa: Duration::from_millis(pausa_ms), tentativi, ultima: None }
    }

    async fn aspetta(&mut self) {
        if let Some(u) = self.ultima {
            tokio::time::sleep_until(u + self.pausa).await;
        }
    }
}

impl<D: Dispositivo> Dispositivo for Ritmato<D> {
    async fn leggi(&mut self, area: AreaModbus, addr: u16, n: u16) -> io::Result<Letti> {
        let mut fatti = 0;
        loop {
            self.aspetta().await;
            let r = self.dev.leggi(area, addr, n).await;
            self.ultima = Some(Instant::now());
            match r {
                Err(e) if e.kind() == io::ErrorKind::InvalidData && fatti < self.tentativi => {
                    fatti += 1;
                    debug!(addr, n, tentativo = fatti, "Modbus: risposta rotta, riprovo: {e}");
                }
                r => return r,
            }
        }
    }
    async fn scrivi_registri(&mut self, addr: u16, regs: &[u16]) -> io::Result<()> {
        self.aspetta().await;
        let r = self.dev.scrivi_registri(addr, regs).await;
        self.ultima = Some(Instant::now());
        r
    }
    async fn scrivi_bit(&mut self, addr: u16, bit: &[bool]) -> io::Result<()> {
        self.aspetta().await;
        let r = self.dev.scrivi_bit(addr, bit).await;
        self.ultima = Some(Instant::now());
        r
    }
    fn imposta_unita(&mut self, unita: u8) {
        self.dev.imposta_unita(unita);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::duplex;

    const SERIALE: u32 = 1786079474;

    /// Una chiavetta finta: legge un pacchetto, risponde con quello che le dice
    /// `rispondi` (zero o più pacchetti, anche rotti o d'altri).
    async fn chiavetta(mut lato: tokio::io::DuplexStream, rispondi: impl Fn(u8, &[u8]) -> Vec<Vec<u8>>) {
        let mut buf = Vec::new();
        let mut pezzo = [0u8; 512];
        loop {
            let n = match lato.read(&mut pezzo).await {
                Ok(0) | Err(_) => return,
                Ok(n) => n,
            };
            buf.extend_from_slice(&pezzo[..n]);
            while let Some(p) = solarman::separa(&mut buf) {
                if p[4] != solarman::RICHIESTA {
                    continue; // la risposta a un battito
                }
                for r in rispondi(p[5], &p[26..p.len() - 2]) {
                    if lato.write_all(&r).await.is_err() {
                        return;
                    }
                }
            }
        }
    }

    /// Il pacchetto di risposta che la chiavetta costruisce.
    fn pacchetto(controllo: u8, seq: u8, carico: &[u8]) -> Vec<u8> {
        let mut t = vec![0xA5];
        t.extend_from_slice(&(carico.len() as u16).to_le_bytes());
        t.extend_from_slice(&[0x10, controllo, seq, 0]);
        t.extend_from_slice(&SERIALE.to_le_bytes());
        t.extend_from_slice(carico);
        let c = solarman::checksum(&t[1..]);
        t.push(c);
        t.push(0x15);
        t
    }

    fn risposta(seq: u8, rtu_risp: &[u8]) -> Vec<u8> {
        let mut carico = vec![0x02, 0x01];
        carico.extend_from_slice(&[0; 12]);
        carico.extend_from_slice(rtu_risp);
        pacchetto(solarman::RISPOSTA, seq, &carico)
    }

    fn registri(unita: u8, valori: &[u16]) -> Vec<u8> {
        let mut t = vec![unita, 3, (valori.len() * 2) as u8];
        for v in valori {
            t.extend_from_slice(&v.to_be_bytes());
        }
        let c = rtu::crc16(&t);
        t.extend_from_slice(&c.to_le_bytes());
        t
    }

    #[tokio::test]
    async fn legge_attraverso_la_chiavetta_scartando_battiti_e_risposte_vecchie() {
        let (a, b) = duplex(4096);
        tokio::spawn(chiavetta(b, |seq, rtu_rich| {
            assert_eq!(&rtu_rich[..6], &[1, 3, 0x02, 0x10, 0, 2]);
            vec![
                pacchetto(0x47, 9, &[0]),                    // un battito
                risposta(seq.wrapping_sub(1), &registri(1, &[9, 9])), // una risposta vecchia
                risposta(seq, &registri(1, &[17, 489])),     // la nostra
            ]
        }));
        let mut c = ClientSolarman::nuovo(a, SERIALE, 1);
        let l = c.leggi(AreaModbus::Holding, 0x0210, 2).await.unwrap();
        assert_eq!(l, Letti::Registri(vec![17, 489]));
        assert_eq!(c.scartati.load(Ordering::Relaxed), 1);
    }

    #[tokio::test]
    async fn un_eccezione_resta_un_eccezione() {
        let (a, b) = duplex(4096);
        tokio::spawn(chiavetta(b, |seq, _| {
            let mut e = vec![1, 0x83, 2];
            let c = rtu::crc16(&e);
            e.extend_from_slice(&c.to_le_bytes());
            vec![risposta(seq, &e)]
        }));
        let mut c = ClientSolarman::nuovo(a, SERIALE, 1);
        let e = c.leggi(AreaModbus::Holding, 0x0200, 1).await.unwrap_err();
        assert_eq!(e.kind(), io::ErrorKind::Other);
        assert!(!crate::e_trasporto(&e));
    }

    #[tokio::test]
    async fn una_risposta_rotta_si_riprova() {
        let (a, b) = duplex(4096);
        let volte = Arc::new(AtomicU64::new(0));
        let v = volte.clone();
        tokio::spawn(chiavetta(b, move |seq, _| {
            let mut r = risposta(seq, &registri(1, &[5]));
            if v.fetch_add(1, Ordering::Relaxed) == 0 {
                let n = r.len();
                r[n - 2] ^= 0xFF; // il primo con il checksum rovinato
            }
            vec![r]
        }));
        let mut c = Ritmato::nuovo(ClientSolarman::nuovo(a, SERIALE, 1), 0, 2);
        assert_eq!(c.leggi(AreaModbus::Holding, 0, 1).await.unwrap(), Letti::Registri(vec![5]));
        assert_eq!(volte.load(Ordering::Relaxed), 2);
    }

    #[tokio::test]
    async fn la_chiavetta_che_chiude_e_un_guasto_di_trasporto() {
        let (a, b) = duplex(64);
        drop(b);
        let mut c = ClientSolarman::nuovo(a, SERIALE, 1);
        let e = c.leggi(AreaModbus::Holding, 0, 1).await.unwrap_err();
        assert!(crate::e_trasporto(&e), "{e:?}");
    }

    /// 02-11-2026: la chiavetta perde la prima richiesta; la lettura si
    /// rimanda e la seconda risposta arriva entro il timeout.
    #[tokio::test(start_paused = true)]
    async fn una_lettura_muta_si_rimanda_una_volta() {
        let (a, b) = duplex(4096);
        let volte = Arc::new(AtomicU64::new(0));
        let v = volte.clone();
        tokio::spawn(chiavetta(b, move |seq, _| {
            if v.fetch_add(1, Ordering::Relaxed) == 0 { vec![] } else { vec![risposta(seq, &registri(1, &[7]))] }
        }));
        let mut c = ClientSolarman::nuovo(a, SERIALE, 1).con_ripetizione(Duration::from_millis(2500));
        let l = tokio::time::timeout(Duration::from_secs(5), c.leggi(AreaModbus::Holding, 0, 1)).await.unwrap().unwrap();
        assert_eq!(l, Letti::Registri(vec![7]));
        assert_eq!(volte.load(Ordering::Relaxed), 2);
    }

    /// Una scrittura senza conferma **non** si rimanda: potrebbe essere già
    /// arrivata, e la si farebbe due volte.
    #[tokio::test(start_paused = true)]
    async fn una_scrittura_muta_non_si_rimanda() {
        let (a, b) = duplex(4096);
        let volte = Arc::new(AtomicU64::new(0));
        let v = volte.clone();
        tokio::spawn(chiavetta(b, move |_, _| {
            v.fetch_add(1, Ordering::Relaxed);
            vec![]
        }));
        let mut c = ClientSolarman::nuovo(a, SERIALE, 1).con_ripetizione(Duration::from_millis(2500));
        assert!(tokio::time::timeout(Duration::from_secs(5), c.scrivi_registri(0, &[1])).await.is_err());
        assert_eq!(volte.load(Ordering::Relaxed), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn la_pausa_separa_le_richieste() {
        struct Orologio(Vec<Instant>);
        impl Dispositivo for Orologio {
            async fn leggi(&mut self, _: AreaModbus, _: u16, _: u16) -> io::Result<Letti> {
                self.0.push(Instant::now());
                Ok(Letti::Registri(vec![0]))
            }
            async fn scrivi_registri(&mut self, _: u16, _: &[u16]) -> io::Result<()> {
                Ok(())
            }
            async fn scrivi_bit(&mut self, _: u16, _: &[bool]) -> io::Result<()> {
                Ok(())
            }
            fn imposta_unita(&mut self, _: u8) {}
        }
        let mut r = Ritmato::nuovo(Orologio(Vec::new()), 300, 0);
        r.leggi(AreaModbus::Holding, 0, 1).await.unwrap();
        r.leggi(AreaModbus::Holding, 0, 1).await.unwrap();
        let t = &r.dev.0;
        assert!(t[1] - t[0] >= Duration::from_millis(300));
    }
}
