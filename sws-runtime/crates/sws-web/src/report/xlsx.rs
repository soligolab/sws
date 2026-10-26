//! Un `.xlsx` scritto a mano (P3, 26-10-2026): SpreadsheetML in uno zip, un
//! foglio per tabella. Come il PDF, niente dipendenze nuove: lo zip c'è già
//! (`backups.rs`). I numeri restano numeri (si sommano e si filtrano in Excel),
//! con un formato a decimali fissi; i testi sono stringhe in linea.

use super::dati::{Cella, DatiReport};
use std::io::{Cursor, Write};
use zip::write::SimpleFileOptions;

fn esc(s: &str) -> String {
    let mut o = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => o.push_str("&amp;"),
            '<' => o.push_str("&lt;"),
            '>' => o.push_str("&gt;"),
            '"' => o.push_str("&quot;"),
            // I caratteri di controllo non sono XML valido: Excel rifiuterebbe il file.
            c if (c as u32) < 0x20 && c != '\t' && c != '\n' => {}
            c => o.push(c),
        }
    }
    o
}

/// «A», «B», … «AA»: il nome della colonna `i` (da 0).
fn colonna(mut i: usize) -> String {
    let mut s = String::new();
    loop {
        s.insert(0, (b'A' + (i % 26) as u8) as char);
        if i < 26 {
            break;
        }
        i = i / 26 - 1;
    }
    s
}

/// Il nome di un foglio: al massimo 31 caratteri, senza `[]:*?/\`, unico.
fn nome_foglio(t: &str, usati: &mut Vec<String>) -> String {
    let base: String = t.chars().filter(|c| !"[]:*?/\\".contains(*c)).take(28).collect();
    let base = if base.trim().is_empty() { "Foglio".to_string() } else { base };
    let mut n = base.clone();
    let mut k = 2;
    while usati.contains(&n) {
        n = format!("{base} {k}");
        k += 1;
    }
    usati.push(n.clone());
    n
}

/// Lo stile di una cella numerica con `d` decimali: 1 = intero, 2..=7 = da 1 a 6 decimali.
fn stile(d: u8) -> usize {
    1 + d.min(6) as usize
}

