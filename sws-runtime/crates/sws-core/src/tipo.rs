//! I tipi scalari delle variabili (D5 del piano tag, 22-09-2026).
//!
//! La variabile è del **runtime**, e il suo tipo dice tutto ciò che serve a
//! qualunque protocollo — larghezza, segno, testo, tempo — senza distinguere
//! per protocollo. Fino ad allora `data_type` conosceva quattro parole (`bool`,
//! `int`, `float`, `string`) e la larghezza la indovinava il plugin: un `word`
//! S7 diventava `int` e il fatto che fosse senza segno spariva; un `u16` Modbus
//! era un `float`. L'unica cosa che **non** è un tipo è l'ordine di byte e
//! parole con cui un dispositivo mette un `u32` sui registri: è un fatto del
//! dispositivo, e sta nella sorgente.
//!
//! **La fonte è `tests/fixtures/tipi-scalari.json`**: nomi, alias, valore
//! iniziale e casi di coercizione. La leggono il test di questo modulo, il
//! test TypeScript (`sws-editor/tests/tipiScalari.test.ts`) e la guardia
//! `scripts/check_tipi_scalari.sh`.
//!
//! I quattro nomi vecchi restano come **alias** (`int` = `i64`, `float` =
//! `f64`) e sopravvivono al round-trip: `TagDef.data_type` resta una `String`
//! nel YAML, interpretata qui — nessun progetto va migrato, nessun template
//! cambia. In memoria il valore resta `TagValue::Int`/`Float`/…: il tipo è più
//! fine del valore, ed è il tipo — non il valore — a guidare coercizione,
//! limiti e la codifica nei plugin.

use crate::tag::TagValue;

/// La famiglia del tipo: decide come si valida un valore JSON, come si
/// formatta, cosa può contenere lo storico.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Categoria {
    Bool,
    Intero,
    Reale,
    Testo,
    Tempo,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TipoScalare {
    Bool,
    I8,
    I16,
    I32,
    I64,
    U8,
    U16,
    U32,
    U64,
    F32,
    F64,
    /// `string` o `string(N)`: lunghezza massima in caratteri, facoltativa.
    Stringa {
        max_len: Option<u32>,
    },
    /// Millisecondi UTC dall'epoca, in un `TagValue::Int` (D7).
    DateTime,
}

/// I nomi canonici, nell'ordine della fixture. Gli alias non stanno qui.
pub const NOMI: &[&str] = &[
    "bool", "i8", "i16", "i32", "i64", "u8", "u16", "u32", "u64", "f32", "f64", "string",
    "datetime",
];

impl TipoScalare {
    /// Dal nome scritto nello YAML. Accetta gli alias storici (`int`, `float`)
    /// e `string(N)`; spazi ai bordi e maiuscole non contano. `None` = non è
    /// un tipo: lo dice il validatore, qui non si indovina.
    pub fn parse(nome: &str) -> Option<Self> {
        let n = nome.trim().to_ascii_lowercase();
        Some(match n.as_str() {
            "bool" => Self::Bool,
            "i8" => Self::I8,
            "i16" => Self::I16,
            "i32" => Self::I32,
            "i64" | "int" => Self::I64,
            "u8" => Self::U8,
            "u16" => Self::U16,
            "u32" => Self::U32,
            "u64" => Self::U64,
            "f32" => Self::F32,
            "f64" | "float" => Self::F64,
            "string" => Self::Stringa { max_len: None },
            "datetime" => Self::DateTime,
            _ => {
                let dentro = n.strip_prefix("string(")?.strip_suffix(')')?;
                let len: u32 = dentro.trim().parse().ok()?;
                if len == 0 {
                    return None;
                }
                Self::Stringa { max_len: Some(len) }
            }
        })
    }

