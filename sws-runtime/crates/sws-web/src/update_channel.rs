//! The update channel chosen from the IDE (25-11-2026, plan
//! `docs/plans/2026-11-25-cambio-di-canale-dal-cloud.md`).
//!
//! The channel of a panel is the tag of its image: `latest-<arch>` stable,
//! `rc-<arch>` test, `dev-<arch>` development (`aggiornamento::canale`). Until
//! 25-11-2026 the only way to change it was a reinstallation over SSH, which
//! the cloud cannot do. Now an Admin chooses the channel from the IDE:
//!
//! - when the chosen channel has a version **higher** than the one that runs,
//!   the panel switches at once: the data snapshot, then the installer in a
//!   transient user service (the same road as the quadlet update) rewrites
//!   `Image=` and `SWS_IMAGE` with the channel's tag, pulls the image and
//!   restarts;
//! - otherwise the panel **never goes down a version** (maintainer's
//!   decision): the chosen channel is written in [`FILE`] and the image stays.
//!   The update status reads the chosen channel, and the first «Update now»
//!   (or scheduled update) that finds a higher version makes the switch.
//!
//! A panel with a fixed version or installed from an archive can choose a
//! channel too: the architecture comes from its tag, the registry is the
//! public one.

use crate::aggiornamento::{Canale, Riferimento};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// The chosen channel, in the config folder, while it waits for a version
/// higher than the one that runs.
pub const FILE: &str = "update_channel.json";

/// The public registry, for a panel installed from an archive.
pub const DEFAULT_IMAGE: &str = "ghcr.io/soligolab/sws-runtime";

/// The architectures in the image tags, the longest first (`arm64-generic`
/// ends with `arm64` too).
const ARCHES: [&str; 3] = ["arm64-generic", "arm64", "amd64"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
struct Chosen {
    channel: Canale,
    since_ms: i64,
}

/// The channel named by the API: `stable`, `test`, `dev`.
pub fn parse(name: &str) -> Option<Canale> {
    match name {
        "stable" => Some(Canale::Stabile),
        "test" => Some(Canale::Prova),
        "dev" => Some(Canale::Sviluppo),
        _ => None,
    }
}

/// The architecture at the end of an image tag: `latest-arm64`,
/// `2.27.0-dev.3-arm64`, `a570b64b-amd64`, `…-arm64-generic`.
pub fn arch_of(tag: &str) -> Option<&'static str> {
    ARCHES
        .iter()
        .copied()
        .find(|a| tag == *a || tag.ends_with(&format!("-{a}")))
}

/// The moving tag of a channel for an architecture.
pub fn channel_tag(channel: &Canale, arch: &str) -> Option<String> {
    let prefix = match channel {
        Canale::Stabile => "latest",
        Canale::Prova => "rc",
        Canale::Sviluppo => "dev",
        _ => return None,
    };
    Some(format!("{prefix}-{arch}"))
}

/// The registry reference of the chosen channel for the image that runs: same
/// registry and repository (the public ones for an archive), the channel's tag
/// with the image's architecture. `None` if the image says no architecture.
pub fn target(image: &str, channel: &Canale) -> Option<(Riferimento, String)> {
    let r = crate::aggiornamento::scomponi(image)?;
    // `arm64-generic` is an alias that only the releases carry: `rc-` and
    // `dev-arm64-generic` do not exist (review of 25-11-2026).
    let arch = match arch_of(&r.tag)? {
        "arm64-generic" => "arm64",
        a => a,
    };
    let tag = channel_tag(channel, arch)?;
    let r = if r.host == "localhost" {
        crate::aggiornamento::scomponi(&format!("{DEFAULT_IMAGE}:{tag}"))?
    } else {
        Riferimento {
            host: r.host,
            repo: r.repo,
            tag,
        }
    };
    Some((r, arch.to_string()))
}

/// The full image reference of a registry reference.
pub fn image_ref(r: &Riferimento) -> String {
    format!("{}/{}:{}", r.host, r.repo, r.tag)
}

/// The chosen channel waiting in `config_dir`, if there is one.
pub async fn read(config_dir: &Path) -> Option<Canale> {
    let text = tokio::fs::read_to_string(config_dir.join(FILE))
        .await
        .ok()?;
    serde_json::from_str::<Chosen>(&text)
        .ok()
        .map(|c| c.channel)
}

/// Writes the chosen channel (atomic: a temporary file, then a rename).
pub async fn write(config_dir: &Path, channel: &Canale) -> Result<(), String> {
    let chosen = Chosen {
        channel: channel.clone(),
        since_ms: chrono::Utc::now().timestamp_millis(),
    };
    let text = serde_json::to_string_pretty(&chosen).map_err(|e| e.to_string())?;
    let tmp = config_dir.join(format!("{FILE}.tmp"));
    tokio::fs::write(&tmp, text)
        .await
        .map_err(|e| format!("{}: {e}", tmp.display()))?;
    tokio::fs::rename(&tmp, config_dir.join(FILE))
        .await
        .map_err(|e| format!("{FILE}: {e}"))
}

