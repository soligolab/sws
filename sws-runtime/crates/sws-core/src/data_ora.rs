//! La data e l'ora scritte dall'oggetto «Data e ora» (`clock`, 15-10-2026, piano
//! `docs/plans/2026-10-15-cornici-di-pagina.md`, ramo 1).
//!
//! Funzione pura su componenti già scomposti (anno, mese, …): così web e pannello
//! la provano sugli stessi casi senza dipendere dal fuso orario della macchina
//! che esegue i test. Gemello: `sws-editor/src/canvas/dataOra.ts`; casi in
//! `tests/fixtures/data-ora.json`.

/// Una data e un'ora già nel fuso del dispositivo che le mostra.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Componenti {
    pub anno: i32,
    /// 1…12
    pub mese: u32,
    /// 1…31
    pub giorno: u32,
    pub ore: u32,
    pub minuti: u32,
    pub secondi: u32,
    /// 0 = domenica … 6 = sabato (come `Date.getDay()` in JavaScript).
    pub giorno_settimana: u32,
}

/// Il modello di un formato pronto; `None` per un formato sconosciuto.
pub fn modello_di(formato: &str, secondi: bool) -> Option<&'static str> {
    Some(match (formato, secondi) {
        ("ora", false) => "%H:%M",
        ("ora", true) => "%H:%M:%S",
        ("data", _) => "%d/%m/%Y",
        ("data_ora", false) => "%d/%m/%Y %H:%M",
        ("data_ora", true) => "%d/%m/%Y %H:%M:%S",
        ("giorno", _) => "%A %d %B %Y",
        _ => return None,
    })
}

fn giorni(lingua: &str) -> [&'static str; 7] {
    match lingua {
        "it" => ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"],
        "es" => ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"],
        _ => ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    }
}

fn mesi(lingua: &str) -> [&'static str; 12] {
    match lingua {
        "it" => ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"],
        "es" => ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
        _ => ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    }
}

/// Le prime tre lettere: «gio», «Thu», «jue». Sui caratteri, non sui byte.
fn breve(s: &str) -> String {
    s.chars().take(3).collect()
}

/// Scrive `c` secondo `modello`. I segnaposti: `%d` giorno, `%m` mese, `%Y`
/// anno, `%y` anno a due cifre, `%H` ore, `%M` minuti, `%S` secondi (tutti a
/// due cifre), `%A`/`%a` giorno della settimana per esteso/breve, `%B`/`%b`
/// mese per esteso/breve, `%%` il simbolo. Un segnaposto sconosciuto resta com'è.
pub fn formatta(c: &Componenti, modello: &str, lingua: &str) -> String {
    let mut out = String::new();
    let mut it = modello.chars();
    while let Some(ch) = it.next() {
        if ch != '%' {
            out.push(ch);
            continue;
        }
        match it.next() {
            Some('d') => out.push_str(&format!("{:02}", c.giorno)),
            Some('m') => out.push_str(&format!("{:02}", c.mese)),
            Some('Y') => out.push_str(&c.anno.to_string()),
            Some('y') => out.push_str(&format!("{:02}", c.anno.rem_euclid(100))),
            Some('H') => out.push_str(&format!("{:02}", c.ore)),
            Some('M') => out.push_str(&format!("{:02}", c.minuti)),
            Some('S') => out.push_str(&format!("{:02}", c.secondi)),
            Some('A') => out.push_str(giorni(lingua)[(c.giorno_settimana % 7) as usize]),
            Some('a') => out.push_str(&breve(giorni(lingua)[(c.giorno_settimana % 7) as usize])),
            Some('B') => out.push_str(mesi(lingua)[((c.mese + 11) % 12) as usize]),
            Some('b') => out.push_str(&breve(mesi(lingua)[((c.mese + 11) % 12) as usize])),
            Some('%') => out.push('%'),
            Some(altro) => {
                out.push('%');
                out.push(altro);
            }
            None => out.push('%'),
        }
    }
    out
}

/// Il testo di un oggetto `clock`: formato pronto o modello personalizzato.
pub fn testo_orologio(c: &Componenti, formato: Option<&str>, secondi: bool, modello: Option<&str>, lingua: &str) -> String {
    let f = formato.unwrap_or("ora");
    let m = if f == "personalizzato" {
        modello.filter(|m| !m.is_empty()).unwrap_or("%H:%M")
    } else {
        modello_di(f, secondi).unwrap_or("%H:%M")
    };
    formatta(c, m, lingua)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    struct Caso {
        nome: String,
        componenti: [u32; 6],
        anno: i32,
        #[serde(default)]
        formato: Option<String>,
        #[serde(default)]
        secondi: bool,
        #[serde(default)]
        modello: Option<String>,
        lingua: String,
        atteso: String,
    }

    #[test]
    fn i_casi_della_fixture() {
        let casi: Vec<Caso> = serde_json::from_str(include_str!("../../../../tests/fixtures/data-ora.json")).unwrap();
        for k in casi {
            let [mese, giorno, ore, minuti, secondi, gs] = k.componenti;
            let c = Componenti { anno: k.anno, mese, giorno, ore, minuti, secondi, giorno_settimana: gs };
            assert_eq!(
                testo_orologio(&c, k.formato.as_deref(), k.secondi, k.modello.as_deref(), &k.lingua),
                k.atteso,
                "{}",
                k.nome
            );
        }
    }
}
