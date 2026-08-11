//! Registrazione del display LVGL **bypassando** `lvgl::Display::register()`/
//! `register_raw()`, entrambi affetti da un bug di lifetime confermato (vedi
//! `docs/OPEN_QUESTIONS.md` Q14): tengono il `DrawBuffer` in una variabile
//! locale alla funzione stessa, distrutta al ritorno — LVGL resta con un
//! puntatore pendente, il primo `task_handler()` segfalta.
//!
//! Il fix: usare solo `lvgl-sys` (i binding raw, generati da bindgen, che non
//! hanno questo bug — il bug è tutto nel layer sicuro `lvgl::Display`) e
//! ottenere storage `'static` con `Box::leak` invece che una variabile
//! locale. `Box::leak` è 100% safe Rust: alloca sull'heap e restituisce un
//! riferimento che vive per il resto del programma — esattamente la garanzia
//! che serve qui, e che il commento `// TODO: needs to be 'static somehow`
//! nel sorgente del crate chiedeva senza risolvere.
//!
//! Nessun file C: lo "shim" è tutto Rust, usando direttamente i tipi
//! generati da bindgen (`lv_disp_drv_t`, `lv_disp_draw_buf_t`, `lv_color_t`)
//! così la struttura corrisponde bit-per-bit a quello che LVGL C si aspetta,
//! senza dover duplicare i layout a mano in un `.c` separato.

use std::sync::{Mutex, OnceLock};

/// Frame buffer condiviso RGB888 (3 byte/pixel), riempito dal flush
/// callback (chiamato da LVGL, contesto FFI) e letto dal loop SDL2 (contesto
/// Rust normale) — il `Mutex` è il confine di sincronizzazione tra i due.
static FRAME: OnceLock<Mutex<Vec<u8>>> = OnceLock::new();
static FRAME_DIMS: OnceLock<(u32, u32)> = OnceLock::new();

/// Copia l'ultimo frame flushato in un buffer RGB888 fornito dal chiamante
/// (dimensione `hor_res*ver_res*3`, stesso ordine riga per riga di
/// `init_display`). Restituisce `false` se il display non è ancora stato
/// inizializzato.
pub fn copy_frame_rgb888(out: &mut [u8]) -> bool {
    let Some(frame) = FRAME.get() else { return false };
    let buf = frame.lock().unwrap_or_else(|e| e.into_inner());
    let n = out.len().min(buf.len());
    out[..n].copy_from_slice(&buf[..n]);
    true
}

unsafe extern "C" fn sws_flush_cb(
    disp_drv: *mut lvgl_sys::_lv_disp_drv_t,
    area: *const lvgl_sys::lv_area_t,
    color_p: *mut lvgl_sys::lv_color_t,
) {
    // Safety: `area`/`color_p` sono validi per la durata della chiamata —
    // stessa garanzia che LVGL dà a qualunque flush_cb C.
    let area = unsafe { &*area };
    let (hor_res, ver_res) = FRAME_DIMS.get().copied().unwrap_or((0, 0));
    let x1 = area.x1.max(0) as usize;
    let y1 = area.y1.max(0) as usize;
    let w = (area.x2 - area.x1 + 1).max(0) as usize;
    let h = (area.y2 - area.y1 + 1).max(0) as usize;

    if let Some(frame) = FRAME.get() {
        let mut buf = frame.lock().unwrap_or_else(|e| e.into_inner());
        for row in 0..h {
            let dst_y = y1 + row;
            if dst_y >= ver_res as usize {
                continue;
            }
            for col in 0..w {
                let dst_x = x1 + col;
                if dst_x >= hor_res as usize {
                    continue;
                }
                // Safety: color_p punta a un array riga-per-riga di w*h
                // pixel per quest'area — stesso layout che DisplayRefresh::
                // as_pixels() del crate assume (vedi lvgl-0.6.2/src/display.rs).
                let px = unsafe { *color_p.add(row * w + col) };
                let raw: u16 = unsafe { px.full }; // union: lettura del pattern di bit grezzo, RGB565
                let r5 = (raw >> 11) & 0x1F;
                let g6 = (raw >> 5) & 0x3F;
                let b5 = raw & 0x1F;
                let idx = (dst_y * hor_res as usize + dst_x) * 3;
                if idx + 2 < buf.len() {
                    buf[idx] = ((r5 as u32 * 255) / 31) as u8;
                    buf[idx + 1] = ((g6 as u32 * 255) / 63) as u8;
                    buf[idx + 2] = ((b5 as u32 * 255) / 31) as u8;
                }
            }
        }
    }

    // Obbligatorio: senza questo LVGL pensa che il flush sia ancora in corso
    // e non procede mai col frame successivo. La safe API lo chiama per
    // conto nostro dentro il suo trampolino; qui tocca a noi.
    unsafe { lvgl_sys::lv_disp_flush_ready(disp_drv) };
}

/// Registra un display LVGL `hor_res`×`ver_res` con storage `'static`
/// (niente uso di `lvgl::Display`/`DrawBuffer`). Va chiamata una sola volta;
/// richiede che LVGL sia già inizializzato (il ctor `#[ctor]` del crate
/// `lvgl` lo fa automaticamente al primo utilizzo, prima di `main()`).
pub fn init_display(hor_res: u32, ver_res: u32) -> anyhow::Result<()> {
    FRAME
        .set(Mutex::new(vec![0u8; (hor_res * ver_res * 3) as usize]))
        .map_err(|_| anyhow::anyhow!("init_display chiamata più di una volta"))?;
    FRAME_DIMS.set((hor_res, ver_res)).ok();

    let n_px = (hor_res * ver_res) as usize;
    // Buffer pixel LVGL (formato nativo lv_color_t, non RGB888): storage
    // 'static via Box::leak, non una variabile locale — questo è il fix.
    let pixel_buf: &'static mut [lvgl_sys::lv_color_t] =
        Box::leak(vec![lvgl_sys::lv_color16_t { full: 0 }; n_px].into_boxed_slice());

    // Default per _lv_disp_draw_buf_t/_lv_disp_drv_t è generato da bindgen
    // come zero-init sicuro (vedi bindings.rs) — stesso pattern usato da
    // lv_disp_drv_init lato C, che si aspetta una struct azzerata da
    // riempire lui stesso.
    let draw_buf: &'static mut lvgl_sys::lv_disp_draw_buf_t = Box::leak(Box::default());
    unsafe {
        lvgl_sys::lv_disp_draw_buf_init(
            draw_buf as *mut _,
            pixel_buf.as_mut_ptr() as *mut std::ffi::c_void,
            core::ptr::null_mut(),
            n_px as u32,
        );
    }

    let disp_drv: &'static mut lvgl_sys::lv_disp_drv_t = Box::leak(Box::default());
    unsafe {
        lvgl_sys::lv_disp_drv_init(disp_drv as *mut _);
    }
    disp_drv.draw_buf = draw_buf as *mut _;
    disp_drv.hor_res = hor_res as lvgl_sys::lv_coord_t;
    disp_drv.ver_res = ver_res as lvgl_sys::lv_coord_t;
    disp_drv.flush_cb = Some(sws_flush_cb);

    let disp_ptr = unsafe { lvgl_sys::lv_disp_drv_register(disp_drv as *mut _) };
    if disp_ptr.is_null() {
        anyhow::bail!("lv_disp_drv_register ha restituito null");
    }
    Ok(())
}
