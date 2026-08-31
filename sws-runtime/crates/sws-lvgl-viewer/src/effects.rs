//! Effetti che non dipendono dal *valore* di un tag ma da **come sta** il tag:
//! lampeggia, è fermo da troppo tempo, la sua qualità è cattiva, c'è un allarme
//! sopra.
//!
//! Non è estetica. Un allarme che nel browser lampeggia, sul pannello era
//! fermo; e un dato aggiornato un secondo fa non si distingueva da uno fermo da
//! mezz'ora. Su uno SCADA quella è la differenza fra «il valore è quello» e «il
//! valore *era* quello» — cioè fra un impianto che si guarda e uno di cui ci si
//! fida a torto.
//!
//! Qui sta solo la logica pura, senza LVGL: si prova con `cargo test` su
//! qualunque macchina, e le chiamate C stanno in `lvgl_render.rs`. La semantica
//! è quella del web (`SvgCanvas.tsx`, blocco «F4»), non una seconda inventata
//! qui: dove il web sceglie un valore — mezzo periodo acceso, 0.15 da spento,
//! 0.55 da attenuato — questo modulo usa lo stesso.

use crate::client::{AlarmStateLite, TagSnapshot, TagSnapshotValue};
use sws_core::tag::{TagQuality, TagValue};
use crate::model::SynopticObject;
use std::collections::HashMap;

/// Opacità della fase "spenta" del lampeggio: `opacity: 0.15` nei keyframes
/// `sws-obj-blink` del web. Non zero — un oggetto che sparisce del tutto
/// sembra un difetto di disegno, non un allarme.
pub const OPA_LAMPEGGIO_SPENTO: u8 = 38; // 0.15 × 255

/// Opacità di un oggetto attenuato perché il dato è vecchio o di qualità
/// cattiva: `opacity: 0.55` sul web.
pub const OPA_ATTENUATO: u8 = 140; // 0.55 × 255

/// Quanto "scolora" il filtro grigio: `filter: grayscale(0.9)` sul web.
pub const FILTRO_GRIGIO_OPA: u8 = 230; // 0.9 × 255

/// Periodo di lampeggio quando l'oggetto non lo dichiara — `?? 800` sul web.
pub const BLINK_MS_DEFAULT: u32 = 800;

/// Perché un oggetto lampeggia.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Lampeggio {
    Mai,
    Sempre,
    /// Finché il tag indicato è "vero".
    SeTag(String),
    /// Finché sul tag principale dell'oggetto c'è un allarme non riconosciuto.
    SeAllarme,
}

/// Legge `blink_mode`/`blink_tag`. Un `blink_mode: tag` senza `blink_tag` vale
/// `Mai`: dichiarare la modalità e non il tag è un progetto incompleto, e far
/// lampeggiare l'oggetto "per sempre" sarebbe la lettura peggiore delle due.
pub fn lampeggio_di(obj: &SynopticObject) -> Lampeggio {
    match obj.blink_mode.as_deref() {
        Some("always") => Lampeggio::Sempre,
        Some("alarm") => Lampeggio::SeAllarme,
        Some("tag") => match obj.blink_tag.as_deref().filter(|t| !t.is_empty()) {
            Some(t) => Lampeggio::SeTag(t.to_string()),
            None => Lampeggio::Mai,
        },
        _ => Lampeggio::Mai,
    }
}

/// L'allarme che conta per un tag, se ce n'è uno attivo.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AllarmeSuTag {
    pub severita: String,
    pub riconosciuto: bool,
}

/// Fra più allarmi attivi sullo stesso tag vince quello **non** riconosciuto:
/// è la regola di `alarmByTag` in `SvgCanvas.tsx`, e ha senso perché un
/// allarme già visto non deve zittire quello che nessuno ha ancora guardato.
pub fn allarme_su_tag(alarms: &HashMap<String, AlarmStateLite>, tag: &str) -> Option<AllarmeSuTag> {
    let mut scelto: Option<AllarmeSuTag> = None;
    for a in alarms.values() {
        if !a.active || a.def.tag.is_empty() || a.def.tag != tag {
            continue;
        }
        let candidato = AllarmeSuTag {
            severita: a.def.severity.clone(),
            riconosciuto: a.acknowledged,
        };
        match &scelto {
            None => scelto = Some(candidato),
            Some(p) if p.riconosciuto && !candidato.riconosciuto => scelto = Some(candidato),
            _ => {}
        }
    }
    scelto
}

/// Un valore tag è "vero"? Stessa scala del web: bool com'è, numero diverso da
/// zero, stringa non vuota di soli spazi.
fn verita(v: &TagValue) -> bool {
    match v {
        TagValue::Bool(b) => *b,
        TagValue::Int(i) => *i != 0,
        TagValue::Float(f) => *f != 0.0,
        TagValue::Str(s) => !s.trim().is_empty(),
    }
}

