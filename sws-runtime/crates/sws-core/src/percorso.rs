//! Percorsi dentro una variabile composita, e la **forma** di una variabile
//! (Fase 1b del piano tag, 22-09-2026).
//!
//! `motore1.velocita`, `valvole[3].stato`, `matrice[1][2]` (D8: più
//! dimensioni). Un id piatto con i punti dentro (`pv1.potenza`, ce ne sono
//! centinaia nei progetti) **non** è un percorso: la risoluzione prova prima
//! l'id esatto, poi il prefisso più lungo che sia una radice composita — e chi
//! risolve decide, qui c'è solo la grammatica.
//!
//! La forma si deriva dal tipo dichiarato (`type_ref`/`array`/`data_type`) e
//! serve a tre cose: il valore iniziale composito, l'elenco delle foglie con il
//! loro tipo e i metadati del membro (scala, ruolo, storico), e la navigazione.

use std::collections::BTreeMap;

use crate::project::{Membro, TagDef, TypeDef};
use crate::tag::TagValue;
use crate::tipo::TipoScalare;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Segmento {
    Campo(String),
    Indice(usize),
}

/// Il testo di un percorso relativo (`.velocita`, `[3].stato`).
pub fn testo_segmenti(segmenti: &[Segmento]) -> String {
    let mut s = String::new();
    for seg in segmenti {
        match seg {
            Segmento::Campo(c) => {
                s.push('.');
                s.push_str(c);
            }
            Segmento::Indice(i) => s.push_str(&format!("[{i}]")),
        }
    }
    s
}

/// I punti in cui `id` può spezzarsi in (radice, resto): prima di ogni `.` o
/// `[` non annidato, dal più lungo al più corto. La radice più lunga vince
/// perché `pv1.potenza` piatto e `pv1` radice non possono convivere (lo vieta
/// la validazione), quindi il primo prefisso che è una radice è quello giusto.
pub fn candidati(id: &str) -> Vec<(&str, &str)> {
    let mut out = Vec::new();
    let b = id.as_bytes();
    let mut i = b.len();
    while i > 0 {
        i -= 1;
        if b[i] == b'.' || b[i] == b'[' {
            out.push((&id[..i], &id[i..]));
        }
    }
    out
}

/// Il resto dopo la radice (`.a[2].b`) in segmenti. `None` se malformato.
pub fn parse_segmenti(resto: &str) -> Option<Vec<Segmento>> {
    let mut out = Vec::new();
    let mut rest = resto;
    while !rest.is_empty() {
        if let Some(r) = rest.strip_prefix('.') {
            let fine = r.find(['.', '[']).unwrap_or(r.len());
            let nome = &r[..fine];
            if nome.is_empty()
                || !nome
                    .chars()
                    .all(|c| c.is_alphanumeric() || c == '_' || c == '-')
            {
                return None;
            }
            out.push(Segmento::Campo(nome.to_string()));
            rest = &r[fine..];
        } else if let Some(r) = rest.strip_prefix('[') {
            let fine = r.find(']')?;
            let n: usize = r[..fine].trim().parse().ok()?;
            out.push(Segmento::Indice(n));
            rest = &r[fine + 1..];
        } else {
            return None;
        }
    }
    Some(out)
}

/// Legge la foglia (o il sotto-albero) puntato dai segmenti.
pub fn leggi<'a>(v: &'a TagValue, segmenti: &[Segmento]) -> Option<&'a TagValue> {
    let mut cur = v;
    for seg in segmenti {
        cur = match (seg, cur) {
            (Segmento::Campo(c), TagValue::Struct(m)) => m.get(c)?,
            (Segmento::Indice(i), TagValue::Array(a)) => a.get(*i)?,
            _ => return None,
        };
    }
    Some(cur)
}

/// Sostituisce la foglia (o il sotto-albero) puntato. `Err` se il percorso non
/// esiste nella forma del valore: non si creano campi a runtime.
pub fn scrivi(v: &mut TagValue, segmenti: &[Segmento], nuovo: TagValue) -> Result<(), String> {
    let Some((primo, resto)) = segmenti.split_first() else {
        *v = nuovo;
        return Ok(());
    };
    match (primo, v) {
        (Segmento::Campo(c), TagValue::Struct(m)) => match m.get_mut(c) {
            Some(figlio) => scrivi(figlio, resto, nuovo),
            None => Err(format!("campo `{c}` inesistente")),
        },
        (Segmento::Indice(i), TagValue::Array(a)) => match a.get_mut(*i) {
            Some(figlio) => scrivi(figlio, resto, nuovo),
            None => Err(format!("indice [{i}] oltre la lunghezza {}", a.len())),
        },
        (Segmento::Campo(c), _) => Err(format!("`.{c}` su un valore che non è una struttura")),
        (Segmento::Indice(i), _) => Err(format!("`[{i}]` su un valore che non è un array")),
    }
}

