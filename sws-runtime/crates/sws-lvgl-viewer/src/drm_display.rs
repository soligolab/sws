//! Rendering DRM/KMS diretto (API **legacy**, non atomica) — percorso
//! alternativo a SDL2, aggiunto il 2026-08-10.
//!
//! Perché esiste: su `tc620-a-p3-c6-07aff9.local`, sia `SDL_CreateRenderer`
//! sia `SDL_GetWindowSurface` (via SDL2, driver `wayland`, `x11` o
//! `kmsdrm`) producono un piano DRM correttamente allocato — verificato con
//! `/sys/kernel/debug/dri/1/state`, formato/dimensioni giusti, buffer con
//! dati reali non-zero — ma lo schermo resta nero. Isolato con `modetest`
//! (puro libdrm, nessun codice nostro): il pattern di test si vede con
//! l'API **legacy** (`drmModeSetCrtc`, cosa che questo modulo usa) ma NON
//! con quella **atomica** (`modetest -a`, la stessa usata sia da SDL2 sia
//! dal driver `drm.c` già vendorizzato in lvgl-sys — vedi il suo
//! `drmModeAtomicCommit`). È quindi un bug del driver kernel Rockchip
//! (`Tainted: [O]=OOT_MODULE` nei log) sul percorso atomico specificamente,
//! non un bug nostro, di SDL2 o di LVGL — vedi `docs/OPEN_QUESTIONS.md` Q14
//! per l'indagine completa.
//!
//! Bindgen (non FFI scritta a mano né la crate wrapper `drm`) contro
//! l'header reale di libdrm-dev — vedi `build.rs`. Il codice di apertura
//! device/dumb-buffer segue lo stesso schema di
//! `vendor/lvgl-sys-0.6.2/vendor/lv_drivers/display/drm.c`
//! (`DRM_IOCTL_MODE_CREATE_DUMB`/`DRM_IOCTL_MODE_MAP_DUMB` + `mmap`), letto
//! prima di scrivere questo modulo — quella parte è identica indipendentemente
//! da legacy/atomico, cambia solo come si aggancia il framebuffer al CRTC.

#![allow(non_camel_case_types, non_snake_case, non_upper_case_globals, dead_code)]

include!(concat!(env!("OUT_DIR"), "/drm_bindings.rs"));

use std::fs::{File, OpenOptions};
use std::os::unix::io::{AsRawFd, RawFd};
use std::ptr;

// Vedi build.rs: macro function-like, non allowlistabile via bindgen.
// Valore verificato dal vero output di /sys/kernel/debug/dri/1/state su
// tc620-a-p3-c6-07aff9.local ("format=XR24 little-endian (0x34325258)").
const DRM_FORMAT_XRGB8888: u32 = 0x3432_5258;

// I DRM_IOCTL_MODE_* sono macro function-like (DRM_IOWR(nr, tipo), che
// espande a sua volta in _IOC(...) — dipende da sizeof(tipo), bindgen non
// le valuta (stesso motivo di DRM_FORMAT_XRGB8888 sopra, ma qui il valore
// dipende anche dal layout dello struct, quindi non va hardcoded: va
// ricalcolato con la stessa formula, verificata leggendo
// /usr/include/asm-generic/ioctl.h e /usr/include/drm/drm.h (DRM_IOCTL_BASE
// = 'd', DRM_IOWR = _IOC(_IOC_READ|_IOC_WRITE, DRM_IOCTL_BASE, nr,
// sizeof(tipo))) invece di leggere gli header a mano nel codice C.
const IOC_NRSHIFT: u32 = 0;
const IOC_TYPESHIFT: u32 = IOC_NRSHIFT + 8; // _IOC_NRBITS
const IOC_SIZESHIFT: u32 = IOC_TYPESHIFT + 8; // _IOC_TYPEBITS
const IOC_DIRSHIFT: u32 = IOC_SIZESHIFT + 14; // _IOC_SIZEBITS
const IOC_READ_WRITE: u32 = 3; // _IOC_READ | _IOC_WRITE
const DRM_IOCTL_BASE: u32 = b'd' as u32;

const fn drm_iowr(nr: u32, size: usize) -> u32 {
    (IOC_READ_WRITE << IOC_DIRSHIFT)
        | (DRM_IOCTL_BASE << IOC_TYPESHIFT)
        | (nr << IOC_NRSHIFT)
        | ((size as u32) << IOC_SIZESHIFT)
}

pub struct DrmDisplay {
    _file: File, // tenuto vivo solo per chiudere il fd al Drop
    fd: RawFd,
    fb_handle: u32,
    dumb_handle: u32,
    map: *mut u8,
    map_size: usize,
    pitch: u32,
    pub width: u32,
    pub height: u32,
}

