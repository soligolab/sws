//! Un PDF di sole tabelle, scritto a mano (P3, 26-10-2026).
//!
//! Niente dipendenze nuove, di proposito: il piano CRA tratta ogni crate come
//! superficie da dichiarare, e per delle tabelle di testo un PDF 1.4 con
//! Helvetica (uno dei 14 font standard, che ogni lettore ha) basta. A4
//! orizzontale; l'intestazione di una tabella si ripete a ogni pagina; una
//! tabella con troppe colonne (l'andamento con tanti tag) si divide in gruppi
//! che ripetono la prima colonna.

use super::dati::{Cella, DatiReport, Tabella};

const LARGHEZZA: f64 = 842.0;
const ALTEZZA: f64 = 595.0;
const MARGINE: f64 = 36.0;
const RIGA: f64 = 14.0;
const CORPO: f64 = 9.0;
const COLONNE_MAX: usize = 9;

/// Il testo in WinAnsi (cp1252), con le parentesi e la barra protette. Quello
/// che WinAnsi non ha diventa `?`: meglio un carattere sbagliato visibile che
/// un PDF che un lettore rifiuta.
fn stringa_pdf(s: &str) -> Vec<u8> {
    let mut out = vec![b'('];
    for c in s.chars() {
        let b = match c {
            '(' | ')' | '\\' => {
                out.push(b'\\');
                c as u8
            }
            '€' => 0x80,
            '’' => 0x92,
            '“' => 0x93,
            '”' => 0x94,
            '–' => 0x96,
            '—' => 0x97,
            '•' => 0x95,
            '…' => 0x85,
            c if (c as u32) < 0x80 => c as u8,
            c if (0xA0..=0xFF).contains(&(c as u32)) => c as u32 as u8,
            _ => b'?',
        };
        out.push(b);
    }
    out.push(b')');
    out
}

/// Larghezza stimata di un testo in Helvetica: mezza em per carattere è la
/// media del font; basta per decidere dove tagliare.
fn larghezza(s: &str, corpo: f64) -> f64 {
    s.chars().count() as f64 * corpo * 0.52
}

fn taglia(s: &str, max: f64, corpo: f64) -> String {
    if larghezza(s, corpo) <= max {
        return s.to_string();
    }
    let n = ((max / (corpo * 0.52)) as usize).saturating_sub(1);
    let mut t: String = s.chars().take(n).collect();
    t.push('…');
    t
}

pub fn numero(v: f64, decimali: u8, virgola: bool) -> String {
    let s = format!("{:.*}", decimali as usize, v);
    if virgola { s.replace('.', ",") } else { s }
}

fn testo_cella(c: &Cella, virgola: bool) -> String {
    match c {
        Cella::Testo(s) => s.clone(),
        Cella::Numero(v, d) => numero(*v, *d, virgola),
        Cella::Vuota => "—".into(),
    }
}

/// Le larghezze delle colonne, in proporzione al testo più lungo di ciascuna
/// (intestazione compresa), fra un minimo e un massimo, scalate alla pagina.
/// Con larghezze uguali la descrizione si troncava e i numeri avevano mezza
/// colonna vuota (campione del 26-10-2026).
fn larghezze(t: &Tabella, utile: f64, virgola: bool) -> Vec<f64> {
    let n = t.colonne.len().max(1);
    let mut w: Vec<f64> = (0..n)
        .map(|i| {
            let intest = larghezza(&t.colonne[i], CORPO) + 8.0;
            let celle = t.righe.iter().filter_map(|r| r.get(i)).map(|c| larghezza(&testo_cella(c, virgola), CORPO) + 8.0);
            celle.fold(intest, f64::max).clamp(40.0, 260.0)
        })
        .collect();
    let somma: f64 = w.iter().sum();
    for x in &mut w {
        *x *= utile / somma;
    }
    w
}

/// Le tabelle con troppe colonne, divise: la prima colonna si ripete.
fn dividi(t: &Tabella) -> Vec<Tabella> {
    if t.colonne.len() <= COLONNE_MAX {
        return vec![t.clone()];
    }
    let resto: Vec<usize> = (1..t.colonne.len()).collect();
    resto
        .chunks(COLONNE_MAX - 1)
        .map(|gruppo| Tabella {
            titolo: t.titolo.clone(),
            colonne: std::iter::once(0).chain(gruppo.iter().copied()).map(|i| t.colonne[i].clone()).collect(),
            righe: t
                .righe
                .iter()
                .map(|r| std::iter::once(0).chain(gruppo.iter().copied()).map(|i| r.get(i).cloned().unwrap_or(Cella::Vuota)).collect())
                .collect(),
        })
        .collect()
}

