use axum::{response::IntoResponse, Json};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use std::time::{Duration, Instant};

#[derive(Serialize)]
pub struct DiscoveredRuntime {
    name: String,
    /// Hostname mDNS pulito (es. `tc620-a-p3-c6-07aff9.local`, senza il punto
    /// finale FQDN che `mdns-sd` restituisce) — stabile nel tempo a differenza
    /// dell'IP (che può cambiare per DHCP). Usato lato frontend per "Host SSH"
    /// (risolto dal resolver del sistema operativo del backend, non dal
    /// browser: `.local` lì funziona in modo affidabile solo se l'host ha
    /// Avahi/nss-mdns/systemd-resolved configurato per mDNS). `admin_url`/
    /// `viewer_url` restano IP-based apposta: sono risolti dal browser, dove
    /// il supporto `.local` per fetch/WebSocket è incoerente tra sistemi.
    hostname: String,
    admin_url: String,
    viewer_url: String,
    version: Option<String>,
    /// Motore del container (`podman`, `docker`, o `container` generico) quando
    /// il runtime gira dentro un container; `None` quando gira nudo sull'host
    /// **oppure** quando è più vecchio di questa proprietà. I due casi non si
    /// distinguono di proposito: annunciare "nativo" per un runtime che
    /// semplicemente non lo dice sarebbe un'affermazione senza prove.
    container: Option<String>,
}

/// Scegli l'indirizzo da offrire, preferendo un IPv4 raggiungibile dalla rete.
///
/// Serve perché `enable_addr_auto()` annuncia **tutti** gli indirizzi
/// dell'host, loopback compreso, e `get_addresses_v4()` restituisce un
/// `HashSet`: prendere il primo che capita dava un URL diverso a ogni giro, e
/// una volta su tre `127.0.0.1` — inutilizzabile da un'altra macchina, che è
/// esattamente il caso d'uso di questa funzione. L'ordinamento non è
/// cosmetico: rende la scelta ripetibile, altrimenti la deduplica per nome
/// terrebbe la prima risposta arrivata e quindi un indirizzo a caso.
///
/// Dal 2026-08-24 la scelta non è più solo alfabetica. Un runtime annuncia un
/// indirizzo per ogni rete a cui è attaccato (vedi `netif`), e su un pannello
/// industriale sono spesso due: rete d'impianto e rete di campo. L'ordine
/// alfabetico ne prendeva uno a caso — che sull'unico caso reale disponibile
/// era per fortuna quello giusto, ma `10.x` avrebbe battuto `192.168.x` senza
/// alcun motivo. Si preferisce quindi un indirizzo che stia in una delle reti
/// di **questa** macchina: è l'unico che si può davvero raggiungere.
fn pick_address(v4: &[String], any: &[String]) -> Option<String> {
    pick_address_from(v4, any, &crate::netif::local_nets())
}

fn pick_address_from(
    v4: &[String],
    any: &[String],
    local: &[crate::netif::LocalNet],
) -> Option<String> {
    let mut routable: Vec<&String> = v4.iter().filter(|a| !is_loopback(a)).collect();
    routable.sort();
    // Stessa sottorete di una nostra interfaccia: è raggiungibile senza passare
    // da un instradamento che potrebbe non esistere.
    let mut reachable: Vec<&&String> = routable
        .iter()
        .filter(|a| {
            a.parse::<std::net::Ipv4Addr>()
                .map(|ip| local.iter().any(|n| n.contains(ip)))
                .unwrap_or(false)
        })
        .collect();
    reachable.sort();
    if let Some(a) = reachable.first() {
        return Some((**a).clone());
    }
    if let Some(a) = routable.first() {
        return Some((*a).clone());
    }
    let mut all_v4: Vec<&String> = v4.iter().collect();
    all_v4.sort();
    if let Some(a) = all_v4.first() {
        return Some((*a).clone());
    }
    let mut rest: Vec<&String> = any.iter().filter(|a| !is_loopback(a)).collect();
    rest.sort();
    rest.first().map(|a| (*a).clone()).or_else(|| {
        let mut all: Vec<&String> = any.iter().collect();
        all.sort();
        all.first().map(|a| (*a).clone())
    })
}