/// In questo istante l'oggetto deve lampeggiare?
pub fn deve_lampeggiare(
    l: &Lampeggio,
    tag_principale: Option<&str>,
    tags: &TagSnapshot,
    alarms: &HashMap<String, AlarmStateLite>,
) -> bool {
    match l {
        Lampeggio::Mai => false,
        Lampeggio::Sempre => true,
        Lampeggio::SeTag(t) => tags.get(t).map(|tv| verita(&tv.value)).unwrap_or(false),
        Lampeggio::SeAllarme => tag_principale
            .and_then(|t| allarme_su_tag(alarms, t))
            .map(|a| !a.riconosciuto)
            .unwrap_or(false),
    }
}

/// Fase dell'onda quadra: `true` = metà "piena".
///
/// Il web usa `step-start` con un solo keyframe al 50%, cioè un'onda quadra
/// netta — non una dissolvenza. Riprodurla con l'aritmetica invece che con
/// `lv_anim` costa niente e ha un vantaggio: tutti gli oggetti che lampeggiano
/// allo stesso ritmo restano **in fase**, perché guardano lo stesso orologio
/// invece di ognuno il proprio istante di creazione. Un gruppo di allarmi che
/// pulsa insieme si legge; uno che pulsa a caso sembra un guasto del pannello.
pub fn fase_accesa(now_ms: u64, rate_ms: u32) -> bool {
    let periodo = rate_ms.max(2) as u64; // sotto i 2 ms la metà sarebbe 0
    (now_ms % periodo) < periodo / 2
}

/// Il dato è fermo da più di `stale_after_s`?
///
/// `ts == 0` significa "non lo so" (server che non manda il timestamp, o valore
/// mai arrivato) e vale **non stantio**: dichiarare vecchio un dato di cui non
/// si conosce l'età sarebbe un allarme inventato, e su un pannello di impianto
/// gli allarmi inventati costano quanto quelli mancati.
pub fn stantio(stale_after_s: Option<f64>, ts: u64, now_ms: u64) -> bool {
    let Some(s) = stale_after_s else { return false };
    if !(s > 0.0) || ts == 0 {
        return false;
    }
    now_ms.saturating_sub(ts) > (s * 1000.0) as u64
}

/// L'oggetto va attenuato? Vero se il dato è vecchio, oppure se la sua qualità
/// è cattiva e l'oggetto ha chiesto `bad_value_style: gray`.
///
/// Prende i pezzi e non l'oggetto synottico perché il chiamante che conta —
/// `update_effects`, a ogni frame — non ha più l'oggetto sottomano, solo quello
/// che ne ha conservato. Passargli i pezzi è l'unico modo perché esista **una**
/// implementazione invece di due che possono divergere.
pub fn attenuato(
    stale_after_s: Option<f64>,
    bad_gray: bool,
    tv: Option<&TagSnapshotValue>,
    now_ms: u64,
) -> bool {
    let Some(tv) = tv else { return false };
    stantio(stale_after_s, tv.ts, now_ms) || (bad_gray && matches!(tv.quality, TagQuality::Bad))
}

/// Colore del pallino di qualità. Stessi valori di `qualityColor` sul web, e
/// stesso ordine di precedenza: il colore dichiarato dall'oggetto vince.
pub fn colore_qualita(
    q: &TagQuality,
    buono: Option<&str>,
    cattivo: Option<&str>,
    incerto: Option<&str>,
) -> (u8, u8, u8) {
    let scelto = match q {
        TagQuality::Good => buono.unwrap_or("#22c55e"),
        TagQuality::Bad => cattivo.unwrap_or("#ef4444"),
        _ => incerto.unwrap_or("#eab308"),
    };
    crate::lvgl_render::parse_hex_color(scelto).unwrap_or((148, 163, 184))
}

/// Colore del bordo d'allarme per severità — le stesse tre tinte di
/// `SEV_COLOR` in `sws-editor/src/alarmSeverity.ts`.
pub fn colore_severita(sev: &str) -> (u8, u8, u8) {
    match sev {
        "Critical" => (239, 68, 68),
        "Info" => (59, 130, 246),
        _ => (234, 179, 8), // Warning, e qualunque cosa non riconosciuta
    }
}

