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
        Self {
            gravita: Gravita::Errore,
            campo,
            messaggio,
            suggerimento: suggerimento.into(),
        }
    }
    fn avviso(campo: &'static str, messaggio: String, suggerimento: impl Into<String>) -> Self {
        Self {
            gravita: Gravita::Avviso,
            campo,
            messaggio,
            suggerimento: suggerimento.into(),
        }
    }
}

use chrono::{
    DateTime, Datelike, Duration, LocalResult, NaiveDate, NaiveDateTime, TimeZone, Timelike, Utc,
};

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
            format!(
                "l'espressione cron ha {} campi invece di cinque",
                parti.len()
            ),
            "l'ordine è `minuto ora giorno mese giorno-settimana`; i campi che \
             mancano valgono `*`, quindi un'espressione corta parte molto più \
             spesso di quanto sembri",
        ));
    }
    if parti.len() > 5 {
        problemi.push(Problema::avviso(
            "espressione",
            format!(
                "i campi dal sesto in poi vengono ignorati: {:?}",
                &parti[5..]
            ),
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
        if passo > 1 {
            (n, max)
        } else {
            (n, n)
        }
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

/// Quanto avanti si cerca la prossima esecuzione. Ventotto anni: il 29 febbraio
/// che cade di lunedì (`0 0 29 2 1`) torna ogni 28 anni, e un giorno costa tre
/// confronti, quindi cercare lontano non costa niente.
const ORIZZONTE_GIORNI: i64 = 366 * 28;

// # L'ora è quella del pannello (10-11-2026)
//
// Fino alla 2.26.0-rc.11 il cron girava in **UTC**, e nell'IDE niente lo diceva: chi
// scriveva `0 7 * * *` pensando alle 7 di casa accendeva l'uscita alle 8
// d'inverno e alle 9 d'estate. Ora l'espressione si legge sul quadrante del
// fuso del pannello (`chrono::Local`, che legge `/etc/localtime`: nel container
// lo riempie `Timezone=local` del quadlet), lo stesso dei report programmati e
// della finestra dell'aggiornamento.
impl Cron {
    /// L'ora **sul quadrante** combacia con l'espressione?
    fn combacia_quadrante(&self, t: &NaiveDateTime) -> bool {
        self.minute.contains(&(t.minute() as u8))
            && self.hour.contains(&(t.hour() as u8))
            && self.giorno_ammesso(t.date())
    }

    fn giorno_ammesso(&self, d: NaiveDate) -> bool {
        self.day.contains(&(d.day() as u8))
            && self.month.contains(&(d.month() as u8))
            && self
                .weekday
                .contains(&(d.weekday().num_days_from_sunday() as u8))
    }

    /// Un cron con tutte le ventiquattro ore (`*/5 * * * *`, `0 * * * *`) conta il
    /// tempo vero, non l'ora sul quadrante: nell'ora ripetuta di ottobre gira
    /// anche la seconda volta, altrimenti «ogni cinque minuti» resterebbe fermo
    /// un'ora intera. Un cron con un'ora scelta (`30 2 * * *`) è un appuntamento,
    /// e un appuntamento si tiene una volta sola. È la regola di Vixie cron.
    fn conta_il_tempo_vero(&self) -> bool {
        self.hour.len() == 24
    }

    /// Gli istanti in cui lo script parte nel giorno `d` del fuso `tz`, in ordine.
    ///
    /// Il cambio d'ora, deciso dal maintainer il 10-11-2026:
    /// - un'ora che **non esiste** (le 2:30 dell'ultima domenica di marzo) si
    ///   **salta**: quel giorno lo script non parte, né prima né dopo;
    /// - un'ora **ripetuta** (le 2:30 dell'ultima domenica di ottobre) parte
    ///   **una volta sola**, la prima — salvo i cron a tutte le ore, vedi
    ///   [`Cron::conta_il_tempo_vero`].
    fn istanti_del_giorno<Tz: TimeZone>(&self, tz: &Tz, d: NaiveDate) -> Vec<DateTime<Utc>> {
        let mut v = Vec::new();
        if !self.giorno_ammesso(d) {
            return v;
        }
        for &h in &self.hour {
            for &m in &self.minute {
                let Some(quadrante) = d.and_hms_opt(h as u32, m as u32, 0) else {
                    continue;
                };
                match tz.from_local_datetime(&quadrante) {
                    LocalResult::Single(t) => v.push(t.with_timezone(&Utc)),
                    LocalResult::Ambiguous(prima, seconda) => {
                        v.push(prima.with_timezone(&Utc));
                        if self.conta_il_tempo_vero() {
                            v.push(seconda.with_timezone(&Utc));
                        }
                    }
                    LocalResult::None => {}
                }
            }
        }
        v.sort_unstable();
        v
    }

    /// Le prossime `n` esecuzioni dopo `adesso` (escluso), lette nel fuso di
    /// `adesso`. Meno di `n` se in ventotto anni non ce ne sono abbastanza
    /// (`0 0 30 2 *` non ne ha nessuna).
    pub fn prossimi<Tz: TimeZone>(&self, adesso: &DateTime<Tz>, n: usize) -> Vec<DateTime<Utc>> {
        let tz = adesso.timezone();
        let da = adesso.with_timezone(&Utc);
        // Dal giorno prima: un istante di un giorno di calendario può cadere,
        // col cambio d'ora, a cavallo della mezzanotte di quello dopo.
        let mut giorno = adesso.date_naive() - Duration::days(1);
        let mut out = Vec::with_capacity(n);
        for _ in 0..ORIZZONTE_GIORNI {
            for t in self.istanti_del_giorno(&tz, giorno) {
                if t > da {
                    out.push(t);
                    if out.len() == n {
                        return out;
                    }
                }
            }
            giorno += Duration::days(1);
        }
        out
    }

    /// La prossima esecuzione dopo `adesso`.
    pub fn prossimo<Tz: TimeZone>(&self, adesso: &DateTime<Tz>) -> Option<DateTime<Utc>> {
        self.prossimi(adesso, 1).into_iter().next()
    }

    /// Il minuto `istante` è un'esecuzione? Per chi controlla minuto per minuto
    /// (i report): stesse regole di [`Cron::prossimi`], ora saltata e ora
    /// ripetuta comprese.
    pub fn scatta<Tz: TimeZone>(&self, istante: &DateTime<Tz>) -> bool {
        let quadrante = istante.naive_local();
        if istante.second() != 0 || !self.combacia_quadrante(&quadrante) {
            return false;
        }
        match istante.timezone().from_local_datetime(&quadrante) {
            LocalResult::Ambiguous(prima, _) => {
                self.conta_il_tempo_vero()
                    || prima.with_timezone(&Utc) == istante.with_timezone(&Utc)
            }
            _ => true,
        }
    }
}

// ── L'anteprima per l'IDE ───────────────────────────────────────────────────

/// Quante esecuzioni mostra l'IDE accanto al campo del trigger.
pub const ANTEPRIMA: usize = 3;

/// Il corpo di `GET /api/cron/prossime`: il fuso in cui il cron si legge e le
/// prossime esecuzioni, calcolate da chi le farà partire.
#[derive(Debug, Clone, serde::Serialize)]
pub struct Anteprima {
    /// Il nome del fuso (`Europe/Rome`), se la macchina lo dice; vedi
    /// [`crate::aggiornamento_finestra::nome_fuso`].
    pub fuso: Option<String>,
    /// Lo scostamento da UTC adesso, `+01:00`: c'è anche quando il nome no.
    pub scostamento: String,
    pub prossime: Vec<Esecuzione>,
    /// Gli avvisi del parser (un campo che manca vale `*`, …).
    pub avvisi: Vec<String>,
    /// Questa macchina è quella che fa partire gli script (un pannello), o è
    /// un IDE che li calcola nel fuso suo? L'IDE lo dice accanto alle ore.
    pub pannello: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct Esecuzione {
    /// Sul quadrante del fuso, `2026-11-11 07:00`.
    pub locale: String,
    pub utc: String,
    /// Lo scostamento di **quell'**istante: a cavallo del cambio d'ora non è
    /// quello di adesso.
    pub scostamento: String,
}

fn spiega(p: &Problema) -> String {
    format!("{}: {} — {}", p.campo, p.messaggio, p.suggerimento)
}

/// Le prossime [`ANTEPRIMA`] esecuzioni di `expr` dopo `adesso`, o il perché no.
pub fn anteprima<Tz: TimeZone>(
    expr: &str,
    adesso: &DateTime<Tz>,
    fuso: Option<String>,
) -> Result<Anteprima, String>
where
    Tz::Offset: std::fmt::Display,
{
    let (cron, problemi) = analizza(expr);
    let Some(cron) = cron else {
        let errori: Vec<String> = problemi
            .iter()
            .filter(|p| p.gravita == Gravita::Errore)
            .map(spiega)
            .collect();
        return Err(errori.join("; "));
    };
    let tz = adesso.timezone();
    Ok(Anteprima {
        fuso,
        scostamento: adesso.format("%:z").to_string(),
        prossime: cron
            .prossimi(adesso, ANTEPRIMA)
            .into_iter()
            .map(|u| {
                let l = u.with_timezone(&tz);
                Esecuzione {
                    locale: l.format("%Y-%m-%d %H:%M").to_string(),
                    utc: u.format("%Y-%m-%d %H:%M").to_string(),
                    scostamento: l.format("%:z").to_string(),
                }
            })
            .collect(),
        avvisi: problemi
            .iter()
            .filter(|p| p.gravita == Gravita::Avviso)
            .map(spiega)
            .collect(),
        pannello: false,
    })
}

#[derive(Debug, serde::Deserialize)]
pub struct Domanda {
    #[serde(default)]
    pub espressione: String,
}

/// `GET /api/cron/prossime?espressione=0+7+*+*+*` — le prossime esecuzioni nel
/// fuso di **questa** macchina. Sul pannello è il fuso del pannello; l'IDE
/// collegato a un dispositivo chiede `/api/remote/cron/prossime`, che gira la
/// domanda al dispositivo. Un'espressione che non si capisce è un 400 col
/// perché, in italiano, come lo direbbe il validatore.
pub async fn prossime_handler(
    axum::extract::State(s): axum::extract::State<crate::router::AppState>,
    axum::extract::Query(q): axum::extract::Query<Domanda>,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    match anteprima(
        &q.espressione,
        &chrono::Local::now(),
        crate::aggiornamento_finestra::nome_fuso(),
    ) {
        Ok(mut a) => {
            a.pannello = crate::report::ruolo_impianto(&s);
            axum::Json(a).into_response()
        }
        Err(e) => (axum::http::StatusCode::BAD_REQUEST, e).into_response(),
    }
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
        let e: Vec<_> = p
            .into_iter()
            .filter(|p| p.gravita == Gravita::Errore)
            .collect();
        assert!(!e.is_empty(), "`{expr}` doveva dare errore, e invece no");
        assert!(
            c.is_none(),
            "`{expr}` ha dato errore ma anche un cron usabile"
        );
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

    /// L'ora di Roma con le regole europee del cambio d'ora: +01:00, e +02:00
    /// dall'ultima domenica di marzo all'ultima di ottobre, sempre alle 01:00
    /// UTC. Scritta qui perché i test non dipendano dal fuso della macchina che
    /// li esegue, e senza tirare dentro un database dei fusi per un fuso solo.
    #[derive(Debug, Clone, Copy)]
    struct Roma;

    fn ultima_domenica(anno: i32, mese: u32) -> NaiveDate {
        let mut d = NaiveDate::from_ymd_opt(anno, mese, 31).unwrap();
        while d.weekday() != chrono::Weekday::Sun {
            d = d.pred_opt().unwrap();
        }
        d
    }

    impl Roma {
        fn scarto_utc(utc: &NaiveDateTime) -> chrono::FixedOffset {
            let anno = utc.date().year();
            let inizio = ultima_domenica(anno, 3).and_hms_opt(1, 0, 0).unwrap();
            let fine = ultima_domenica(anno, 10).and_hms_opt(1, 0, 0).unwrap();
            let ore = if *utc >= inizio && *utc < fine { 2 } else { 1 };
            chrono::FixedOffset::east_opt(ore * 3600).unwrap()
        }
    }

    impl TimeZone for Roma {
        type Offset = chrono::FixedOffset;
        fn from_offset(_: &chrono::FixedOffset) -> Self {
            Roma
        }
        fn offset_from_local_date(&self, d: &NaiveDate) -> LocalResult<chrono::FixedOffset> {
            self.offset_from_local_datetime(&d.and_hms_opt(12, 0, 0).unwrap())
        }
        fn offset_from_local_datetime(
            &self,
            l: &NaiveDateTime,
        ) -> LocalResult<chrono::FixedOffset> {
            // Le due letture possibili, inverno e estate: valgono quelle che,
            // riportate a UTC, danno davvero quello scarto.
            let valide: Vec<chrono::FixedOffset> = [1, 2]
                .into_iter()
                .map(|h| chrono::FixedOffset::east_opt(h * 3600).unwrap())
                .filter(|o| {
                    Self::scarto_utc(&(*l - Duration::seconds(o.local_minus_utc() as i64))) == *o
                })
                .collect();
            match valide.as_slice() {
                [] => LocalResult::None,
                [o] => LocalResult::Single(*o),
                // La prima delle due è quella d'estate (+02:00, prima del ritorno).
                [inverno, estate] => LocalResult::Ambiguous(*estate, *inverno),
                _ => unreachable!(),
            }
        }
        fn offset_from_utc_date(&self, d: &NaiveDate) -> chrono::FixedOffset {
            Self::scarto_utc(&d.and_hms_opt(12, 0, 0).unwrap())
        }
        fn offset_from_utc_datetime(&self, u: &NaiveDateTime) -> chrono::FixedOffset {
            Self::scarto_utc(u)
        }
    }

    /// Un istante scritto in ora di Roma, `2026-11-10 12:00`.
    fn a_roma(s: &str) -> DateTime<Roma> {
        let n = NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M").unwrap();
        Roma.from_local_datetime(&n).earliest().unwrap()
    }

    fn utc(v: &[DateTime<Utc>]) -> Vec<String> {
        v.iter()
            .map(|t| t.format("%Y-%m-%d %H:%M").to_string())
            .collect()
    }

    /// Prima di tutto la regola di prova deve dire la verità.
    #[test]
    fn la_roma_dei_test_cambia_ora_quando_deve() {
        assert_eq!(a_roma("2026-01-15 12:00").offset().local_minus_utc(), 3600);
        assert_eq!(a_roma("2026-07-15 12:00").offset().local_minus_utc(), 7200);
        // 29-03-2026 e 25-10-2026 sono le ultime domeniche.
        assert!(Roma
            .from_local_datetime(
                &NaiveDate::from_ymd_opt(2026, 3, 29)
                    .unwrap()
                    .and_hms_opt(2, 30, 0)
                    .unwrap()
            )
            .single()
            .is_none());
        assert!(matches!(
            Roma.from_local_datetime(
                &NaiveDate::from_ymd_opt(2026, 10, 25)
                    .unwrap()
                    .and_hms_opt(2, 30, 0)
                    .unwrap()
            ),
            LocalResult::Ambiguous(_, _)
        ));
    }

    /// **Il difetto del seme.** `0 7 * * *` sono le 7 di casa tutto l'anno: le
    /// 06:00 UTC d'inverno, le 05:00 UTC d'estate.
    #[test]
    fn le_sette_di_casa_d_inverno_e_d_estate() {
        let c = ok("0 7 * * *");
        assert_eq!(
            utc(&c.prossimi(&a_roma("2026-11-10 12:00"), 3)),
            ["2026-11-11 06:00", "2026-11-12 06:00", "2026-11-13 06:00"]
        );
        assert_eq!(
            utc(&c.prossimi(&a_roma("2026-07-10 12:00"), 2)),
            ["2026-07-11 05:00", "2026-07-12 05:00"]
        );
        // A cavallo del cambio d'ora: sabato 24-10 è ancora estate, lunedì 26 no.
        assert_eq!(
            utc(&c.prossimi(&a_roma("2026-10-24 08:00"), 2)),
            ["2026-10-25 06:00", "2026-10-26 06:00"]
        );
        // E l'istante cade in quello in cui il cron lo legge.
        assert!(c.scatta(&a_roma("2026-11-11 07:00")));
        assert!(!c.scatta(&a_roma("2026-11-11 08:00")));
    }

    #[test]
    fn la_prossima_e_dopo_adesso_non_adesso() {
        let c = ok("*/5 * * * *");
        assert_eq!(
            utc(&c.prossimi(&a_roma("2026-01-01 00:00"), 2)),
            ["2025-12-31 23:05", "2025-12-31 23:10"]
        );
        // Il 29 febbraio di lunedì torna nel 2044: l'orizzonte ci arriva.
        let bisestile = ok("0 0 29 2 1").prossimo(&a_roma("2026-01-01 00:00"));
        assert_eq!(bisestile.unwrap().format("%Y").to_string(), "2044");
        // Il 30 febbraio non esiste: nessuna esecuzione, non un'attesa inventata.
        assert!(ok("0 0 30 2 *")
            .prossimi(&a_roma("2026-01-01 00:00"), 3)
            .is_empty());
    }

    /// Un'ora che il cambio d'ora salta **si salta**: le 2:30 del 29-03-2026 non
    /// esistono, e quel giorno lo script non parte.
    #[test]
    fn l_ora_che_non_esiste_si_salta() {
        let c = ok("30 2 * * *");
        assert_eq!(
            utc(&c.prossimi(&a_roma("2026-03-28 12:00"), 2)),
            // 30-03 alle 02:30 d'estate = 00:30 UTC; il 29 manca.
            ["2026-03-30 00:30", "2026-03-31 00:30"]
        );
        // «Ogni cinque minuti» non perde niente: il tempo vero non ha buchi.
        let ogni5 = ok("*/5 * * * *").prossimi(&a_roma("2026-03-29 01:50"), 3);
        assert_eq!(
            utc(&ogni5),
            ["2026-03-29 00:55", "2026-03-29 01:00", "2026-03-29 01:05"]
        );
    }

    /// Un'ora ripetuta parte **una volta sola**: le 2:30 del 25-10-2026 tornano
    /// due volte sul quadrante, lo script parte alla prima.
    #[test]
    fn l_ora_ripetuta_parte_una_volta() {
        let c = ok("30 2 * * *");
        assert_eq!(
            utc(&c.prossimi(&a_roma("2026-10-24 12:00"), 3)),
            // 25-10 02:30 estate = 00:30 UTC; la seconda (01:30 UTC) no.
            ["2026-10-25 00:30", "2026-10-26 01:30", "2026-10-27 01:30"]
        );
        // Lo stesso per chi controlla minuto per minuto (i report).
        let prima = Utc
            .with_ymd_and_hms(2026, 10, 25, 0, 30, 0)
            .unwrap()
            .with_timezone(&Roma);
        let seconda = Utc
            .with_ymd_and_hms(2026, 10, 25, 1, 30, 0)
            .unwrap()
            .with_timezone(&Roma);
        assert_eq!(
            prima.naive_local(),
            seconda.naive_local(),
            "stessa ora sul quadrante"
        );
        assert!(c.scatta(&prima));
        assert!(!c.scatta(&seconda));
        // Un cron a tutte le ore conta il tempo vero: gira anche nella seconda.
        let ogni_ora = ok("30 * * * *");
        assert!(ogni_ora.scatta(&prima) && ogni_ora.scatta(&seconda));
        assert_eq!(
            utc(&ogni_ora.prossimi(&a_roma("2026-10-25 01:00"), 3)),
            ["2026-10-24 23:30", "2026-10-25 00:30", "2026-10-25 01:30"]
        );
    }

    /// Quello che l'IDE mostra: fuso, e le tre prossime nell'ora del pannello,
    /// ognuna col suo scostamento (a cavallo del cambio d'ora cambia).
    #[test]
    fn l_anteprima_per_l_ide() {
        let a = anteprima(
            "0 7 * * *",
            &a_roma("2026-10-24 12:00"),
            Some("Europe/Rome".into()),
        )
        .unwrap();
        assert_eq!(a.fuso.as_deref(), Some("Europe/Rome"));
        assert_eq!(a.scostamento, "+02:00");
        let locali: Vec<_> = a.prossime.iter().map(|e| e.locale.as_str()).collect();
        assert_eq!(
            locali,
            ["2026-10-25 07:00", "2026-10-26 07:00", "2026-10-27 07:00"]
        );
        assert_eq!(a.prossime[0].utc, "2026-10-25 06:00");
        assert_eq!(a.prossime[1].scostamento, "+01:00");
        assert!(a.avvisi.is_empty());
        // Un'espressione corta passa, con l'avviso.
        let corta = anteprima("30 4", &a_roma("2026-10-24 12:00"), None).unwrap();
        assert_eq!(corta.avvisi.len(), 1);
    }

    /// Un'espressione che non si capisce: un errore che si legge, col campo e il
    /// rimedio, non un elenco vuoto.
    #[test]
    fn l_anteprima_di_un_espressione_non_valida() {
        let e = anteprima("70 7 * * *", &a_roma("2026-10-24 12:00"), None).unwrap_err();
        assert!(e.starts_with("minuto: "), "{e}");
        assert!(e.contains("fuori dall'intervallo 0-59"), "{e}");
        assert!(e.contains("vanno da 0 a 59"), "{e}");
        assert!(anteprima("", &a_roma("2026-10-24 12:00"), None).is_err());
    }
}
