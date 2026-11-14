//! Luce, riposo e beep al tocco (13-11-2026, piano
//! `docs/plans/2026-10-30-sws-lvgl-sul-tiny-ty.md`).
//!
//! Decisione del maintainer del 12-11: sul Tiny TY `tyx_panelcontrol` non parte,
//! e SWS fa da sé luce e cicalino. Prima versione: luce impostabile; a riposo
//! si oscura dopo N minuti e si spegne dopo M; il primo tocco riaccende **senza
//! premere** quello che c'è sotto; beep a ogni tocco (frequenza, durata,
//! volume, oppure niente). Si imposta nel progetto (`pannello`) e viaggia col
//! deploy.
//!
//! **Quale** luce e **quale** cicalino non lo dice il progetto ma
//! l'installazione: `--retroilluminazione` e `--cicalino`, che il lanciatore
//! del Tiny TY passa quando i file ci sono. Senza, questo modulo non fa niente
//! — è il caso dei pannelli PixsysOS, dove luce e beep restano del sistema.
//!
//! Il riposo vale solo con un touch: uno schermo spento che nessun tocco può
//! riaccendere sarebbe un pannello morto.

use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use sws_core::project::{BeepTocco, PannelloConfig};

/// La luce da oscurato, in percento della luce normale.
const OSCURATO_PERCENTO: u32 = 15;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Fase {
    Acceso,
    Oscurato,
    Spento,
}

/// Il riposo, senza hardware: quando oscurare, quando spegnere, e quali tocchi
/// passano a LVGL.
#[derive(Debug)]
pub struct Riposo {
    ultimo: Instant,
    fase: Fase,
    premuto: bool,
    /// Il tocco che ha svegliato lo schermo: non passa a LVGL finché il dito
    /// non si alza.
    inghiotti: bool,
}

/// Cosa fare di un evento del touch.
#[derive(Debug, PartialEq, Eq)]
pub struct Tocco {
    /// Lo stato da dare a LVGL: `false` vuol dire «rilasciato», anche se il
    /// dito è giù, per il tocco che ha svegliato lo schermo.
    pub premuto_per_lvgl: bool,
    /// È appena sceso il dito: il momento del beep.
    pub appena_premuto: bool,
    /// La fase cambia: va riaccesa la luce.
    pub cambio: Option<Fase>,
}

impl Riposo {
    pub fn nuovo(ora: Instant) -> Self {
        Self {
            ultimo: ora,
            fase: Fase::Acceso,
            premuto: false,
            inghiotti: false,
        }
    }

    pub fn fase(&self) -> Fase {
        self.fase
    }

    pub fn tocco(&mut self, ora: Instant, premuto: bool) -> Tocco {
        let appena_premuto = premuto && !self.premuto;
        self.premuto = premuto;
        self.ultimo = ora;
        let mut cambio = None;
        if appena_premuto && self.fase != Fase::Acceso {
            self.fase = Fase::Acceso;
            self.inghiotti = true;
            cambio = Some(Fase::Acceso);
        }
        let premuto_per_lvgl = premuto && !self.inghiotti;
        if !premuto {
            self.inghiotti = false;
        }
        Tocco {
            premuto_per_lvgl,
            appena_premuto,
            cambio,
        }
    }

    /// A deploy counts as activity: the screen lights up and the idle time
    /// starts again. Without it the new times were measured from the last
    /// touch, maybe minutes before, and a deploy with «off after 2 minutes»
    /// left the screen dark straight away (TY570, 13-11-2026).
    pub fn wake(&mut self, ora: Instant) -> bool {
        self.ultimo = ora;
        let was_dark = self.fase != Fase::Acceso;
        self.fase = Fase::Acceso;
        was_dark
    }