    /// Il nome canonico (mai un alias): `int` scritto nello YAML si legge `i64`.
    pub fn nome(&self) -> String {
        match self {
            Self::Bool => "bool".into(),
            Self::I8 => "i8".into(),
            Self::I16 => "i16".into(),
            Self::I32 => "i32".into(),
            Self::I64 => "i64".into(),
            Self::U8 => "u8".into(),
            Self::U16 => "u16".into(),
            Self::U32 => "u32".into(),
            Self::U64 => "u64".into(),
            Self::F32 => "f32".into(),
            Self::F64 => "f64".into(),
            Self::Stringa { max_len: None } => "string".into(),
            Self::Stringa { max_len: Some(n) } => format!("string({n})"),
            Self::DateTime => "datetime".into(),
        }
    }

    pub fn categoria(&self) -> Categoria {
        match self {
            Self::Bool => Categoria::Bool,
            Self::I8
            | Self::I16
            | Self::I32
            | Self::I64
            | Self::U8
            | Self::U16
            | Self::U32
            | Self::U64 => Categoria::Intero,
            Self::F32 | Self::F64 => Categoria::Reale,
            Self::Stringa { .. } => Categoria::Testo,
            Self::DateTime => Categoria::Tempo,
        }
    }

    /// Larghezza in bit; `None` per il testo, che non ne ha una fissa.
    pub fn bit(&self) -> Option<u32> {
        Some(match self {
            Self::Bool => 1,
            Self::I8 | Self::U8 => 8,
            Self::I16 | Self::U16 => 16,
            Self::I32 | Self::U32 | Self::F32 => 32,
            Self::I64 | Self::U64 | Self::F64 | Self::DateTime => 64,
            Self::Stringa { .. } => return None,
        })
    }

    /// Quanti registri Modbus a 16 bit occupa (i plugin lo derivano da qui, non
    /// da un campo scritto a mano). Testo: lunghezza massima in byte / 2,
    /// arrotondata per eccesso; senza lunghezza, uno.
    pub fn registri(&self) -> u16 {
        match self {
            Self::Stringa { max_len: Some(n) } => n.div_ceil(2).max(1) as u16,
            Self::Stringa { max_len: None } => 1,
            t => t.bit().unwrap_or(16).div_ceil(16).max(1) as u16,
        }
    }

    /// L'intervallo degli interi, per la coercizione. `u64` vive in un `i64`.
    pub fn intervallo(&self) -> Option<(i64, i64)> {
        Some(match self {
            Self::I8 => (i8::MIN as i64, i8::MAX as i64),
            Self::I16 => (i16::MIN as i64, i16::MAX as i64),
            Self::I32 => (i32::MIN as i64, i32::MAX as i64),
            Self::I64 => (i64::MIN, i64::MAX),
            Self::U8 => (0, u8::MAX as i64),
            Self::U16 => (0, u16::MAX as i64),
            Self::U32 => (0, u32::MAX as i64),
            Self::U64 | Self::DateTime => (0, i64::MAX),
            _ => return None,
        })
    }

    /// Il valore con cui il tag nasce nel `TagDb`, prima di ogni lettura.
    pub fn valore_iniziale(&self) -> TagValue {
        match self.categoria() {
            Categoria::Bool => TagValue::Bool(false),
            Categoria::Intero | Categoria::Tempo => TagValue::Int(0),
            Categoria::Reale => TagValue::Float(0.0),
            Categoria::Testo => TagValue::Str(String::new()),
        }
    }