fn foglio(intestazione: &[String], righe: &[Vec<Cella>], prima: &[String]) -> String {
    let mut x = String::from(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>"#);
    let mut r = 1;
    let riga_testo = |x: &mut String, r: usize, celle: &[String], grassetto: bool| {
        x.push_str(&format!(r#"<row r="{r}">"#));
        for (i, c) in celle.iter().enumerate() {
            let s = if grassetto { r#" s="8""# } else { "" };
            x.push_str(&format!(r#"<c r="{}{r}" t="inlineStr"{s}><is><t xml:space="preserve">{}</t></is></c>"#, colonna(i), esc(c)));
        }
        x.push_str("</row>");
    };
    for p in prima {
        riga_testo(&mut x, r, std::slice::from_ref(p), true);
        r += 1;
    }
    if !prima.is_empty() {
        r += 1;
    }
    riga_testo(&mut x, r, intestazione, true);
    r += 1;
    for riga in righe {
        x.push_str(&format!(r#"<row r="{r}">"#));
        for (i, c) in riga.iter().enumerate() {
            let rif = format!("{}{r}", colonna(i));
            match c {
                Cella::Testo(s) => x.push_str(&format!(r#"<c r="{rif}" t="inlineStr"><is><t xml:space="preserve">{}</t></is></c>"#, esc(s))),
                Cella::Numero(v, d) if v.is_finite() => x.push_str(&format!(r#"<c r="{rif}" s="{}"><v>{v}</v></c>"#, stile(*d))),
                _ => {}
            }
        }
        x.push_str("</row>");
        r += 1;
    }
    x.push_str("</sheetData></worksheet>");
    x
}

const STILI: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="6"><numFmt numFmtId="164" formatCode="0.0"/><numFmt numFmtId="165" formatCode="0.00"/><numFmt numFmtId="166" formatCode="0.000"/><numFmt numFmtId="167" formatCode="0.0000"/><numFmt numFmtId="168" formatCode="0.00000"/><numFmt numFmtId="169" formatCode="0.000000"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="9"><xf/><xf numFmtId="1" applyNumberFormat="1"/><xf numFmtId="164" applyNumberFormat="1"/><xf numFmtId="165" applyNumberFormat="1"/><xf numFmtId="166" applyNumberFormat="1"/><xf numFmtId="167" applyNumberFormat="1"/><xf numFmtId="168" applyNumberFormat="1"/><xf numFmtId="169" applyNumberFormat="1"/><xf fontId="1" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>"#;

/// Il file intero.
pub fn scrivi(d: &DatiReport) -> anyhow::Result<Vec<u8>> {
    let mut usati = Vec::new();
    let nomi: Vec<String> = d.tabelle.iter().map(|t| nome_foglio(&t.titolo, &mut usati)).collect();
    let mut buf = Cursor::new(Vec::new());
    {
        let mut z = zip::ZipWriter::new(&mut buf);
        let o = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        let mut parte = |nome: &str, testo: &str| -> anyhow::Result<()> {
            z.start_file(nome, o)?;
            z.write_all(testo.as_bytes())?;
            Ok(())
        };
        let fogli_ct: String = (1..=nomi.len())
            .map(|i| format!(r#"<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>"#))
            .collect();
        parte("[Content_Types].xml", &format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>{fogli_ct}</Types>"#))?;
        parte("_rels/.rels", r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#)?;
        let fogli: String = nomi.iter().enumerate().map(|(i, n)| format!(r#"<sheet name="{}" sheetId="{}" r:id="rId{}"/>"#, esc(n), i + 1, i + 1)).collect();
        parte("xl/workbook.xml", &format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>{fogli}</sheets></workbook>"#))?;
        let rel: String = (1..=nomi.len())
            .map(|i| format!(r#"<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i}.xml"/>"#))
            .collect();
        parte("xl/_rels/workbook.xml.rels", &format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{rel}<Relationship Id="rId{}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>"#, nomi.len() + 1))?;
        parte("xl/styles.xml", STILI)?;
        for (i, t) in d.tabelle.iter().enumerate() {
            // Il primo foglio porta titolo, progetto e periodo: un file aperto
            // da solo deve dire cos'è.
            let prima = if i == 0 { vec![d.titolo.clone(), d.progetto.clone(), d.periodo.clone()] } else { Vec::new() };
            parte(&format!("xl/worksheets/sheet{}.xml", i + 1), &foglio(&t.colonne, &t.righe, &prima))?;
        }
        z.finish()?;
    }
    Ok(buf.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::report::dati::Tabella;
    use std::io::Read;

    #[test]
    fn l_xlsx_ha_le_parti_e_i_numeri_restano_numeri() {
        let d = DatiReport {
            titolo: "Turno & co".into(),
            progetto: "P".into(),
            periodo: "x".into(),
            generato: "y".into(),
            tabelle: vec![
                Tabella { titolo: "Riepilogo".into(), colonne: vec!["Tag".into(), "Media".into()], righe: vec![vec![Cella::Testo("t<1>".into()), Cella::Numero(21.5, 1)]] },
                Tabella { titolo: "Riepilogo".into(), colonne: vec!["A".into()], righe: vec![] },
            ],
            virgola: true,
            parole_pagina: "Pagina",
        };
        let b = scrivi(&d).unwrap();
        let mut z = zip::ZipArchive::new(Cursor::new(b)).unwrap();
        for p in ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet2.xml"] {
            assert!(z.by_name(p).is_ok(), "manca {p}");
        }
        let mut wb = String::new();
        z.by_name("xl/workbook.xml").unwrap().read_to_string(&mut wb).unwrap();
        assert!(wb.contains(r#"name="Riepilogo""#) && wb.contains(r#"name="Riepilogo 2""#), "nomi dei fogli unici: {wb}");
        let mut f = String::new();
        z.by_name("xl/worksheets/sheet1.xml").unwrap().read_to_string(&mut f).unwrap();
        assert!(f.contains("<v>21.5</v>") && f.contains(r#"s="2""#), "un numero con un decimale: {f}");
        assert!(f.contains("t&lt;1&gt;") && f.contains("Turno &amp; co"));
    }

    #[test]
    fn i_nomi_delle_colonne() {
        assert_eq!([0, 25, 26, 27, 51, 52].map(colonna), ["A", "Z", "AA", "AB", "AZ", "BA"]);
    }
}
