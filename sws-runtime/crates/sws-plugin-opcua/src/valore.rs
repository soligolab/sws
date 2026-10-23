//! Da `Variant` di OPC-UA a `TagValue` e ritorno — funzioni **pure**.
//!
//! Esiste perché queste conversioni si possano provare senza un server
//! davanti: `lib.rs` era 1 345 righe in un file solo, e le due conversioni
//! vivevano in mezzo alla sessione. Stesso taglio che ha già `sws-plugin-modbus`
//! (`codec.rs` puro, `lib.rs` la sessione, `tests.rs` le prove).
//!
//! # Due difetti che questo modulo chiude
//!
//! **Il valore inventato.** Un `Variant` che il motore non sapeva leggere —
//! un array, una struttura — diventava `Float(0.0)` con qualità Uncertain. Un
//! nodo array su un tag `f64` mostrava **0.0 come se fosse un dato letto**.
//! Ora la conversione torna `None`, e il chiamante marca la qualità lasciando
//! l'ultima lettura vera dov'è (`TagDb::marca_qualita`).
//!
//! **Il tipo scelto dal valore.** In scrittura, ogni intero diventava un
//! `Int64` e ogni reale un `Double`, qualunque cosa fosse il nodo: scrivere su
//! un nodo `UInt16` mandava un `Int64`, e molti server rispondono
//! `BadTypeMismatch`. Ora il `Variant` si sceglie dal **tipo dichiarato del
//! tag** quando c'è — quello che il progetto sa già, senza chiedere niente al
//! server — e si ripiega sul comportamento di prima quando non c'è.

use opcua::types::{DataValue, StatusCode, Variant};
use sws_core::{TagQuality, TagValue, TipoScalare};

/// Il valore e la qualità di un `DataValue`.
///
/// `None` nel valore vuol dire «non so leggerlo»: il chiamante **non deve
/// inventare un numero**, deve marcare la qualità e lasciare dov'è l'ultima
/// lettura vera.
pub fn da_data_value(dv: &DataValue) -> (Option<TagValue>, TagQuality) {
    let qualita = match dv.status {
        Some(s) if s == StatusCode::Good => TagQuality::Good,
        Some(_) => TagQuality::Bad,
        None => TagQuality::Uncertain,
    };
    match &dv.value {
        // Il valore non è arrivato: **Uncertain**. Non sappiamo ancora, e il
        // pannello lo ingrigisce.
        None => (None, TagQuality::Uncertain),
        Some(v) => match da_variant(v) {
            Some(tv) => (Some(tv), qualita),
            // Il dato c'è ma **non lo sappiamo leggere**: `Bad`, non
            // `Uncertain` (decisione del maintainer, 23-10-2026). È un difetto
            // nostro o una configurazione sbagliata, e va **visto** — sul
            // pannello la differenza è fra un bordo di allarme e un dato
            // ingrigito, cioè fra «guarda qui» e «aspetta».
            None => (None, TagQuality::Bad),
        },
    }
}

/// `Variant` → `TagValue`, ricorsiva sugli array.
pub fn da_variant(v: &Variant) -> Option<TagValue> {
    Some(match v {
        Variant::Boolean(b) => TagValue::Bool(*b),
        Variant::Byte(n) => TagValue::Int(*n as i64),
        Variant::SByte(n) => TagValue::Int(*n as i64),
        Variant::Int16(n) => TagValue::Int(*n as i64),
        Variant::UInt16(n) => TagValue::Int(*n as i64),
        Variant::Int32(n) => TagValue::Int(*n as i64),
        Variant::UInt32(n) => TagValue::Int(*n as i64),
        Variant::Int64(n) => TagValue::Int(*n),
        Variant::UInt64(n) => TagValue::Int(*n as i64),
        Variant::Float(f) => TagValue::Float(*f as f64),
        Variant::Double(d) => TagValue::Float(*d),
        Variant::String(s) => TagValue::Str(s.as_ref().to_string()),
        Variant::LocalizedText(t) => TagValue::Str(t.text.as_ref().to_string()),
        Variant::Array(a) => {
            let piatti: Option<Vec<TagValue>> = a.values.iter().map(da_variant).collect();
            annida(piatti?, a.dimensions.as_deref())?
        }
        // Le strutture (`ExtensionObject`) vogliono il `DataTypeTree` del
        // server e un type loader: è la parte della Fase 4 che non si può
        // fare senza un server che le esponga.
        _ => return None,
    })
}

