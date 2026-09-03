//! Il cron degli script globali: **un** parser, usato sia da chi schedula sia
//! da chi valida.
//!
//! # Perché è un modulo a sé
//!
//! Le regole stavano scritte due volte — in `parse_field` (che schedulava) e in
//! `cron_rilievi` (che avvisava, in `validate.rs`) — e questo è esattamente il
//! modo in cui l'informazione duplicata mente: fino al 2026-09-03 il validatore
//! diceva «questo cron non capisce i passi `*/n`», che era vero; il giorno in
//! cui il parser li impara, quel messaggio diventa una bugia che nessuno
//! aggiorna. Ora la sintassi ammessa è definita in un posto solo, e chi valida
//! chiede al parser invece di reimplementarne le regole.
//!
//! # Il difetto che questo modulo chiude (Q34)
//!
//! Il vecchio `parse_field` faceva `filter_map(parse::<u8>().ok())`: **scartava**
//! ciò che non sapeva leggere. Quindi `*/5` non era un errore — diventava un
//! `Vec` vuoto, e un insieme vuoto non combacia con nessun minuto. Lo script
//! veniva schedulato, il supervisore avviava il suo task, e **non partiva mai**:
//! nessun errore, nessuna riga di log, nessuna spia nell'IDE. `*/5 * * * *` è la
//! prima cosa che chiunque scrive per «ogni cinque minuti», e in ogni altro cron
//! del mondo funziona.
//!
//! Qui ciò che non si capisce è un **errore dichiarato**, non un insieme vuoto.

/// Quanto è grave un problema trovato in un'espressione cron.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Gravita {
    /// L'espressione non è usabile: lo script non va schedulato.
    Errore,
    /// L'espressione è usabile, ma probabilmente non fa quello che si crede.
    Avviso,
}

#[derive(Debug, Clone)]
pub struct Problema {
    pub gravita: Gravita,
    /// Il nome del campo in italiano (`minuto`, `ora`, …), o `espressione` per
    /// i problemi che riguardano l'intera stringa.
    pub campo: &'static str,
    pub messaggio: String,
    pub suggerimento: String,
}

impl Problema {
    fn errore(campo: &'static str, messaggio: String, suggerimento: impl Into<String>) -> Self {
        Self { gravita: Gravita::Errore, campo, messaggio, suggerimento: suggerimento.into() }
    }
    fn avviso(campo: &'static str, messaggio: String, suggerimento: impl Into<String>) -> Self {
        Self { gravita: Gravita::Avviso, campo, messaggio, suggerimento: suggerimento.into() }
    }
}

/// I cinque insiemi di istanti che l'espressione ammette.
#[derive(Debug, Clone)]
pub struct Cron {
    minute: Vec<u8>,  // 0-59
    hour: Vec<u8>,    // 0-23
    day: Vec<u8>,     // 1-31
    month: Vec<u8>,   // 1-12
    weekday: Vec<u8>, // 0-6, con la domenica a 0
}

const CAMPI: [(&str, u8, u8); 5] = [
    ("minuto", 0, 59),
    ("ora", 0, 23),
    ("giorno", 1, 31),
    ("mese", 1, 12),
    ("giorno-settimana", 0, 6),
];