impl DrmDisplay {
    /// Apre `card_path` (es. `/dev/dri/card1` — su questo device NON è
    /// card0, verificato: è quello che Weston usa, vedi
    /// `docs/OPEN_QUESTIONS.md` Q14), trova il primo connettore attivo,
    /// crea un dumb buffer XRGB8888 e lo aggancia al CRTC via
    /// `drmModeSetCrtc` (legacy — vedi commento di modulo sul perché).
    pub fn open(card_path: &str) -> anyhow::Result<Self> {
        let file = OpenOptions::new().read(true).write(true).open(card_path)?;
        let fd = file.as_raw_fd();

        let res = unsafe { drmModeGetResources(fd) };
        if res.is_null() {
            anyhow::bail!("drmModeGetResources ha restituito null ({card_path})");
        }
        let res_ref = unsafe { &*res };

        let conn_ids = unsafe {
            std::slice::from_raw_parts(res_ref.connectors, res_ref.count_connectors as usize)
        };
        let mut found: Option<(u32, drmModeModeInfo, u32)> = None; // (connector_id, mode, encoder_id)
        for &cid in conn_ids {
            let conn = unsafe { drmModeGetConnector(fd, cid) };
            if conn.is_null() {
                continue;
            }
            let conn_ref = unsafe { &*conn };
            if conn_ref.connection == drmModeConnection_DRM_MODE_CONNECTED && conn_ref.count_modes > 0 {
                let modes = unsafe {
                    std::slice::from_raw_parts(conn_ref.modes, conn_ref.count_modes as usize)
                };
                // modes[0] è la preferita: il driver le ordina così
                // (confermato con modetest -c, che segnala esplicitamente
                // "type: preferred" sulla prima in elenco).
                found = Some((conn_ref.connector_id, modes[0], conn_ref.encoder_id));
                unsafe { drmModeFreeConnector(conn) };
                break;
            }
            unsafe { drmModeFreeConnector(conn) };
        }
        let (connector_id, mode, encoder_id) = found
            .ok_or_else(|| anyhow::anyhow!("nessun connettore DRM connesso con una mode valida"))?;

        // CRTC: riusa quello già agganciato all'encoder del connettore
        // (è quello che il resto del sistema usa già per questo schermo),
        // altrimenti ripiega sul primo della lista risorse.
        let crtc_from_encoder = if encoder_id != 0 {
            let enc = unsafe { drmModeGetEncoder(fd, encoder_id) };
            if enc.is_null() {
                0
            } else {
                let id = unsafe { (*enc).crtc_id };
                unsafe { drmModeFreeEncoder(enc) };
                id
            }
        } else {
            0
        };
        let crtc_id = if crtc_from_encoder != 0 {
            crtc_from_encoder
        } else {
            let crtc_ids =
                unsafe { std::slice::from_raw_parts(res_ref.crtcs, res_ref.count_crtcs as usize) };
            *crtc_ids
                .first()
                .ok_or_else(|| anyhow::anyhow!("nessun CRTC DRM disponibile"))?
        };

        unsafe { drmModeFreeResources(res) };

        let width = mode.hdisplay as u32;
        let height = mode.vdisplay as u32;

        // Dumb buffer: stesso identico percorso di lv_drivers/display/drm.c
        // (letto prima di scrivere questo codice, non assunto) —
        // DRM_IOCTL_MODE_CREATE_DUMB + DRM_IOCTL_MODE_MAP_DUMB + mmap.
        let mut creq = drm_mode_create_dumb {
            height,
            width,
            bpp: 32,
            ..Default::default()
        };
        let ret = unsafe {
            drmIoctl(
                fd,
                drm_iowr(0xB2, std::mem::size_of::<drm_mode_create_dumb>()) as std::os::raw::c_ulong,
                &mut creq as *mut _ as *mut std::os::raw::c_void,
            )
        };
        if ret < 0 {
            anyhow::bail!(
                "DRM_IOCTL_MODE_CREATE_DUMB fallita: {}",
                std::io::Error::last_os_error()
            );
        }

        let mut mreq = drm_mode_map_dumb {
            handle: creq.handle,
            ..Default::default()
        };
        let ret = unsafe {
            drmIoctl(
                fd,
                drm_iowr(0xB3, std::mem::size_of::<drm_mode_map_dumb>()) as std::os::raw::c_ulong,
                &mut mreq as *mut _ as *mut std::os::raw::c_void,
            )
        };
        if ret < 0 {
            anyhow::bail!(
                "DRM_IOCTL_MODE_MAP_DUMB fallita: {}",
                std::io::Error::last_os_error()
            );
        }

        let map_size = creq.size as usize;
        let map = unsafe {
            libc::mmap(
                ptr::null_mut(),
                map_size,
                libc::PROT_READ | libc::PROT_WRITE,
                libc::MAP_SHARED,
                fd,
                mreq.offset as libc::off_t,
            )
        };
        if map == libc::MAP_FAILED {
            anyhow::bail!("mmap del dumb buffer fallita: {}", std::io::Error::last_os_error());
        }
        let map = map as *mut u8;

        // Azzera il buffer (nero pieno in XRGB8888, non contenuto
        // indefinito del kernel) prima del primo frame reale.
        unsafe { ptr::write_bytes(map, 0, map_size) };

        let mut fb_handle: u32 = 0;
        let mut handles = [creq.handle, 0, 0, 0];
        let mut pitches = [creq.pitch, 0, 0, 0];
        let mut offsets = [0u32, 0, 0, 0];
        let ret = unsafe {
            drmModeAddFB2(
                fd,
                width,
                height,
                DRM_FORMAT_XRGB8888,
                handles.as_mut_ptr(),
                pitches.as_mut_ptr(),
                offsets.as_mut_ptr(),
                &mut fb_handle,
                0,
            )
        };
        if ret != 0 {
            anyhow::bail!("drmModeAddFB2 fallita: {}", std::io::Error::last_os_error());
        }

        let mut mode_mut = mode;
        let mut conn_id_mut = connector_id;
        let ret = unsafe {
            drmModeSetCrtc(
                fd,
                crtc_id,
                fb_handle,
                0,
                0,
                &mut conn_id_mut,
                1,
                &mut mode_mut,
            )
        };
        if ret != 0 {
            anyhow::bail!("drmModeSetCrtc fallita: {}", std::io::Error::last_os_error());
        }

        Ok(Self {
            _file: file,
            fd,
            fb_handle,
            dumb_handle: creq.handle,
            map,
            map_size,
            pitch: creq.pitch,
            width,
            height,
        })
    }

