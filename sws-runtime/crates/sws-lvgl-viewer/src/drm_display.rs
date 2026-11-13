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

#![allow(
    non_camel_case_types,
    non_snake_case,
    non_upper_case_globals,
    dead_code
)]

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

/// The copy below writes LVGL's pixels as they are: they must be XRGB8888.
const _: () = assert!(
    crate::pixel::PX == 4,
    "the DRM path wants LV_COLOR_DEPTH 32"
);

/// `DRM_MODE_PAGE_FLIP_EVENT` (drm_mode.h): the kernel sends an event when the
/// flip has happened.
const PAGE_FLIP_EVENT: u32 = 0x01;

/// One dumb buffer with its framebuffer, mapped in memory.
struct Buffer {
    fb: u32,
    dumb: u32,
    map: *mut u8,
    size: usize,
}

pub struct DrmDisplay {
    _file: File, // tenuto vivo solo per chiudere il fd al Drop
    fd: RawFd,
    crtc_id: u32,
    /// Two buffers shown in turn with the legacy page flip (13-11-2026, plan
    /// `docs/archive/2026-11-13-lvgl-32-bit.md`): the screen never reads the one
    /// being written, so no tearing. One only if the second could not be
    /// made or the driver refuses the flip.
    buffers: Vec<Buffer>,
    /// The buffer on screen.
    front: usize,
    /// The zone copied into the other buffer at the previous flip: the one now
    /// hidden has not got it yet, and gets it with the next zone.
    previous: Option<crate::lvgl_display::Zona>,
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
            if conn_ref.connection == drmModeConnection_DRM_MODE_CONNECTED
                && conn_ref.count_modes > 0
            {
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
        let (first, pitch) = crea_buffer(fd, width, height)?;
        let mut buffers = vec![first];
        match crea_buffer(fd, width, height) {
            Ok((second, _)) => buffers.push(second),
            Err(e) => {
                eprintln!("[drm] second buffer not available ({e}): one buffer, no page flip")
            }
        }

        let mut mode_mut = mode;
        let mut conn_id_mut = connector_id;
        let ret = unsafe {
            drmModeSetCrtc(
                fd,
                crtc_id,
                buffers[0].fb,
                0,
                0,
                &mut conn_id_mut,
                1,
                &mut mode_mut,
            )
        };
        if ret != 0 {
            anyhow::bail!(
                "drmModeSetCrtc fallita: {}",
                std::io::Error::last_os_error()
            );
        }

        Ok(Self {
            _file: file,
            fd,
            crtc_id,
            buffers,
            front: 0,
            previous: None,
            pitch,
            width,
            height,
        })
    }

    /// Q37 — riempie l'INTERO framebuffer, **tutti e due i buffer**, col colore
    /// dato (XRGB8888).
    /// Chiamata una volta all'avvio, prima del primo frame: la pagina la
    /// sovrascrive a ogni flush, il resto è la cornice, che così è un colore
    /// deliberato (il neutro delle bande del viewer web) e non «memoria come
    /// capita». Il dumb buffer del kernel nasce azzerato — nero — ma nero e
    /// dichiarato sono due cose diverse, ed era il punto della scheda.
    pub fn riempi(&mut self, r: u8, g: u8, b: u8) {
        let row_bytes = self.pitch as usize;
        let px = u32::from_le_bytes([b, g, r, 0]);
        // Both buffers: each one is shown in turn.
        for buf in &self.buffers {
            for y in 0..self.height as usize {
                for x in 0..self.width as usize {
                    unsafe { (buf.map.add(y * row_bytes + x * 4) as *mut u32).write(px) };
                }
            }
        }
        self.previous = None;
    }

    /// Brings `zona` of the page (LVGL's buffer, XRGB8888, `src_w` pixels per
    /// row) to the screen at `off`. With two buffers: into the hidden one, with
    /// the zone of the previous flip, then a page flip; with one: in place.
    pub fn flush_zona(
        &mut self,
        page: &[u8],
        src_w: u32,
        src_h: u32,
        off: (i32, i32),
        zona: crate::lvgl_display::Zona,
    ) {
        if self.buffers.len() < 2 {
            self.copia(0, page, src_w, src_h, off, zona);
            return;
        }
        let back = 1 - self.front;
        let tutta = match self.previous {
            Some(p) => zona.unione(p),
            None => zona,
        };
        self.copia(back, page, src_w, src_h, off, tutta);
        let ret = unsafe {
            drmModePageFlip(
                self.fd,
                self.crtc_id,
                self.buffers[back].fb,
                PAGE_FLIP_EVENT,
                ptr::null_mut(),
            )
        };
        if ret != 0 {
            // The driver refuses the flip: one buffer from now on, the one on
            // screen, written in place (as before 13-11-2026).
            eprintln!(
                "[drm] page flip refused ({}): one buffer from now on",
                std::io::Error::last_os_error()
            );
            let front = self.buffers.swap_remove(back);
            drop_buffer(self.fd, front);
            self.front = 0;
            self.previous = None;
            self.copia(0, page, src_w, src_h, off, tutta);
            return;
        }
        self.aspetta_flip();
        self.front = back;
        self.previous = Some(zona);
    }