/// Legge l'espressione e restituisce **sia** il risultato **sia** tutto ciò che
/// non torna.
///
/// Il `Cron` c'è quando l'espressione è usabile, cioè quando fra i problemi non
/// c'è nessun `Errore`; gli `Avviso` non impediscono di schedulare. Le due cose
/// tornano insieme di proposito: chi schedula vuole il risultato *e* deve poter
/// loggare gli avvisi, chi valida vuole i problemi *e* niente altro, e tenerli
/// in due funzioni separate significherebbe leggere l'espressione due volte con
/// due implementazioni che possono divergere — il difetto da cui nasce questo
/// modulo.
pub fn analizza(expr: &str) -> (Option<Cron>, Vec<Problema>) {
    let mut problemi = Vec::new();
    let parti: Vec<&str> = expr.split_whitespace().collect();

    if parti.is_empty() {
        problemi.push(Problema::errore(
            "espressione",
            "l'espressione cron è vuota".into(),
            "servono cinque campi: `minuto ora giorno mese giorno-settimana`",
        ));
        return (None, problemi);
    }

    // Un campo che manca vale `*`, come ha sempre fatto questo runtime. È un
    // **avviso** e non un errore, deliberatamente: trattarlo come errore
    // fermerebbe uno script che oggi gira — troppo spesso, ma gira — e togliere
    // di mezzo in silenzio qualcosa che funzionava è peggio del difetto che
    // stiamo correggendo. Chi scrive `30 4` intende «alle 4:30», e ottiene
    // «alle 4:30 di ogni giorno di ogni mese», che è la stessa cosa solo per
    // caso; ma lo scopre da un avviso, non da uno script che tace.
    if parti.len() != 5 {
        problemi.push(Problema::avviso(
            "espressione",
            format!("l'espressione cron ha {} campi invece di cinque", parti.len()),
            "l'ordine è `minuto ora giorno mese giorno-settimana`; i campi che \
             mancano valgono `*`, quindi un'espressione corta parte molto più \
             spesso di quanto sembri",
        ));
    }
    if parti.len() > 5 {
        problemi.push(Problema::avviso(
            "espressione",
            format!("i campi dal sesto in poi vengono ignorati: {:?}", &parti[5..]),
            "un cron a sei campi (con i secondi) non è questo formato: qui il \
             primo campo è il minuto",
        ));
    }

    let mut insiemi: Vec<Vec<u8>> = Vec::with_capacity(5);
    for (i, (nome, min, max)) in CAMPI.iter().enumerate() {
        match parti.get(i) {
            Some(testo) => match campo(testo, *min, *max, nome) {
                Ok(v) => insiemi.push(v),
                Err(mut p) => {
                    problemi.append(&mut p);
                    insiemi.push(Vec::new());
                }
            },
            None => insiemi.push((*min..=*max).collect()),
        }
    }

    if problemi.iter().any(|p| p.gravita == Gravita::Errore) {
        return (None, problemi);
    }
    let mut it = insiemi.into_iter();
    let cron = Cron {
        minute: it.next().unwrap_or_default(),
        hour: it.next().unwrap_or_default(),
        day: it.next().unwrap_or_default(),
        month: it.next().unwrap_or_default(),
        weekday: it.next().unwrap_or_default(),
    };
    (Some(cron), problemi)
}

/// Un campo: `*`, `*/n`, `n`, `n-m`, `n-m/k`, oppure una lista di questi
/// separata da virgola.
fn campo(testo: &str, min: u8, max: u8, nome: &'static str) -> Result<Vec<u8>, Vec<Problema>> {
    let mut valori: Vec<u8> = Vec::new();
    let mut problemi: Vec<Problema> = Vec::new();

    for pezzo in testo.split(',') {
        let pezzo = pezzo.trim();
        if pezzo.is_empty() {
            problemi.push(Problema::errore(
                nome,
                format!("il campo «{nome}» vale `{testo}` e contiene un elemento vuoto"),
                "una virgola di troppo: gli elementi vanno separati senza lasciarne vuoti",
            ));
            continue;
        }
        match elemento(pezzo, min, max, nome, testo) {
            Ok(mut v) => valori.append(&mut v),
            Err(p) => problemi.push(p),
        }
    }

    if !problemi.is_empty() {
        return Err(problemi);
    }
    valori.sort_unstable();
    valori.dedup();
    if valori.is_empty() {
        // Non dovrebbe accadere — ogni ramo che non produce valori produce un
        // errore — ma un insieme vuoto è **il** difetto di Q34, quindi non
        // passa comunque in silenzio.
        return Err(vec![Problema::errore(
            nome,
            format!("del campo «{nome}» (`{testo}`) non resta nessun valore"),
            "un insieme vuoto non combacia con nessun istante: lo script non partirebbe mai",
        )]);
    }
    Ok(valori)
}