/// Forgets the chosen channel: the image follows its own channel again.
pub async fn clear(config_dir: &Path) {
    let _ = tokio::fs::remove_file(config_dir.join(FILE)).await;
}

/// The chosen channel that still waits: the file says one, and the image does
/// not follow it yet. A file that names the image's own channel is removed
/// (the switch happened, or the choice was taken back).
pub async fn waiting(config_dir: &Path, image_channel: &Canale) -> Option<Canale> {
    let chosen = read(config_dir).await?;
    if &chosen == image_channel {
        clear(config_dir).await;
        return None;
    }
    Some(chosen)
}

/// What a channel choice does, given the version that runs and the highest
/// version of the chosen channel (`aggiornamento::migliore_nel_canale`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    /// The chosen channel is the image's own: nothing waits any more.
    Same,
    /// The chosen channel has a higher version: switch now.
    SwitchNow,
    /// Nothing higher yet: the channel waits, the image stays (never down).
    Wait,
}

pub fn decide(
    image_channel: &Canale,
    chosen: &Canale,
    current: Option<&crate::aggiornamento::Versione>,
    top: Option<&crate::aggiornamento::Versione>,
) -> Decision {
    if image_channel == chosen {
        return Decision::Same;
    }
    match (top, current) {
        (Some(t), Some(c)) if t > c => Decision::SwitchNow,
        // The version that runs cannot be read (a development build): any
        // version of the channel is a step forward.
        (Some(_), None) => Decision::SwitchNow,
        _ => Decision::Wait,
    }
}

/// The version behind the channel's moving tag: what a switch would install.
/// The decision uses this, not the highest version tag of the registry: a
/// moving tag left behind by a build (registry not answering) would otherwise
/// mean a step down (review of 25-11-2026).
pub async fn moving_version(r: &Riferimento) -> Result<crate::aggiornamento::Versione, String> {
    let labels = crate::aggiornamento::etichette(r, &r.tag).await?;
    labels
        .get("org.opencontainers.image.version")
        .and_then(|v| crate::aggiornamento::Versione::leggi(v))
        .ok_or_else(|| format!("{}: l'immagine non dice la sua versione", r.tag))
}

/// What the chosen channel would do now, read from the registry: the target
/// reference and the decision. `Err` when the registry does not answer.
pub async fn decide_now(
    image: &str,
    image_channel: &Canale,
    chosen: &Canale,
) -> Result<
    (
        Riferimento,
        Decision,
        Option<crate::aggiornamento::Versione>,
    ),
    String,
> {
    let (r, _) = target(image, chosen).ok_or("l'immagine che gira non dice la sua architettura")?;
    if image_channel == chosen {
        return Ok((r, Decision::Same, None));
    }
    let top = moving_version(&r).await?;
    let current = crate::aggiornamento::Versione::leggi(crate::aggiornamento::version());
    let d = decide(image_channel, chosen, current.as_ref(), Some(&top));
    Ok((r, d, Some(top)))
}

/// The conditions of a switch, checked **before** the data snapshot and the
/// answer: the host config folder, the user bus, the installer in the image.
pub async fn preflight() -> Result<(), String> {
    crate::quadlet::host_config()
        .ok_or("SWS_HOST_CONFIG_DIR assente: il pannello non sa dove scrivere l'installer")?;
    if !Path::new(crate::quadlet::DIR_IMMAGINE)
        .join("install-container.sh")
        .exists()
    {
        return Err("l'immagine che gira non porta l'installer".into());
    }
    zbus::Connection::session()
        .await
        .map(|_| ())
        .map_err(|e| format!("bus utente non raggiungibile: {e}"))
}