/// Da array piatto ad array annidato, secondo le dimensioni dichiarate.
///
/// OPC-UA tiene un array a più dimensioni **piatto**, con le dimensioni di
/// rango più alto scritte per prime: `[2,2,2]` viaggia nell'ordine `[0,0,0]`,
/// `[0,0,1]`, `[0,1,0]`… `Forma::Array` invece è **annidata**, quindi qui si
/// ricostruisce l'annidamento. Senza, `matrice[1][2]` non si potrebbe leggere.
///
/// `None` se le dimensioni non tornano col numero di valori: meglio dire «non
/// so leggerlo» che consegnare una matrice storta.
fn annida(piatti: Vec<TagValue>, dimensioni: Option<&[u32]>) -> Option<TagValue> {
    let Some(dims) = dimensioni.filter(|d| d.len() > 1) else {
        return Some(TagValue::Array(piatti));
    };
    let attesi: usize = dims.iter().try_fold(1usize, |a, d| a.checked_mul(*d as usize))?;
    if attesi != piatti.len() {
        return None;
    }
    Some(annida_ricorsiva(piatti, dims))
}

fn annida_ricorsiva(piatti: Vec<TagValue>, dims: &[u32]) -> TagValue {
    if dims.len() <= 1 {
        return TagValue::Array(piatti);
    }
    let passo = piatti.len() / dims[0].max(1) as usize;
    let mut fuori = Vec::with_capacity(dims[0] as usize);
    let mut resto = piatti;
    for _ in 0..dims[0] {
        let coda = resto.split_off(passo.min(resto.len()));
        fuori.push(annida_ricorsiva(resto, &dims[1..]));
        resto = coda;
    }
    TagValue::Array(fuori)
}