fn is_loopback(addr: &str) -> bool {
    addr.starts_with("127.") || addr == "::1"
}

/// Una risposta successiva per lo stesso servizio va preferita solo se porta un
/// indirizzo raggiungibile al posto di un loopback.
///
/// Non è teoria: mdns-sd consegna `ServiceResolved` man mano che impara gli
/// indirizzi, e la **prima** risposta può portare solo `127.0.0.1`. Tenendo
/// sempre la prima, un runtime su un'altra macchina finiva offerto come
/// `http://127.0.0.1:8444` — misurato, capitava circa due volte su tre.
fn prefer_new_address(old: &str, new: &str) -> bool {
    is_loopback(old) && !is_loopback(new)
}

/// GET /api/discover — browse mDNS for _sws._tcp.local. services for ~2 s.
/// Returns an array of runtimes found on the LAN.
pub async fn discover_runtimes() -> impl IntoResponse {
    let runtimes = tokio::task::spawn_blocking(|| browse_mdns_blocking(2))
        .await
        .unwrap_or_default();
    Json(runtimes)
}

fn browse_mdns_blocking(timeout_secs: u64) -> Vec<DiscoveredRuntime> {
    use mdns_sd::{ServiceDaemon, ServiceEvent};

    let daemon = match ServiceDaemon::new() {
        Ok(d) => d,
        Err(_) => return vec![],
    };

    let receiver = match daemon.browse("_sws._tcp.local.") {
        Ok(r) => r,
        Err(_) => return vec![],
    };

    let mut runtimes: Vec<DiscoveredRuntime> = Vec::new();
    // Un servizio produce più `ServiceResolved` nella stessa finestra di
    // ascolto, uno per risposta ricevuta: senza questa mappa lo stesso runtime
    // compariva tre volte nell'elenco (misurato in locale).
    //
    // Non basta però scartare i doppioni: le risposte non sono equivalenti, e
    // la prima può portare solo il loopback. Si tiene quindi l'indirizzo scelto
    // per ogni nome, così una risposta successiva può promuovere la voce a un
    // indirizzo raggiungibile.
    let mut seen: HashMap<String, (usize, String)> = HashMap::new();
    let deadline = Instant::now() + Duration::from_secs(timeout_secs);

    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            break;
        }
        match receiver.recv_timeout(remaining) {
            Ok(ServiceEvent::ServiceResolved(info)) => {
                let fullname = info.get_fullname().to_string();
                let hostname = info.get_hostname().trim_end_matches('.').to_string();
                let viewer_port = info.get_port();
                let admin_port: u16 = info
                    .get_property_val_str("admin_port")
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(8444);
                let version = info.get_property_val_str("version").map(str::to_string);
                // Default "https" per i runtime che non annunciano lo schema
                // (versioni precedenti a questo campo).
                let scheme = info.get_property_val_str("scheme").unwrap_or("https");
                let container = info
                    .get_property_val_str("container")
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string);

                let v4: Vec<String> = info
                    .get_addresses_v4()
                    .into_iter()
                    .map(|a| a.to_string())
                    .collect();
                let ip = pick_address(
                    &v4,
                    &info
                        .get_addresses()
                        .iter()
                        .map(|a| a.to_string())
                        .collect::<Vec<_>>(),
                );

                // Una risposta senza indirizzo non è utilizzabile e viene
                // lasciata cadere senza registrarla, altrimenti scarterebbe
                // come duplicata la risposta successiva che l'indirizzo ce l'ha.
                let Some(ip) = ip else { continue };

                let entry = DiscoveredRuntime {
                    name: fullname.clone(),
                    hostname: hostname.clone(),
                    admin_url: format!("{}://{}:{}", scheme, ip, admin_port),
                    viewer_url: format!("{}://{}:{}", scheme, ip, viewer_port),
                    version,
                    container,
                };

                match seen.get(&fullname) {
                    None => {
                        seen.insert(fullname, (runtimes.len(), ip));
                        runtimes.push(entry);
                    }
                    Some((idx, old_ip)) if prefer_new_address(old_ip, &ip) => {
                        let idx = *idx;
                        runtimes[idx] = entry;
                        seen.insert(fullname, (idx, ip));
                    }
                    Some(_) => {}
                }
            }
            Ok(_) => {}
            Err(_) => break,
        }
    }

    let _ = daemon.shutdown();
    runtimes
}