/// La forma di una variabile: che cosa c'è a ogni percorso.
#[derive(Debug, Clone, PartialEq)]
pub enum Forma {
    Scalare(TipoScalare),
    Struttura(Vec<(String, Forma)>),
    Array(usize, Box<Forma>),
}

/// Una foglia della forma con il membro che la descrive (scala, ruolo,
/// storico). `membro` è `None` per gli elementi di un array dichiarato
/// direttamente sul tag con `data_type`.
#[derive(Debug, Clone)]
pub struct Foglia {
    pub percorso: String,
    pub tipo: TipoScalare,
    pub membro: Option<Membro>,
}

impl Forma {
    /// La forma di un tag. `Ok(None)` = tag scalare piatto, nessuna radice.
    /// `Err` = tipo o riferimento non validi (lo dice anche il validatore; qui
    /// si rifiuta e basta, senza inventare).
    pub fn da_tag(tag: &TagDef, types: &[TypeDef]) -> Result<Option<Forma>, String> {
        let elemento = match (&tag.type_ref, &tag.array) {
            (None, None) => return Ok(None),
            (Some(t), _) => Forma::da_type_ref(t, types, &mut Vec::new())?,
            (None, Some(_)) => Forma::Scalare(
                TipoScalare::parse(&tag.data_type)
                    .ok_or_else(|| format!("tipo `{}` non valido", tag.data_type))?,
            ),
        };
        Ok(Some(Forma::con_array(elemento, tag.array.as_deref())?))
    }

    fn con_array(elemento: Forma, dims: Option<&[u32]>) -> Result<Forma, String> {
        let Some(dims) = dims else {
            return Ok(elemento);
        };
        if dims.is_empty() {
            return Err("array senza dimensioni".into());
        }
        let mut f = elemento;
        for d in dims.iter().rev() {
            if *d == 0 {
                return Err("array con una dimensione zero".into());
            }
            f = Forma::Array(*d as usize, Box::new(f));
        }
        Ok(f)
    }

    fn da_type_ref(id: &str, types: &[TypeDef], pila: &mut Vec<String>) -> Result<Forma, String> {
        if pila.iter().any(|x| x == id) {
            return Err(format!(
                "il tipo `{id}` si contiene (ciclo: {})",
                pila.join(" → ")
            ));
        }
        let td = types
            .iter()
            .find(|t| t.id == id)
            .ok_or_else(|| format!("tipo `{id}` non dichiarato"))?;
        pila.push(id.to_string());
        let mut membri = Vec::new();
        for m in &td.members {
            let base = match (&m.type_ref, &m.data_type) {
                (Some(t), _) => Forma::da_type_ref(t, types, pila)?,
                (None, Some(dt)) => Forma::Scalare(
                    TipoScalare::parse(dt)
                        .ok_or_else(|| format!("membro `{}`: tipo `{dt}` non valido", m.name))?,
                ),
                (None, None) => {
                    return Err(format!("membro `{}` senza data_type né type_ref", m.name))
                }
            };
            membri.push((m.name.clone(), Forma::con_array(base, m.array.as_deref())?));
        }
        pila.pop();
        Ok(Forma::Struttura(membri))
    }

    pub fn valore_iniziale(&self) -> TagValue {
        match self {
            Forma::Scalare(t) => t.valore_iniziale(),
            Forma::Struttura(m) => TagValue::Struct(
                m.iter()
                    .map(|(n, f)| (n.clone(), f.valore_iniziale()))
                    .collect::<BTreeMap<_, _>>(),
            ),
            Forma::Array(n, f) => TagValue::Array((0..*n).map(|_| f.valore_iniziale()).collect()),
        }
    }

    /// Le foglie, in ordine di dichiarazione (row-major per gli array), con
    /// il percorso **assoluto** a partire da `radice`. Il membro è quello del
    /// livello struttura più vicino alla foglia.
    pub fn foglie(&self, radice: &str, types: &[TypeDef]) -> Vec<Foglia> {
        let mut out = Vec::new();
        self.raccogli(radice, None, types, &mut out);
        out
    }

