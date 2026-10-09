//! La revisione git, compilata dentro il binario.
//!
//! PERCHÉ ESISTE
//!
//! Il 09-10-2026 il maintainer ha chiesto «una data/ora di build e una
//! revisione» nella console, per non dover più indovinare se quello che vede
//! è aggiornato. Il commit oggi esiste in un posto solo — il **tag**
//! dell'immagine nel registry (`scripts/build_container.sh`), e solo se
//! l'immagine è stata pushata: il processo in esecuzione non lo conosce.
//!
//! **La data NON si emette qui**, ed è una scelta. `build.rs` viene rieseguito
//! solo quando cambia uno dei suoi `rerun-if-changed`: un timestamp scritto
//! qui resterebbe quello della prima compilazione e mentirebbe a ogni
//! ricompilazione successiva — che è esattamente il dubbio che si vuole
//! togliere. La data di build è la **mtime del binario**, che il runtime legge
//! da sé ed è vera per costruzione (vedi `system.rs`).
//!
//! Qui si emette solo la revisione, che invece cambia solo quando cambia
//! `HEAD` — e quello `rerun-if-changed` lo sa intercettare.

use std::process::Command;

fn main() {
    // Si rilegge quando cambia il commit o l'indice. Non intercetta una
    // modifica non ancora messa in staging: per quella c'è la data, che in
    // sviluppo è l'informazione che conta davvero.
    for f in [".git/HEAD", ".git/index"] {
        // Il percorso è relativo alla radice del repo, non al crate.
        println!("cargo:rerun-if-changed=../../../{f}");
    }

    let sha = Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    // Senza git — la build del container copia i sorgenti, non `.git` — si
    // dichiara di non saperlo invece di inventare un valore. Un «sconosciuta»
    // onesto è leggibile; un trattino muto fa pensare a un difetto.
    println!(
        "cargo:rustc-env=SWS_GIT_SHA={}",
        sha.unwrap_or_else(|| "sconosciuta".into())
    );
}