fn elemento(
    pezzo: &str,
    min: u8,
    max: u8,
    nome: &'static str,
    intero: &str,
) -> Result<Vec<u8>, Problema> {
    // Il passo, se c'è: `<base>/<k>`.
    let (base, passo) = match pezzo.split_once('/') {
        Some((b, k)) => {
            let k: u8 = k.trim().parse().map_err(|_| {
                Problema::errore(
                    nome,
                    format!("nel campo «{nome}» il passo di `{pezzo}` non è un numero"),
                    "il passo va dopo la barra, come in `*/5` («ogni 5»)",
                )
            })?;
            if k == 0 {
                return Err(Problema::errore(
                    nome,
                    format!("nel campo «{nome}» il passo di `{pezzo}` è zero"),
                    "un passo di zero non produce nessun istante; il più piccolo utile è 1",
                ));
            }
            (b.trim(), k)
        }
        None => (pezzo, 1),
    };

    // La base: `*` oppure `n` oppure `n-m`.
    let (da, a) = if base == "*" {
        (min, max)
    } else if let Some((x, y)) = base.split_once('-') {
        let x = numero(x, nome, pezzo)?;
        let y = numero(y, nome, pezzo)?;
        if x > y {
            return Err(Problema::errore(
                nome,
                format!("nel campo «{nome}» l'intervallo `{base}` va all'indietro"),
                "il primo valore deve essere minore o uguale al secondo; per \
                 «da sabato a domenica» elenca i due valori separati da virgola",
            ));
        }
        (x, y)
    } else {
        let n = numero(base, nome, pezzo)?;
        // Un valore secco con un passo (`5/10`) non ha un significato condiviso
        // fra le implementazioni di cron: qui vale «da 5 al massimo, ogni 10»,
        // che è ciò che fanno Vixie cron e systemd. Lo diciamo nel manuale
        // invece di inventarci un errore.
        if passo > 1 { (n, max) } else { (n, n) }
    };

    if da < min || a > max {
        return Err(Problema::errore(
            nome,
            format!("il campo «{nome}» contiene `{pezzo}`, fuori dall'intervallo {min}-{max}"),
            format!(
                "i valori ammessi per «{nome}» vanno da {min} a {max}{}",
                if nome == "giorno-settimana" {
                    " (la domenica è 0, e per comodità anche 7)"
                } else {
                    ""
                }
            ),
        ));
    }

    let _ = intero;
    Ok((da..=a).step_by(passo as usize).collect())
}

fn numero(s: &str, nome: &'static str, pezzo: &str) -> Result<u8, Problema> {
    let s = s.trim();
    // La domenica scritta `7`: lo standard POSIX la ammette insieme a `0`, e
    // `0 0 * * 7` è una forma che si trova scritta in mezzo mondo. Prima
    // finiva fuori intervallo e veniva **scartata in silenzio**, cioè lo script
    // non partiva mai: è lo stesso difetto di `*/5` con un'altra faccia.
    if nome == "giorno-settimana" && s == "7" {
        return Ok(0);
    }
    s.parse::<u8>().map_err(|_| {
        Problema::errore(
            nome,
            format!("nel campo «{nome}» `{pezzo}` non è un numero"),
            "un campo ammette `*`, un intero, un intervallo `n-m`, un passo \
             `*/n` o `n-m/k`, e liste di questi separate da virgola",
        )
    })
}

impl Cron {
    /// L'istante `unix_s` (UTC) combacia con l'espressione?
    fn combacia(&self, unix_s: u64) -> bool {
        const GIORNO: u64 = 86_400;
        const ORA: u64 = 3_600;
        const MINUTO: u64 = 60;

        let minuto = ((unix_s % ORA) / MINUTO) as u8;
        let ora = ((unix_s % GIORNO) / ORA) as u8;
        let giorni = unix_s / GIORNO;
        // 1970-01-01 era un giovedì, che con la domenica a 0 è il 4.
        let settimana = ((giorni + 4) % 7) as u8;
        let (_, mese, giorno) = giorno_del_calendario(giorni);

        self.minute.contains(&minuto)
            && self.hour.contains(&ora)
            && self.day.contains(&(giorno as u8))
            && self.month.contains(&(mese as u8))
            && self.weekday.contains(&settimana)
    }

    /// Quanti secondi mancano al prossimo istante utile, cercando minuto per
    /// minuto nelle prossime 24 ore. `None` se in 24 ore non ce n'è nessuno —
    /// che è legittimo (`0 0 29 2 *` esiste), e chi chiama decide cosa farne.
    pub fn secondi_al_prossimo(&self, adesso: u64) -> Option<u64> {
        for offset in 1u64..=1440 {
            let candidato = ((adesso + offset * 60) / 60) * 60;
            if self.combacia(candidato) {
                return Some(candidato.saturating_sub(adesso).max(1));
            }
        }
        None
    }
}