    fn raccogli(
        &self,
        percorso: &str,
        membro: Option<&Membro>,
        types: &[TypeDef],
        out: &mut Vec<Foglia>,
    ) {
        match self {
            Forma::Scalare(t) => out.push(Foglia {
                percorso: percorso.to_string(),
                tipo: t.clone(),
                membro: membro.cloned(),
            }),
            Forma::Array(n, f) => {
                for i in 0..*n {
                    f.raccogli(&format!("{percorso}[{i}]"), membro, types, out);
                }
            }
            Forma::Struttura(m) => {
                for (nome, f) in m {
                    // Il membro di questo livello: cercato per nome nel tipo che
                    // ha generato la struttura. Con i tipi annidati il membro
                    // giusto è quello della struttura più interna che porta
                    // metadati (unità, scala): per una foglia scalare è
                    // sempre il membro che la dichiara.
                    let mb = types
                        .iter()
                        .flat_map(|t| t.members.iter())
                        .find(|x| &x.name == nome && forma_del_membro_coincide(x, f, types));
                    f.raccogli(&format!("{percorso}.{nome}"), mb.or(membro), types, out);
                }
            }
        }
    }

    /// Il tipo scalare al percorso, se è una foglia.
    pub fn tipo_a(&self, segmenti: &[Segmento]) -> Option<&TipoScalare> {
        let mut cur = self;
        for seg in segmenti {
            cur = match (seg, cur) {
                (Segmento::Campo(c), Forma::Struttura(m)) => &m.iter().find(|(n, _)| n == c)?.1,
                (Segmento::Indice(i), Forma::Array(n, f)) if *i < *n => f,
                _ => return None,
            };
        }
        match cur {
            Forma::Scalare(t) => Some(t),
            _ => None,
        }
    }
}

