//! The free-SVG symbol through the whole turn of the assistant (plan
//! `docs/archive/2026-11-10-assistente-secondo-giro.md`, G3): the fake script
//! replayed on the bench of the steel tubes, without a browser and without a
//! model.
//!
//! Twin of `banco_tubi.rs` and `bench_house.rs`. What it holds together: the
//! draft drawn as SVG is seen by `valida`, its ports are the ones the pipes
//! of the page name, and the proposal carries it as a custom symbol of the
//! project — next to the ones the project already had, which the model never
//! sees whole.

#[cfg(test)]
mod tests {
    use super::super::{finto_giro, tools, Banco};
    use serde_json::{json, Value};
    use std::path::Path;
    use tokio::sync::mpsc;

    const BENCH: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../tests/fixtures/ai-bench/tubi-acciaio"
    );
    const SCRIPT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/ai/free-svg-symbol.json");

    fn copy(from: &Path, to: &Path) {
        std::fs::create_dir_all(to).unwrap();
        for entry in std::fs::read_dir(from).unwrap() {
            let entry = entry.unwrap();
            let dest = to.join(entry.file_name());
            if entry.file_type().unwrap().is_dir() {
                copy(&entry.path(), &dest);
            } else {
                std::fs::copy(entry.path(), dest).unwrap();
            }
        }
    }

    /// A custom symbol the person imported by hand, before the assistant.
    const IMPORTED: &str = "\ncustom_symbols:\n  - id: logo\n    label: Logo\n    url: ''\n    \
        attribution: { author: me, source: drawn, license: mine }\n    \
        svg: '<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 10 10\"><rect width=\"10\" height=\"10\"/></svg>'\n";

    #[tokio::test]
    async fn the_free_svg_script_reaches_the_proposal() {
        let d = tempfile::tempdir().unwrap();
        let project = d.path().join("bench-free-symbol");
        copy(Path::new(BENCH), &project);
        let yaml = project.join("project.yaml");
        let text = std::fs::read_to_string(&yaml).unwrap();
        std::fs::write(&yaml, format!("{text}{IMPORTED}")).unwrap();
        let s = crate::router::stato_di_prova(d.path()).await;
        *s.project_dir.write().await = Some(project);

        // What the model reads of the project: the imported symbol, without
        // its drawing.
        let read = tools::esegui(&s, "leggi_progetto", &json!({}))
            .await
            .unwrap();
        assert_eq!(read["custom_symbols"][0]["id"], "logo");
        assert!(read["custom_symbols"][0].get("svg").is_none());

        let (tx, mut rx) = mpsc::unbounded_channel::<String>();
        let mut bench = Banco::default();
        finto_giro(&s, &tx, SCRIPT, &mut bench)
            .await
            .expect("the script must reach its end");
        drop(tx);

        let mut thumbnails = Vec::new();
        let mut proposal = None;
        while let Some(m) = rx.recv().await {
            let v: Value = serde_json::from_str(&m).unwrap();
            match v["t"].as_str() {
                Some("simbolo") => thumbnails.push(v),
                Some("proposta") => proposal = Some(v),
                _ => {}
            }
        }

        // The person sees the draft in chat, as for a compiled symbol.
        assert_eq!(thumbnails.len(), 1);
        assert_eq!(thumbnails[0]["slug"], "ciclone");
        assert_eq!(thumbnails[0]["en"], "Cyclone separator");
        assert!(thumbnails[0]["svg"].as_str().unwrap().starts_with("<svg"));
        assert_eq!(bench.free_symbols.len(), 1);
        assert!(bench.simboli.is_empty());

        let p = proposal.expect("a proposal");
        assert_eq!(
            p["giudizio"]["ok"], true,
            "the validator does not pass it: {}",
            p["giudizio"]
        );
        // The two pipes name ports of the cyclone: nothing to say about them.
        let on_ports: Vec<&Value> = p["giudizio"]["rilievi"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|f| f["path"].as_str().is_some_and(|x| x.ends_with("_port")))
            .collect();
        assert!(on_ports.is_empty(), "{on_ports:?}");

        // The project of the proposal: the imported symbol whole, as on the
        // disk, and the cyclone with its size and ports.
        let symbols = p["project"]["custom_symbols"].as_array().unwrap();
        assert_eq!(symbols.len(), 2);
        assert_eq!(symbols[0]["id"], "logo");
        assert!(symbols[0]["svg"].as_str().unwrap().contains("<rect"));
        let cyclone = &symbols[1];
        assert_eq!(cyclone["id"], "ciclone");
        assert_eq!(cyclone["label"], "Ciclone separatore");
        assert_eq!(cyclone["view_box"], json!([80.0, 120.0]));
        assert_eq!(cyclone["ports"][0]["id"], "n-left");
        assert_eq!(cyclone["ports"][1]["side"], "bottom");
        assert!(cyclone["svg"]
            .as_str()
            .unwrap()
            .contains("url(#cs-ciclone-shell)"));
        // The thumbnail of the diff.
        assert_eq!(p["simboli"].as_array().unwrap().len(), 1);
        assert_eq!(p["simboli"][0]["symbol_id"], "custom:ciclone");

        let page = &p["pages"][0];
        let object = |id: &str| {
            page["objects"]
                .as_array()
                .unwrap()
                .iter()
                .find(|o| o["id"] == id)
                .unwrap_or_else(|| panic!("no object `{id}` in the page"))
        };
        assert_eq!(object("cyclone")["symbol_id"], "custom:ciclone");
        assert_eq!(object("p_fan_cyclone")["to_port"], "n-left");
        assert_eq!(object("p_cyclone_tank")["from_port"], "n-bottom");

        // A pipe to a port the cyclone does not have is told to the model,
        // with the ports it has.
        let mut wrong = page.clone();
        wrong["objects"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|o| o["id"] == "p_fan_cyclone")
            .unwrap()["to_port"] = json!("n-top");
        let (judgement, _) = tools::valida_interna(
            &s,
            &json!({ "pages": [wrong] }),
            &bench.simboli,
            &bench.free_symbols,
            false,
        )
        .await
        .unwrap();
        let finding = judgement["rilievi"]
            .as_array()
            .unwrap()
            .iter()
            .find(|f| f["path"].as_str().is_some_and(|x| x.ends_with(".to_port")))
            .expect("a finding on the pipe end");
        assert!(
            finding["hint"]
                .as_str()
                .unwrap()
                .contains("n-left, n-bottom"),
            "{finding}"
        );

        // And a page that names a custom symbol nobody drew does not pass.
        let mut ghost = page.clone();
        ghost["objects"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|o| o["id"] == "cyclone")
            .unwrap()["symbol_id"] = json!("custom:ghost");
        let (judgement, _) = tools::valida_interna(
            &s,
            &json!({ "pages": [ghost] }),
            &bench.simboli,
            &bench.free_symbols,
            false,
        )
        .await
        .unwrap();
        assert_eq!(judgement["ok"], false, "{judgement}");
        assert!(judgement.to_string().contains("custom:ghost"));

        // The board of the drafts: the cyclone is there, in its proportions.
        let board = super::super::tavola_delle_bozze(&bench.simboli, &bench.free_symbols);
        let on_board = &board["objects"][0];
        assert_eq!(on_board["symbol_id"], "custom:ciclone");
        let ratio = on_board["width"].as_f64().unwrap() / on_board["height"].as_f64().unwrap();
        assert!((ratio - 80.0 / 120.0).abs() < 0.02, "{ratio}");
    }

    /// What was already wrong on the disk is not an error of the proposal,
    /// and what a caller changes in `custom_symbols` is told as not taken.
    #[tokio::test]
    async fn valida_tells_old_defects_from_new_and_what_it_did_not_take() {
        let d = tempfile::tempdir().unwrap();
        let project = d.path().join("bench-free-symbol");
        copy(Path::new(BENCH), &project);
        let yaml = project.join("project.yaml");
        let text = std::fs::read_to_string(&yaml).unwrap();
        // The imported symbol has ports, and a page of the disk still shows
        // a custom symbol that was removed from the project.
        std::fs::write(
            &yaml,
            format!(
                "{text}{IMPORTED}    view_box: [10, 10]\n    ports:\n      \
                 - {{ id: n-left, x: 0, y: 5, side: left, d: 2 }}\n"
            ),
        )
        .unwrap();
        std::fs::write(
            project.join("synoptics/Vecchia.yaml"),
            "id: vecchia\nname: Vecchia\nwidth: 1280\nheight: 800\nobjects:\n  \
             - { id: old, type: symbol, x: 100, y: 100, width: 80, height: 80, symbol_id: \"custom:removed\" }\n",
        )
        .unwrap();
        let s = crate::router::stato_di_prova(d.path()).await;
        *s.project_dir.write().await = Some(project);

        let on_symbol = |judgement: &Value| -> Vec<Value> {
            judgement["rilievi"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|f| {
                    f["path"]
                        .as_str()
                        .is_some_and(|p| p.ends_with(".symbol_id"))
                })
                .cloned()
                .collect()
        };

        // The page comes back with one object moved: the missing symbol was
        // there before, the proposal passes and no correction round is spent.
        let mut page = tools::esegui(&s, "leggi_pagina", &json!({ "nome": "Vecchia" }))
            .await
            .unwrap();
        page["objects"][0]["x"] = json!(300);
        let judgement = tools::valida(&s, &json!({ "pages": [page.clone()] }))
            .await
            .unwrap();
        assert_eq!(judgement["ok"], true, "{judgement}");
        let found = on_symbol(&judgement);
        assert_eq!(found.len(), 1, "{judgement}");
        assert!(found[0]["message"]
            .as_str()
            .unwrap()
            .contains("custom:removed"));
        assert_eq!(found[0]["preesistente"], true);

        // One the proposal adds is its own error, next to the old one.
        page["objects"].as_array_mut().unwrap().push(
            json!({ "id": "new", "type": "symbol", "x": 500, "y": 100, "width": 80,
                          "height": 80, "symbol_id": "custom:ghost" }),
        );
        let judgement = tools::valida(&s, &json!({ "pages": [page] }))
            .await
            .unwrap();
        assert_eq!(judgement["ok"], false, "{judgement}");
        assert_eq!(judgement["errori_nuovi"], 1, "{judgement}");
        assert_eq!(on_symbol(&judgement).len(), 2);

        // The project sent back as it was read: nothing about its symbols.
        let read = tools::esegui(&s, "leggi_progetto", &json!({}))
            .await
            .unwrap();
        let on_custom = |judgement: &Value| -> Option<Value> {
            judgement["rilievi"]
                .as_array()
                .unwrap()
                .iter()
                .find(|f| f["path"] == "project.custom_symbols")
                .cloned()
        };
        let judgement = tools::valida(&s, &json!({ "project": read.clone() }))
            .await
            .unwrap();
        assert!(on_custom(&judgement).is_none(), "{judgement}");
        // With a port moved outside the drawing the verdict is still about
        // the symbol of the disk — and now it says so.
        let mut moved = read.clone();
        moved["custom_symbols"][0]["ports"][0]["x"] = json!(200);
        let judgement = tools::valida(&s, &json!({ "project": moved }))
            .await
            .unwrap();
        let said = on_custom(&judgement).expect("the change was not taken, and it is said");
        assert_eq!(said["severity"], "warning");
        assert!(
            said["message"].as_str().unwrap().contains("changed: logo"),
            "{said}"
        );
        assert_eq!(judgement["ok"], true, "{judgement}");
    }

    /// One draft per slug: drawing it again the other way replaces it.
    #[test]
    fn a_slug_is_one_draft_whatever_the_way() {
        let mut bench = Banco::default();
        let (tx, _rx) = mpsc::unbounded_channel::<String>();
        let free = super::super::free_symbol_tool::tests::cyclone_input();
        let r = super::super::bozza(&tx, &mut bench, &free).unwrap();
        assert_eq!(r["symbol_id"], "custom:cyclone");
        assert!(bench.has_symbol_drafts());
        // Again as free SVG: still one.
        super::super::bozza(&tx, &mut bench, &free).unwrap();
        assert_eq!(bench.free_symbols.len(), 1);
        // A wrong one leaves the bench as it was, and says why.
        let mut wrong = free.clone();
        wrong["svg"] = json!("<svg viewBox=\"0 0 80 120\"><text>x</text></svg>");
        let e = super::super::bozza(&tx, &mut bench, &wrong).unwrap_err();
        assert!(e.contains("no fonts"), "{e}");
        assert_eq!(bench.free_symbols.len(), 1);
        // The same slug as a description: the free one leaves.
        let mut description: Value = serde_json::from_str(include_str!(
            "../../../../../tests/fixtures/simboli-prj/gabbia-laminazione.json"
        ))
        .unwrap();
        description["slug"] = json!("cyclone");
        let r =
            super::super::bozza(&tx, &mut bench, &json!({ "descrizione": description })).unwrap();
        assert_eq!(r["symbol_id"], "prj:cyclone");
        assert!(bench.free_symbols.is_empty());
        assert_eq!(bench.simboli.len(), 1);
        super::super::bozza(&tx, &mut bench, &free).unwrap();
        assert!(bench.simboli.is_empty());
        assert_eq!(bench.free_symbols.len(), 1);
    }
}