/// Da giorni-dall'epoca a (anno, mese, giorno). Algoritmo del calendario civile
/// di Howard Hinnant, dominio pubblico.
fn giorno_del_calendario(z: u64) -> (i32, u32, u32) {
    let z = z as i64 + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m as u32, d as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(expr: &str) -> Cron {
        let (c, p) = analizza(expr);
        let errori: Vec<_> = p.iter().filter(|p| p.gravita == Gravita::Errore).collect();
        assert!(errori.is_empty(), "`{expr}` doveva andare: {errori:#?}");
        c.expect("nessun errore ma nessun cron")
    }

    fn errori(expr: &str) -> Vec<Problema> {
        let (c, p) = analizza(expr);
        let e: Vec<_> = p.into_iter().filter(|p| p.gravita == Gravita::Errore).collect();
        assert!(!e.is_empty(), "`{expr}` doveva dare errore, e invece no");
        assert!(c.is_none(), "`{expr}` ha dato errore ma anche un cron usabile");
        e
    }

    /// **Il test di Q34.** `*/5 * * * *` è la prima cosa che chiunque scrive per
    /// «ogni cinque minuti»: prima diventava un insieme vuoto e lo script non
    /// partiva mai, in silenzio.
    #[test]
    fn ogni_cinque_minuti() {
        let c = ok("*/5 * * * *");
        assert_eq!(c.minute, vec![0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
        assert_eq!(c.hour.len(), 24);
    }

    #[test]
    fn intervalli_e_passi_dentro_intervallo() {
        assert_eq!(ok("0 9-17 * * *").hour, (9..=17).collect::<Vec<u8>>());
        assert_eq!(ok("0 9-17/4 * * *").hour, vec![9, 13, 17]);
        assert_eq!(ok("0,30 * * * *").minute, vec![0, 30]);
        // Liste che mescolano le forme, e valori ripetuti che non si duplicano.
        assert_eq!(ok("0,0,*/30 * * * *").minute, vec![0, 30]);
    }

    #[test]
    fn la_forma_che_funzionava_prima_funziona_ancora() {
        assert_eq!(ok("30 4 * * *").minute, vec![30]);
        assert_eq!(ok("* * * * *").minute.len(), 60);
        assert_eq!(
            ok("0,5,10,15,20,25,30,35,40,45,50,55 * * * *").minute,
            vec![0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]
        );
    }

    /// La domenica scritta `7`: prima finiva fuori intervallo, veniva scartata
    /// in silenzio e lo script non partiva mai.
    #[test]
    fn la_domenica_si_puo_scrivere_sette() {
        assert_eq!(ok("0 0 * * 7").weekday, vec![0]);
        assert_eq!(ok("0 0 * * 0").weekday, vec![0]);
    }

    #[test]
    fn cio_che_non_si_capisce_e_un_errore_non_un_insieme_vuoto() {
        for expr in [
            "pippo * * * *",
            "*/0 * * * *",   // passo zero
            "*/x * * * *",   // passo non numerico
            "17-5 * * * *",  // intervallo all'indietro
            "70 * * * *",    // fuori intervallo
            "0 * * * 9",     // giorno-settimana fuori intervallo
            "0,,30 * * * *", // elemento vuoto
            "",
        ] {
            let e = errori(expr);
            assert!(
                !e[0].messaggio.is_empty() && !e[0].suggerimento.is_empty(),
                "`{expr}`: un errore senza spiegazione non serve a nessuno"
            );
        }
    }

    /// I campi mancanti restano un **avviso** e non un errore: fermare uno
    /// script che oggi gira sarebbe peggio del difetto.
    #[test]
    fn i_campi_mancanti_avvisano_e_non_fermano() {
        let (c, p) = analizza("30 4");
        assert!(c.is_some(), "un cron corto deve restare usabile");
        assert!(p.iter().all(|p| p.gravita == Gravita::Avviso));
        assert!(p.iter().any(|p| p.messaggio.contains("invece di cinque")));
        let c = c.unwrap();
        assert_eq!(c.minute, vec![30]);
        assert_eq!(c.hour, vec![4]);
        assert_eq!(c.day.len(), 31, "i campi mancanti valgono `*`, come prima");
    }

    #[test]
    fn i_campi_di_troppo_avvisano() {
        let (c, p) = analizza("0 0 * * * *");
        assert!(c.is_some());
        assert!(p.iter().any(|p| p.messaggio.contains("sesto in poi")));
    }

    /// `secondi_al_prossimo` su un istante noto: 2026-01-01 00:00:00 UTC è un
    /// giovedì (weekday 4).
    #[test]
    fn quanto_manca_al_prossimo() {
        let capodanno_2026 = 1_767_225_600u64;
        // Ogni 5 minuti: dal minuto 0 il prossimo è a 5 minuti.
        assert_eq!(ok("*/5 * * * *").secondi_al_prossimo(capodanno_2026), Some(300));
        // Ogni minuto: 60 secondi.
        assert_eq!(ok("* * * * *").secondi_al_prossimo(capodanno_2026), Some(60));
        // Alle 4:30: 4 ore e mezza.
        assert_eq!(
            ok("30 4 * * *").secondi_al_prossimo(capodanno_2026),
            Some(4 * 3600 + 30 * 60)
        );
        // Il 29 febbraio non cade nelle prossime 24 ore: `None`, non un'attesa
        // inventata.
        assert_eq!(ok("0 0 29 2 *").secondi_al_prossimo(capodanno_2026), None);
    }
}