    /// Converte RGB888 (3 byte/pixel, il formato prodotto da
    /// `lvgl_display::copy_frame_rgb888`) in XRGB8888 (4 byte/pixel, il
    /// formato reale del piano — confermato via debugfs) e scrive
    /// direttamente nel buffer mappato, rispettando il pitch reale (può
    /// differire da width*4 per allineamento hardware — qui non lo fa,
    /// 1280*4=5120=pitch osservato, ma il codice non lo assume).
    ///
    /// # F2 — perché prende le misure della sorgente
    ///
    /// Prima questa funzione dava per scontato che il frame fosse grande quanto
    /// il display e iterava su `self.width`/`self.height` leggendo da `rgb888`.
    /// Con una pagina 800x480 su un display 1280x800 il chiamante passava un
    /// buffer da 1 152 000 byte e questa ne leggeva fino a 3 072 000: **panic da
    /// indice fuori range**, cioè la peggior diagnostica possibile su un
    /// dispositivo senza console — lo schermo resta nero e non lo spiega
    /// nessuno.
    ///
    /// Ora si copia l'**intersezione** fra frame e schermo, alla posizione che
    /// il chiamante indica: le stesse due regole del backend SDL2, che questo
    /// caso lo gestiva già (`page_offset` per centrare, ritaglio esplicito per
    /// non chiedere più pixel di quanti ce ne siano). Due backend che si
    /// comportano diversamente davanti allo stesso progetto sono una divergenza
    /// che si paga più tardi.
    ///
    /// Cosa c'è **attorno** al foglio quando è più piccolo dello schermo resta
    /// indefinito: qui non si dipinge, e sul buffer appena aperto è nero perché
    /// il kernel consegna pagine azzerate. È una decisione di prodotto ancora
    /// aperta — `docs/OPEN_QUESTIONS.md` Q37 — e non va presa di straforo qui.
    pub fn flush_rgb888(&mut self, rgb888: &[u8], src_w: u32, src_h: u32, off: (i32, i32)) {
        let (off_x, off_y, copy_w, copy_h) =
            ritaglio(src_w, src_h, self.width, self.height, off, rgb888.len());
        let row_bytes_src = (src_w * 3) as usize;
        let row_bytes_dst = self.pitch as usize;
        for y in 0..copy_h as usize {
            let src_row = &rgb888[y * row_bytes_src..(y + 1) * row_bytes_src];
            let dst_row_off = (y + off_y as usize) * row_bytes_dst;
            for x in 0..copy_w as usize {
                let s = &src_row[x * 3..x * 3 + 3];
                let dst_off = dst_row_off + (x + off_x as usize) * 4;
                unsafe {
                    // XRGB8888 little-endian in memoria: B,G,R,X.
                    *self.map.add(dst_off) = s[2];
                    *self.map.add(dst_off + 1) = s[1];
                    *self.map.add(dst_off + 2) = s[0];
                    *self.map.add(dst_off + 3) = 0;
                }
            }
        }
    }
}