    /// Waits for the flip event (at most 100 ms, a few frames) and drains it:
    /// the next copy must not write into the buffer still on screen.
    fn aspetta_flip(&self) {
        let mut pfd = libc::pollfd {
            fd: self.fd,
            events: libc::POLLIN,
            revents: 0,
        };
        if unsafe { libc::poll(&mut pfd, 1, 100) } > 0 {
            let mut ev = [0u8; 256];
            unsafe { libc::read(self.fd, ev.as_mut_ptr() as *mut libc::c_void, ev.len()) };
        }
    }

    /// Copies `zona` of the page into buffer `i`, row by row, no conversion.
    fn copia(
        &self,
        i: usize,
        page: &[u8],
        src_w: u32,
        src_h: u32,
        off: (i32, i32),
        zona: crate::lvgl_display::Zona,
    ) {
        let (off_x, off_y, copy_w, copy_h) =
            ritaglio(src_w, src_h, self.width, self.height, off, page.len());
        let Some((x0, y0, x1, y1)) = dentro(zona, copy_w, copy_h) else {
            return;
        };
        let map = self.buffers[i].map;
        let src_row = src_w as usize * 4;
        let n = (x1 - x0 + 1) * 4;
        for y in y0..=y1 {
            let src = &page[y * src_row + x0 * 4..y * src_row + x0 * 4 + n];
            let dst_off = (y + off_y as usize) * self.pitch as usize + (x0 + off_x as usize) * 4;
            unsafe { ptr::copy_nonoverlapping(src.as_ptr(), map.add(dst_off), n) };
        }
    }
}

/// La parte di `zona` che cade nei `copy_w`×`copy_h` pixel copiabili, come
/// indici `(x0, y0, x1, y1)` inclusi; `None` se è fuori.
pub(crate) fn dentro(
    zona: crate::lvgl_display::Zona,
    copy_w: u32,
    copy_h: u32,
) -> Option<(usize, usize, usize, usize)> {
    if copy_w == 0 || copy_h == 0 || zona.x1 >= copy_w || zona.y1 >= copy_h {
        return None;
    }
    Some((
        zona.x1 as usize,
        zona.y1 as usize,
        zona.x2.min(copy_w - 1) as usize,
        zona.y2.min(copy_h - 1) as usize,
    ))
}

impl Drop for DrmDisplay {
    fn drop(&mut self) {
        for b in self.buffers.drain(..) {
            drop_buffer(self.fd, b);
        }
    }
}

fn drop_buffer(fd: RawFd, b: Buffer) {
    unsafe {
        libc::munmap(b.map as *mut libc::c_void, b.size);
        drmModeRmFB(fd, b.fb);
        let mut dreq = drm_mode_destroy_dumb { handle: b.dumb };
        drmIoctl(
            fd,
            drm_iowr(0xB4, std::mem::size_of::<drm_mode_destroy_dumb>()) as std::os::raw::c_ulong,
            &mut dreq as *mut _ as *mut std::os::raw::c_void,
        );
    }
}