    /// La coercizione di Q27, per tipo: converte ciò che non perde
    /// informazione (Int→reale; Float intero→intero **nell'intervallo**; le
    /// stringhe "true"/"false" e numeriche, che i vecchi progetti usano
    /// davvero) e rifiuta il resto. `Err` porta la descrizione del valore
    /// ricevuto; il chiamante ci antepone tag e tipo dichiarato — con il nome
    /// **scritto** nello YAML, così chi legge «dichiarato int» ritrova la
    /// sua parola.
    pub fn coerce(&self, v: TagValue) -> Result<TagValue, String> {
        use TagValue::*;
        let intero_nel_range = |i: i64| -> Result<TagValue, String> {
            let (lo, hi) = self.intervallo().unwrap_or((i64::MIN, i64::MAX));
            if i < lo || i > hi {
                Err(format!(
                    "{} fuori dall'intervallo {lo}..={hi}",
                    descrivi(&Int(i))
                ))
            } else {
                Ok(Int(i))
            }
        };
        match (self.categoria(), v) {
            (Categoria::Bool, Bool(b)) => Ok(Bool(b)),
            (Categoria::Bool, Str(s)) => match s.to_ascii_lowercase().as_str() {
                "true" => Ok(Bool(true)),
                "false" => Ok(Bool(false)),
                _ => Err(descrivi(&Str(s))),
            },
            (Categoria::Intero | Categoria::Tempo, Int(i)) => intero_nel_range(i),
            // `f as i64` satura invece di sbagliare, ma un fuori-range È una
            // perdita: si rifiuta invece di consegnare i64::MAX al PLC.
            (Categoria::Intero | Categoria::Tempo, Float(f))
                if f.is_finite()
                    && f.fract() == 0.0
                    && f >= i64::MIN as f64
                    && f <= i64::MAX as f64 =>
            {
                intero_nel_range(f as i64)
            }
            (Categoria::Intero, Str(s)) => match s.trim().parse::<i64>() {
                Ok(i) => intero_nel_range(i),
                Err(_) => Err(descrivi(&Str(s))),
            },
            (Categoria::Reale, Float(f)) if f.is_finite() => self.reale(f),
            (Categoria::Reale, Int(i)) => self.reale(i as f64),
            (Categoria::Reale, Str(s)) => match s.trim().parse::<f64>() {
                Ok(f) if f.is_finite() => self.reale(f),
                _ => Err(descrivi(&Str(s))),
            },
            (Categoria::Testo, Str(s)) => match self {
                Self::Stringa { max_len: Some(n) } if s.chars().count() > *n as usize => {
                    Err(format!("{} più lunga di {n} caratteri", descrivi(&Str(s))))
                }
                _ => Ok(Str(s)),
            },
            (_, v) => Err(descrivi(&v)),
        }
    }