/// `TagValue` → `Variant`, col tipo scelto dal **tipo dichiarato del tag**.
///
/// `tipo` è il nome scritto nello YAML (`u16`, `f32`, `int`, `float`…), come lo
/// tiene il `TagDb`. Quando c'è e si legge, il `Variant` esce di quel tipo;
/// quando manca — o è uno dei nomi storici, che non dicono quanto è largo il
/// numero — si ripiega sul comportamento di prima (`Int64`/`Double`), che è
/// quello che i progetti di oggi hanno sempre avuto.
///
/// `None` = non si può tradurre: array e strutture, che vogliono l'`index_range`
/// e il `DataType` del nodo (Fase 4, parte che non si fa qui).
pub fn variant_per_tipo(tipo: Option<&str>, v: &TagValue) -> Option<Variant> {
    let dichiarato = tipo.and_then(TipoScalare::parse);
    Some(match (v, dichiarato) {
        (TagValue::Bool(b), _) => Variant::Boolean(*b),
        (TagValue::Str(s), _) => Variant::String(s.as_str().into()),

        // I nomi storici (`int`, `float`) si leggono come `I64`/`F64`: sono il
        // default di un progetto che non ha mai scelto, e cambiare la larghezza
        // sul filo sotto i piedi di un progetto esistente non si fa.
        (TagValue::Int(n), Some(TipoScalare::I8)) => Variant::SByte(*n as i8),
        (TagValue::Int(n), Some(TipoScalare::U8)) => Variant::Byte(*n as u8),
        (TagValue::Int(n), Some(TipoScalare::I16)) => Variant::Int16(*n as i16),
        (TagValue::Int(n), Some(TipoScalare::U16)) => Variant::UInt16(*n as u16),
        (TagValue::Int(n), Some(TipoScalare::I32)) => Variant::Int32(*n as i32),
        (TagValue::Int(n), Some(TipoScalare::U32)) => Variant::UInt32(*n as u32),
        (TagValue::Int(n), Some(TipoScalare::U64)) => Variant::UInt64(*n as u64),
        (TagValue::Int(n), Some(TipoScalare::Bool)) => Variant::Boolean(*n != 0),
        (TagValue::Int(n), _) => Variant::Int64(*n),

        (TagValue::Float(f), Some(TipoScalare::F32)) => Variant::Float(*f as f32),
        (TagValue::Float(f), _) => Variant::Double(*f),

        // Un array si traduce elemento per elemento, col **tipo della radice**:
        // `Forma::Array` dichiara un tipo solo per tutti gli elementi, ed è
        // anche quello che OPC-UA pretende (`Array.value_type` è uno solo).
        //
        // Il server lo usa per **esporre** un tag composito: fino al 23-10-2026
        // qui si tornava `None` e l'updater saltava quei tag **in silenzio** —
        // un array nel progetto non compariva affatto nell'indirizzario, e
        // niente lo diceva.
        (TagValue::Array(v), t) => {
            if v.is_empty() {
                return None;
            }
            let dentro: Option<Vec<Variant>> = v.iter().map(|x| variant_per_tipo(tipo, x)).collect();
            let dentro = dentro?;
            let tipo_elementi = dentro.first().map(tipo_scalare_del_variant)??;
            // Elementi di tipo diverso non fanno un array OPC-UA.
            if dentro.iter().any(|x| tipo_scalare_del_variant(x) != Some(tipo_elementi)) {
                return None;
            }
            let _ = t;
            Variant::Array(Box::new(opcua::types::Array::new(tipo_elementi, dentro).ok()?))
        }
        // Le strutture no: vogliono il `DataTypeTree` del server e un type
        // loader, ed è la parte della Fase 4 che aspetta un server con
        // strutture su cui provarla.
        (TagValue::Struct(_), _) => return None,
    })
}

fn tipo_scalare_del_variant(v: &Variant) -> Option<opcua::types::VariantScalarTypeId> {
    use opcua::types::VariantScalarTypeId as T;
    Some(match v {
        Variant::Boolean(_) => T::Boolean,
        Variant::SByte(_) => T::SByte,
        Variant::Byte(_) => T::Byte,
        Variant::Int16(_) => T::Int16,
        Variant::UInt16(_) => T::UInt16,
        Variant::Int32(_) => T::Int32,
        Variant::UInt32(_) => T::UInt32,
        Variant::Int64(_) => T::Int64,
        Variant::UInt64(_) => T::UInt64,
        Variant::Float(_) => T::Float,
        Variant::Double(_) => T::Double,
        Variant::String(_) => T::String,
        _ => return None,
    })
}

/// Il `DataType` con cui il **nostro** server dichiara un nodo.
///
/// Fino al 23-10-2026 ogni nodo era dichiarato `Double`, qualunque fosse il
/// tag: un `bool` esposto come `Double`, e poi l'updater ci spingeva dentro un
/// `Variant::Boolean`. Il valore contraddiceva il tipo dichiarato, e un client
/// severo ha tutto il diritto di rifiutarlo.
///
/// Il tipo viene da quello **dichiarato nel progetto**, che è la stessa fonte
/// scelta per la scrittura (decisione 3 del 23-10-2026).
pub fn tipo_opcua(tipo: Option<&str>) -> opcua::types::DataTypeId {
    use opcua::types::DataTypeId as D;
    match tipo.and_then(TipoScalare::parse) {
        Some(TipoScalare::Bool) => D::Boolean,
        Some(TipoScalare::I8) => D::SByte,
        Some(TipoScalare::U8) => D::Byte,
        Some(TipoScalare::I16) => D::Int16,
        Some(TipoScalare::U16) => D::UInt16,
        Some(TipoScalare::I32) => D::Int32,
        Some(TipoScalare::U32) => D::UInt32,
        Some(TipoScalare::I64) => D::Int64,
        Some(TipoScalare::U64) => D::UInt64,
        Some(TipoScalare::F32) => D::Float,
        Some(TipoScalare::Stringa { .. }) => D::String,
        // `datetime` è un intero di millisecondi da noi (D7), non un
        // `DateTime` di OPC-UA: dichiararlo `DateTime` direbbe il falso.
        Some(TipoScalare::DateTime) => D::Int64,
        // `f64`, i nomi storici, e tutto ciò che non si legge: `Double`, che è
        // quello che il server ha sempre dichiarato.
        _ => D::Double,
    }
}

