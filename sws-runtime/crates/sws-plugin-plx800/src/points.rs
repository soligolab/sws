//! Where each point lives in the segment, how its value reads, and how a
//! command changes it (`docs/interface/points.md` of the reference).

use crate::shm::{set_bit, Command, Snapshot};
use sws_core::{Plx800Point, TagValue};

/// The state of the segment that is not on the module.
#[derive(Debug, Clone, Copy, Default)]
pub struct Meta {
    pub fresh: bool,
    pub writer_active: bool,
    pub foreign_writer: bool,
}

/// Coil 15 is a configuration bit: always written back as read.
pub const RESERVED_COIL: usize = 15;

/// Where a point is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Slot {
    Coil(usize),
    Di(usize),
    Hr(usize),
    Ir(usize),
    /// A 32-bit counter in two input registers, high word first.
    Ir32(usize),
    Temp,
    Fresh,
    UpdateCount,
    FailCount,
    WriterActive,
    ForeignWriter,
}

pub fn slot(p: Plx800Point) -> Slot {
    use Plx800Point::*;
    match p {
        In0 => Slot::Di(0),
        In1 => Slot::Di(1),
        In2 => Slot::Di(2),
        In3 => Slot::Di(3),
        In4 => Slot::Di(4),
        In5 => Slot::Di(5),
        In6 => Slot::Di(6),
        In7 => Slot::Di(7),
        Dip1 => Slot::Di(8),
        Dip2 => Slot::Di(9),
        Dip3 => Slot::Di(10),
        Dip4 => Slot::Di(11),
        Dip5 => Slot::Di(12),
        Dip6 => Slot::Di(13),
        LedRedundantSupply => Slot::Di(14),
        LedOperativeState => Slot::Di(15),
        Out0 => Slot::Coil(0),
        Out1 => Slot::Coil(1),
        Out2 => Slot::Coil(2),
        Out3 => Slot::Coil(3),
        Out4 => Slot::Coil(4),
        Out5 => Slot::Coil(5),
        Out6 => Slot::Coil(6),
        Out7 => Slot::Coil(7),
        LedRunRed => Slot::Coil(8),
        LedRunGreen => Slot::Coil(9),
        LedError => Slot::Coil(10),
        LedA1Red => Slot::Coil(11),
        LedA1Green => Slot::Coil(12),
        LedA2Red => Slot::Coil(13),
        LedA2Green => Slot::Coil(14),
        PoeEn => Slot::Coil(16),
        RunLedMode => Slot::Hr(0),
        PwmMask => Slot::Hr(1),
        PwmFreqG0 => Slot::Hr(2),
        PwmFreqG1 => Slot::Hr(3),
        PwmDutyOut0 => Slot::Hr(4),
        PwmDutyOut1 => Slot::Hr(5),
        PwmDutyOut2 => Slot::Hr(6),
        PwmDutyOut3 => Slot::Hr(7),
        PwmDutyOut4 => Slot::Hr(8),
        PwmDutyOut5 => Slot::Hr(9),
        PwmDutyOut6 => Slot::Hr(10),
        PwmDutyOut7 => Slot::Hr(11),
        VcapMv => Slot::Ir(0),
        VcapSwitchMv => Slot::Ir(1),
        SupplyCpuMv => Slot::Ir(2),
        SupplyMainMv => Slot::Ir(3),
        SupplySecMv => Slot::Ir(4),
        BoardTempC => Slot::Temp,
        DiagRxTotal => Slot::Ir32(6),
        DiagRxOk => Slot::Ir32(8),
        DiagRxErr => Slot::Ir32(10),
        DiagTxTotal => Slot::Ir32(12),
        DiagTxOk => Slot::Ir32(14),
        DiagTxErr => Slot::Ir32(16),
        Fresh => Slot::Fresh,
        UpdateCount => Slot::UpdateCount,
        FailCount => Slot::FailCount,
        WriterActive => Slot::WriterActive,
        ForeignWriter => Slot::ForeignWriter,
    }
}

/// Whether the point describes the segment rather than the module: those keep
/// their meaning (and quality) even when the image is not fresh.
pub fn is_meta(p: Plx800Point) -> bool {
    matches!(
        slot(p),
        Slot::Fresh
            | Slot::UpdateCount
            | Slot::FailCount
            | Slot::WriterActive
            | Slot::ForeignWriter
    )
}