    /// La conversione **in lettura** (03-10-2026, decisione del maintainer): un
    /// valore che arriva da un plugin si porta al tipo dichiarato del tag (o
    /// della foglia). Diversa da [`coerce`](Self::coerce), che vale per le
    /// scritture dell'utente e rifiuta ogni perdita: qui il valore viene dal
    /// campo, e un 29,8 su un `i32` è un 30, non un errore.
    ///
    /// - reale su intero → **arrotondato**;
    /// - fuori dall'intervallo del tipo → **saturato** al limite, e chi chiama
    ///   lo marca Uncertain ([`Lettura::Saturato`]); così anche un testo più
    ///   lungo del massimo, troncato;
    /// - testo numerico su un numero, numero o booleano su un testo → convertiti
    ///   (non perdono niente);
    /// - tutto il resto — un booleano su un numero, un testo non numerico, un
    ///   valore composito su uno scalare, NaN — **non entra**
    ///   ([`Lettura::Rifiutato`]): chi chiama lascia l'ultimo valore e marca Bad.
    pub fn converti_lettura(&self, v: TagValue) -> Lettura {
        use TagValue::*;
        let intero = |f: f64| -> Lettura {
            if !f.is_finite() {
                return Lettura::Rifiutato(descrivi(&Float(f)));
            }
            let (lo, hi) = self.intervallo().unwrap_or((i64::MIN, i64::MAX));
            let r = f.round();
            if r < lo as f64 {
                Lettura::Saturato(Int(lo))
            } else if r > hi as f64 {
                Lettura::Saturato(Int(hi))
            } else {
                Lettura::Ok(Int(r as i64))
            }
        };
        let intero_i = |i: i64| -> Lettura {
            let (lo, hi) = self.intervallo().unwrap_or((i64::MIN, i64::MAX));
            if i < lo {
                Lettura::Saturato(Int(lo))
            } else if i > hi {
                Lettura::Saturato(Int(hi))
            } else {
                Lettura::Ok(Int(i))
            }
        };
        let reale = |f: f64| -> Lettura {
            if !f.is_finite() {
                return Lettura::Rifiutato(descrivi(&Float(f)));
            }
            if matches!(self, Self::F32) && f.abs() > f32::MAX as f64 {
                return Lettura::Saturato(Float(f.signum() * f32::MAX as f64));
            }
            Lettura::Ok(Float(f))
        };
        match (self.categoria(), v) {
            (Categoria::Bool, Bool(b)) => Lettura::Ok(Bool(b)),
            (Categoria::Bool, Str(s)) => match s.trim().to_ascii_lowercase().as_str() {
                "true" | "1" => Lettura::Ok(Bool(true)),
                "false" | "0" => Lettura::Ok(Bool(false)),
                _ => Lettura::Rifiutato(descrivi(&Str(s))),
            },
            (Categoria::Intero | Categoria::Tempo, Int(i)) => intero_i(i),
            (Categoria::Intero | Categoria::Tempo, Float(f)) => intero(f),
            (Categoria::Intero | Categoria::Tempo, Str(s)) => match s.trim().parse::<i64>() {
                Ok(i) => intero_i(i),
                Err(_) => match s.trim().parse::<f64>() {
                    Ok(f) => intero(f),
                    Err(_) => Lettura::Rifiutato(descrivi(&Str(s))),
                },
            },
            (Categoria::Reale, Float(f)) => reale(f),
            (Categoria::Reale, Int(i)) => reale(i as f64),
            (Categoria::Reale, Str(s)) => match s.trim().parse::<f64>() {
                Ok(f) => reale(f),
                Err(_) => Lettura::Rifiutato(descrivi(&Str(s))),
            },
            (Categoria::Testo, v @ (Str(_) | Int(_) | Float(_) | Bool(_))) => {
                let s = match v {
                    Str(s) => s,
                    Int(i) => i.to_string(),
                    Float(f) => f.to_string(),
                    Bool(b) => b.to_string(),
                    _ => unreachable!(),
                };
                match self {
                    Self::Stringa { max_len: Some(n) } if s.chars().count() > *n as usize => {
                        Lettura::Saturato(Str(s.chars().take(*n as usize).collect()))
                    }
                    _ => Lettura::Ok(Str(s)),
                }
            }
            (_, v) => Lettura::Rifiutato(descrivi(&v)),
        }
    }

    fn reale(&self, f: f64) -> Result<TagValue, String> {
        if matches!(self, Self::F32) && !(f as f32).is_finite() {
            return Err(format!(
                "{} non sta in un f32",
                descrivi(&TagValue::Float(f))
            ));
        }
        Ok(TagValue::Float(f))
    }
}

/// L'esito di [`TipoScalare::converti_lettura`].
#[derive(Debug, Clone, PartialEq)]
pub enum Lettura {
    /// Convertito senza perdere niente (o arrotondato da reale a intero).
    Ok(TagValue),
    /// Portato al limite del tipo: va marcato Uncertain.
    Saturato(TagValue),
    /// Non convertibile: resta l'ultimo valore, marcato Bad. Porta il valore
    /// ricevuto in parole, per il log.
    Rifiutato(String),
}

