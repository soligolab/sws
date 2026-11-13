//! Il banco fisso dei tubi d'acciaio (piano
//! `docs/plans/2026-11-10-assistente-secondo-giro.md`, G1): il copione finto
//! rigiocato sul progetto di prova, senza browser e senza modello.
//!
//! L'e2e (`e2e/chat-tubi.spec.ts`) prova la chat, il diff e il Salva, ma vuole
//! un runtime avviato a mano e non gira in CI. Questo test prende la parte che
//! si rompe in silenzio: un copione scritto a mano che smette di passare il
//! validatore — una bocca rinominata, un materiale tolto, un campo nuovo
//! obbligatorio — e che l'e2e scoprirebbe solo il giorno in cui qualcuno lo
//! lancia.

#[cfg(test)]
mod tests {
    use super::super::{finto_giro, Banco};
    use serde_json::Value;
    use std::path::Path;
    use tokio::sync::mpsc;

    const BANCO: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../tests/fixtures/ai-bench/tubi-acciaio"
    );
    const COPIONE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/ai/sinottico-tubi.json");

    fn copia(da: &Path, a: &Path) {
        std::fs::create_dir_all(a).unwrap();
        for voce in std::fs::read_dir(da).unwrap() {
            let voce = voce.unwrap();
            let dest = a.join(voce.file_name());
            if voce.file_type().unwrap().is_dir() {
                copia(&voce.path(), &dest);
            } else {
                std::fs::copy(voce.path(), dest).unwrap();
            }
        }
    }

    #[tokio::test]
    async fn il_copione_dei_tubi_arriva_alla_proposta() {
        let d = tempfile::tempdir().unwrap();
        let progetto = d.path().join("banco-tubi");
        copia(Path::new(BANCO), &progetto);
        let s = crate::router::stato_di_prova(d.path()).await;
        *s.project_dir.write().await = Some(progetto);

        let (tx, mut rx) = mpsc::unbounded_channel::<String>();
        let mut banco = Banco::default();
        finto_giro(&s, &tx, COPIONE, &mut banco)
            .await
            .expect("il copione deve arrivare in fondo");
        drop(tx);

        let mut miniature = Vec::new();
        let mut proposta = None;
        while let Some(m) = rx.recv().await {
            let v: Value = serde_json::from_str(&m).unwrap();
            match v["t"].as_str() {
                Some("simbolo") => miniature.push(v["slug"].as_str().unwrap().to_string()),
                Some("proposta") => proposta = Some(v),
                _ => {}
            }
        }
        assert_eq!(
            miniature,
            [
                "aspo-svolgitore",
                "raddrizzatrice",
                "gabbia-formatura",
                "saldatrice-hf",
                "sega-volante"
            ]
        );
        let p = proposta.expect("una proposta");
        assert_eq!(
            p["giudizio"]["ok"], true,
            "il validatore non la passa: {}",
            p["giudizio"]
        );
        assert_eq!(p["simboli"].as_array().unwrap().len(), 5);
        assert_eq!(p["project"]["types"][0]["id"], "macchina_linea");
        let pagina = &p["pages"][0];
        assert_eq!(pagina["id"], "linea");
        let simboli: Vec<&str> = pagina["objects"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|o| o["symbol_id"].as_str())
            .collect();
        assert_eq!(simboli.iter().filter(|s| s.starts_with("lib:")).count(), 6);
        assert_eq!(simboli.iter().filter(|s| s.starts_with("prj:")).count(), 5);
    }
}