    /// Da chiamare a ogni giro del ciclo: la fase in cui passare, se cambia.
    /// Col dito appoggiato non si va a riposo, per quanto a lungo stia lì.
    pub fn giro(
        &mut self,
        ora: Instant,
        oscura: Option<Duration>,
        spegni: Option<Duration>,
    ) -> Option<Fase> {
        if self.premuto {
            return None;
        }
        let fermo = ora.saturating_duration_since(self.ultimo);
        let voluta = if spegni.is_some_and(|d| fermo >= d) {
            Fase::Spento
        } else if oscura.is_some_and(|d| fermo >= d) {
            Fase::Oscurato
        } else {
            Fase::Acceso
        };
        // Il giro non riaccende mai: lo fa un tocco, o un deploy (`wake`).
        let piu_buio = |a: Fase, b: Fase| (a as u8) > (b as u8);
        if piu_buio(voluta, self.fase) {
            self.fase = voluta;
            return Some(voluta);
        }
        None
    }
}

/// La retroilluminazione: `<dir>/brightness`, da 0 a `<dir>/max_brightness`.
struct Luce {
    brightness: PathBuf,
    massimo: u32,
    /// La luce trovata all'avvio: quella da usare quando il progetto non ne
    /// chiede una.
    iniziale: u32,
}

impl Luce {
    fn apri(dir: &Path) -> anyhow::Result<Self> {
        let leggi = |nome: &str| -> anyhow::Result<u32> {
            let p = dir.join(nome);
            let t =
                std::fs::read_to_string(&p).map_err(|e| anyhow::anyhow!("{}: {e}", p.display()))?;
            Ok(t.trim().parse()?)
        };
        let massimo = leggi("max_brightness")?.max(1);
        // A light found at 0 is a screen a previous run left off at rest, not
        // a choice: with no light in the project (the pairing page, a project
        // without one) the panel stayed black (TY570, 13-11-2026).
        let iniziale = match leggi("brightness")? {
            0 => massimo,
            b => b,
        };
        Ok(Self {
            brightness: dir.join("brightness"),
            massimo,
            iniziale,
        })
    }

    fn valore(&self, percento: Option<u8>, dimmed: Option<u8>, fase: Fase) -> u32 {
        let normale = match percento {
            Some(p) => (self.massimo * p as u32).div_ceil(100),
            None => self.iniziale,
        };
        match fase {
            Fase::Acceso => normale,
            Fase::Oscurato => match dimmed {
                Some(p) => (self.massimo * p as u32).div_ceil(100).max(1),
                None => (normale * OSCURATO_PERCENTO / 100).max(1),
            },
            Fase::Spento => 0,
        }
    }

    fn scrivi(&self, valore: u32) {
        if let Err(e) = std::fs::write(&self.brightness, valore.to_string()) {
            eprintln!(
                "[schermo] luce {valore}: {}: {e}",
                self.brightness.display()
            );
        }
    }
}

/// Il cicalino su un PWM di sysfs: `<chip>/pwm0`, esportato se serve.
struct Cicalino {
    canale: PathBuf,
    /// Al thread del cicalino: una durata = un beep.
    tx: mpsc::Sender<Duration>,
}

