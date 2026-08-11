# Estende Containerfile.aarch64-generic.builder con ciò che sws-lvgl-viewer
# richiede oltre a sws-runtime: clang/libclang (bindgen, per lvgl-sys),
# libsdl2-dev (SDL2 di sistema, collegato direttamente dal crate) e
# libdrm-dev (bindgen contro libdrm per src/drm_display.rs — percorso di
# rendering DRM/KMS diretto, alternativo a SDL2, aggiunto il 2026-08-10 dopo
# aver isolato un bug del driver Rockchip sul percorso KMS atomico, vedi
# docs/OPEN_QUESTIONS.md Q14 e build.rs del crate). Layer separato invece di
# aggiungerli al builder condiviso: il percorso sws-runtime-only (il
# default, chi non passa --with-lvgl) non deve appesantirsi per una
# dipendenza che non usa.
#
# FROM il tag prodotto dallo stesso script (scripts/build_container_
# aarch64_generic.sh) per il builder di base — non un ARG parametrizzabile:
# questo file è pensato per essere costruito solo da lì, non riusato altrove.
FROM sws-runtime-builder:aarch64-generic

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        clang \
        libclang-dev \
        libsdl2-dev \
        libdrm-dev && \
    rm -rf /var/lib/apt/lists/*
