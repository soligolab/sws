//! Dai campioni dello storico alle tabelle del report (P3, 26-10-2026) — puro.
//!
//! Tre tabelle: il **riepilogo** (per tag min, max, media e numero di campioni
//! nel periodo), l'**andamento** (la media di ogni tag per intervallo) e gli
//! **allarmi** del periodo. Gli scrittori PDF ed Excel le impaginano senza
//! sapere da dove vengono.

use std::collections::HashMap;
use sws_core::{AlarmEvent, TagValue};
use sws_historian::Sample;

/// Una cella: un numero resta un numero (in Excel si somma), un testo un testo.
#[derive(Debug, Clone, PartialEq)]
pub enum Cella {
    Testo(String),
    Numero(f64, u8),
    Vuota,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Tabella {
    pub titolo: String,
    pub colonne: Vec<String>,
    pub righe: Vec<Vec<Cella>>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DatiReport {
    pub titolo: String,
    pub progetto: String,
    /// «dal … al …», già nell'ora locale del pannello.
    pub periodo: String,
    pub generato: String,
    pub tabelle: Vec<Tabella>,
    /// `,` in italiano, `.` in inglese: il PDF scrive i numeri come testo.
    pub virgola: bool,
    pub parole_pagina: &'static str,
}

/// Quello che il report sa di un tag, dal progetto.
#[derive(Debug, Clone, Default)]
pub struct InfoTag {
    pub descrizione: String,
    pub unita: String,
    pub decimali: u8,
}

/// Le parole del report, nella lingua dei contenuti del progetto.
pub struct Parole {
    pub riepilogo: &'static str,
    pub andamento: &'static str,
    pub allarmi: &'static str,
    pub tag: &'static str,
    pub descrizione: &'static str,
    pub unita: &'static str,
    pub min: &'static str,
    pub max: &'static str,
    pub media: &'static str,
    pub campioni: &'static str,
    pub inizio: &'static str,
    pub allarme: &'static str,
    pub messaggio: &'static str,
    pub gravita: &'static str,
    pub attivato: &'static str,
    pub rientrato: &'static str,
    pub riconosciuto: &'static str,
    pub nessuno: &'static str,
    pub dal: &'static str,
    pub al: &'static str,
    pub generato: &'static str,
    pub progetto: &'static str,
    pub pagina: &'static str,
}

pub fn parole(lingua: &str) -> Parole {
    if lingua.starts_with("en") {
        Parole {
            riepilogo: "Summary", andamento: "Trend", allarmi: "Alarms", tag: "Tag", descrizione: "Description",
            unita: "Unit", min: "Min", max: "Max", media: "Average", campioni: "Samples", inizio: "From",
            allarme: "Alarm", messaggio: "Message", gravita: "Severity", attivato: "Activated", rientrato: "Cleared",
            riconosciuto: "Acknowledged by", nessuno: "None in the period", dal: "from", al: "to",
            generato: "Generated", progetto: "Project", pagina: "Page",
        }
    } else {
        Parole {
            riepilogo: "Riepilogo", andamento: "Andamento", allarmi: "Allarmi", tag: "Tag", descrizione: "Descrizione",
            unita: "Unità", min: "Min", max: "Max", media: "Media", campioni: "Campioni", inizio: "Dalle",
            allarme: "Allarme", messaggio: "Messaggio", gravita: "Gravità", attivato: "Attivato", rientrato: "Rientrato",
            riconosciuto: "Riconosciuto da", nessuno: "Nessuno nel periodo", dal: "dal", al: "al",
            generato: "Generato", progetto: "Progetto", pagina: "Pagina",
        }
    }
}

fn numero(v: &TagValue) -> Option<f64> {
    match v {
        TagValue::Float(f) => Some(*f),
        TagValue::Int(i) => Some(*i as f64),
        TagValue::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
        _ => None,
    }
}

/// Min, max, media e conteggio dei campioni numerici in `[da, a)`.
fn statistiche<'a>(campioni: impl Iterator<Item = &'a Sample>) -> Option<(f64, f64, f64, u64)> {
    let mut acc: Option<(f64, f64, f64, u64)> = None;
    for v in campioni.filter_map(|s| numero(&s.value)) {
        acc = Some(match acc {
            None => (v, v, v, 1),
            Some((mi, ma, me, n)) => (mi.min(v), ma.max(v), me + (v - me) / (n as f64 + 1.0), n + 1),
        });
    }
    acc
}

/// Le tabelle del report. `ora` scrive un istante nell'ora locale del pannello
/// (iniettata, così il test non dipende dal fuso della macchina).
#[allow(clippy::too_many_arguments)]
pub fn componi(
    titolo: &str,
    progetto: &str,
    tags: &[String],
    info: &HashMap<String, InfoTag>,
    campioni: &HashMap<String, Vec<Sample>>,
    allarmi: Option<&[AlarmEvent]>,
    da_ms: u64,
    a_ms: u64,
    passo_ms: u64,
    generato_ms: u64,
    lingua: &str,
    ora: &dyn Fn(u64) -> String,
) -> DatiReport {
    let p = parole(lingua);
    let vuoti: Vec<Sample> = Vec::new();
    let nel_periodo = |t: &str| campioni.get(t).unwrap_or(&vuoti).iter().filter(move |s| s.ts_ms >= da_ms && s.ts_ms < a_ms);

    // Il riepilogo: una riga per tag.
    let mut riepilogo = Tabella {
        titolo: p.riepilogo.into(),
        colonne: [p.tag, p.descrizione, p.unita, p.min, p.max, p.media, p.campioni].map(String::from).to_vec(),
        righe: Vec::new(),
    };
    for t in tags {
        let i = info.get(t).cloned().unwrap_or_default();
        let mut riga = vec![Cella::Testo(t.clone()), Cella::Testo(i.descrizione.clone()), Cella::Testo(i.unita.clone())];
        match statistiche(nel_periodo(t)) {
            Some((mi, ma, me, n)) => riga.extend([
                Cella::Numero(mi, i.decimali),
                Cella::Numero(ma, i.decimali),
                Cella::Numero(me, i.decimali),
                Cella::Numero(n as f64, 0),
            ]),
            None => riga.extend([Cella::Vuota, Cella::Vuota, Cella::Vuota, Cella::Numero(0.0, 0)]),
        }
        riepilogo.righe.push(riga);
    }

    // L'andamento: una riga per intervallo, allineato all'inizio della finestra
    // (non all'epoca: un report «ora per ora» parte dall'ora del turno).
    let mut andamento = Tabella {
        titolo: p.andamento.into(),
        colonne: std::iter::once(p.inizio.to_string()).chain(tags.iter().cloned()).collect(),
        righe: Vec::new(),
    };
    let passo = passo_ms.max(60_000);
    let mut inizio = da_ms;
    while inizio < a_ms {
        let fine = (inizio + passo).min(a_ms);
        let mut riga = vec![Cella::Testo(ora(inizio))];
        for t in tags {
            let dec = info.get(t).map(|i| i.decimali).unwrap_or(2);
            let s = campioni.get(t).unwrap_or(&vuoti).iter().filter(|s| s.ts_ms >= inizio && s.ts_ms < fine);
            riga.push(match statistiche(s) {
                Some((_, _, me, _)) => Cella::Numero(me, dec),
                None => Cella::Vuota,
            });
        }
        andamento.righe.push(riga);
        inizio = fine;
    }

    let mut tabelle = vec![riepilogo, andamento];
    if let Some(eventi) = allarmi {
        let mut t = Tabella {
            titolo: p.allarmi.into(),
            colonne: [p.attivato, p.allarme, p.messaggio, p.gravita, p.rientrato, p.riconosciuto].map(String::from).to_vec(),
            righe: Vec::new(),
        };
        let mut ordinati: Vec<&AlarmEvent> = eventi.iter().filter(|e| e.ts_activated_ms >= da_ms && e.ts_activated_ms < a_ms).collect();
        ordinati.sort_by_key(|e| e.ts_activated_ms);
        for e in ordinati {
            t.righe.push(vec![
                Cella::Testo(ora(e.ts_activated_ms)),
                Cella::Testo(e.alarm_id.clone()),
                Cella::Testo(e.alarm_message.clone()),
                Cella::Testo(format!("{:?}", e.severity).to_lowercase()),
                e.ts_normalized_ms.map(|x| Cella::Testo(ora(x))).unwrap_or(Cella::Vuota),
                e.acked_by.clone().map(Cella::Testo).unwrap_or(Cella::Vuota),
            ]);
        }
        if t.righe.is_empty() {
            t.righe.push(vec![Cella::Testo(p.nessuno.into())]);
        }
        tabelle.push(t);
    }

    DatiReport {
        titolo: titolo.into(),
        progetto: progetto.into(),
        periodo: format!("{} {} {} {}", p.dal, ora(da_ms), p.al, ora(a_ms)),
        generato: ora(generato_ms),
        tabelle,
        virgola: !lingua.starts_with("en"),
        parole_pagina: p.pagina,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sws_core::{AlarmSeverity, TagQuality};

    fn s(ts: u64, v: f64) -> Sample {
        Sample { ts_ms: ts, value: TagValue::Float(v), quality: TagQuality::Good }
    }

    /// Un turno di due ore a passo di un'ora: riepilogo sull'intero periodo,
    /// andamento per ora allineato all'inizio, un campione fuori finestra che
    /// non conta, un tag senza dati che resta vuoto e non inventa zeri.
    #[test]
    fn il_report_di_un_turno() {
        let h = 3_600_000;
        let da = 10 * h;
        let campioni: HashMap<String, Vec<Sample>> = [(
            "temp".to_string(),
            vec![s(da - 1, 999.0), s(da, 20.0), s(da + h / 2, 22.0), s(da + h, 30.0), s(da + 2 * h, 999.0)],
        )]
        .into();
        let info: HashMap<String, InfoTag> =
            [("temp".to_string(), InfoTag { descrizione: "Caldaia".into(), unita: "°C".into(), decimali: 1 })].into();
        let eventi = vec![AlarmEvent {
            alarm_id: "alta".into(),
            alarm_message: "Temperatura alta".into(),
            severity: AlarmSeverity::Critical,
            ts_activated_ms: da + h + 5,
            ts_acked_ms: None,
            ts_normalized_ms: None,
            duration_s: None,
            acked_by: None,
            interrotto: false,
        }];
        let ora = |ms: u64| format!("h{}", ms / h);
        let r = componi("Turno", "Casa", &["temp".into(), "vuoto".into()], &info, &campioni, Some(&eventi), da, da + 2 * h, h, da + 2 * h, "it", &ora);
        assert_eq!(r.periodo, "dal h10 al h12");
        let riep = &r.tabelle[0];
        assert_eq!(riep.righe[0][3..], [Cella::Numero(20.0, 1), Cella::Numero(30.0, 1), Cella::Numero(24.0, 1), Cella::Numero(3.0, 0)]);
        assert_eq!(riep.righe[1][3], Cella::Vuota, "un tag senza dati non inventa uno zero");
        let and = &r.tabelle[1];
        assert_eq!(and.righe.len(), 2);
        assert_eq!(and.righe[0][..2], [Cella::Testo("h10".into()), Cella::Numero(21.0, 1)]);
        assert_eq!(and.righe[1][1], Cella::Numero(30.0, 1));
        assert_eq!(r.tabelle[2].righe[0][1], Cella::Testo("alta".into()));
    }
}