/// Il valore ricevuto, in parole, per i messaggi d'errore.
pub fn descrivi(v: &TagValue) -> String {
    use TagValue::*;
    match v {
        Bool(b) => format!("bool ({b})"),
        Int(i) => format!("int ({i})"),
        Float(f) => format!("float ({f})"),
        Str(s) => format!("string («{s}»)"),
        Array(a) => format!("array ({} elementi)", a.len()),
        Struct(m) => format!("struttura ({} campi)", m.len()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(serde::Deserialize)]
    struct Tipo {
        nome: String,
        categoria: String,
        bit: Option<u32>,
        min: Option<String>,
        max: Option<String>,
        iniziale: serde_json::Value,
        #[serde(default)]
        alias: Vec<String>,
    }
    #[derive(serde::Deserialize)]
    struct Coercizione {
        tipo: String,
        ingresso: serde_json::Value,
        esito: serde_json::Value,
    }
    #[derive(serde::Deserialize)]
    struct Fixture {
        tipi: Vec<Tipo>,
        coercizioni: Vec<Coercizione>,
    }

    fn fixture() -> Fixture {
        let percorso = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../tests/fixtures/tipi-scalari.json"
        );
        serde_json::from_str(&std::fs::read_to_string(percorso).expect("fixture"))
            .expect("fixture valida")
    }

    /// Un numero JSON con la virgola è Float, senza è Int; gli altri sono ovvi.
    fn valore(v: &serde_json::Value) -> TagValue {
        match v {
            serde_json::Value::Bool(b) => TagValue::Bool(*b),
            serde_json::Value::Number(n) if n.is_i64() => TagValue::Int(n.as_i64().unwrap()),
            serde_json::Value::Number(n) => TagValue::Float(n.as_f64().unwrap()),
            serde_json::Value::String(s) => TagValue::Str(s.clone()),
            _ => panic!("valore non scalare nella fixture: {v}"),
        }
    }

    #[test]
    fn la_tabella_condivisa_col_web() {
        let f = fixture();
        let mut rotti = Vec::new();
        assert_eq!(
            f.tipi.len(),
            NOMI.len(),
            "NOMI e fixture devono avere lo stesso numero di tipi"
        );
        for t in &f.tipi {
            let Some(tipo) = TipoScalare::parse(&t.nome) else {
                rotti.push(format!("  {}: non si legge", t.nome));
                continue;
            };
            if tipo.nome() != t.nome {
                rotti.push(format!("  {}: il nome canonico è {}", t.nome, tipo.nome()));
            }
            if !NOMI.contains(&t.nome.as_str()) {
                rotti.push(format!("  {}: manca in NOMI", t.nome));
            }
            let cat = match tipo.categoria() {
                Categoria::Bool => "bool",
                Categoria::Intero => "intero",
                Categoria::Reale => "reale",
                Categoria::Testo => "testo",
                Categoria::Tempo => "tempo",
            };
            if cat != t.categoria {
                rotti.push(format!(
                    "  {}: categoria {cat}, fixture {}",
                    t.nome, t.categoria
                ));
            }
            if tipo.bit() != t.bit {
                rotti.push(format!(
                    "  {}: bit {:?}, fixture {:?}",
                    t.nome,
                    tipo.bit(),
                    t.bit
                ));
            }
            if let (Some(min), Some(max)) = (&t.min, &t.max) {
                let atteso = (min.parse::<i64>().unwrap(), max.parse::<i64>().unwrap());
                if tipo.intervallo() != Some(atteso) {
                    rotti.push(format!(
                        "  {}: intervallo {:?}, fixture {:?}",
                        t.nome,
                        tipo.intervallo(),
                        atteso
                    ));
                }
            }
            if tipo.valore_iniziale() != valore(&t.iniziale) {
                rotti.push(format!(
                    "  {}: iniziale {:?}, fixture {}",
                    t.nome,
                    tipo.valore_iniziale(),
                    t.iniziale
                ));
            }
            for a in &t.alias {
                if TipoScalare::parse(a) != Some(tipo.clone()) {
                    rotti.push(format!("  {}: l'alias {a} non porta qui", t.nome));
                }
            }
        }
        assert!(
            rotti.is_empty(),
            "{} divergenze dalla fixture:\n{}",
            rotti.len(),
            rotti.join("\n")
        );
    }

    #[test]
    fn le_coercizioni_della_fixture() {
        let f = fixture();
        let mut rotti = Vec::new();
        for c in &f.coercizioni {
            let tipo =
                TipoScalare::parse(&c.tipo).unwrap_or_else(|| panic!("tipo {} non valido", c.tipo));
            let esito = tipo.coerce(valore(&c.ingresso));
            match (&c.esito, esito) {
                (serde_json::Value::String(s), Err(_)) if s == "rifiuto" => {}
                (serde_json::Value::String(s), Ok(v)) if s == "rifiuto" => rotti.push(format!(
                    "  {} ← {}: accettato {v:?}, atteso rifiuto",
                    c.tipo, c.ingresso
                )),
                (atteso, Ok(v)) => {
                    if v != valore(atteso) {
                        rotti.push(format!(
                            "  {} ← {}: {v:?}, atteso {atteso}",
                            c.tipo, c.ingresso
                        ));
                    }
                }
                (atteso, Err(e)) => rotti.push(format!(
                    "  {} ← {}: rifiutato ({e}), atteso {atteso}",
                    c.tipo, c.ingresso
                )),
            }
        }
        assert!(
            rotti.is_empty(),
            "{} coercizioni divergenti:\n{}",
            rotti.len(),
            rotti.join("\n")
        );
    }

    #[test]
    fn nomi_sconosciuti_e_parametri_storti() {
        assert_eq!(TipoScalare::parse("real"), None);
        assert_eq!(TipoScalare::parse("string(0)"), None);
        assert_eq!(TipoScalare::parse("string(x)"), None);
        assert_eq!(TipoScalare::parse(" INT "), Some(TipoScalare::I64));
        assert_eq!(
            TipoScalare::parse("String(16)").unwrap().nome(),
            "string(16)"
        );
    }

    #[test]
    fn i_registri_modbus_si_derivano_dal_tipo() {
        assert_eq!(TipoScalare::U16.registri(), 1);
        assert_eq!(TipoScalare::Bool.registri(), 1);
        assert_eq!(TipoScalare::F32.registri(), 2);
        assert_eq!(TipoScalare::I64.registri(), 4);
        assert_eq!(TipoScalare::parse("string(7)").unwrap().registri(), 4);
    }

    #[test]
    fn la_conversione_in_lettura() {
        use crate::tipo::Lettura::*;
        use TagValue::*;
        let t = |n: &str| TipoScalare::parse(n).unwrap();
        assert_eq!(t("i32").converti_lettura(Float(29.8)), Ok(Int(30)));
        assert_eq!(t("i32").converti_lettura(Float(-2.5)), Ok(Int(-3)), "arrotondamento lontano dallo zero, come f64::round");
        assert_eq!(t("u8").converti_lettura(Int(300)), Saturato(Int(255)));
        assert_eq!(t("u16").converti_lettura(Float(-0.4)), Ok(Int(0)));
        assert_eq!(t("u16").converti_lettura(Float(-0.6)), Saturato(Int(0)));
        assert_eq!(t("i64").converti_lettura(Str(" 42 ".into())), Ok(Int(42)));
        assert_eq!(t("i64").converti_lettura(Str("4.6".into())), Ok(Int(5)));
        assert!(matches!(t("i64").converti_lettura(Str("abc".into())), Rifiutato(_)));
        assert!(matches!(t("i64").converti_lettura(Bool(true)), Rifiutato(_)));
        assert!(matches!(t("f64").converti_lettura(Bool(true)), Rifiutato(_)));
        assert!(matches!(t("f64").converti_lettura(Float(f64::NAN)), Rifiutato(_)));
        assert_eq!(t("f64").converti_lettura(Int(3)), Ok(Float(3.0)));
        assert_eq!(t("f32").converti_lettura(Float(1e300)), Saturato(Float(f32::MAX as f64)));
        assert_eq!(t("bool").converti_lettura(Str("1".into())), Ok(Bool(true)));
        assert!(matches!(t("bool").converti_lettura(Int(1)), Rifiutato(_)));
        assert_eq!(t("string").converti_lettura(Float(2.5)), Ok(Str("2.5".into())));
        assert_eq!(t("string(3)").converti_lettura(Str("abcdef".into())), Saturato(Str("abc".into())));
        assert!(matches!(t("f64").converti_lettura(Array(vec![])), Rifiutato(_)));
        assert_eq!(t("datetime").converti_lettura(Float(1.5)), Ok(Int(2)));
    }
}
