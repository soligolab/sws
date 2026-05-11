// TODO: load project, start tag engine, connect comm plugins.

use anyhow::Context;
use axum::{routing::get, Router};
use clap::Parser;
use hyper::body::Incoming;
use hyper_util::rt::{TokioExecutor, TokioIo};
use hyper_util::server::conn::auto::Builder as ConnBuilder;
use rcgen::generate_simple_self_signed;
use std::{net::SocketAddr, path::PathBuf, sync::Arc};
use tokio::net::TcpListener;
use tokio_rustls::{
    rustls::{
        pki_types::{CertificateDer, PrivateKeyDer},
        ServerConfig,
    },
    TlsAcceptor,
};
use tower::Service;
use tracing::{info, warn};
use tracing_subscriber::{fmt, EnvFilter};

#[derive(Parser, Debug)]
#[command(name = "sws-runtime", about = "Soligo Web SCADA runtime")]
struct Args {
    /// Runtime config directory (TLS certificates stored here)
    #[arg(long, default_value = "/var/sws/config")]
    config: PathBuf,

    /// SWS project root directory
    #[arg(long, default_value = "/var/sws/projects/default")]
    project: PathBuf,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();

    fmt()
        .json()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    info!(
        version = env!("CARGO_PKG_VERSION"),
        config  = %args.config.display(),
        project = %args.project.display(),
        "SWS runtime starting"
    );

    let acceptor = build_tls_acceptor(&args.config)?;

    let app = Router::new()
        .route("/health", get(health))
        // TODO: replace with real Prometheus handle from metrics-exporter-prometheus
        .route("/metrics", get(|| async { "# SWS metrics placeholder\n" }));

    let addr: SocketAddr = "0.0.0.0:8443".parse()?;
    let listener = TcpListener::bind(addr).await?;
    info!(%addr, "HTTPS listener ready");

    loop {
        let (stream, peer) = tokio::select! {
            res = listener.accept() => match res {
                Ok(v)  => v,
                Err(e) => { warn!("accept error: {e}"); continue; }
            },
            _ = tokio::signal::ctrl_c() => {
                info!("shutdown signal received");
                break;
            }
        };

        let acceptor = acceptor.clone();
        let svc = app.clone();

        tokio::spawn(async move {
            let tls_stream = match acceptor.accept(stream).await {
                Ok(s)  => s,
                Err(e) => { warn!(%peer, "TLS handshake failed: {e}"); return; }
            };
            let io      = TokioIo::new(tls_stream);
            let hyper_svc = hyper::service::service_fn(move |req: axum::extract::Request<Incoming>| {
                svc.clone().call(req)
            });
            if let Err(e) = ConnBuilder::new(TokioExecutor::new())
                .serve_connection_with_upgrades(io, hyper_svc)
                .await
            {
                warn!(%peer, "connection error: {e}");
            }
        });
    }

    Ok(())
}

async fn health() -> &'static str {
    "ok"
}

/// Load `tls.crt`/`tls.key` from `config_dir`.
/// Generates a self-signed certificate for `localhost` on first run.
fn build_tls_acceptor(config_dir: &PathBuf) -> anyhow::Result<TlsAcceptor> {
    let cert_path = config_dir.join("tls.crt");
    let key_path  = config_dir.join("tls.key");

    if !cert_path.exists() || !key_path.exists() {
        info!("generating self-signed TLS certificate");
        std::fs::create_dir_all(config_dir).context("creating config directory")?;
        let certified = generate_simple_self_signed(vec!["localhost".into()])
            .context("rcgen: generate_simple_self_signed")?;
        std::fs::write(&cert_path, certified.cert.pem())
            .context("writing tls.crt")?;
        std::fs::write(&key_path, certified.key_pair.serialize_pem())
            .context("writing tls.key")?;
    }

    let cert_pem = std::fs::read(&cert_path).context("reading tls.crt")?;
    let key_pem  = std::fs::read(&key_path).context("reading tls.key")?;

    let certs: Vec<CertificateDer<'static>> =
        rustls_pemfile::certs(&mut cert_pem.as_slice())
            .collect::<Result<_, _>>()
            .context("parsing certificate PEM")?;

    let key: PrivateKeyDer<'static> =
        rustls_pemfile::private_key(&mut key_pem.as_slice())
            .context("parsing private key PEM")?
            .ok_or_else(|| anyhow::anyhow!("no private key found in tls.key"))?;

    let tls_cfg = ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(certs, key)
        .context("building TLS ServerConfig")?;

    Ok(TlsAcceptor::from(Arc::new(tls_cfg)))
}
