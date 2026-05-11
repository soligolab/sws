# Stage 1 — build
FROM rust:1.75-bookworm AS builder

WORKDIR /build
COPY . .

RUN cargo build --release --bin sws-runtime

# Generate CycloneDX SBOM
RUN cargo install cargo-cyclonedx --locked && \
    cargo cyclonedx --format json --output-file /build/sbom.cdx.json

# Stage 2 — minimal runtime image
FROM debian:bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        libpython3.11 && \
    rm -rf /var/lib/apt/lists/*

RUN useradd --system --no-create-home --shell /usr/sbin/nologin sws

COPY --from=builder /build/target/release/sws-runtime /usr/local/bin/sws-runtime
COPY --from=builder /build/sbom.cdx.json              /usr/share/sws/sbom.cdx.json
COPY docker/entrypoint.sh                              /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8443
EXPOSE 9090

USER sws

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsk https://localhost:8443/health || exit 1

ENTRYPOINT ["/entrypoint.sh"]
CMD ["sws-runtime"]