#[cfg(test)]
mod tests {
    use super::{pick_address, pick_address_from, prefer_new_address};
    use crate::netif::LocalNet;

    fn lan(addr: &str, mask: &str) -> LocalNet {
        LocalNet {
            addr: addr.parse().unwrap(),
            netmask: mask.parse().unwrap(),
        }
    }

    fn v(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    /// Il caso che ha motivato la funzione: l'annuncio porta loopback e LAN
    /// insieme, e va offerto l'indirizzo che un'altra macchina può usare.
    #[test]
    fn preferisce_l_indirizzo_di_rete_al_loopback() {
        assert_eq!(
            pick_address(&v(&["127.0.0.1", "192.168.0.201"]), &[]),
            Some("192.168.0.201".to_string())
        );
    }

    /// Con più indirizzi di rete la scelta dev'essere ripetibile: la deduplica
    /// per nome tiene la prima risposta, e un ordine casuale renderebbe l'URL
    /// offerto diverso a ogni ricerca.
    #[test]
    fn la_scelta_e_deterministica_con_piu_indirizzi() {
        let a = pick_address(&v(&["192.168.60.200", "192.168.1.84"]), &[]);
        let b = pick_address(&v(&["192.168.1.84", "192.168.60.200"]), &[]);
        assert_eq!(a, b);
        assert_eq!(a, Some("192.168.1.84".to_string()));
    }

    /// Un runtime raggiungibile solo in loopback (istanza di sviluppo sulla
    /// stessa macchina) resta utilizzabile: meglio 127.0.0.1 che niente.
    #[test]
    fn ripiega_sul_loopback_quando_non_c_e_altro() {
        assert_eq!(
            pick_address(&v(&["127.0.0.1"]), &[]),
            Some("127.0.0.1".to_string())
        );
    }

    #[test]
    fn usa_gli_altri_indirizzi_quando_non_ci_sono_ipv4() {
        assert_eq!(
            pick_address(&[], &v(&["::1", "fe80::1"])),
            Some("fe80::1".to_string())
        );
    }

    #[test]
    fn senza_alcun_indirizzo_non_produce_una_voce() {
        assert_eq!(pick_address(&[], &[]), None);
    }

    /// Il caso del WP630: due schede, e solo una è sulla nostra rete. L'ordine
    /// alfabetico qui darebbe la risposta giusta per caso — questo test la
    /// vuole per costruzione.
    #[test]
    fn preferisce_l_indirizzo_sulla_nostra_stessa_rete() {
        let locali = [lan("192.168.0.201", "255.255.254.0")];
        assert_eq!(
            pick_address_from(&v(&["192.168.60.177", "192.168.1.120"]), &[], &locali),
            Some("192.168.1.120".to_string())
        );
    }

    /// Senza il criterio della sottorete questo caso sceglierebbe 10.8.0.3,
    /// che sta prima in ordine alfabetico e non è raggiungibile.
    #[test]
    fn la_sottorete_batte_l_ordine_alfabetico() {
        let locali = [lan("192.168.0.201", "255.255.254.0")];
        assert_eq!(
            pick_address_from(&v(&["10.8.0.3", "192.168.1.120"]), &[], &locali),
            Some("192.168.1.120".to_string())
        );
    }

    /// Nessun indirizzo annunciato è sulle nostre reti: si offre comunque
    /// qualcosa, perché un instradamento fra le due reti può esistere lo
    /// stesso. Meglio un URL da provare che nessuna voce nell'elenco.
    #[test]
    fn ripiega_sull_ordine_alfabetico_se_niente_e_vicino() {
        let locali = [lan("192.168.0.201", "255.255.254.0")];
        assert_eq!(
            pick_address_from(&v(&["10.8.0.3", "172.16.4.9"]), &[], &locali),
            Some("10.8.0.3".to_string())
        );
    }

    /// Senza informazioni sulle reti locali (enumerazione fallita) il
    /// comportamento deve restare quello di prima, non peggiorare.
    #[test]
    fn senza_reti_locali_resta_il_comportamento_precedente() {
        assert_eq!(
            pick_address_from(&v(&["10.8.0.3", "192.168.1.120"]), &[], &[]),
            Some("10.8.0.3".to_string())
        );
    }

    /// La prima risposta per un servizio può portare solo il loopback: quando
    /// ne arriva una con l'indirizzo di rete, la voce va promossa.
    #[test]
    fn promuove_la_voce_quando_arriva_un_indirizzo_raggiungibile() {
        assert!(prefer_new_address("127.0.0.1", "192.168.0.201"));
    }

    /// Le altre combinazioni non devono muovere niente, altrimenti l'elenco
    /// cambierebbe a ogni risposta ricevuta.
    #[test]
    fn non_retrocede_ne_rimpiazza_a_parita_di_qualita() {
        assert!(!prefer_new_address("192.168.0.201", "127.0.0.1"));
        assert!(!prefer_new_address("192.168.0.201", "192.168.60.200"));
        assert!(!prefer_new_address("127.0.0.1", "127.0.0.1"));
    }
}

// ── Q52: la tabella dei dispositivi in rete, non solo i runtime SWS ────────────
//
// «SWS è agnostico: il runtime devo poterlo installare su un qualsiasi dispositivo
// che trovo in rete. Con mDNS mi dai una tabella dei dispositivi, se lo riconosco
// lo seleziono» (maintainer, 2026-09-09). Quindi niente filtro per produttore e
// niente elenco di modelli: si ascoltano i tipi di servizio che una macchina
// Linux annuncia di solito (ssh e sftp con Avahi `publish-ssh`, `workstation`
// che Avahi annuncia di default), più `_sws._tcp` per dire «qui SWS c'è già».
// La macchina la riconosce l'utente dal nome; a dire se è pronta ci pensa la
// sonda (`sonda.rs`), dopo, con le credenziali.
//
// Limite dichiarato: mDNS mostra solo chi si annuncia. Una macchina senza Avahi
// né systemd-resolved non compare e si inserisce a mano, come oggi.
//
// Niente meta-query `_services._dns-sd._udp`: mdns-sd la accetta, ma poi
// tratta i tipi trovati come istanze da risolvere, e la lista che interessa è
// comunque fissa. Quattro `browse` concorrenti sullo stesso daemon bastano.

/// Tipo mDNS → nome breve in tabella.
const TIPI_SERVIZIO: &[(&str, &str)] = &[
    ("_ssh._tcp.local.", "ssh"),
    ("_sftp-ssh._tcp.local.", "sftp"),
    ("_workstation._tcp.local.", "workstation"),
    ("_sws._tcp.local.", "sws"),
];

/// Un `ServiceResolved` ridotto a ciò che serve al raggruppamento. È un tipo a
/// sé, e non l'oggetto di mdns-sd, perché così `raggruppa_per_host` è pura e si
/// prova senza rete.
pub(crate) struct Osservazione {
    pub servizio: &'static str,
    pub host: String,
    pub port: u16,
    pub v4: Vec<String>,
    pub any: Vec<String>,
    pub txt: HashMap<String, String>,
}

#[derive(Serialize, Debug, PartialEq, Default)]
pub struct SwsPresente {
    pub presente: bool,
    pub versione: Option<String>,
    pub container: Option<String>,
    pub admin_url: Option<String>,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct DispositivoLan {
    pub hostname: String,
    pub indirizzo: String,
    pub servizi: Vec<&'static str>,
    pub sws: SwsPresente,
}

/// GET /api/discover/dispositivi — ~3 s di ascolto, tutti gli host che
/// annunciano ssh/sftp/workstation/sws, uno per riga.
pub async fn discover_dispositivi() -> impl IntoResponse {
    let dispositivi = tokio::task::spawn_blocking(|| browse_dispositivi_blocking(3))
        .await
        .unwrap_or_default();
    Json(dispositivi)
}

fn browse_dispositivi_blocking(timeout_secs: u64) -> Vec<DispositivoLan> {
    use mdns_sd::{ServiceDaemon, ServiceEvent};

    let daemon = match ServiceDaemon::new() {
        Ok(d) => d,
        Err(_) => return vec![],
    };
    let ricevitori: Vec<(&'static str, _)> = TIPI_SERVIZIO
        .iter()
        .filter_map(|(tipo, nome)| daemon.browse(tipo).ok().map(|r| (*nome, r)))
        .collect();
    if ricevitori.is_empty() {
        let _ = daemon.shutdown();
        return vec![];
    }

    let mut oss: Vec<Osservazione> = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(timeout_secs);
    // Quattro ricevitori e nessun `select` esportato da mdns-sd: si passano in
    // giro con `try_recv` e ci si ferma un attimo quando nessuno ha niente.
    while Instant::now() < deadline {
        let mut fermo = true;
        for (nome, r) in &ricevitori {
            while let Ok(ev) = r.try_recv() {
                fermo = false;
                if let ServiceEvent::ServiceResolved(info) = ev {
                    oss.push(Osservazione {
                        servizio: nome,
                        host: info.get_hostname().to_string(),
                        port: info.get_port(),
                        v4: info
                            .get_addresses_v4()
                            .into_iter()
                            .map(|a| a.to_string())
                            .collect(),
                        any: info.get_addresses().iter().map(|a| a.to_string()).collect(),
                        txt: info
                            .get_properties()
                            .iter()
                            .map(|p| (p.key().to_string(), p.val_str().to_string()))
                            .collect(),
                    });
                }
            }
        }
        if fermo {
            std::thread::sleep(Duration::from_millis(25));
        }
    }
    let _ = daemon.shutdown();
    raggruppa_per_host(oss, &crate::netif::local_nets())
}

/// Le TXT di un runtime SWS, con le stesse regole di `browse_mdns_blocking`:
/// porta admin 8444 e schema https se non dichiarati, `container` solo se non
/// vuoto.
fn sws_da_txt(txt: &HashMap<String, String>, ip: &str) -> SwsPresente {
    let admin_port: u16 = txt
        .get("admin_port")
        .and_then(|s| s.parse().ok())
        .unwrap_or(8444);
    let scheme = txt.get("scheme").map(String::as_str).unwrap_or("https");
    SwsPresente {
        presente: true,
        versione: txt.get("version").cloned(),
        container: txt
            .get("container")
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
        admin_url: Some(format!("{scheme}://{ip}:{admin_port}")),
    }
}

/// Un host, una riga: unione dei servizi visti e degli indirizzi, l'indirizzo
/// scelto con le stesse preferenze di `pick_address` (rete locale prima), chi
/// non ha indirizzo si scarta come oggi. Uscita ordinata per nome, così due
/// scansioni uguali danno la stessa tabella.
pub(crate) fn raggruppa_per_host(
    oss: Vec<Osservazione>,
    local: &[crate::netif::LocalNet],
) -> Vec<DispositivoLan> {
    struct Acc {
        hostname: String,
        v4: Vec<String>,
        any: Vec<String>,
        servizi: Vec<&'static str>,
        sws_txt: Option<HashMap<String, String>>,
    }
    let mut per_host: BTreeMap<String, Acc> = BTreeMap::new();
    for o in oss {
        let hostname = o.host.trim_end_matches('.').to_string();
        let chiave = hostname.to_lowercase();
        let acc = per_host.entry(chiave).or_insert_with(|| Acc {
            hostname,
            v4: Vec::new(),
            any: Vec::new(),
            servizi: Vec::new(),
            sws_txt: None,
        });
        acc.v4.extend(o.v4);
        acc.any.extend(o.any);
        if !acc.servizi.contains(&o.servizio) {
            acc.servizi.push(o.servizio);
        }
        if o.servizio == "sws" {
            let _ = o.port; // la porta del viewer non serve in tabella
            acc.sws_txt = Some(o.txt);
        }
    }
    per_host
        .into_values()
        .filter_map(|mut acc| {
            let ip = pick_address_from(&acc.v4, &acc.any, local)?;
            acc.servizi.sort_unstable();
            let sws = acc
                .sws_txt
                .as_ref()
                .map(|t| sws_da_txt(t, &ip))
                .unwrap_or_default();
            Some(DispositivoLan {
                hostname: acc.hostname,
                indirizzo: ip,
                servizi: acc.servizi,
                sws,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests_dispositivi {
    use super::*;

    fn oss(servizio: &'static str, host: &str, v4: &[&str]) -> Osservazione {
        Osservazione {
            servizio,
            host: host.to_string(),
            port: 22,
            v4: v4.iter().map(|s| s.to_string()).collect(),
            any: v4.iter().map(|s| s.to_string()).collect(),
            txt: HashMap::new(),
        }
    }

    #[test]
    fn raggruppa_i_servizi_dello_stesso_host_anche_con_maiuscole_diverse() {
        let d = raggruppa_per_host(
            vec![
                oss("ssh", "TC620.local.", &["192.168.1.20"]),
                oss("workstation", "tc620.local.", &["192.168.1.20"]),
                oss("ssh", "tc620.local.", &["192.168.1.20"]),
            ],
            &[],
        );
        assert_eq!(d.len(), 1);
        assert_eq!(d[0].hostname, "TC620.local");
        assert_eq!(d[0].servizi, vec!["ssh", "workstation"]);
        assert_eq!(d[0].indirizzo, "192.168.1.20");
        assert!(!d[0].sws.presente);
    }

    #[test]
    fn sws_presente_porta_versione_container_e_admin_url() {
        let mut o = oss("sws", "wp630.local.", &["192.168.1.50"]);
        o.txt.insert("version".into(), "2.7.1".into());
        o.txt.insert("container".into(), "podman".into());
        o.txt.insert("admin_port".into(), "8444".into());
        o.txt.insert("scheme".into(), "https".into());
        let d = raggruppa_per_host(vec![oss("ssh", "wp630.local.", &["192.168.1.50"]), o], &[]);
        assert_eq!(d.len(), 1);
        assert_eq!(
            d[0].sws,
            SwsPresente {
                presente: true,
                versione: Some("2.7.1".into()),
                container: Some("podman".into()),
                admin_url: Some("https://192.168.1.50:8444".into()),
            }
        );
        assert_eq!(d[0].servizi, vec!["ssh", "sws"]);
    }

    #[test]
    fn host_senza_indirizzo_non_compare() {
        let d = raggruppa_per_host(vec![oss("ssh", "fantasma.local.", &[])], &[]);
        assert!(d.is_empty());
    }

    #[test]
    fn l_uscita_e_ordinata_per_hostname() {
        let d = raggruppa_per_host(
            vec![
                oss("ssh", "zeta.local.", &["10.0.0.2"]),
                oss("ssh", "alfa.local.", &["10.0.0.1"]),
            ],
            &[],
        );
        let nomi: Vec<&str> = d.iter().map(|x| x.hostname.as_str()).collect();
        assert_eq!(nomi, vec!["alfa.local", "zeta.local"]);
    }
}