impl Drop for DrmDisplay {
    fn drop(&mut self) {
        unsafe {
            libc::munmap(self.map as *mut libc::c_void, self.map_size);
            drmModeRmFB(self.fd, self.fb_handle);
            let mut dreq = drm_mode_destroy_dumb {
                handle: self.dumb_handle,
                ..Default::default()
            };
            drmIoctl(
                self.fd,
                drm_iowr(0xB4, std::mem::size_of::<drm_mode_destroy_dumb>()) as std::os::raw::c_ulong,
                &mut dreq as *mut _ as *mut std::os::raw::c_void,
            );
        }
    }
}

/// F2 — quanta parte del frame si può copiare sullo schermo, e da dove.
///
/// Restituisce `(off_x, off_y, larghezza, altezza)` in pixel. È la parte di
/// `flush_rgb888` che decide, separata da quella che scrive in memoria: il
/// difetto stava qui, e qui si può provare senza un framebuffer vero.
///
/// Tre limiti, e nessuno è di troppo:
/// - lo **schermo**: oltre il suo bordo non si scrive, o si torna al panic;
/// - il **frame**: una pagina più piccola non si stira, si centra e basta;
/// - i **byte davvero presenti** in `rgb888`. Non è paranoia: il chiamante
///   dimensiona il buffer sulla pagina e le due misure sono già divergite una
///   volta. Una funzione che non può andare fuori range non lo farà nemmeno il
///   giorno in cui qualcuno cambierà il chiamante senza guardare qui.
pub(crate) fn ritaglio(
    src_w: u32,
    src_h: u32,
    dst_w: u32,
    dst_h: u32,
    off: (i32, i32),
    byte_sorgente: usize,
) -> (u32, u32, u32, u32) {
    // Mai negativo, come `page_offset` in main.rs: una pagina più grande dello
    // schermo parte dall'angolo e viene ritagliata. Spostarla in negativo
    // taglierebbe anche il lato opposto, nascondendo il doppio delle cose.
    let off_x = off.0.max(0) as u32;
    let off_y = off.1.max(0) as u32;
    let row_bytes = (src_w as usize) * 3;
    let righe_presenti = if row_bytes == 0 { 0 } else { (byte_sorgente / row_bytes) as u32 };
    let w = src_w.min(dst_w.saturating_sub(off_x));
    let h = src_h.min(dst_h.saturating_sub(off_y)).min(righe_presenti);
    (off_x, off_y, w, h)
}

#[cfg(test)]
mod tests_ritaglio {
    use super::ritaglio;

    /// Il caso che andava in panic: pagina 800x480 su display 1280x800, buffer
    /// dimensionato sulla pagina. Prima si leggevano 800 righe da un buffer che
    /// ne conteneva 480.
    #[test]
    fn pagina_piu_piccola_del_display() {
        let byte = 800 * 480 * 3;
        assert_eq!(ritaglio(800, 480, 1280, 800, (240, 160), byte), (240, 160, 800, 480));
    }

    /// Pagina più grande: si ritaglia, non si stira, e si parte dall'angolo.
    #[test]
    fn pagina_piu_grande_del_display() {
        let byte = 1920 * 1080 * 3;
        assert_eq!(ritaglio(1920, 1080, 1280, 800, (0, 0), byte), (0, 0, 1280, 800));
    }

    /// Offset negativo (pagina più grande, `page_offset` restituisce 0): non
    /// deve diventare un `as u32` gigantesco.
    #[test]
    fn offset_negativo_vale_zero() {
        let byte = 1920 * 1080 * 3;
        assert_eq!(ritaglio(1920, 1080, 1280, 800, (-320, -140), byte), (0, 0, 1280, 800));
    }

    /// Un buffer più corto di quanto le misure dichiarino non fa uscire dai
    /// bordi: si copia quello che c'è.
    #[test]
    fn un_buffer_corto_limita_le_righe() {
        let byte = 800 * 100 * 3;                       // 100 righe invece di 480
        assert_eq!(ritaglio(800, 480, 1280, 800, (0, 0), byte), (0, 0, 800, 100));
    }

    /// Offset che porta il foglio oltre il bordo: zero pixel, non un
    /// `saturating_sub` che torna a essere enorme.
    #[test]
    fn oltre_il_bordo_non_si_copia_niente() {
        let byte = 800 * 480 * 3;
        assert_eq!(ritaglio(800, 480, 1280, 800, (2000, 2000), byte), (2000, 2000, 0, 0));
    }

    #[test]
    fn misure_a_zero_non_dividono_per_zero() {
        assert_eq!(ritaglio(0, 0, 1280, 800, (0, 0), 0), (0, 0, 0, 0));
    }
}