/// Il nome del tipo SWS che corrisponde al `DataType` di un nodo.
///
/// È l'inverso di [`tipo_opcua`], e serve al browse: con questo l'IDE può
/// proporre il tipo giusto quando si crea un tag da un nodo, invece di
/// lasciarlo scegliere a mano — che è quello che si fa oggi.
///
/// `None` per un `DataType` che non è uno scalare conosciuto: una struttura,
/// un'enumerazione, un tipo del costruttore. Lì il tipo non si indovina.
pub fn tipo_sws(data_type: &opcua::types::NodeId) -> Option<&'static str> {
    use opcua::types::{DataTypeId as D, Identifier};
    // Solo lo spazio di nomi 0 porta i tipi standard: un `ns=2` è un tipo del
    // costruttore, e indovinarlo sarebbe peggio che non dire niente.
    if data_type.namespace != 0 {
        return None;
    }
    let Identifier::Numeric(n) = data_type.identifier else { return None };
    Some(match n {
        x if x == D::Boolean as u32 => "bool",
        x if x == D::SByte as u32 => "i8",
        x if x == D::Byte as u32 => "u8",
        x if x == D::Int16 as u32 => "i16",
        x if x == D::UInt16 as u32 => "u16",
        x if x == D::Int32 as u32 => "i32",
        x if x == D::UInt32 as u32 => "u32",
        x if x == D::Int64 as u32 => "i64",
        x if x == D::UInt64 as u32 => "u64",
        x if x == D::Float as u32 => "f32",
        x if x == D::Double as u32 => "f64",
        x if x == D::String as u32 || x == D::LocalizedText as u32 => "string",
        _ => return None,
    })
}

#[cfg(test)]
mod prove {
    use super::*;
    use opcua::types::Array;

    fn dv(v: Variant) -> DataValue {
        DataValue { value: Some(v), status: Some(StatusCode::Good), ..Default::default() }
    }

    /// Il difetto principale: un valore che non si sa leggere non diventa zero.
    #[test]
    fn un_valore_che_non_si_sa_leggere_non_diventa_zero() {
        let ignoto = dv(Variant::Guid(Default::default()));
        let (v, q) = da_data_value(&ignoto);
        assert!(v.is_none(), "ha inventato un valore: {v:?}");
        // Il dato c'è e non lo sappiamo leggere: va visto.
        assert_eq!(q, TagQuality::Bad);

        // Un valore **assente** invece no: non sappiamo ancora.
        let vuoto = DataValue { value: None, status: Some(StatusCode::Good), ..Default::default() };
        let (v, q) = da_data_value(&vuoto);
        assert!(v.is_none());
        assert_eq!(q, TagQuality::Uncertain, "assente e illeggibile non sono la stessa cosa");
    }

