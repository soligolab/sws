// Bindgen minimale contro libdrm (solo le funzioni/struct usate da
// src/drm_display.rs) — percorso di rendering DRM/KMS diretto, alternativo a
// SDL2, aggiunto il 2026-08-10 dopo aver isolato un bug del driver Rockchip
// sul percorso KMS *atomico* (usato sia da SDL2 sia dal driver `drm.c` già
// vendorizzato in lvgl-sys — vedi il suo `drmModeAtomicCommit`): con Weston
// fermo, anche `modetest -a` mostra schermo nero, mentre `modetest` senza
// `-a` (API legacy, drmModeSetCrtc) funziona — vedi docs/OPEN_QUESTIONS.md
// Q14. Bindgen (non FFI scritta a mano) per gli stessi motivi di lvgl-sys:
// gli struct del kernel DRM UAPI sono stabili ma non vale la pena rischiare
// un errore di layout copiandoli a mano quando bindgen li legge dai veri
// header installati (libdrm-dev, già richiesto dal builder LVGL esistente).
/// Da dove leggere gli header di sistema.
///
/// In cross-build gli header vanno presi dal **sysroot del target**, non
/// dall'host: sono due architetture diverse, e bindgen genererebbe struct con
/// il layout sbagliato mentre il link va contro la `libdrm` aarch64. Il difetto
/// era latente perché fino al 2026-08-24 nessuno aveva mai cross-compilato
/// questo crate — l'SDK Pixsys non era disponibile su nessuna macchina.
///
/// `OECORE_TARGET_SYSROOT` lo esporta l'ambiente dell'SDK Yocto; fuori da
/// quello si ricade sull'host, che è il caso del build nativo x86_64.
fn sysroot_clang_args() -> Vec<String> {
    match std::env::var("OECORE_TARGET_SYSROOT") {
        Ok(s) if !s.trim().is_empty() => {
            println!("cargo:warning=bindgen: sysroot del target = {s}");
            vec![
                format!("--sysroot={s}"),
                // xf86drm.h fa un bare `#include <drm.h>`, che sta in una
                // sottodirectory: senza questa -I non risolve.
                format!("-I{s}/usr/include/libdrm"),
                format!("-I{s}/usr/include"),
            ]
        }
        _ => vec!["-I/usr/include/libdrm".to_string()],
    }
}

fn main() {
    println!("cargo:rustc-link-lib=drm");
    println!("cargo:rerun-if-env-changed=OECORE_TARGET_SYSROOT");

    let mut builder = bindgen::Builder::default();
    for arg in sysroot_clang_args() {
        builder = builder.clang_arg(arg);
    }

    let bindings = builder
        .header_contents(
            "drm_wrapper.h",
            "#include <xf86drm.h>\n#include <xf86drmMode.h>\n#include <drm_fourcc.h>\n\
             #include <drm.h>\n",
        )
        .allowlist_function("drmModeGetResources")
        .allowlist_function("drmModeFreeResources")
        .allowlist_function("drmModeGetConnector")
        .allowlist_function("drmModeFreeConnector")
        .allowlist_function("drmModeGetEncoder")
        .allowlist_function("drmModeFreeEncoder")
        .allowlist_function("drmModeGetCrtc")
        .allowlist_function("drmModeFreeCrtc")
        .allowlist_function("drmModeSetCrtc")
        .allowlist_function("drmModeAddFB2")
        .allowlist_function("drmModeRmFB")
        .allowlist_function("drmIoctl")
        .allowlist_type("drmModeRes")
        .allowlist_type("drmModeConnector")
        .allowlist_type("drmModeEncoder")
        .allowlist_type("drmModeCrtc")
        .allowlist_type("drmModeModeInfo")
        .allowlist_type("drm_mode_create_dumb")
        .allowlist_type("drm_mode_map_dumb")
        .allowlist_type("drm_mode_destroy_dumb")
        // DRM_MODE_CONNECTED è una costante enum (drmModeConnection), non
        // una macro: bindgen la genera come `drmModeConnection_DRM_MODE_
        // CONNECTED` (prefissata col tipo) automaticamente insieme allo
        // struct drmModeConnector che la usa — nessun allowlist_var extra
        // necessario, verificato leggendo l'output generato.
        //
        // DRM_IOCTL_MODE_* e DRM_FORMAT_XRGB8888 NON allowlistati: sono
        // macro function-like (DRM_IOWR(...)/fourcc_code(...), non
        // letterali) — bindgen non le valuta. Ricalcolate/hardcoded in
        // drm_display.rs — vedi i commenti lì (drm_iowr() per le prime,
        // verificate contro /usr/include/asm-generic/ioctl.h e drm.h; il
        // valore del formato verificato dal vero output di
        // /sys/kernel/debug/dri/1/state su tc620-a-p3-c6-07aff9.local).
        .derive_default(true)
        .generate()
        .expect("Impossibile generare i binding libdrm (manca libdrm-dev?)");

    let out_path = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap());
    bindings
        .write_to_file(out_path.join("drm_bindings.rs"))
        .expect("scrittura drm_bindings.rs fallita");
}