struct Pagine {
    pagine: Vec<Vec<u8>>,
    y: f64,
}

impl Pagine {
    fn corrente(&mut self) -> &mut Vec<u8> {
        self.pagine.last_mut().expect("almeno una pagina")
    }
    fn nuova(&mut self) {
        self.pagine.push(Vec::new());
        self.y = ALTEZZA - MARGINE;
    }
    fn testo(&mut self, x: f64, y: f64, corpo: f64, grassetto: bool, s: &str) {
        let f = if grassetto { "F2" } else { "F1" };
        let mut op = format!("BT /{f} {corpo} Tf {x:.1} {y:.1} Td ").into_bytes();
        op.extend(stringa_pdf(s));
        op.extend(b" Tj ET\n");
        self.corrente().extend(op);
    }
    fn rettangolo(&mut self, x: f64, y: f64, w: f64, h: f64, grigio: f64) {
        let op = format!("{grigio:.2} g {x:.1} {y:.1} {w:.1} {h:.1} re f 0 g\n");
        self.corrente().extend(op.into_bytes());
    }
}

/// Il PDF intero.
pub fn scrivi(d: &DatiReport) -> Vec<u8> {
    let mut p = Pagine { pagine: Vec::new(), y: 0.0 };
    p.nuova();
    let y = p.y;
    p.testo(MARGINE, y - 16.0, 16.0, true, &d.titolo);
    p.testo(MARGINE, y - 34.0, 10.0, false, &format!("{} — {}", d.progetto, d.periodo));
    p.y -= 56.0;

    let utile = LARGHEZZA - 2.0 * MARGINE;
    for tab in d.tabelle.iter().flat_map(dividi) {
        if p.y < MARGINE + 4.0 * RIGA {
            p.nuova();
        }
        let y = p.y;
        p.testo(MARGINE, y - 12.0, 12.0, true, &tab.titolo);
        p.y -= 22.0;
        let w = larghezze(&tab, utile, d.virgola);
        let x0: Vec<f64> = w.iter().scan(MARGINE, |x, l| { let a = *x; *x += l; Some(a) }).collect();
        let intestazione = |p: &mut Pagine| {
            let y = p.y;
            p.rettangolo(MARGINE, y - RIGA + 3.0, utile, RIGA, 0.85);
            for (i, c) in tab.colonne.iter().enumerate() {
                p.testo(x0[i] + 2.0, y - RIGA + 6.0, CORPO, true, &taglia(c, w[i] - 4.0, CORPO));
            }
            p.y -= RIGA;
        };
        intestazione(&mut p);
        for (k, riga) in tab.righe.iter().enumerate() {
            if p.y < MARGINE + RIGA {
                p.nuova();
                intestazione(&mut p);
            }
            let y = p.y;
            if k % 2 == 1 {
                p.rettangolo(MARGINE, y - RIGA + 3.0, utile, RIGA, 0.95);
            }
            for (i, c) in riga.iter().enumerate().take(w.len()) {
                let s = taglia(&testo_cella(c, d.virgola), w[i] - 4.0, CORPO);
                // I numeri a destra, come in un foglio di calcolo.
                let x = match c {
                    Cella::Numero(..) => x0[i] + w[i] - 2.0 - larghezza(&s, CORPO),
                    _ => x0[i] + 2.0,
                };
                p.testo(x, y - RIGA + 6.0, CORPO, false, &s);
            }
            p.y -= RIGA;
        }
        p.y -= 12.0;
    }

    // Il piè di pagina, ora che si sa quante sono.
    let totale = p.pagine.len();
    for (i, pg) in p.pagine.iter_mut().enumerate() {
        let piede = format!("{} — {} {} {} / {}", d.progetto, d.generato, d.parole_pagina, i + 1, totale);
        let mut op = format!("BT /F1 8 Tf {MARGINE:.1} 20 Td ").into_bytes();
        op.extend(stringa_pdf(&piede));
        op.extend(b" Tj ET\n");
        pg.extend(op);
    }
    componi(&p.pagine)
}