    #[test]
    fn gli_scalari_si_leggono_come_prima() {
        assert_eq!(da_data_value(&dv(Variant::Boolean(true))).0, Some(TagValue::Bool(true)));
        assert_eq!(da_data_value(&dv(Variant::UInt16(65535))).0, Some(TagValue::Int(65535)));
        assert_eq!(da_data_value(&dv(Variant::Int16(-2))).0, Some(TagValue::Int(-2)));
        assert_eq!(da_data_value(&dv(Variant::Float(1.5))).0, Some(TagValue::Float(1.5)));
        let (_, q) = da_data_value(&DataValue {
            value: Some(Variant::Double(1.0)),
            status: Some(StatusCode::BadNodeIdUnknown),
            ..Default::default()
        });
        assert_eq!(q, TagQuality::Bad, "uno stato di errore resta Bad");
    }

    #[test]
    fn un_array_a_una_dimensione_diventa_un_array() {
        let a = Array::new_multi(
            opcua::types::VariantScalarTypeId::Int32,
            vec![Variant::Int32(1), Variant::Int32(2), Variant::Int32(3)],
            vec![3],
        )
        .unwrap();
        let (v, q) = da_data_value(&dv(Variant::Array(Box::new(a))));
        assert_eq!(q, TagQuality::Good);
        assert_eq!(
            v,
            Some(TagValue::Array(vec![TagValue::Int(1), TagValue::Int(2), TagValue::Int(3)]))
        );
    }

    /// OPC-UA tiene gli array a più dimensioni **piatti**; `Forma::Array` è
    /// annidata. Senza ricostruire l'annidamento, `matrice[1][2]` non si legge.
    #[test]
    fn un_array_a_due_dimensioni_si_annida() {
        let valori: Vec<Variant> = (1..=6).map(Variant::Int32).collect();
        let a = Array::new_multi(opcua::types::VariantScalarTypeId::Int32, valori, vec![2, 3]).unwrap();
        let (v, _) = da_data_value(&dv(Variant::Array(Box::new(a))));
        assert_eq!(
            v,
            Some(TagValue::Array(vec![
                TagValue::Array(vec![TagValue::Int(1), TagValue::Int(2), TagValue::Int(3)]),
                TagValue::Array(vec![TagValue::Int(4), TagValue::Int(5), TagValue::Int(6)]),
            ])),
            "l'ordine è row-major: le dimensioni di rango alto viaggiano per prime"
        );
    }

    #[test]
    fn dimensioni_che_non_tornano_non_danno_una_matrice_storta() {
        let valori: Vec<Variant> = (1..=5).map(Variant::Int32).collect();
        let a = Array {
            value_type: opcua::types::VariantScalarTypeId::Int32,
            values: valori,
            dimensions: Some(vec![2, 3]),
        };
        assert!(da_variant(&Variant::Array(Box::new(a))).is_none(), "5 valori in 2x3");
    }

    /// Il secondo difetto: scrivere su un nodo `UInt16` mandava un `Int64`.
    #[test]
    fn il_variant_in_scrittura_segue_il_tipo_dichiarato() {
        let v = TagValue::Int(7);
        assert_eq!(variant_per_tipo(Some("u16"), &v), Some(Variant::UInt16(7)));
        assert_eq!(variant_per_tipo(Some("i16"), &v), Some(Variant::Int16(7)));
        assert_eq!(variant_per_tipo(Some("i32"), &v), Some(Variant::Int32(7)));
        assert_eq!(variant_per_tipo(Some("u8"), &v), Some(Variant::Byte(7)));
        assert_eq!(
            variant_per_tipo(Some("f32"), &TagValue::Float(1.5)),
            Some(Variant::Float(1.5))
        );
    }