/// L'opacità finale di un oggetto, messe insieme le tre ragioni che la
/// abbassano.
///
/// L'ordine conta e non è arbitrario: `opacity` dichiarata è il punto di
/// partenza, l'attenuazione da dato vecchio la **sostituisce** (come sul web,
/// dove `st.opacity = 0.55` scrive sopra), e il lampeggio spento vince su
/// tutto. Un oggetto già semitrasparente che lampeggia deve restare leggibile
/// nella fase piena, non diventare due volte invisibile.
pub fn opa_finale(base: u8, attenuato: bool, lampeggio_spento: bool) -> u8 {
    if lampeggio_spento {
        return OPA_LAMPEGGIO_SPENTO;
    }
    if attenuato {
        return OPA_ATTENUATO;
    }
    base
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::{AlarmDefLite, TagSnapshotValue};

    fn tag_bool(v: bool) -> TagSnapshotValue {
        TagSnapshotValue { value: TagValue::Bool(v), quality: TagQuality::Good, ts: 1_000 }
    }

    fn allarme(id: &str, tag: &str, sev: &str, attivo: bool, ack: bool) -> AlarmStateLite {
        AlarmStateLite {
            def: AlarmDefLite {
                id: id.to_string(),
                message: String::new(),
                severity: sev.to_string(),
                tag: tag.to_string(),
            },
            active: attivo,
            acknowledged: ack,
            activated_at_ms: None,
        }
    }

    fn mappa(v: Vec<AlarmStateLite>) -> HashMap<String, AlarmStateLite> {
        v.into_iter().map(|a| (a.def.id.clone(), a)).collect()
    }

    // ── lampeggio ─────────────────────────────────────────────────────────

    #[test]
    fn un_blink_mode_tag_senza_tag_non_lampeggia_per_sempre() {
        let obj = SynopticObject {
            blink_mode: Some("tag".into()),
            blink_tag: None,
            ..Default::default()
        };
        assert_eq!(lampeggio_di(&obj), Lampeggio::Mai,
                   "un progetto incompleto non deve diventare un allarme permanente");
    }

    #[test]
    fn lampeggia_finche_il_tag_e_vero() {
        let l = Lampeggio::SeTag("p".into());
        let mut t = TagSnapshot::new();
        let vuoto = HashMap::new();
        assert!(!deve_lampeggiare(&l, None, &t, &vuoto), "tag assente: fermo");
        t.insert("p".into(), tag_bool(true));
        assert!(deve_lampeggiare(&l, None, &t, &vuoto));
        t.insert("p".into(), tag_bool(false));
        assert!(!deve_lampeggiare(&l, None, &t, &vuoto));
    }

    #[test]
    fn lallarme_riconosciuto_smette_di_lampeggiare() {
        let l = Lampeggio::SeAllarme;
        let t = TagSnapshot::new();
        let vivo = mappa(vec![allarme("a1", "pompa.stato", "Critical", true, false)]);
        assert!(deve_lampeggiare(&l, Some("pompa.stato"), &t, &vivo));
        let visto = mappa(vec![allarme("a1", "pompa.stato", "Critical", true, true)]);
        assert!(!deve_lampeggiare(&l, Some("pompa.stato"), &t, &visto));
        let spento = mappa(vec![allarme("a1", "pompa.stato", "Critical", false, false)]);
        assert!(!deve_lampeggiare(&l, Some("pompa.stato"), &t, &spento));
    }

    /// Fra due allarmi sullo stesso tag vince quello non riconosciuto: uno già
    /// visto non deve zittire quello che nessuno ha ancora guardato.
    #[test]
    fn fra_due_allarmi_sullo_stesso_tag_vince_quello_non_riconosciuto() {
        for ordine in [vec![("a1", true), ("a2", false)], vec![("a1", false), ("a2", true)]] {
            let m = mappa(ordine.iter()
                .map(|(id, ack)| allarme(id, "t", "Warning", true, *ack))
                .collect());
            let a = allarme_su_tag(&m, "t").expect("uno c'è");
            assert!(!a.riconosciuto, "ordine {ordine:?}");
        }
    }

    #[test]
    fn un_allarme_su_un_altro_tag_non_conta() {
        let m = mappa(vec![allarme("a1", "altro", "Critical", true, false)]);
        assert_eq!(allarme_su_tag(&m, "mio"), None);
    }

    // ── fase ──────────────────────────────────────────────────────────────

    #[test]
    fn londa_quadra_sta_accesa_meta_periodo() {
        assert!(fase_accesa(0, 800));
        assert!(fase_accesa(399, 800));
        assert!(!fase_accesa(400, 800));
        assert!(!fase_accesa(799, 800));
        assert!(fase_accesa(800, 800), "il periodo dopo riparte acceso");
    }

    /// Due oggetti guardano lo stesso orologio, quindi lampeggiano insieme:
    /// un gruppo di allarmi che pulsa a caso sembra un guasto del pannello.
    #[test]
    fn oggetti_diversi_allo_stesso_ritmo_restano_in_fase() {
        for t in [0u64, 137, 400, 999, 12_345] {
            assert_eq!(fase_accesa(t, 800), fase_accesa(t, 800));
        }
    }

    #[test]
    fn un_periodo_assurdo_non_divide_per_zero() {
        let _ = fase_accesa(12_345, 0);
        let _ = fase_accesa(12_345, 1);
    }

    // ── dato vecchio ──────────────────────────────────────────────────────

    #[test]
    fn il_dato_diventa_vecchio_dopo_il_tempo_dichiarato() {
        assert!(!stantio(Some(10.0), 100_000, 105_000), "5 s su 10: fresco");
        assert!(stantio(Some(10.0), 100_000, 111_000), "11 s su 10: vecchio");
        assert!(!stantio(None, 100_000, 999_999), "non dichiarato: mai vecchio");
        assert!(!stantio(Some(0.0), 100_000, 999_999), "zero = disattivato");
    }

    /// Un timestamp che non conosciamo non autorizza a dire "vecchio": sarebbe
    /// un allarme inventato, e costa quanto uno mancato.
    #[test]
    fn un_timestamp_sconosciuto_non_e_un_dato_vecchio() {
        assert!(!stantio(Some(1.0), 0, 9_999_999));
    }

    #[test]
    fn un_orologio_che_va_indietro_non_esplode() {
        assert!(!stantio(Some(1.0), 500_000, 100), "now < ts: saturating, non panico");
    }

    // ── attenuazione ──────────────────────────────────────────────────────

    #[test]
    fn la_qualita_cattiva_attenua_solo_se_richiesto() {
        let cattivo = TagSnapshotValue {
            value: TagValue::Float(1.0), quality: TagQuality::Bad, ts: 1_000,
        };
        assert!(!attenuato(None, false, Some(&cattivo), 1_100),
                "opt-in: senza bad_value_style non si tocca");
        assert!(attenuato(None, true, Some(&cattivo), 1_100));
    }

    #[test]
    fn senza_tag_non_ce_niente_da_attenuare() {
        assert!(!attenuato(Some(1.0), true, None, 9_999_999));
    }

    /// Le due ragioni sono indipendenti: un dato vecchio attenua anche se la
    /// qualità è ottima, ed è il caso che conta davvero — una sorgente che ha
    /// smesso di rispondere continua a mandare l'ultimo valore buono.
    #[test]
    fn un_dato_vecchio_attenua_anche_con_qualita_buona() {
        let buono_ma_fermo = TagSnapshotValue {
            value: TagValue::Float(1.0), quality: TagQuality::Good, ts: 1_000,
        };
        assert!(attenuato(Some(5.0), false, Some(&buono_ma_fermo), 20_000));
    }

    // ── opacità risultante ────────────────────────────────────────────────

    #[test]
    fn il_lampeggio_spento_vince_su_tutto() {
        assert_eq!(opa_finale(255, false, true), OPA_LAMPEGGIO_SPENTO);
        assert_eq!(opa_finale(255, true, true), OPA_LAMPEGGIO_SPENTO);
        assert_eq!(opa_finale(100, true, true), OPA_LAMPEGGIO_SPENTO);
    }

    #[test]
    fn lattenuazione_sostituisce_lopacita_dichiarata() {
        assert_eq!(opa_finale(255, true, false), OPA_ATTENUATO);
        assert_eq!(opa_finale(200, true, false), OPA_ATTENUATO,
                   "come sul web, dove 0.55 scrive sopra invece di moltiplicare");
    }

    /// Nella fase piena un oggetto semitrasparente che lampeggia resta come
    /// l'ha voluto il progettista: il lampeggio toglie luce solo da spento.
    #[test]
    fn nella_fase_piena_lopacita_dichiarata_sopravvive() {
        assert_eq!(opa_finale(120, false, false), 120);
    }

    // ── colori ────────────────────────────────────────────────────────────

    #[test]
    fn i_colori_di_qualita_sono_quelli_del_web() {
        assert_eq!(colore_qualita(&TagQuality::Good, None, None, None), (0x22, 0xc5, 0x5e));
        assert_eq!(colore_qualita(&TagQuality::Bad, None, None, None), (0xef, 0x44, 0x44));
        assert_eq!(colore_qualita(&TagQuality::Good, Some("#000000"), None, None), (0, 0, 0),
                   "il colore dichiarato dall'oggetto vince");
    }

    #[test]
    fn un_colore_illeggibile_non_fa_sparire_il_pallino() {
        assert_eq!(colore_qualita(&TagQuality::Good, Some("verde acqua"), None, None),
                   (148, 163, 184), "ripiega su un grigio, non su niente");
    }

    #[test]
    fn le_severita_hanno_i_colori_del_web() {
        assert_eq!(colore_severita("Critical"), (0xef, 0x44, 0x44));
        assert_eq!(colore_severita("Warning"), (0xea, 0xb3, 0x08));
        assert_eq!(colore_severita("Info"), (0x3b, 0x82, 0xf6));
        assert_eq!(colore_severita("boh"), (0xea, 0xb3, 0x08), "l'ignoto vale Warning");
    }
}
