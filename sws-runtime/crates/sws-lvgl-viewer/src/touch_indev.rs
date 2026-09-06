//! Lettore touch per il backend "drm" (nessun windowing system che ci passi
//! eventi mouse, a differenza di SDL2) — legge evdev grezzo da un device
//! **già calibrato e filtrato** da `tslib` (il demone `ts-uinput.service`,
//! confermato attivo su tc620-a-p3-c6-07aff9.local, verificato prima di
//! scrivere questo codice: `/etc/ts.conf` ha `module linear`, e
//! `/dev/input/ts_uinput` è il symlink al device virtuale che espone
//! l'output già calibrato — niente bisogno di linkare tslib direttamente
//! né di applicare `/etc/pointercal` a mano).
//!
//! Alimenta lo stesso `lvgl_indev::set_pointer_state` già usato dal loop
//! eventi SDL2 — un solo indev puntatore condiviso, la sorgente (mouse SDL2
//! o touch evdev) è solo un dettaglio di chi lo chiama.
//!
//! Calibrazione dinamica via `EVIOCGABS` (non costanti fisse come
//! `lv_drivers/indev/evdev.c`, che le vuole configurate a mano in
//! `lv_drv_conf.h`): più robusto, si adatta a qualunque range riporti
//! davvero il device invece di assumerlo.

use std::fs::File;
use std::io::Read;
use std::os::unix::io::AsRawFd;

use crate::lvgl_indev;

const EV_KEY: u16 = 0x01;
const EV_ABS: u16 = 0x03;
const ABS_X: u16 = 0x00;
const ABS_Y: u16 = 0x01;
const BTN_TOUCH: u16 = 0x14a;

// struct input_event su Linux 64-bit non-kernel: { timeval (2×i64), u16
// type, u16 code, i32 value } = 24 byte — verificato contro
// /usr/include/linux/input.h prima di scrivere questo, non assunto a
// memoria.
#[repr(C)]
#[derive(Default, Clone, Copy)]
struct InputEvent {
    tv_sec: i64,
    tv_usec: i64,
    type_: u16,
    code: u16,
    value: i32,
}

// struct input_absinfo: 6×i32 = 24 byte.
#[repr(C)]
#[derive(Default)]
struct InputAbsinfo {
    value: i32,
    minimum: i32,
    maximum: i32,
    fuzz: i32,
    flat: i32,
    resolution: i32,
}

// EVIOCGABS(abs) = _IOR('E', 0x40+abs, struct input_absinfo) — stessa
// formula _IOC di drm_display.rs, dir=_IOC_READ (2) invece di READ|WRITE.
fn eviocgabs(abs: u16) -> u64 {
    const IOC_READ: u32 = 2;
    const SIZE: u32 = std::mem::size_of::<InputAbsinfo>() as u32;
    let dir_shift = 30u32;
    let type_shift = 8u32;
    let size_shift = 16u32;
    ((IOC_READ << dir_shift)
        | ((b'E' as u32) << type_shift)
        | (0x40 + abs as u32)
        | (SIZE << size_shift)) as u64
}

fn query_absinfo(fd: i32, abs: u16) -> anyhow::Result<InputAbsinfo> {
    let mut info = InputAbsinfo::default();
    let ret = unsafe { libc::ioctl(fd, eviocgabs(abs), &mut info as *mut _) };
    if ret < 0 {
        anyhow::bail!(
            "EVIOCGABS({abs}) fallita: {}",
            std::io::Error::last_os_error()
        );
    }
    Ok(info)
}

/// Avvia il thread di lettura touch in background. `device_path` tipico:
/// `/dev/input/ts_uinput` (il symlink tslib, non l'`/dev/input/eventN`
/// grezzo sottostante — quel numero cambia da device a device, verificato
/// su tc620-a-p3-c6-07aff9.local: lì è `event3`, ma il symlink è stabile).
/// `hor_res`/`ver_res`: risoluzione LVGL a cui scalare le coordinate
/// calibrate del device (che possono avere un range diverso).
pub fn spawn(device_path: &str, hor_res: u32, ver_res: u32) -> anyhow::Result<()> {
    // Posseduta, non presa in prestito: il thread sotto deve poterla usare
    // per tutta la sua vita, che può superare quella del chiamante di
    // questa funzione (serve 'static per std::thread::spawn).
    let device_path = device_path.to_string();

    let file = File::open(&device_path)
        .map_err(|e| anyhow::anyhow!("apertura device touch '{device_path}' fallita: {e}"))?;
    let fd = file.as_raw_fd();

    let x_info = query_absinfo(fd, ABS_X)?;
    let y_info = query_absinfo(fd, ABS_Y)?;
    eprintln!(
        "[touch] '{device_path}': range X {}..{}, Y {}..{} → scalato a {hor_res}x{ver_res}",
        x_info.minimum, x_info.maximum, y_info.minimum, y_info.maximum
    );

    std::thread::spawn(move || {
        let mut file = file;
        let mut buf = [0u8; std::mem::size_of::<InputEvent>()];
        let (mut x_raw, mut y_raw, mut pressed) = (0i32, 0i32, false);
        loop {
            if let Err(e) = file.read_exact(&mut buf) {
                eprintln!("[touch] lettura da '{device_path}' interrotta: {e}");
                return;
            }
            // Stesso layout di InputEvent: reinterpretazione diretta dei
            // byte letti, nessuna conversione di endianness necessaria
            // (stesso processo/architettura che ha scritto i dati nel
            // device — evdev non è un formato di rete). read_unaligned, non
            // read: [u8; 24] non garantisce l'allineamento a 8 byte che i
            // campi i64 di InputEvent richiederebbero.
            let ev: InputEvent = unsafe { std::ptr::read_unaligned(buf.as_ptr() as *const InputEvent) };

            match ev.type_ {
                EV_ABS if ev.code == ABS_X => x_raw = ev.value,
                EV_ABS if ev.code == ABS_Y => y_raw = ev.value,
                EV_KEY if ev.code == BTN_TOUCH => pressed = ev.value != 0,
                _ => continue, // EV_SYN e altri: aggiorniamo lo stato condiviso solo sui campi che contano
            }

            let x = map_range(x_raw, x_info.minimum, x_info.maximum, hor_res as i32);
            let y = map_range(y_raw, y_info.minimum, y_info.maximum, ver_res as i32);
            lvgl_indev::set_pointer_state(x, y, pressed);
        }
    });

    Ok(())
}

fn map_range(value: i32, in_min: i32, in_max: i32, out_max: i32) -> i32 {
    if in_max <= in_min {
        return 0;
    }
    let scaled = (value - in_min) as i64 * (out_max - 1) as i64 / (in_max - in_min) as i64;
    scaled.clamp(0, (out_max - 1) as i64) as i32
}
