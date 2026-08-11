//! Registrazione di un input device puntatore (mouse) LVGL, con lo stesso
//! pattern di `lvgl_display.rs`: `_lv_indev_drv_t` ha, come `_lv_disp_drv_t`,
//! un `Default` zero-safe generato da bindgen — stesso fix (`Box::leak` per
//! storage `'static` invece di una variabile locale che LVGL C manterrebbe
//! per riferimento oltre la vita della funzione che l'ha creata).
//!
//! Il crate `lvgl` safe non espone un binding per gli input device, quindi
//! qui si passa da `lvgl-sys` direttamente fin dall'inizio (a differenza di
//! `lvgl_display.rs`, non c'è nessuna API sicura rotta da bypassare: manca
//! proprio l'API sicura).
//!
//! `lv_indev_drv_register` assegna da solo l'indev al display di default
//! (`lv_disp_get_default()`) se `driver.disp` è nullo — verificato nel
//! sorgente C (`lv_hal_indev.c`), non assunto: va quindi chiamata dopo
//! `lvgl_display::init_display`, mai prima.

use std::sync::{Mutex, OnceLock};

#[derive(Clone, Copy, Default)]
struct PointerState {
    x: i16,
    y: i16,
    pressed: bool,
}

static POINTER: OnceLock<Mutex<PointerState>> = OnceLock::new();

/// Chiamata dal loop SDL2 a ogni evento mouse (down/up/motion) — l'ultimo
/// stato scritto qui è quello che `sws_pointer_read_cb` riporterà a LVGL al
/// prossimo poll (`lv_indev_read`, guidato da `lv_task_handler()`).
pub fn set_pointer_state(x: i32, y: i32, pressed: bool) {
    if let Some(m) = POINTER.get() {
        let mut s = m.lock().unwrap_or_else(|e| e.into_inner());
        s.x = x.clamp(i16::MIN as i32, i16::MAX as i32) as i16;
        s.y = y.clamp(i16::MIN as i32, i16::MAX as i32) as i16;
        s.pressed = pressed;
    }
}

unsafe extern "C" fn sws_pointer_read_cb(
    _indev_drv: *mut lvgl_sys::_lv_indev_drv_t,
    data: *mut lvgl_sys::lv_indev_data_t,
) {
    let s = POINTER.get().map(|m| *m.lock().unwrap_or_else(|e| e.into_inner())).unwrap_or_default();
    unsafe {
        (*data).point = lvgl_sys::lv_point_t { x: s.x, y: s.y };
        (*data).state = if s.pressed {
            lvgl_sys::lv_indev_state_t_LV_INDEV_STATE_PRESSED
        } else {
            lvgl_sys::lv_indev_state_t_LV_INDEV_STATE_RELEASED
        };
        // Un solo campione per poll: il mouse SDL2 non ha bisogno del
        // meccanismo "più punti per ciclo di lettura" pensato per i buffer
        // dei controller touch.
        (*data).continue_reading = false;
    }
}

/// Registra un indev puntatore singleton. Va chiamata una sola volta, dopo
/// `lvgl_display::init_display` (vedi commento di modulo).
pub fn init_pointer_indev() -> anyhow::Result<()> {
    POINTER
        .set(Mutex::new(PointerState::default()))
        .map_err(|_| anyhow::anyhow!("init_pointer_indev chiamata più di una volta"))?;

    let indev_drv: &'static mut lvgl_sys::lv_indev_drv_t = Box::leak(Box::default());
    unsafe {
        lvgl_sys::lv_indev_drv_init(indev_drv as *mut _);
    }
    indev_drv.type_ = lvgl_sys::lv_indev_type_t_LV_INDEV_TYPE_POINTER;
    indev_drv.read_cb = Some(sws_pointer_read_cb);

    let indev_ptr = unsafe { lvgl_sys::lv_indev_drv_register(indev_drv as *mut _) };
    if indev_ptr.is_null() {
        anyhow::bail!("lv_indev_drv_register ha restituito null (nessun display registrato?)");
    }
    Ok(())
}