/// One dumb buffer XRGB8888 `width × height`, mapped and cleared, with its
/// framebuffer. Returns it and its pitch.
fn crea_buffer(fd: RawFd, width: u32, height: u32) -> anyhow::Result<(Buffer, u32)> {
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
    let size = creq.size as usize;
    let map = unsafe {
        libc::mmap(
            ptr::null_mut(),
            size,
            libc::PROT_READ | libc::PROT_WRITE,
            libc::MAP_SHARED,
            fd,
            mreq.offset as libc::off_t,
        )
    };
    if map == libc::MAP_FAILED {
        anyhow::bail!(
            "mmap del dumb buffer fallita: {}",
            std::io::Error::last_os_error()
        );
    }
    let map = map as *mut u8;
    // Nero pieno in XRGB8888, non contenuto indefinito del kernel.
    unsafe { ptr::write_bytes(map, 0, size) };
    let mut fb: u32 = 0;
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
            &mut fb,
            0,
        )
    };
    if ret != 0 {
        anyhow::bail!("drmModeAddFB2 fallita: {}", std::io::Error::last_os_error());
    }
    Ok((
        Buffer {
            fb,
            dumb: creq.handle,
            map,
            size,
        },
        creq.pitch,
    ))
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
    let row_bytes = (src_w as usize) * crate::pixel::PX;
    let righe_presenti = if row_bytes == 0 {
        0
    } else {
        (byte_sorgente / row_bytes) as u32
    };
    let w = src_w.min(dst_w.saturating_sub(off_x));
    let h = src_h.min(dst_h.saturating_sub(off_y)).min(righe_presenti);
    (off_x, off_y, w, h)
}

#[cfg(test)]
mod tests_dentro {
    use super::dentro;
    use crate::lvgl_display::Zona;

    #[test]
    fn una_zona_dentro_resta_com_e() {
        let z = Zona {
            x1: 10,
            y1: 20,
            x2: 30,
            y2: 40,
        };
        assert_eq!(dentro(z, 800, 480), Some((10, 20, 30, 40)));
    }

    #[test]
    fn una_zona_oltre_il_bordo_si_taglia() {
        let z = Zona {
            x1: 700,
            y1: 400,
            x2: 900,
            y2: 600,
        };
        assert_eq!(dentro(z, 800, 480), Some((700, 400, 799, 479)));
    }

    #[test]
    fn una_zona_fuori_non_copia_niente() {
        let z = Zona {
            x1: 800,
            y1: 0,
            x2: 900,
            y2: 10,
        };
        assert_eq!(dentro(z, 800, 480), None);
        assert_eq!(
            dentro(
                Zona {
                    x1: 0,
                    y1: 0,
                    x2: 0,
                    y2: 0
                },
                0,
                0
            ),
            None
        );
    }
}

#[cfg(test)]
mod tests_ritaglio {
    use super::ritaglio;

    /// Il caso che andava in panic: pagina 800x480 su display 1280x800, buffer
    /// dimensionato sulla pagina. Prima si leggevano 800 righe da un buffer che
    /// ne conteneva 480.
    #[test]
    fn pagina_piu_piccola_del_display() {
        let byte = 800 * 480 * 4;
        assert_eq!(
            ritaglio(800, 480, 1280, 800, (240, 160), byte),
            (240, 160, 800, 480)
        );
    }

    /// Pagina più grande: si ritaglia, non si stira, e si parte dall'angolo.
    #[test]
    fn pagina_piu_grande_del_display() {
        let byte = 1920 * 1080 * 4;
        assert_eq!(
            ritaglio(1920, 1080, 1280, 800, (0, 0), byte),
            (0, 0, 1280, 800)
        );
    }

    /// Offset negativo (pagina più grande, `page_offset` restituisce 0): non
    /// deve diventare un `as u32` gigantesco.
    #[test]
    fn offset_negativo_vale_zero() {
        let byte = 1920 * 1080 * 4;
        assert_eq!(
            ritaglio(1920, 1080, 1280, 800, (-320, -140), byte),
            (0, 0, 1280, 800)
        );
    }

    /// Un buffer più corto di quanto le misure dichiarino non fa uscire dai
    /// bordi: si copia quello che c'è.
    #[test]
    fn un_buffer_corto_limita_le_righe() {
        let byte = 800 * 100 * 4; // 100 righe invece di 480
        assert_eq!(
            ritaglio(800, 480, 1280, 800, (0, 0), byte),
            (0, 0, 800, 100)
        );
    }

    /// Offset che porta il foglio oltre il bordo: zero pixel, non un
    /// `saturating_sub` che torna a essere enorme.
    #[test]
    fn oltre_il_bordo_non_si_copia_niente() {
        let byte = 800 * 480 * 4;
        assert_eq!(
            ritaglio(800, 480, 1280, 800, (2000, 2000), byte),
            (2000, 2000, 0, 0)
        );
    }

    #[test]
    fn misure_a_zero_non_dividono_per_zero() {
        assert_eq!(ritaglio(0, 0, 1280, 800, (0, 0), 0), (0, 0, 0, 0));
    }
}
