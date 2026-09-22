use crate::percorso::{candidati, leggi, parse_segmenti, scrivi, Forma, Segmento};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap},
    fmt,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::sync::{broadcast, mpsc, RwLock};

pub type TagId = String;

/// Qualità e timestamp delle foglie di una radice, per percorso **relativo**
/// (`.velocita`, `[3].stato`). D6: la radice riporta la peggiore.
pub type QualitaFoglie = BTreeMap<String, (TagQuality, u64)>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub id: TagId,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)] // serializes as native JSON: true / 42 / 3.14 / "hello" / [..] / {..}
pub enum TagValue {
    Bool(bool),
    Int(i64),
    Float(f64),
    Str(String),
    /// Fase 1b (22-09-2026): il valore di una radice array. Sul filo viaggia
    /// espanso in foglie salvo richiesta esplicita.
    Array(Vec<TagValue>),
    /// Il valore di un'istanza di tipo struttura: campo → valore. `BTreeMap`
    /// per un ordine stabile in serializzazione e nello storico.
    Struct(std::collections::BTreeMap<String, TagValue>),
}

impl TagValue {
    /// Vero per array e strutture: un valore che non è un numero, un testo o
    /// un bool e che i consumatori scalari devono trattare come «non
    /// applicabile», mai come zero.
    pub fn e_composito(&self) -> bool {
        matches!(self, TagValue::Array(_) | TagValue::Struct(_))
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum TagQuality {
    Good,
    Bad,
    Uncertain,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagState {
    pub value: TagValue,
    pub quality: TagQuality,
    pub timestamp_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagUpdate {
    pub id: TagId,
    pub state: TagState,
}

/// Scaling lineare raw→eng di un tag (F1, piano SCADA-widgets). Definito in
/// `TagDef` (raw_min/raw_max/eng_min/eng_max), installato a ogni apertura di
/// progetto via `TagDb::set_scales`.
#[derive(Debug, Clone, Copy)]
pub struct LinearScale {
    pub raw_min: f64,
    pub raw_max: f64,
    pub eng_min: f64,
    pub eng_max: f64,
}

impl LinearScale {
    pub fn to_eng(&self, raw: f64) -> f64 {
        if self.raw_max == self.raw_min {
            return raw;
        }
        self.eng_min
            + (raw - self.raw_min) * (self.eng_max - self.eng_min) / (self.raw_max - self.raw_min)
    }
    pub fn to_raw(&self, eng: f64) -> f64 {
        if self.eng_max == self.eng_min {
            return eng;
        }
        self.raw_min
            + (eng - self.eng_min) * (self.raw_max - self.raw_min) / (self.eng_max - self.eng_min)
    }
}

pub struct TagDb {
    store: Arc<RwLock<HashMap<TagId, TagState>>>,
    tx: broadcast::Sender<TagUpdate>,
    /// Scaling per-tag applicato SOLO da `ingest()` (plugin di protocollo).
    scales: Arc<RwLock<HashMap<TagId, LinearScale>>>,
    /// Ruolo minimo di scrittura per-tag (`TagDef.write_min_role`, F3.1).
    /// Stringhe grezze: sws-core non conosce i tipi di sws-auth — il web
    /// layer le interpreta. Aggiornata insieme a `scales`.
    write_roles: Arc<RwLock<HashMap<TagId, String>>>,
    /// `data_type` dichiarato per-tag (`TagDef.data_type`, Q27): "bool",
    /// "int", "float", "string", come nello YAML. Aggiornata insieme a
    /// `scales`. Un tag assente dalla mappa non viene vincolato — succede ai
    /// tag creati al volo dagli script e nei test.
    data_types: Arc<RwLock<HashMap<TagId, String>>>,
    /// Le **radici composite** e la loro forma (Fase 1b). Vuota finché un
    /// progetto non dichiara `types:`/`array`: senza radici la risoluzione è
    /// quella di sempre, una ricerca esatta nella mappa.
    forme: Arc<RwLock<HashMap<TagId, Forma>>>,
    /// Qualità e timestamp **per foglia** (D6): radice → percorso relativo →
    /// (qualità, ts). La qualità della radice è la peggiore delle foglie, il
    /// suo timestamp il più recente. Serve perché una mappatura a foglia può
    /// guastarsi da sola: marcare Bad tutta la struttura nasconderebbe le
    /// foglie sane, lasciarla Good nasconderebbe il guasto.
    qualita_foglie: Arc<RwLock<HashMap<TagId, QualitaFoglie>>>,
    /// Tag il cui valore è CALCOLATO (`TagDef::is_computed`: espressione
    /// derivata o generatore d'onda attivo, T-69) — non deve accettare
    /// scritture utente (API/WS/ricette). Aggiornata insieme a `scales`.
    /// Un tag assente dall'insieme non è vincolato: è il caso storico.
    computed_tags: Arc<RwLock<std::collections::HashSet<TagId>>>,
}

impl TagDb {
    pub fn new(channel_capacity: usize) -> Self {
        let (tx, _) = broadcast::channel(channel_capacity);
        Self {
            store: Arc::new(RwLock::new(HashMap::new())),
            tx,
            scales: Arc::new(RwLock::new(HashMap::new())),
            write_roles: Arc::new(RwLock::new(HashMap::new())),
            data_types: Arc::new(RwLock::new(HashMap::new())),
            computed_tags: Arc::new(RwLock::new(std::collections::HashSet::new())),
            forme: Arc::new(RwLock::new(HashMap::new())),
            qualita_foglie: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Sostituisce la mappa dei ruoli minimi di scrittura (F3.1).
    pub async fn set_write_roles(&self, roles: HashMap<TagId, String>) {
        *self.write_roles.write().await = roles;
    }

    /// Ruolo minimo di scrittura del tag, se definito. Per una foglia si
    /// guarda prima il percorso, poi la radice: un ruolo messo sull'istanza
    /// vale per tutti i suoi membri.
    pub async fn write_role_of(&self, id: &str) -> Option<String> {
        if let Some(r) = self.write_roles.read().await.get(id).cloned() {
            return Some(r);
        }
        let (radice, segmenti) = self.risolvi(id).await?;
        if segmenti.is_empty() {
            return None;
        }
        let r = self.write_roles.read().await.get(&radice).cloned();
        r
    }

    /// Sostituisce la mappa dei `data_type` dichiarati (Q27). Stessi punti
    /// di refresh di `set_scales`.
    pub async fn set_data_types(&self, types: HashMap<TagId, String>) {
        *self.data_types.write().await = types;
    }

    /// Q27 — il `data_type` è un contratto sui percorsi di scrittura UTENTE
    /// (API, WebSocket, ricette, script Python). Converte ciò che non perde
    /// informazione (Int→float; Float intero→int; le stringhe "true"/"false"
    /// e numeriche, che i vecchi progetti usano davvero) e rifiuta il resto
    /// con un messaggio che nomina tag, tipo dichiarato e valore ricevuto.
    /// Il percorso inverso — i plugin che leggono dal campo via `ingest` —
    /// non passa di qui: lì il tipo lo determina il protocollo.
    pub async fn coerce_for_write(&self, id: &str, value: TagValue) -> Result<TagValue, String> {
        let Some(want) = self.data_types.read().await.get(id).cloned() else {
            return Ok(value);
        };
        coerce_value(&want, value)
            .map_err(|got| format!("il tag «{id}» è dichiarato {want}, ricevuto {got}"))
    }

    /// Sostituisce l'insieme dei tag calcolati (T-69). Stessi punti di
    /// refresh di `set_scales`.
    pub async fn set_computed_tags(&self, ids: std::collections::HashSet<TagId>) {
        *self.computed_tags.write().await = ids;
    }

    /// Vero se il tag è calcolato (espressione o generatore attivo): il
    /// chiamante (`write_tag`) deve rifiutare la scrittura utente.
    pub async fn is_computed(&self, id: &str) -> bool {
        self.computed_tags.read().await.contains(id)
    }

    /// Installa le radici composite (Fase 1b). Mappa vuota = nessuna radice,
    /// e tutto si comporta come prima. La chiama `apply_tags`.
    pub async fn set_forme(&self, forme: HashMap<TagId, Forma>) {
        let radici: std::collections::HashSet<TagId> = forme.keys().cloned().collect();
        self.qualita_foglie
            .write()
            .await
            .retain(|id, _| radici.contains(id));
        *self.forme.write().await = forme;
    }

    /// La forma di una radice, se `id` è una radice composita.
    pub async fn forma_di(&self, id: &str) -> Option<Forma> {
        self.forme.read().await.get(id).cloned()
    }

    /// Da un id o percorso alla coppia (radice, segmenti).
    ///
    /// **Esatto prima**: un tag piatto con i punti dentro (`pv1.potenza`, ce
    /// ne sono centinaia nei progetti) vince sempre su ogni interpretazione a
    /// percorso. Poi il prefisso più lungo che sia una radice composita. La
    /// validazione vieta che le due cose coesistano, quindi non c'è ambiguità
    /// da arbitrare qui.
    async fn risolvi(&self, id: &str) -> Option<(TagId, Vec<Segmento>)> {
        if self.store.read().await.contains_key(id) {
            return Some((id.to_string(), Vec::new()));
        }
        let forme = self.forme.read().await;
        for (radice, resto) in candidati(id) {
            if forme.contains_key(radice) {
                let segmenti = parse_segmenti(resto)?;
                return Some((radice.to_string(), segmenti));
            }
        }
        None
    }

    /// La peggiore fra le qualità delle foglie, e il timestamp più recente.
    fn riepiloga(foglie: &QualitaFoglie) -> Option<(TagQuality, u64)> {
        let peso = |q: &TagQuality| match q {
            TagQuality::Good => 0,
            TagQuality::Uncertain => 1,
            TagQuality::Bad => 2,
        };
        let peggiore = foglie.values().max_by_key(|(q, _)| peso(q))?.0.clone();
        let ts = foglie.values().map(|(_, t)| *t).max().unwrap_or(0);
        Some((peggiore, ts))
    }

    /// Sostituisce la mappa degli scaling. Chiamata a ogni apertura/chiusura
    /// progetto (mappa vuota = nessuno scaling).
    pub async fn set_scales(&self, scales: HashMap<TagId, LinearScale>) {
        *self.scales.write().await = scales;
    }

    /// Converte un valore ingegneristico nel valore raw da scrivere sul
    /// device, se il tag ha uno scaling. Usato dai percorsi di scrittura
    /// (API/WS/ricette) prima di consegnare al TagWriteBus.
    pub async fn scale_to_raw(&self, id: &str, value: TagValue) -> TagValue {
        let Some(scale) = self.scales.read().await.get(id).copied() else {
            return value;
        };
        match value {
            TagValue::Float(v) => TagValue::Float(scale.to_raw(v)),
            TagValue::Int(v) => TagValue::Float(scale.to_raw(v as f64)),
            other => other,
        }
    }

    /// Ingresso dati dai PLUGIN DI PROTOCOLLO: come `set()`, ma applica lo
    /// scaling raw→eng se il tag lo definisce. Gli altri produttori (script,
    /// tag derivati, populate iniziale, API su tag virtuali) usano `set()`:
    /// producono già valori ingegneristici e scalarli due volte sarebbe un bug.
    pub async fn ingest(&self, id: TagId, value: TagValue, quality: TagQuality) {
        let scaled = match (self.scales.read().await.get(&id).copied(), value) {
            (Some(s), TagValue::Float(v)) => TagValue::Float(s.to_eng(v)),
            (Some(s), TagValue::Int(v)) => TagValue::Float(s.to_eng(v as f64)),
            (_, v) => v,
        };
        self.set(id, scaled, quality).await;
    }

    pub async fn set(&self, id: TagId, value: TagValue, quality: TagQuality) {
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        // Una foglia di una radice composita (Fase 1b): leggi-modifica-scrivi
        // sulla radice, e la sua qualità diventa la peggiore delle foglie
        // (D6). L'evento porta la RADICE — chi vuole le foglie chiama
        // `espandi_foglie`, così sul bus resta un aggiornamento solo.
        if !self.store.read().await.contains_key(&id) {
            if let Some((radice, segmenti)) = self.risolvi(&id).await {
                if !segmenti.is_empty() {
                    let rel = crate::percorso::testo_segmenti(&segmenti);
                    {
                        let mut store = self.store.write().await;
                        let Some(st) = store.get_mut(&radice) else {
                            return;
                        };
                        if scrivi(&mut st.value, &segmenti, value).is_err() {
                            return;
                        }
                    }
                    let riepilogo = {
                        let mut qf = self.qualita_foglie.write().await;
                        let foglie = qf.entry(radice.clone()).or_default();
                        foglie.insert(rel, (quality, ts));
                        Self::riepiloga(foglie)
                    };
                    let state = {
                        let mut store = self.store.write().await;
                        let Some(st) = store.get_mut(&radice) else {
                            return;
                        };
                        match riepilogo {
                            Some((q, t)) => {
                                st.quality = q;
                                st.timestamp_ms = t;
                            }
                            None => st.timestamp_ms = ts,
                        }
                        st.clone()
                    };
                    let _ = self.tx.send(TagUpdate { id: radice, state });
                    return;
                }
            }
        }
        let state = TagState {
            value,
            quality,
            timestamp_ms: ts,
        };
        self.store.write().await.insert(id.clone(), state.clone());
        let _ = self.tx.send(TagUpdate { id, state }); // no subscribers is fine
    }

    /// Le foglie di un aggiornamento, con percorso, valore e qualità propria
    /// (D6). Per un tag scalare ritorna l'aggiornamento stesso: chi espande
    /// non deve distinguere i due casi.
    ///
    /// È ciò che usano il filo (WS/REST: un frame tipizzato con dentro un
    /// valore composito si perderebbe **intero**, quindi il default è
    /// espanso), lo storico e gli allarmi.
    pub async fn espandi_foglie(&self, update: &TagUpdate) -> Vec<(TagId, TagState)> {
        let forma = {
            let forme = self.forme.read().await;
            forme.get(&update.id).cloned()
        };
        let Some(forma) = forma else {
            return vec![(update.id.clone(), update.state.clone())];
        };
        let foglie = forma.foglie(&update.id, &[]);
        let qf = self.qualita_foglie.read().await;
        let per_foglia = qf.get(&update.id);
        foglie
            .iter()
            .filter_map(|f| {
                let rel = f.percorso.strip_prefix(update.id.as_str())?;
                let segmenti = parse_segmenti(rel)?;
                let valore = leggi(&update.state.value, &segmenti)?.clone();
                let (quality, timestamp_ms) = per_foglia
                    .and_then(|m| m.get(rel).cloned())
                    .unwrap_or((update.state.quality.clone(), update.state.timestamp_ms));
                Some((
                    f.percorso.clone(),
                    TagState {
                        value: valore,
                        quality,
                        timestamp_ms,
                    },
                ))
            })
            .collect()
    }

    /// Marca un tag come inattendibile **senza toccarne il valore**.
    ///
    /// Serve a chi perde la sorgente. Fino al 16-09-2026 i plugin scrivevano
    /// `Float(0.0)` con qualità `Bad` per dire «non so più»: un valore
    /// inventato, che poi il resto del sistema si beveva. Nel caso che l'ha
    /// fatto scoprire, un allarme «potenza sotto 0.1 W» scattava a ogni
    /// riconnessione fallita e mandava una notifica Telegram con la pompa che
    /// girava — perché lo zero non veniva dall'impianto, veniva da noi.
    ///
    /// Ora l'ultima lettura **vera** resta dov'è, marcata vecchia: sullo
    /// schermo si vede l'ultimo dato con l'indicazione che non è fresco, che è
    /// ciò che un operatore si aspetta. Un tag mai letto non si crea: se non
    /// c'è ancora un valore non c'è niente da marcare.
    pub async fn marca_qualita(&self, id: &str, quality: TagQuality) {
        // Una foglia si marca da sola (D6): la radice prende la peggiore.
        if !self.store.read().await.contains_key(id) {
            if let Some((radice, segmenti)) = self.risolvi(id).await {
                if !segmenti.is_empty() {
                    let ts = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as u64;
                    let rel = crate::percorso::testo_segmenti(&segmenti);
                    let riepilogo = {
                        let mut qf = self.qualita_foglie.write().await;
                        let foglie = qf.entry(radice.clone()).or_default();
                        if matches!(foglie.get(&rel), Some((q, _)) if *q == quality) {
                            return;
                        }
                        foglie.insert(rel, (quality, ts));
                        Self::riepiloga(foglie)
                    };
                    let state = {
                        let mut store = self.store.write().await;
                        let Some(st) = store.get_mut(&radice) else {
                            return;
                        };
                        if let Some((q, t)) = riepilogo {
                            st.quality = q;
                            st.timestamp_ms = t;
                        }
                        st.clone()
                    };
                    let _ = self.tx.send(TagUpdate { id: radice, state });
                    return;
                }
            }
        }
        let precedente = { self.store.read().await.get(id).cloned() };
        let Some(mut state) = precedente else { return };
        if state.quality == quality {
            return;
        }
        state.quality = quality;
        state.timestamp_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        self.store
            .write()
            .await
            .insert(id.to_string(), state.clone());
        let _ = self.tx.send(TagUpdate {
            id: id.to_string(),
            state,
        });
    }

    /// Lo stato di un tag o di una **foglia** (`motore1.velocita`): per una
    /// foglia il valore è quello della foglia e la qualità è la sua (D6).
    pub async fn get(&self, id: &str) -> Option<TagState> {
        if let Some(st) = self.store.read().await.get(id).cloned() {
            return Some(st);
        }
        let (radice, segmenti) = self.risolvi(id).await?;
        let radice_st = self.store.read().await.get(&radice).cloned()?;
        if segmenti.is_empty() {
            return Some(radice_st);
        }
        let valore = leggi(&radice_st.value, &segmenti)?.clone();
        let rel = crate::percorso::testo_segmenti(&segmenti);
        let (quality, timestamp_ms) = self
            .qualita_foglie
            .read()
            .await
            .get(&radice)
            .and_then(|m| m.get(&rel).cloned())
            .unwrap_or((radice_st.quality, radice_st.timestamp_ms));
        Some(TagState {
            value: valore,
            quality,
            timestamp_ms,
        })
    }

    /// Remove a tag from the store. Returns `true` if the tag existed.
    /// Used by hot-reload to evict orphans after a project edit.
    /// Note: no "removed" event is broadcast — clients reconcile on next snapshot.
    pub async fn remove(&self, id: &str) -> bool {
        self.store.write().await.remove(id).is_some()
    }

    /// Drop every tag. Used by project switch / close to reset the in-memory
    /// store before populating the next project's tags.
    pub async fn clear(&self) {
        self.store.write().await.clear();
        self.qualita_foglie.write().await.clear();
    }

    pub fn subscribe(&self) -> broadcast::Receiver<TagUpdate> {
        self.tx.subscribe()
    }

    pub async fn snapshot(&self) -> HashMap<TagId, TagState> {
        self.store.read().await.clone()
    }

    /// Lo snapshot **espanso in foglie** (Fase 1d): le radici composite
    /// diventano N voci con l'id di percorso e la qualità della foglia, i tag
    /// piatti restano sé stessi.
    ///
    /// È la forma che va sul filo di default: i frame di `/ws/tags` sono
    /// tipizzati, e una sola voce con dentro un valore composito farebbe
    /// fallire la deserializzazione dell'**intero** pacchetto — non di quella
    /// voce. Chi vuole la radice la chiede.
    pub async fn snapshot_foglie(&self) -> HashMap<TagId, TagState> {
        let store = self.store.read().await.clone();
        let forme = self.forme.read().await;
        if forme.is_empty() {
            return store;
        }
        drop(forme);
        let mut out = HashMap::with_capacity(store.len());
        for (id, state) in store {
            let update = TagUpdate { id, state };
            for (percorso, st) in self.espandi_foglie(&update).await {
                out.insert(percorso, st);
            }
        }
        out
    }
}

// ── TagWriteBus ──────────────────────────────────────────────────────────────
//
// Routes "write this value" requests to the plugin that owns the tag.
// Plugins register a sender per tag at startup; the API handler calls
// `write()` and the value is delivered to the owning plugin's mpsc receiver,
// which talks to the field device. If no plugin owns the tag, the bus
// returns `NoWriter` — the caller may then choose to update TagDb directly
// (useful for "virtual" tags with no source).

#[derive(Debug)]
pub enum WriteError {
    NoWriter(TagId),
    ChannelClosed(TagId),
}

impl fmt::Display for WriteError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            WriteError::NoWriter(t) => write!(f, "no writer registered for tag '{t}'"),
            WriteError::ChannelClosed(t) => write!(f, "write channel for tag '{t}' closed"),
        }
    }
}

impl std::error::Error for WriteError {}

/// La conversione di Q27, pura e testabile. `Err` porta la descrizione del
/// valore ricevuto (il chiamante ci antepone tag e tipo dichiarato).
///
/// Dal 22-09-2026 la regola vive in `TipoScalare::coerce` (D5: tipi ricchi con
/// intervallo). Un `want` che non è un tipo passa tutto invariato: rifiutare
/// qui trasformerebbe un refuso nello YAML in un tag non scrivibile — quello
/// lo deve dire il validatore.
fn coerce_value(want: &str, v: TagValue) -> Result<TagValue, String> {
    match crate::tipo::TipoScalare::parse(want) {
        Some(t) => t.coerce(v),
        None => Ok(v),
    }
}

/// Una richiesta di scrittura sul bus: **l'id che il plugin ha registrato**,
/// il percorso relativo dentro quell'id, e il valore.
///
/// Il percorso è `None` per un tag piatto e per una radice scritta intera;
/// è `Some(".velocita")` o `Some("[3].stato")` quando si scrive una foglia di
/// una radice che il plugin possiede (Fase 1d). Esplicito e non «l'id è a
/// volte una radice e a volte un percorso»: chi riceve non deve indovinare
/// dove finisce l'uno e comincia l'altro, e nessun plugin riscrive la
/// divisione per conto suo.
pub type WriteRequest = (TagId, Option<String>, TagValue);

pub struct TagWriteBus {
    routes: RwLock<HashMap<TagId, mpsc::Sender<WriteRequest>>>,
}

impl Default for TagWriteBus {
    fn default() -> Self {
        Self::new()
    }
}

impl TagWriteBus {
    pub fn new() -> Self {
        Self {
            routes: RwLock::new(HashMap::new()),
        }
    }

    /// A plugin that owns `tag_id` registers its sender. Latest registration wins
    /// (so a runtime reload that re-spawns a plugin replaces the stale entry).
    pub async fn register(&self, tag_id: TagId, sender: mpsc::Sender<WriteRequest>) {
        self.routes.write().await.insert(tag_id, sender);
    }

    /// Drop all routes for the given tag ids. Called by the source supervisor
    /// when a plugin is being stopped — leaves the bus in a state where the
    /// next write to an unowned tag falls back to the direct TagDb path.
    pub async fn unregister_many(&self, tag_ids: &[TagId]) {
        let mut routes = self.routes.write().await;
        for id in tag_ids {
            routes.remove(id);
        }
    }

    /// Instrada una scrittura al plugin che possiede il tag.
    ///
    /// **Dalla mappatura più specifica alla radice** (Fase 1d): prima l'id
    /// esatto — che copre i tag piatti e le mappature a foglia di oggi —
    /// poi i prefissi via via più corti, così una radice mappata a blocco
    /// riceve anche le scritture sulle sue foglie, col percorso relativo.
    /// `NoWriter` se non la possiede nessuno: il chiamante decide il ripiego
    /// (di norma scrivere direttamente nel `TagDb`).
    pub async fn write(&self, tag_id: &str, value: TagValue) -> Result<(), WriteError> {
        let scelta = {
            let routes = self.routes.read().await;
            match routes.get(tag_id) {
                Some(s) => Some((tag_id.to_string(), None, s.clone())),
                None => candidati(tag_id).into_iter().find_map(|(radice, resto)| {
                    routes
                        .get(radice)
                        .map(|s| (radice.to_string(), Some(resto.to_string()), s.clone()))
                }),
            }
        };
        match scelta {
            None => Err(WriteError::NoWriter(tag_id.to_string())),
            Some((radice, percorso, s)) => s
                .send((radice, percorso, value))
                .await
                .map_err(|_| WriteError::ChannelClosed(tag_id.to_string())),
        }
    }
}

#[cfg(test)]
mod bus_percorsi_tests {
    use super::*;

    /// Fase 1d: il bus instrada dalla mappatura **più specifica** alla radice.
    /// Un plugin che possiede `motore1` riceve anche le scritture sulle sue
    /// foglie, col percorso relativo — e non deve dividere lui la stringa.
    #[tokio::test]
    async fn dalla_foglia_alla_radice() {
        let bus = TagWriteBus::new();
        let (tx_radice, mut rx_radice) = mpsc::channel(8);
        let (tx_foglia, mut rx_foglia) = mpsc::channel(8);
        bus.register("motore1".into(), tx_radice).await;
        bus.register("motore1.marcia".into(), tx_foglia).await;

        // una foglia con la sua mappatura: arriva lì, senza percorso
        bus.write("motore1.marcia", TagValue::Bool(true))
            .await
            .unwrap();
        assert_eq!(
            rx_foglia.recv().await.unwrap(),
            ("motore1.marcia".to_string(), None, TagValue::Bool(true))
        );

        // una foglia senza mappatura propria: alla radice, col percorso
        bus.write("motore1.velocita", TagValue::Float(1500.0))
            .await
            .unwrap();
        assert_eq!(
            rx_radice.recv().await.unwrap(),
            (
                "motore1".to_string(),
                Some(".velocita".to_string()),
                TagValue::Float(1500.0)
            )
        );

        // un indice, e un percorso più profondo
        bus.write("motore1.pid.kp", TagValue::Float(1.0))
            .await
            .unwrap();
        assert_eq!(
            rx_radice.recv().await.unwrap().1,
            Some(".pid.kp".to_string())
        );
        bus.write("motore1[2]", TagValue::Int(1)).await.unwrap();
        assert_eq!(rx_radice.recv().await.unwrap().1, Some("[2]".to_string()));

        // la radice intera: nessun percorso
        bus.write("motore1", TagValue::Struct(Default::default()))
            .await
            .unwrap();
        assert_eq!(rx_radice.recv().await.unwrap().1, None);

        // niente di niente: il chiamante decide il ripiego
        assert!(matches!(
            bus.write("altro.tag", TagValue::Int(1)).await,
            Err(WriteError::NoWriter(_))
        ));
    }
}

#[cfg(test)]
mod percorsi_tests {
    use super::*;
    use crate::project::{TagDef, TypeDef};

    fn tipi() -> Vec<TypeDef> {
        serde_yaml::from_str(
            r#"
- id: Motore
  members:
    - { name: velocita, data_type: f32 }
    - { name: marcia, data_type: bool }
"#,
        )
        .unwrap()
    }

    async fn db_con_radice() -> TagDb {
        let db = TagDb::new(16);
        let tags: Vec<TagDef> = serde_yaml::from_str(
            "- { id: motore1, type_ref: Motore }\n- { id: pv1.potenza, data_type: f64 }",
        )
        .unwrap();
        let mut forme = HashMap::new();
        for t in &tags {
            if let Some(f) = Forma::da_tag(t, &tipi()).unwrap() {
                db.set(t.id.clone(), f.valore_iniziale(), TagQuality::Uncertain)
                    .await;
                forme.insert(t.id.clone(), f);
            } else {
                db.set(t.id.clone(), t.initial_value(), TagQuality::Uncertain)
                    .await;
            }
        }
        db.set_forme(forme).await;
        db
    }

    /// **Esatto prima.** `pv1.potenza` è un id piatto con un punto dentro, e
    /// ce ne sono centinaia nei progetti: nessuna interpretazione a percorso
    /// deve rubarglielo.
    #[tokio::test]
    async fn un_id_piatto_col_punto_vince_sempre() {
        let db = db_con_radice().await;
        db.set(
            "pv1.potenza".into(),
            TagValue::Float(1234.0),
            TagQuality::Good,
        )
        .await;
        assert_eq!(
            db.get("pv1.potenza").await.unwrap().value,
            TagValue::Float(1234.0)
        );
        // e non ha creato nessuna radice «pv1»
        assert!(db.get("pv1").await.is_none());
    }

    #[tokio::test]
    async fn una_foglia_si_legge_e_si_scrive_dentro_la_radice() {
        let db = db_con_radice().await;
        assert_eq!(
            db.get("motore1.velocita").await.unwrap().value,
            TagValue::Float(0.0)
        );
        db.set(
            "motore1.velocita".into(),
            TagValue::Float(1500.0),
            TagQuality::Good,
        )
        .await;
        db.set(
            "motore1.marcia".into(),
            TagValue::Bool(true),
            TagQuality::Good,
        )
        .await;
        assert_eq!(
            db.get("motore1.velocita").await.unwrap().value,
            TagValue::Float(1500.0)
        );
        // la radice porta la struttura intera
        let radice = db.get("motore1").await.unwrap();
        let TagValue::Struct(m) = &radice.value else {
            panic!("la radice non è una struttura: {:?}", radice.value)
        };
        assert_eq!(m.get("velocita"), Some(&TagValue::Float(1500.0)));
        assert_eq!(m.get("marcia"), Some(&TagValue::Bool(true)));
        // una foglia che non esiste non si crea
        db.set(
            "motore1.inesistente".into(),
            TagValue::Int(1),
            TagQuality::Good,
        )
        .await;
        assert!(db.get("motore1.inesistente").await.is_none());
    }

    /// D6: la qualità è della foglia, la radice porta la peggiore. Con una
    /// sola qualità per radice, una mappatura a foglia guasta o marcherebbe
    /// Bad tutta la struttura o nasconderebbe il guasto.
    #[tokio::test]
    async fn la_qualita_e_della_foglia_e_la_radice_prende_la_peggiore() {
        let db = db_con_radice().await;
        db.set(
            "motore1.velocita".into(),
            TagValue::Float(1500.0),
            TagQuality::Good,
        )
        .await;
        db.set(
            "motore1.marcia".into(),
            TagValue::Bool(true),
            TagQuality::Good,
        )
        .await;
        assert_eq!(db.get("motore1").await.unwrap().quality, TagQuality::Good);

        db.marca_qualita("motore1.velocita", TagQuality::Bad).await;
        assert_eq!(
            db.get("motore1.velocita").await.unwrap().quality,
            TagQuality::Bad
        );
        assert_eq!(
            db.get("motore1.marcia").await.unwrap().quality,
            TagQuality::Good,
            "la foglia sana resta sana"
        );
        assert_eq!(
            db.get("motore1").await.unwrap().quality,
            TagQuality::Bad,
            "la radice porta la peggiore"
        );
        // il valore non si tocca, come per un tag piatto
        assert_eq!(
            db.get("motore1.velocita").await.unwrap().value,
            TagValue::Float(1500.0)
        );

        db.set(
            "motore1.velocita".into(),
            TagValue::Float(1600.0),
            TagQuality::Good,
        )
        .await;
        assert_eq!(db.get("motore1").await.unwrap().quality, TagQuality::Good);
    }

    #[tokio::test]
    async fn un_aggiornamento_si_espande_in_foglie() {
        let db = db_con_radice().await;
        let mut rx = db.subscribe();
        db.set(
            "motore1.velocita".into(),
            TagValue::Float(1500.0),
            TagQuality::Good,
        )
        .await;
        let update = rx.recv().await.unwrap();
        assert_eq!(update.id, "motore1", "sul bus viaggia la radice");
        let foglie = db.espandi_foglie(&update).await;
        let ids: Vec<&str> = foglie.iter().map(|(id, _)| id.as_str()).collect();
        assert_eq!(ids, ["motore1.velocita", "motore1.marcia"]);
        assert_eq!(foglie[0].1.value, TagValue::Float(1500.0));

        // un tag piatto si espande in sé stesso
        db.set("pv1.potenza".into(), TagValue::Float(1.0), TagQuality::Good)
            .await;
        let piatto = rx.recv().await.unwrap();
        let foglie = db.espandi_foglie(&piatto).await;
        assert_eq!(foglie.len(), 1);
        assert_eq!(foglie[0].0, "pv1.potenza");
    }

    /// Il ruolo di scrittura messo sull'istanza vale per i suoi membri.
    #[tokio::test]
    async fn il_ruolo_della_radice_copre_le_foglie() {
        let db = db_con_radice().await;
        db.set_write_roles(HashMap::from([
            ("motore1".to_string(), "Supervisor".to_string()),
            ("motore1.marcia".to_string(), "Admin".to_string()),
        ]))
        .await;
        assert_eq!(
            db.write_role_of("motore1.velocita").await.as_deref(),
            Some("Supervisor")
        );
        assert_eq!(
            db.write_role_of("motore1.marcia").await.as_deref(),
            Some("Admin"),
            "la foglia vince sulla radice"
        );
        assert_eq!(db.write_role_of("pv1.potenza").await, None);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Q27 — le conversioni senza perdita passano, il resto no.
    #[test]
    fn coerce_lossless_pass_lossy_reject() {
        use TagValue::*;
        // le tre conversioni che i client fanno davvero
        assert_eq!(coerce_value("float", Int(5)), Ok(Float(5.0)));
        assert_eq!(coerce_value("int", Float(5.0)), Ok(Int(5)));
        assert_eq!(coerce_value("bool", Str("true".into())), Ok(Bool(true)));
        assert_eq!(coerce_value("bool", Str("False".into())), Ok(Bool(false)));
        assert_eq!(coerce_value("int", Str(" 42 ".into())), Ok(Int(42)));
        assert_eq!(coerce_value("float", Str("1.5".into())), Ok(Float(1.5)));
        // le perdite e le ambiguità
        assert!(coerce_value("int", Float(1.5)).is_err());
        assert!(coerce_value("int", Float(1e30)).is_err()); // fuori range i64
        assert!(coerce_value("int", Float(f64::NAN)).is_err());
        assert!(coerce_value("bool", Str("abc".into())).is_err()); // il caso della scheda
        assert!(coerce_value("bool", Int(1)).is_err());
        assert!(coerce_value("string", Int(5)).is_err());
        assert!(coerce_value("float", Str("no".into())).is_err());
        // tipo dichiarato ignoto = nessun vincolo (lo segnala il validatore)
        assert_eq!(coerce_value("double", Str("x".into())), Ok(Str("x".into())));
        // identità
        assert_eq!(coerce_value("bool", Bool(true)), Ok(Bool(true)));
        assert_eq!(coerce_value("string", Str("s".into())), Ok(Str("s".into())));
    }

    /// Q27 — un tag fuori mappa non è vincolato; uno in mappa sì, e il
    /// messaggio nomina tag, tipo dichiarato e valore ricevuto.
    #[tokio::test]
    async fn coerce_for_write_uses_declared_map() {
        let db = TagDb::new(16);
        db.set_data_types([("b1".to_string(), "bool".to_string())].into())
            .await;
        assert_eq!(
            db.coerce_for_write("sconosciuto", TagValue::Str("x".into()))
                .await,
            Ok(TagValue::Str("x".into()))
        );
        assert_eq!(
            db.coerce_for_write("b1", TagValue::Str("true".into()))
                .await,
            Ok(TagValue::Bool(true))
        );
        let err = db
            .coerce_for_write("b1", TagValue::Str("abc".into()))
            .await
            .unwrap_err();
        assert!(
            err.contains("b1") && err.contains("bool") && err.contains("abc"),
            "{err}"
        );
    }

    /// T-69 Fase D — un tag calcolato è marcato tale; un tag fuori insieme
    /// (o dopo un reset a insieme vuoto) non è vincolato.
    #[tokio::test]
    async fn computed_tags_seguono_set_computed_tags() {
        let db = TagDb::new(16);
        assert!(!db.is_computed("rampa").await);
        db.set_computed_tags(["rampa".to_string()].into()).await;
        assert!(db.is_computed("rampa").await);
        assert!(!db.is_computed("altro").await);
        db.set_computed_tags(Default::default()).await;
        assert!(!db.is_computed("rampa").await);
    }

    #[tokio::test]
    async fn set_and_get() {
        let db = TagDb::new(16);
        db.set(
            "pump1.speed".into(),
            TagValue::Float(42.5),
            TagQuality::Good,
        )
        .await;
        let s = db.get("pump1.speed").await.unwrap();
        assert_eq!(s.value, TagValue::Float(42.5));
        assert_eq!(s.quality, TagQuality::Good);
    }

    #[tokio::test]
    async fn subscribe_receives_update() {
        let db = TagDb::new(16);
        let mut rx = db.subscribe();
        db.set("valve1.open".into(), TagValue::Bool(true), TagQuality::Good)
            .await;
        let upd = rx.recv().await.unwrap();
        assert_eq!(upd.id, "valve1.open");
        assert_eq!(upd.state.value, TagValue::Bool(true));
    }

    #[tokio::test]
    async fn write_bus_routes_to_owner() {
        let bus = TagWriteBus::new();
        let (tx, mut rx) = mpsc::channel(8);
        bus.register("pump1.speed".into(), tx).await;
        bus.write("pump1.speed", TagValue::Float(75.0))
            .await
            .unwrap();
        let got = rx.recv().await.unwrap();
        assert_eq!(
            got,
            ("pump1.speed".to_string(), None, TagValue::Float(75.0)),
            "un tag piatto arriva senza percorso"
        );
    }

    #[tokio::test]
    async fn write_bus_unknown_tag_returns_no_writer() {
        let bus = TagWriteBus::new();
        let err = bus.write("nope", TagValue::Bool(true)).await.unwrap_err();
        assert!(matches!(err, WriteError::NoWriter(_)));
    }

    #[tokio::test]
    async fn marca_qualita_non_tocca_il_valore() {
        // Il motivo per cui esiste: chi perde la sorgente deve poter dire
        // "non mi fido più" senza inventare un valore — l'ultima lettura vera
        // resta, solo la qualità cambia.
        let db = TagDb::new(16);
        db.set(
            "sim.temperature".into(),
            TagValue::Float(21.5),
            TagQuality::Good,
        )
        .await;
        db.marca_qualita("sim.temperature", TagQuality::Bad).await;
        let s = db.get("sim.temperature").await.unwrap();
        assert_eq!(s.value, TagValue::Float(21.5));
        assert_eq!(s.quality, TagQuality::Bad);
    }

    #[tokio::test]
    async fn marca_qualita_su_un_tag_mai_letto_non_crea_niente() {
        let db = TagDb::new(16);
        db.marca_qualita("mai.esistito", TagQuality::Bad).await;
        assert!(db.get("mai.esistito").await.is_none());
    }
}
