//! Le reti IPv4 a cui questa macchina è realmente attaccata.
//!
//! Serve a due lati opposti dello stesso problema, ed è per questo che sta in
//! un modulo suo invece che dentro `discover`:
//!
//! - chi **annuncia** (`announce_mdns` nel binario del runtime) deve pubblicare
//!   un indirizzo per ogni rete su cui è raggiungibile, non solo quello della
//!   rotta predefinita;
//! - chi **ascolta** (`discover::pick_address`) deve scegliere, fra gli
//!   indirizzi annunciati, uno che può davvero raggiungere.
//!
//! Perché non basta la rotta predefinita: misurato il 2026-08-24 su un WP630
//! con due schede — `ethernet0` 192.168.1.120/23 (rete d'impianto) ed
//! `ethernet1` 192.168.60.177/24 (rete di campo, metrica più bassa e quindi
//! rotta predefinita). Il runtime annunciava solo 192.168.60.177, e un IDE
//! sulla rete d'impianto non trovava nulla — pur avendo il pannello a due
//! metri e pur risolvendone il nome. Su un pannello industriale due reti sono
//! la norma, non l'eccezione.
//!
//! Perché non si annuncia tutto (`enable_addr_auto` di mdns-sd): pubblica un
//! indirizzo per **ogni** interfaccia, comprese le veth residue dei container e
//! i link-local IPv6 con `%scope`, e un client che ne pescasse uno otterrebbe
//! un URL inutilizzabile — è il difetto che T-49 aveva corretto passando a un
//! indirizzo solo. Qui si tiene il rimedio senza la malattia: tutte le reti
//! vere, nessuna plumbing.

use std::net::Ipv4Addr;

/// Un indirizzo IPv4 locale con la sua maschera, cioè una rete a cui siamo
/// attaccati.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LocalNet {
    pub addr: Ipv4Addr,
    pub netmask: Ipv4Addr,
}

impl LocalNet {
    /// Vero se `other` sta nella stessa sottorete di questo indirizzo.
    pub fn contains(&self, other: Ipv4Addr) -> bool {
        let (a, b, m) = (
            u32::from(self.addr),
            u32::from(other),
            u32::from(self.netmask),
        );
        // Una maschera nulla abbraccerebbe l'intero spazio di indirizzi e
        // farebbe passare qualunque cosa per "stessa rete": non è una rete
        // configurata, è un'interfaccia senza informazione utile.
        m != 0 && (a & m) == (b & m)
    }
}

/// Interfacce che non sono reti su cui un altro PC possa trovarci: sono
/// impalcatura di container o di virtualizzazione. Il confronto è sul prefisso
/// del nome perché è così che le nominano podman, docker e libvirt.
const PLUMBING_PREFIXES: [&str; 7] = ["veth", "docker", "podman", "cni-", "br-", "virbr", "tun"];

fn is_plumbing(name: &str) -> bool {
    PLUMBING_PREFIXES.iter().any(|p| name.starts_with(p))
}

/// Vero per un indirizzo che non ha senso annunciare né scegliere: loopback
/// (inutile da un'altra macchina), link-local 169.254/16 (autoconfigurazione
/// senza DHCP, raramente la strada buona), broadcast e non specificato.
fn is_unusable(a: Ipv4Addr) -> bool {
    a.is_loopback() || a.is_link_local() || a.is_broadcast() || a.is_unspecified()
}

/// Tutte le reti IPv4 vere di questa macchina, ordinate per indirizzo così che
/// due chiamate diano lo stesso risultato — l'elenco finisce in un annuncio
/// mDNS, e un ordine ballerino renderebbe l'annuncio diverso a ogni riavvio.
///
/// Elenco vuoto se l'enumerazione fallisce: chi chiama deve avere un ripiego,
/// non dare per scontato che ci sia almeno un indirizzo.
pub fn local_nets() -> Vec<LocalNet> {
    let Ok(ifaces) = if_addrs::get_if_addrs() else {
        return Vec::new();
    };
    let mut out: Vec<LocalNet> = ifaces
        .into_iter()
        .filter(|i| !is_plumbing(&i.name))
        .filter_map(|i| match i.addr {
            if_addrs::IfAddr::V4(v4) if !is_unusable(v4.ip) => Some(LocalNet {
                addr: v4.ip,
                netmask: v4.netmask,
            }),
            _ => None,
        })
        .collect();
    out.sort_by_key(|n| u32::from(n.addr));
    out.dedup_by_key(|n| n.addr);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn net(addr: &str, mask: &str) -> LocalNet {
        LocalNet { addr: addr.parse().unwrap(), netmask: mask.parse().unwrap() }
    }

    /// Il caso del WP630: /23 significa che 192.168.0.x e 192.168.1.x sono la
    /// stessa rete. Sbagliarlo (assumendo /24) farebbe scartare proprio
    /// l'indirizzo giusto.
    #[test]
    fn la_maschera_23_unisce_due_terzetti() {
        let n = net("192.168.0.201", "255.255.254.0");
        assert!(n.contains("192.168.1.120".parse().unwrap()));
        assert!(n.contains("192.168.0.5".parse().unwrap()));
        assert!(!n.contains("192.168.60.177".parse().unwrap()));
    }

    #[test]
    fn reti_diverse_non_si_contengono() {
        let n = net("192.168.60.177", "255.255.255.0");
        assert!(!n.contains("192.168.1.120".parse().unwrap()));
        assert!(n.contains("192.168.60.9".parse().unwrap()));
    }

    #[test]
    fn maschera_nulla_non_abbraccia_tutto() {
        let n = net("10.0.0.1", "0.0.0.0");
        assert!(!n.contains("192.168.1.1".parse().unwrap()),
            "una maschera nulla non è una rete configurata: non deve far passare qualunque indirizzo");
    }

    #[test]
    fn le_interfacce_dei_container_sono_impalcatura() {
        for name in ["veth58fbd0f", "docker0", "podman1", "cni-podman0", "br-1a2b", "virbr0"] {
            assert!(is_plumbing(name), "{name} andrebbe scartata");
        }
        for name in ["eth0", "ethernet0", "ethernet1", "ens192", "wlan0", "enp3s0"] {
            assert!(!is_plumbing(name), "{name} è una rete vera");
        }
    }

    #[test]
    fn loopback_e_link_local_non_si_annunciano() {
        assert!(is_unusable("127.0.0.1".parse().unwrap()));
        assert!(is_unusable("169.254.10.3".parse().unwrap()));
        assert!(is_unusable("0.0.0.0".parse().unwrap()));
        assert!(!is_unusable("192.168.1.120".parse().unwrap()));
        assert!(!is_unusable("10.20.30.40".parse().unwrap()));
    }
}