/// Gli oggetti, la tabella xref e il trailer.
fn componi(contenuti: &[Vec<u8>]) -> Vec<u8> {
    // 1 catalogo, 2 pagine, 3-4 font, poi per ogni pagina: pagina e contenuto.
    let n = contenuti.len();
    let mut oggetti: Vec<Vec<u8>> = Vec::new();
    oggetti.push(b"<< /Type /Catalog /Pages 2 0 R >>".to_vec());
    let figli: Vec<String> = (0..n).map(|i| format!("{} 0 R", 5 + 2 * i)).collect();
    oggetti.push(format!("<< /Type /Pages /Kids [{}] /Count {n} >>", figli.join(" ")).into_bytes());
    oggetti.push(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>".to_vec());
    oggetti.push(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>".to_vec());
    for (i, c) in contenuti.iter().enumerate() {
        oggetti.push(
            format!(
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {LARGHEZZA} {ALTEZZA}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents {} 0 R >>",
                6 + 2 * i
            )
            .into_bytes(),
        );
        let mut s = format!("<< /Length {} >>\nstream\n", c.len()).into_bytes();
        s.extend(c);
        s.extend(b"\nendstream");
        oggetti.push(s);
    }
    let mut out = b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n".to_vec();
    let mut posizioni = Vec::with_capacity(oggetti.len());
    for (i, o) in oggetti.iter().enumerate() {
        posizioni.push(out.len());
        out.extend(format!("{} 0 obj\n", i + 1).into_bytes());
        out.extend(o);
        out.extend(b"\nendobj\n");
    }
    let xref = out.len();
    out.extend(format!("xref\n0 {}\n0000000000 65535 f \n", oggetti.len() + 1).into_bytes());
    for p in posizioni {
        out.extend(format!("{p:010} 00000 n \n").into_bytes());
    }
    out.extend(format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n", oggetti.len() + 1).into_bytes());
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dati(righe: usize, colonne: usize) -> DatiReport {
        DatiReport {
            titolo: "Report del turno".into(),
            progetto: "Caseificio (linea 2)".into(),
            periodo: "dal 26/10 06:00 al 26/10 14:00".into(),
            generato: "26/10 14:00".into(),
            tabelle: vec![Tabella {
                titolo: "Andamento".into(),
                colonne: (0..colonne).map(|i| format!("c{i}")).collect(),
                righe: (0..righe).map(|r| (0..colonne).map(|c| if c == 0 { Cella::Testo(format!("r{r}")) } else { Cella::Numero(r as f64 + 0.25, 2) }).collect()).collect(),
            }],
            virgola: true,
            parole_pagina: "Pagina",
        }
    }

    /// Un lettore PDF si fida della xref: ogni posizione deve cadere su
    /// «N 0 obj». Con 100 righe le pagine sono più d'una e l'intestazione si
    /// ripete; con 20 colonne la tabella si divide in gruppi.
    #[test]
    fn il_pdf_si_rilegge_dalla_sua_xref() {
        let pdf = scrivi(&dati(100, 20));
        // Gli offset della xref sono in **byte**: si lavora sui byte grezzi (il
        // commento binario della seconda riga non è UTF-8, e una conversione
        // «lossy» sposterebbe tutto).
        assert!(pdf.starts_with(b"%PDF-1.4") && pdf.ends_with(b"%%EOF\n"));
        let coda = String::from_utf8_lossy(&pdf[pdf.len() - 40..]).to_string();
        let pos: usize = coda[coda.rfind("startxref\n").unwrap() + 10..].lines().next().unwrap().parse().unwrap();
        assert!(pdf[pos..].starts_with(b"xref"));
        let xref = String::from_utf8_lossy(&pdf[pos..]).to_string();
        let righe: Vec<&str> = xref.lines().skip(3).take_while(|l| l.ends_with(" n ")).collect();
        for (i, r) in righe.iter().enumerate() {
            let off: usize = r[..10].parse().unwrap();
            assert!(pdf[off..].starts_with(format!("{} 0 obj", i + 1).as_bytes()), "oggetto {} fuori posto", i + 1);
        }
        let testo = String::from_utf8_lossy(&pdf).to_string();
        assert!(testo.matches("/Type /Page ").count() >= 3, "più pagine");
        assert!(testo.contains("(Caseificio \\(linea 2\\)"), "le parentesi protette");
        assert!(testo.contains("(1,25)"), "la virgola decimale in italiano");
        assert!(testo.contains("(c0)") && testo.contains("(c19)"), "la tabella divisa tiene tutte le colonne");
    }

    #[test]
    fn i_caratteri_italiani_viaggiano_in_winansi() {
        assert_eq!(stringa_pdf("Unità °C"), b"(Unit\xE0 \xB0C)".to_vec());
        assert_eq!(stringa_pdf("漢"), b"(?)".to_vec());
        assert_eq!(stringa_pdf("…"), b"(\x85)".to_vec(), "il troncamento non diventa un punto di domanda");
    }
}