/// The value of a point in a snapshot.
pub fn value(p: Plx800Point, s: &Snapshot, m: &Meta) -> TagValue {
    match slot(p) {
        Slot::Coil(n) => TagValue::Bool(s.coil(n)),
        Slot::Di(n) => TagValue::Bool(s.di(n)),
        Slot::Hr(n) => TagValue::Int(s.hr[n] as i64),
        Slot::Ir(n) => TagValue::Int(s.ir[n] as i64),
        Slot::Ir32(n) => TagValue::Int((((s.ir[n] as u32) << 16) | s.ir[n + 1] as u32) as i64),
        // Kelvin to °C, rounded to the hundredth so 313 K reads 39.85, not
        // 39.850000000000023.
        Slot::Temp => TagValue::Float(((s.ir[5] as f64 - 273.15) * 100.0).round() / 100.0),
        Slot::Fresh => TagValue::Bool(m.fresh),
        Slot::UpdateCount => TagValue::Int(s.update_count.min(i64::MAX as u64) as i64),
        Slot::FailCount => TagValue::Int(s.fail_count.min(i64::MAX as u64) as i64),
        Slot::WriterActive => TagValue::Bool(m.writer_active),
        Slot::ForeignWriter => TagValue::Bool(m.foreign_writer),
    }
}

/// The accepted range of a holding register.
fn hr_range(n: usize) -> (i64, i64) {
    match n {
        0 => (0, 2),          // RUN_LED_MODE
        1 => (0, 255),        // PWM_MASK
        2 | 3 => (0, 20_000), // PWM_FREQ_G0/G1, Hz (Pixsys tools use 1..20 000)
        _ => (0, 1000),       // PWM_DUTY_OUTn, 0.1 % steps
    }
}