/// Un membro genera questa forma? Serve a ritrovare i metadati del membro
/// (scala, ruolo, storico) percorrendo la forma già costruita.
fn forma_del_membro_coincide(m: &Membro, f: &Forma, types: &[TypeDef]) -> bool {
    let base = match (&m.type_ref, &m.data_type) {
        (Some(t), _) => match Forma::da_type_ref(t, types, &mut Vec::new()) {
            Ok(x) => x,
            Err(_) => return false,
        },
        (None, Some(dt)) => match TipoScalare::parse(dt) {
            Some(t) => Forma::Scalare(t),
            None => return false,
        },
        (None, None) => return false,
    };
    matches!(Forma::con_array(base, m.array.as_deref()), Ok(x) if &x == f)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tipi() -> Vec<TypeDef> {
        serde_yaml::from_str(
            r#"
- id: Pid
  members:
    - { name: kp, data_type: f32 }
    - { name: ki, data_type: f32 }
- id: Motore
  members:
    - { name: velocita, data_type: f32, unit: rpm, raw_min: 0, raw_max: 16384, eng_min: 0, eng_max: 3000, history_deadband: 0.5 }
    - { name: marcia, data_type: bool }
    - { name: allarmi, data_type: bool, array: [8] }
    - { name: pid, type_ref: Pid }
    - { name: nome, data_type: string(16), history: false }
"#,
        )
        .unwrap()
    }
    fn tag(yaml: &str) -> TagDef {
        serde_yaml::from_str(yaml).unwrap()
    }

    #[test]
    fn grammatica_dei_percorsi() {
        assert_eq!(
            parse_segmenti(".velocita"),
            Some(vec![Segmento::Campo("velocita".into())])
        );
        assert_eq!(
            parse_segmenti("[3].stato"),
            Some(vec![Segmento::Indice(3), Segmento::Campo("stato".into())])
        );
        assert_eq!(
            parse_segmenti("[1][2]"),
            Some(vec![Segmento::Indice(1), Segmento::Indice(2)])
        );
        assert_eq!(parse_segmenti(""), Some(vec![]));
        assert_eq!(parse_segmenti("velocita"), None);
        assert_eq!(parse_segmenti("[x]"), None);
        assert_eq!(parse_segmenti("..a"), None);
        assert_eq!(
            testo_segmenti(&parse_segmenti("[3].stato").unwrap()),
            "[3].stato"
        );
    }

    #[test]
    fn i_candidati_vanno_dal_prefisso_piu_lungo() {
        assert_eq!(
            candidati("a.b[2].c"),
            vec![("a.b[2]", ".c"), ("a.b", "[2].c"), ("a", ".b[2].c")]
        );
        assert_eq!(candidati("piatto"), Vec::<(&str, &str)>::new());
    }

    #[test]
    fn la_forma_di_una_istanza_e_le_sue_foglie() {
        let f = Forma::da_tag(&tag("{ id: motore1, type_ref: Motore }"), &tipi())
            .unwrap()
            .unwrap();
        let foglie = f.foglie("motore1", &tipi());
        let percorsi: Vec<&str> = foglie.iter().map(|x| x.percorso.as_str()).collect();
        assert_eq!(
            percorsi,
            [
                "motore1.velocita",
                "motore1.marcia",
                "motore1.allarmi[0]",
                "motore1.allarmi[1]",
                "motore1.allarmi[2]",
                "motore1.allarmi[3]",
                "motore1.allarmi[4]",
                "motore1.allarmi[5]",
                "motore1.allarmi[6]",
                "motore1.allarmi[7]",
                "motore1.pid.kp",
                "motore1.pid.ki",
                "motore1.nome",
            ]
        );
        assert_eq!(foglie[0].tipo, TipoScalare::F32);
        assert_eq!(
            foglie[0].membro.as_ref().unwrap().unit.as_deref(),
            Some("rpm")
        );
        assert_eq!(foglie[0].membro.as_ref().unwrap().raw_max, Some(16384.0));
        assert!(
            !foglie[12].membro.as_ref().unwrap().history,
            "nome è escluso dallo storico"
        );
        assert_eq!(foglie[10].tipo, TipoScalare::F32);
        // il valore iniziale ha la stessa forma
        let v = f.valore_iniziale();
        assert_eq!(
            leggi(&v, &parse_segmenti(".pid.kp").unwrap()),
            Some(&TagValue::Float(0.0))
        );
        assert_eq!(
            leggi(&v, &parse_segmenti(".allarmi[7]").unwrap()),
            Some(&TagValue::Bool(false))
        );
        assert_eq!(leggi(&v, &parse_segmenti(".allarmi[8]").unwrap()), None);
        assert_eq!(
            f.tipo_a(&parse_segmenti(".nome").unwrap()),
            Some(&TipoScalare::Stringa { max_len: Some(16) })
        );
        assert_eq!(f.tipo_a(&parse_segmenti(".pid").unwrap()), None);
    }

    #[test]
    fn array_di_strutture_e_matrici() {
        let v = Forma::da_tag(&tag("{ id: valvole, type_ref: Pid, array: [4] }"), &tipi())
            .unwrap()
            .unwrap();
        assert_eq!(v.foglie("valvole", &tipi()).len(), 8);
        assert_eq!(v.foglie("valvole", &tipi())[3].percorso, "valvole[1].ki");
        let m = Forma::da_tag(&tag("{ id: m, data_type: u16, array: [2, 3] }"), &tipi())
            .unwrap()
            .unwrap();
        let f = m.foglie("m", &tipi());
        assert_eq!(f.len(), 6);
        assert_eq!(f[4].percorso, "m[1][1]");
        assert!(f[0].membro.is_none());
        let mut val = m.valore_iniziale();
        scrivi(
            &mut val,
            &parse_segmenti("[1][2]").unwrap(),
            TagValue::Int(7),
        )
        .unwrap();
        assert_eq!(
            leggi(&val, &parse_segmenti("[1][2]").unwrap()),
            Some(&TagValue::Int(7))
        );
        assert!(scrivi(
            &mut val,
            &parse_segmenti("[2][0]").unwrap(),
            TagValue::Int(1)
        )
        .is_err());
        assert!(scrivi(&mut val, &parse_segmenti(".x").unwrap(), TagValue::Int(1)).is_err());
    }

    #[test]
    fn errori_di_forma() {
        assert!(Forma::da_tag(&tag("{ id: x, type_ref: Inesistente }"), &tipi()).is_err());
        assert!(Forma::da_tag(&tag("{ id: x, data_type: u16, array: [0] }"), &tipi()).is_err());
        assert_eq!(
            Forma::da_tag(&tag("{ id: piatto, data_type: f64 }"), &tipi()).unwrap(),
            None
        );
        let ciclo: Vec<TypeDef> = serde_yaml::from_str("- { id: A, members: [{ name: b, type_ref: B }] }\n- { id: B, members: [{ name: a, type_ref: A }] }").unwrap();
        let e = Forma::da_tag(&tag("{ id: x, type_ref: A }"), &ciclo).unwrap_err();
        assert!(e.contains("ciclo"), "{e}");
    }
}
