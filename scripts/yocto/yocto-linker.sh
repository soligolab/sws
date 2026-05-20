#!/bin/sh
# Linker wrapper for cross-compiling Rust crates against the Pixsys Yocto
# SDK (cortex-a35 / aarch64). Invoked by cargo via
#   CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=scripts/yocto/yocto-linker.sh
# (set by scripts/yocto/build.sh).
#
# The flags here mirror what `environment-setup-cortexa35-pixsys-linux`
# bakes into $CC at SDK install time — keep them in sync if the SDK is
# upgraded. The same binary runs on PX30, RK3399 and RK3588 because
# cortex-a35 is the lowest ARMv8 baseline of the three.

exec aarch64-pixsys-linux-gcc \
    -mcpu=cortex-a35+crc+crypto -mbranch-protection=standard \
    -fstack-protector-strong -O2 -D_FORTIFY_SOURCE=2 \
    -Wformat -Wformat-security -Werror=format-security \
    --sysroot=/usr/local/oecore-x86_64/sysroots/cortexa35-pixsys-linux \
    "$@"