/// The installer in a transient user service: it rewrites the units with
/// `image_ref`, pulls the image and restarts the runtime. Returns as soon as
/// the service started: shortly after, this process is stopped.
pub async fn start_switch(config_dir: &Path, image_ref: &str) -> Result<(), String> {
    let host = crate::quadlet::host_config().ok_or("SWS_HOST_CONFIG_DIR assente")?;
    crate::quadlet::copy_installer(config_dir).await?;
    let user_bus = zbus::Connection::session()
        .await
        .map_err(|e| format!("bus utente: {e}"))?;
    let mut argv = crate::quadlet::comando(&host);
    argv.push("--image-ref".into());
    argv.push(image_ref.to_string());
    let name = format!(
        "sws-channel-switch-{}.service",
        chrono::Utc::now().timestamp()
    );
    crate::display_target::bus::avvia_transitorio(
        &user_bus,
        &name,
        "SWS: switch of the update channel",
        &argv,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::aggiornamento::Versione;

    fn v(s: &str) -> Versione {
        Versione::leggi(s).unwrap()
    }

    #[test]
    fn the_architecture_comes_from_every_form_of_tag() {
        assert_eq!(arch_of("latest-arm64"), Some("arm64"));
        assert_eq!(arch_of("2.27.0-dev.3-arm64"), Some("arm64"));
        assert_eq!(arch_of("a570b64b-amd64"), Some("amd64"));
        assert_eq!(arch_of("rc-arm64-generic"), Some("arm64-generic"));
        assert_eq!(arch_of("2.11.0"), None);
    }

    #[test]
    fn the_target_keeps_the_registry_or_takes_the_public_one() {
        let (r, arch) = target(
            "ghcr.io/soligolab/sws-runtime:2.27.0-dev.3-arm64",
            &Canale::Sviluppo,
        )
        .unwrap();
        assert_eq!(image_ref(&r), "ghcr.io/soligolab/sws-runtime:dev-arm64");
        assert_eq!(arch, "arm64");
        // An archive: the public registry, the archive's architecture.
        let (r, _) = target("localhost/sws-runtime:2.27.0-dev.0-arm64", &Canale::Stabile).unwrap();
        assert_eq!(image_ref(&r), "ghcr.io/soligolab/sws-runtime:latest-arm64");
        // No architecture in the tag: no target.
        assert!(target("ghcr.io/soligolab/sws-runtime:2.11.0", &Canale::Prova).is_none());
        // The generic alias exists only for releases: a channel uses `arm64`.
        let (r, arch) = target(
            "ghcr.io/soligolab/sws-runtime:latest-arm64-generic",
            &Canale::Sviluppo,
        )
        .unwrap();
        assert_eq!(image_ref(&r), "ghcr.io/soligolab/sws-runtime:dev-arm64");
        assert_eq!(arch, "arm64");
        // Not a channel.
        assert!(target("ghcr.io/x/y:latest-arm64", &Canale::Fissata).is_none());
    }

    #[test]
    fn never_down_a_version() {
        let dev4 = v("2.27.0-dev.4");
        // dev → stable while stable is 2.26.x: wait.
        assert_eq!(
            decide(
                &Canale::Sviluppo,
                &Canale::Stabile,
                Some(&dev4),
                Some(&v("2.26.0"))
            ),
            Decision::Wait
        );
        // Stable has 2.27.0 now: switch.
        assert_eq!(
            decide(
                &Canale::Sviluppo,
                &Canale::Stabile,
                Some(&dev4),
                Some(&v("2.27.0"))
            ),
            Decision::SwitchNow
        );
        // The same version is not a step forward.
        assert_eq!(
            decide(
                &Canale::Fissata,
                &Canale::Sviluppo,
                Some(&dev4),
                Some(&v("2.27.0-dev.4"))
            ),
            Decision::Wait
        );
        // test → dev with a newer dev: switch.
        assert_eq!(
            decide(
                &Canale::Prova,
                &Canale::Sviluppo,
                Some(&v("2.26.0-rc.29")),
                Some(&dev4)
            ),
            Decision::SwitchNow
        );
        // An empty channel: wait.
        assert_eq!(
            decide(&Canale::Prova, &Canale::Stabile, Some(&dev4), None),
            Decision::Wait
        );
        assert_eq!(
            decide(
                &Canale::Prova,
                &Canale::Prova,
                Some(&dev4),
                Some(&v("9.0.0"))
            ),
            Decision::Same
        );
    }

    #[test]
    fn the_api_names_the_three_channels() {
        assert_eq!(parse("stable"), Some(Canale::Stabile));
        assert_eq!(parse("test"), Some(Canale::Prova));
        assert_eq!(parse("dev"), Some(Canale::Sviluppo));
        assert_eq!(parse("fissata"), None);
    }

    #[tokio::test]
    async fn the_chosen_channel_waits_until_the_image_follows_it() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(read(dir.path()).await, None);
        write(dir.path(), &Canale::Stabile).await.unwrap();
        assert_eq!(read(dir.path()).await, Some(Canale::Stabile));
        // The image is still on dev: the choice waits.
        assert_eq!(
            waiting(dir.path(), &Canale::Sviluppo).await,
            Some(Canale::Stabile)
        );
        // The image follows stable now: the file goes.
        assert_eq!(waiting(dir.path(), &Canale::Stabile).await, None);
        assert_eq!(read(dir.path()).await, None);
    }
}