fn as_bool(v: &TagValue) -> Option<bool> {
    match v {
        TagValue::Bool(b) => Some(*b),
        TagValue::Int(i) => Some(*i != 0),
        TagValue::Float(f) => Some(*f != 0.0),
        TagValue::Str(s) => match s.trim().to_ascii_lowercase().as_str() {
            "1" | "true" | "on" => Some(true),
            "0" | "false" | "off" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

fn as_int(v: &TagValue) -> Option<i64> {
    match v {
        TagValue::Bool(b) => Some(*b as i64),
        TagValue::Int(i) => Some(*i),
        TagValue::Float(f) if f.is_finite() => Some(f.round() as i64),
        TagValue::Str(s) => s.trim().parse().ok(),
        _ => None,
    }
}

/// Applies a write of `p` to the command. `Err` says why it is refused; the
/// command is then unchanged.
pub fn apply(p: Plx800Point, v: &TagValue, cmd: &mut Command) -> Result<(), String> {
    if !p.writable() {
        return Err("read-only point".into());
    }
    match slot(p) {
        Slot::Coil(n) => {
            let on = as_bool(v).ok_or_else(|| format!("not a boolean: {v:?}"))?;
            set_bit(&mut cmd.coils, n, on);
            Ok(())
        }
        Slot::Hr(n) => {
            let x = as_int(v).ok_or_else(|| format!("not a number: {v:?}"))?;
            let (lo, hi) = hr_range(n);
            if !(lo..=hi).contains(&x) {
                return Err(format!("{x} outside {lo}..{hi}"));
            }
            cmd.hr[n] = x as u16;
            Ok(())
        }
        _ => Err("read-only point".into()),
    }
}

/// The command to leave when this source stops commanding: outputs off, PWM
/// off, the RUN LED given back to the system. PoE and the reserved coil keep
/// their value: powered devices depend on the first, the system on the second.
pub fn safe_state(mut cmd: Command, run_led_mode_at_start: u16) -> Command {
    for n in 0..8 {
        set_bit(&mut cmd.coils, n, false);
    }
    cmd.hr[1] = 0; // PWM_MASK
                   // A 2 found at start was left by a writer that died without cleaning up:
                   // giving it back would keep the RUN LED dark for ever (seen 2026-10-29).
    cmd.hr[0] = if run_led_mode_at_start == 2 {
        1
    } else {
        run_led_mode_at_start
    };
    cmd
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snap() -> Snapshot {
        let mut s = Snapshot {
            coils: [0b0000_0001, 0b0000_1000, 0b1], // OUT0, LED_A1_RED (coil 11), POE_EN
            di: [0b1000_0000, 0b1000_0001],         // IN7, DIP1, LED_OPERATIVE_STATE
            ..Default::default()
        };
        s.ir[0] = 4950;
        s.ir[5] = 313;
        s.ir[10] = 0x0001;
        s.ir[11] = 0x0002;
        s.hr[0] = 1;
        s.hr[4] = 250;
        s.update_count = 7;
        s
    }

    #[test]
    fn point_names_are_the_ones_of_the_project_file() {
        let names: Vec<String> = [
            Plx800Point::In0,
            Plx800Point::Dip1,
            Plx800Point::LedA1Red,
            Plx800Point::PwmFreqG0,
            Plx800Point::PwmDutyOut7,
            Plx800Point::DiagRxTotal,
            Plx800Point::BoardTempC,
            Plx800Point::VcapSwitchMv,
        ]
        .iter()
        .map(|p| {
            serde_json::to_value(p)
                .unwrap()
                .as_str()
                .unwrap()
                .to_string()
        })
        .collect();
        assert_eq!(
            names,
            [
                "in0",
                "dip1",
                "led_a1_red",
                "pwm_freq_g0",
                "pwm_duty_out7",
                "diag_rx_total",
                "board_temp_c",
                "vcap_switch_mv"
            ]
        );
    }

    #[test]
    fn values_come_from_the_documented_slots() {
        let s = snap();
        let m = Meta {
            fresh: true,
            ..Default::default()
        };
        assert_eq!(value(Plx800Point::Out0, &s, &m), TagValue::Bool(true));
        assert_eq!(value(Plx800Point::Out1, &s, &m), TagValue::Bool(false));
        assert_eq!(value(Plx800Point::LedA1Red, &s, &m), TagValue::Bool(true));
        assert_eq!(value(Plx800Point::PoeEn, &s, &m), TagValue::Bool(true));
        assert_eq!(value(Plx800Point::In7, &s, &m), TagValue::Bool(true));
        assert_eq!(value(Plx800Point::Dip1, &s, &m), TagValue::Bool(true));
        assert_eq!(value(Plx800Point::Dip2, &s, &m), TagValue::Bool(false));
        assert_eq!(
            value(Plx800Point::LedOperativeState, &s, &m),
            TagValue::Bool(true)
        );
        assert_eq!(value(Plx800Point::VcapMv, &s, &m), TagValue::Int(4950));
        assert_eq!(
            value(Plx800Point::BoardTempC, &s, &m),
            TagValue::Float(39.85)
        );
        assert_eq!(
            value(Plx800Point::DiagRxErr, &s, &m),
            TagValue::Int(0x0001_0002)
        );
        assert_eq!(value(Plx800Point::PwmDutyOut0, &s, &m), TagValue::Int(250));
        assert_eq!(value(Plx800Point::Fresh, &s, &m), TagValue::Bool(true));
        assert_eq!(value(Plx800Point::UpdateCount, &s, &m), TagValue::Int(7));
    }

    #[test]
    fn writes_change_only_their_point_and_respect_ranges() {
        let s = snap();
        let mut cmd = Command::from_readback(&s);
        apply(Plx800Point::Out3, &TagValue::Bool(true), &mut cmd).unwrap();
        assert_eq!(cmd.coils, [0b0000_1001, 0b0000_1000, 0b1]);
        apply(Plx800Point::PwmDutyOut2, &TagValue::Float(499.6), &mut cmd).unwrap();
        assert_eq!(cmd.hr[6], 500);
        assert!(apply(Plx800Point::RunLedMode, &TagValue::Int(3), &mut cmd).is_err());
        assert!(apply(Plx800Point::PwmFreqG1, &TagValue::Int(-1), &mut cmd).is_err());
        assert!(apply(Plx800Point::In0, &TagValue::Bool(true), &mut cmd).is_err());
        assert!(apply(Plx800Point::VcapMv, &TagValue::Int(1), &mut cmd).is_err());
        assert!(apply(Plx800Point::Out0, &TagValue::Str("maybe".into()), &mut cmd).is_err());
        assert_eq!(cmd.hr[0], 1, "a refused write leaves the command as it was");
    }

    #[test]
    fn the_safe_state_keeps_poe_and_the_reserved_coil() {
        let mut cmd = Command {
            coils: [0xFF, 0xFF, 0b1],
            hr: [2, 0xFF, 100, 100, 1000, 0, 0, 0, 0, 0, 0, 0],
        };
        cmd = safe_state(cmd, 2);
        assert_eq!(cmd.coils[0], 0, "outputs off");
        assert_eq!(cmd.coils[1], 0xFF, "LEDs and the reserved coil untouched");
        assert_eq!(cmd.coils[2], 0b1, "PoE untouched");
        assert_eq!(cmd.hr[1], 0, "PWM off");
        assert_eq!(cmd.hr[0], 1, "a 2 found at start becomes 1");
        assert_eq!(safe_state(cmd, 0).hr[0], 0);
    }

    #[test]
    fn every_writable_point_has_a_writable_slot() {
        use Plx800Point::*;
        for p in [
            Out0,
            Out7,
            LedRunRed,
            LedA2Green,
            PoeEn,
            RunLedMode,
            PwmMask,
            PwmFreqG1,
            PwmDutyOut5,
        ] {
            assert!(p.writable());
            assert!(matches!(slot(p), Slot::Coil(_) | Slot::Hr(_)), "{p:?}");
        }
        for p in [
            In0,
            Dip6,
            LedRedundantSupply,
            VcapMv,
            BoardTempC,
            DiagTxErr,
            Fresh,
            ForeignWriter,
        ] {
            assert!(!p.writable(), "{p:?}");
        }
    }
}