impl Cicalino {
    fn apri(chip: &Path) -> anyhow::Result<Self> {
        let canale = chip.join("pwm0");
        if !canale.exists() {
            std::fs::write(chip.join("export"), "0")
                .map_err(|e| anyhow::anyhow!("{}/export: {e}", chip.display()))?;
            // I permessi sui file del canale li mette udev quando il canale
            // compare (99-sws-tiny-ty.rules): un momento di attesa.
            for _ in 0..20 {
                if std::fs::OpenOptions::new()
                    .write(true)
                    .open(canale.join("enable"))
                    .is_ok()
                {
                    break;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
        }
        let (tx, rx) = mpsc::channel::<Duration>();
        let enable = canale.join("enable");
        // Un thread solo, con uno stack piccolo (piano: ogni thread costa
        // RAM): accende, aspetta, spegne. I beep chiesti mentre suona si
        // accodano e durano quanto devono.
        std::thread::Builder::new()
            .name("sws-cicalino".into())
            .stack_size(32 * 1024)
            .spawn(move || {
                for durata in rx {
                    let _ = std::fs::write(&enable, "1");
                    std::thread::sleep(durata);
                    let _ = std::fs::write(&enable, "0");
                }
            })?;
        Ok(Self { canale, tx })
    }

    /// Frequenza e volume: periodo e duty in nanosecondi. Il duty si azzera
    /// prima di cambiare il periodo, perché il kernel rifiuta un duty più
    /// lungo del periodo.
    fn imposta(&self, b: &BeepTocco) {
        let periodo = 1_000_000_000u64 / b.frequenza_hz.max(1) as u64;
        let duty = periodo * b.volume.min(100) as u64 / 200;
        for (nome, v) in [("duty_cycle", 0), ("period", periodo), ("duty_cycle", duty)] {
            let p = self.canale.join(nome);
            if let Err(e) = std::fs::write(&p, v.to_string()) {
                eprintln!("[schermo] cicalino {}: {e}", p.display());
                return;
            }
        }
    }

    fn suona(&self, durata: Duration) {
        let _ = self.tx.send(durata);
    }
}

struct Schermo {
    cfg: PannelloConfig,
    luce: Option<Luce>,
    cicalino: Option<Cicalino>,
    riposo: Riposo,
    /// C'è un touch che può svegliare lo schermo.
    touch: bool,
}

static SCHERMO: OnceLock<Mutex<Schermo>> = OnceLock::new();
/// Le impostazioni arrivate prima di [`avvia`]: il progetto si legge prima che
/// il backend apra lo schermo.
static IN_ATTESA: Mutex<Option<PannelloConfig>> = Mutex::new(None);
/// The device's own brightness, set from the control panel
/// (`config/control_panel.json` of the runtime): it wins over the project's
/// `luminosita` until it is set back to `None` (decision of 14-11-2026).
static DEVICE_BRIGHTNESS: Mutex<Option<u8>> = Mutex::new(None);

fn minuti(m: Option<u32>) -> Option<Duration> {
    m.map(|m| Duration::from_secs(m as u64 * 60))
}

impl Schermo {
    fn applica_luce(&self) {
        if let Some(l) = &self.luce {
            let device = *DEVICE_BRIGHTNESS.lock().unwrap_or_else(|e| e.into_inner());
            l.scrivi(l.valore(
                device.or(self.cfg.luminosita),
                self.cfg.dimmed_brightness,
                self.riposo.fase(),
            ));
        }
    }

    fn applica(&mut self, cfg: PannelloConfig) {
        if let (Some(c), Some(b)) = (&self.cicalino, &cfg.beep) {
            c.imposta(b);
        }
        self.cfg = cfg;
        self.riposo.wake(Instant::now());
        self.applica_luce();
    }
}

/// Le impostazioni del progetto: all'avvio e dopo ogni deploy.
pub fn configura(cfg: PannelloConfig) {
    match SCHERMO.get() {
        Some(m) => m.lock().unwrap_or_else(|e| e.into_inner()).applica(cfg),
        None => *IN_ATTESA.lock().unwrap_or_else(|e| e.into_inner()) = Some(cfg),
    }
}

/// The control panel's brightness, `None` = the project's. Applied at once,
/// also while the slider moves.
pub fn device_brightness(percent: Option<u8>) {
    let mut d = DEVICE_BRIGHTNESS.lock().unwrap_or_else(|e| e.into_inner());
    if *d == percent {
        return;
    }
    *d = percent;
    drop(d);
    if let Some(m) = SCHERMO.get() {
        m.lock().unwrap_or_else(|e| e.into_inner()).applica_luce();
    }
}

/// Apre luce e cicalino dell'installazione. Un file che non si apre si dice e
/// si salta: il pannello funziona lo stesso, senza quella parte.
pub fn avvia(retroilluminazione: Option<&str>, cicalino: Option<&str>, touch: bool) {
    let luce = retroilluminazione.and_then(|d| match Luce::apri(Path::new(d)) {
        Ok(l) => {
            eprintln!("[schermo] luce: {d} (0-{}, ora {})", l.massimo, l.iniziale);
            Some(l)
        }
        Err(e) => {
            eprintln!("[schermo] luce non disponibile: {e}");
            None
        }
    });
    let cicalino = cicalino.and_then(|d| match Cicalino::apri(Path::new(d)) {
        Ok(c) => {
            eprintln!("[schermo] cicalino: {}", c.canale.display());
            Some(c)
        }
        Err(e) => {
            eprintln!("[schermo] cicalino non disponibile: {e}");
            None
        }
    });
    if !touch && luce.is_some() {
        eprintln!("[schermo] nessun touch: il riposo resta spento, niente potrebbe riaccendere");
    }
    let cfg = IN_ATTESA
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
        .unwrap_or_default();
    let mut s = Schermo {
        cfg: PannelloConfig::default(),
        luce,
        cicalino,
        riposo: Riposo::nuovo(Instant::now()),
        touch,
    };
    s.applica(cfg);
    let _ = SCHERMO.set(Mutex::new(s));
}

/// Un evento del touch: lo stato da dare a LVGL. Senza [`avvia`] il tocco passa
/// com'è.
pub fn tocco(premuto: bool) -> bool {
    let Some(m) = SCHERMO.get() else {
        return premuto;
    };
    let mut s = m.lock().unwrap_or_else(|e| e.into_inner());
    let t = s.riposo.tocco(Instant::now(), premuto);
    if t.cambio.is_some() {
        s.applica_luce();
    }
    if t.appena_premuto {
        if let (Some(c), Some(b)) = (&s.cicalino, &s.cfg.beep) {
            c.suona(Duration::from_millis(b.durata_ms as u64));
        }
    }
    t.premuto_per_lvgl
}

/// A ogni giro del ciclo: oscura o spegne quando è ora. Un confronto di
/// istanti sotto un lucchetto: niente di misurabile.
pub fn giro() {
    let Some(m) = SCHERMO.get() else {
        return;
    };
    let mut s = m.lock().unwrap_or_else(|e| e.into_inner());
    if !s.touch || s.luce.is_none() {
        return;
    }
    let (oscura, spegni) = (minuti(s.cfg.oscura_dopo_min), minuti(s.cfg.spegni_dopo_min));
    if s.riposo.giro(Instant::now(), oscura, spegni).is_some() {
        s.applica_luce();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const S: Duration = Duration::from_secs(1);
    const OSC: Option<Duration> = Some(Duration::from_secs(60));
    const SPE: Option<Duration> = Some(Duration::from_secs(300));

    #[test]
    fn oscura_poi_spegne() {
        let t0 = Instant::now();
        let mut r = Riposo::nuovo(t0);
        assert_eq!(r.giro(t0 + 59 * S, OSC, SPE), None);
        assert_eq!(r.giro(t0 + 60 * S, OSC, SPE), Some(Fase::Oscurato));
        assert_eq!(r.giro(t0 + 61 * S, OSC, SPE), None);
        assert_eq!(r.giro(t0 + 300 * S, OSC, SPE), Some(Fase::Spento));
    }

    #[test]
    fn solo_spegnimento() {
        let t0 = Instant::now();
        let mut r = Riposo::nuovo(t0);
        assert_eq!(r.giro(t0 + 299 * S, None, SPE), None);
        assert_eq!(r.giro(t0 + 300 * S, None, SPE), Some(Fase::Spento));
    }

    #[test]
    fn il_tocco_che_sveglia_non_preme() {
        let t0 = Instant::now();
        let mut r = Riposo::nuovo(t0);
        r.giro(t0 + 300 * S, OSC, SPE);
        assert_eq!(r.fase(), Fase::Spento);
        let giu = r.tocco(t0 + 301 * S, true);
        assert_eq!(
            giu,
            Tocco {
                premuto_per_lvgl: false,
                appena_premuto: true,
                cambio: Some(Fase::Acceso)
            }
        );
        // Il dito scivola: ancora niente per LVGL.
        assert!(!r.tocco(t0 + 301 * S, true).premuto_per_lvgl);
        // Si alza, e il tocco dopo passa.
        assert!(!r.tocco(t0 + 302 * S, false).premuto_per_lvgl);
        let di_nuovo = r.tocco(t0 + 303 * S, true);
        assert!(di_nuovo.premuto_per_lvgl && di_nuovo.cambio.is_none());
    }

    #[test]
    fn da_acceso_il_tocco_passa() {
        let t0 = Instant::now();
        let mut r = Riposo::nuovo(t0);
        let t = r.tocco(t0 + S, true);
        assert!(t.premuto_per_lvgl && t.appena_premuto && t.cambio.is_none());
        // Il movimento col dito giù non è un tocco nuovo: un beep solo.
        assert!(!r.tocco(t0 + S, true).appena_premuto);
    }

    #[test]
    fn col_dito_appoggiato_non_si_riposa() {
        let t0 = Instant::now();
        let mut r = Riposo::nuovo(t0);
        r.tocco(t0, true);
        assert_eq!(r.giro(t0 + 600 * S, OSC, SPE), None);
        r.tocco(t0 + 600 * S, false);
        assert_eq!(r.giro(t0 + 660 * S, OSC, SPE), Some(Fase::Oscurato));
    }

    #[test]
    fn il_giro_non_riaccende() {
        let t0 = Instant::now();
        let mut r = Riposo::nuovo(t0);
        r.giro(t0 + 300 * S, OSC, SPE);
        // Il deploy toglie il riposo: lo schermo resta com'è fino al tocco.
        assert_eq!(r.giro(t0 + 301 * S, None, None), None);
        assert_eq!(r.fase(), Fase::Spento);
    }

    #[test]
    fn a_deploy_wakes_the_screen_and_restarts_the_idle_time() {
        let t0 = Instant::now();
        let mut r = Riposo::nuovo(t0);
        // The last touch long ago: the new short times must not count from it.
        assert!(!r.wake(t0 + 600 * S));
        assert_eq!(r.giro(t0 + 601 * S, OSC, SPE), None);
        assert_eq!(r.fase(), Fase::Acceso);
        r.giro(t0 + 600 * S + SPE.unwrap(), OSC, SPE);
        assert_eq!(r.fase(), Fase::Spento);
        assert!(r.wake(t0 + 2000 * S), "dark → lit");
        assert_eq!(r.fase(), Fase::Acceso);
    }

    #[test]
    fn la_luce_in_numeri() {
        let l = Luce {
            brightness: PathBuf::new(),
            massimo: 255,
            iniziale: 200,
        };
        assert_eq!(l.valore(None, None, Fase::Acceso), 200);
        assert_eq!(l.valore(Some(100), None, Fase::Acceso), 255);
        assert_eq!(l.valore(Some(50), None, Fase::Acceso), 128);
        assert_eq!(l.valore(Some(100), None, Fase::Oscurato), 38);
        assert_eq!(l.valore(Some(5), None, Fase::Oscurato), 1);
        assert_eq!(l.valore(Some(80), None, Fase::Spento), 0);
        // The dimmed light set in the project, in percent of the maximum.
        assert_eq!(l.valore(Some(80), Some(20), Fase::Oscurato), 51);
    }

    #[test]
    fn luce_e_cicalino_su_sysfs_finto() {
        let d = tempfile::tempdir().unwrap();
        let luce = d.path().join("backlight");
        std::fs::create_dir(&luce).unwrap();
        std::fs::write(luce.join("max_brightness"), "255\n").unwrap();
        std::fs::write(luce.join("brightness"), "180\n").unwrap();
        let l = Luce::apri(&luce).unwrap();
        l.scrivi(l.valore(Some(40), None, Fase::Acceso));
        assert_eq!(
            std::fs::read_to_string(luce.join("brightness")).unwrap(),
            "102"
        );
        // Found off: with no light in the project, full light, not black.
        std::fs::write(luce.join("brightness"), "0\n").unwrap();
        let l = Luce::apri(&luce).unwrap();
        assert_eq!(l.valore(None, None, Fase::Acceso), 255);

        let chip = d.path().join("pwmchip3");
        std::fs::create_dir_all(chip.join("pwm0")).unwrap();
        let c = Cicalino::apri(&chip).unwrap();
        c.imposta(&BeepTocco {
            frequenza_hz: 2000,
            durata_ms: 10,
            volume: 50,
        });
        let leggi = |n: &str| std::fs::read_to_string(chip.join("pwm0").join(n)).unwrap();
        assert_eq!(leggi("period"), "500000");
        assert_eq!(leggi("duty_cycle"), "125000");
        c.suona(Duration::from_millis(5));
        std::thread::sleep(Duration::from_millis(100));
        assert_eq!(leggi("enable"), "0");
    }
}