    /// Un progetto che non ha mai scelto il tipo si comporta come prima: è la
    /// stessa regola di compatibilità che la Fase 3 ha scritto per Modbus.
    #[test]
    fn senza_un_tipo_ricco_si_scrive_come_prima() {
        let n = TagValue::Int(7);
        assert_eq!(variant_per_tipo(None, &n), Some(Variant::Int64(7)));
        assert_eq!(variant_per_tipo(Some("int"), &n), Some(Variant::Int64(7)));
        assert_eq!(variant_per_tipo(Some("i64"), &n), Some(Variant::Int64(7)));
        let f = TagValue::Float(1.5);
        assert_eq!(variant_per_tipo(None, &f), Some(Variant::Double(1.5)));
        assert_eq!(variant_per_tipo(Some("float"), &f), Some(Variant::Double(1.5)));
        assert_eq!(
            variant_per_tipo(Some("bool"), &TagValue::Bool(true)),
            Some(Variant::Boolean(true))
        );
        assert_eq!(
            variant_per_tipo(Some("string"), &TagValue::Str("x".into())),
            Some(Variant::String("x".into()))
        );
    }

    /// Un array si traduce, e col tipo della radice. Fino al 23-10-2026 il
    /// server tornava `None` e **saltava quei tag in silenzio**: un array nel
    /// progetto non compariva affatto nell'indirizzario.
    #[test]
    fn un_array_si_traduce_col_tipo_della_radice() {
        let a = TagValue::Array(vec![TagValue::Int(1), TagValue::Int(2)]);
        let Some(Variant::Array(arr)) = variant_per_tipo(Some("u16"), &a) else {
            panic!("un array di u16 non si traduce")
        };
        assert_eq!(arr.values.len(), 2);
        assert_eq!(arr.values[0], Variant::UInt16(1));
        assert_eq!(arr.value_type, opcua::types::VariantScalarTypeId::UInt16);
    }

    #[test]
    fn un_array_vuoto_o_misto_non_si_traduce() {
        assert!(variant_per_tipo(Some("u16"), &TagValue::Array(vec![])).is_none());
        let misto = TagValue::Array(vec![TagValue::Int(1), TagValue::Str("x".into())]);
        assert!(variant_per_tipo(None, &misto).is_none(), "tipi diversi non fanno un array OPC-UA");
    }

    #[test]
    fn una_struttura_non_si_scrive_ancora() {
        assert!(variant_per_tipo(None, &TagValue::Struct(Default::default())).is_none());
    }

    /// Il giro di andata e ritorno: il tipo che il browse legge dal server
    /// torna a essere il nome che il progetto scriverebbe.
    #[test]
    fn il_tipo_del_nodo_torna_il_nome_del_progetto() {
        use opcua::types::{DataTypeId as D, NodeId};
        for (d, atteso) in [
            (D::Boolean, "bool"),
            (D::UInt16, "u16"),
            (D::Float, "f32"),
            (D::Double, "f64"),
            (D::String, "string"),
        ] {
            assert_eq!(tipo_sws(&NodeId::from(d)), Some(atteso));
            // E il giro completo: nome -> DataType -> nome.
            assert_eq!(tipo_opcua(Some(atteso)), d, "andata e ritorno su {atteso}");
        }
        // Un tipo del costruttore non si indovina.
        assert_eq!(tipo_sws(&NodeId::new(2, 3001u32)), None);
    }

    /// Il nodo si dichiara col tipo del progetto, non `Double` per tutti.
    #[test]
    fn il_nodo_si_dichiara_col_tipo_dichiarato() {
        use opcua::types::DataTypeId as D;
        assert_eq!(tipo_opcua(Some("bool")), D::Boolean);
        assert_eq!(tipo_opcua(Some("u16")), D::UInt16);
        assert_eq!(tipo_opcua(Some("f32")), D::Float);
        assert_eq!(tipo_opcua(Some("string(8)")), D::String);
        // `datetime` da noi è un intero di millisecondi (D7): dichiararlo
        // `DateTime` di OPC-UA direbbe il falso.
        assert_eq!(tipo_opcua(Some("datetime")), D::Int64);
        // E chi non ha mai scelto resta `Double`, com'è sempre stato.
        assert_eq!(tipo_opcua(None), D::Double);
        assert_eq!(tipo_opcua(Some("float")), D::Double);
    }
}
