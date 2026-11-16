//! The fixed bench of the house (plan
//! `docs/archive/2026-11-10-assistente-secondo-giro.md`, G2): the fake script
//! replayed on the bench project, without a browser and without a model.
//!
//! Twin of `banco_tubi.rs`, for the same reason: a hand-written script stops
//! passing in silence — a renamed field of the floor plan, a part of a symbol
//! that changes name — and the e2e (`e2e/chat-house.spec.ts`) would find out
//! only the day somebody runs it. Here it also checks what the floor plan is
//! for: the objects are in the room their variable names.

#[cfg(test)]
mod tests {
    use super::super::{finto_giro, floor_plan_tool, Banco};
    use serde_json::{json, Value};
    use std::path::Path;
    use tokio::sync::mpsc;

    const BENCH: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../tests/fixtures/ai-bench/house"
    );
    const SCRIPT: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/ai/house-floor-plan.json"
    );

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

    /// The centre of an object of the page.
    fn centre(o: &Value) -> (f64, f64) {
        let n = |k: &str| o[k].as_f64().unwrap();
        (n("x") + n("width") / 2.0, n("y") + n("height") / 2.0)
    }

    fn inside(room: &Value, (x, y): (f64, f64)) -> bool {
        let n = |k: &str| room[k].as_f64().unwrap();
        x >= n("x") && x <= n("x") + n("w") && y >= n("y") && y <= n("y") + n("h")
    }

    #[tokio::test]
    async fn the_house_script_reaches_the_proposal() {
        let d = tempfile::tempdir().unwrap();
        let project = d.path().join("bench-house");
        copy(Path::new(BENCH), &project);
        let s = crate::router::stato_di_prova(d.path()).await;
        *s.project_dir.write().await = Some(project);

        let (tx, mut rx) = mpsc::unbounded_channel::<String>();
        let mut bench = Banco::default();
        finto_giro(&s, &tx, SCRIPT, &mut bench)
            .await
            .expect("the script must reach its end");
        drop(tx);

        let mut drawings = Vec::new();
        let mut thumbnails = Vec::new();
        let mut proposal = None;
        while let Some(m) = rx.recv().await {
            let v: Value = serde_json::from_str(&m).unwrap();
            match v["t"].as_str() {
                Some("floor_plan") => drawings.push(v),
                Some("simbolo") => thumbnails.push(v["slug"].as_str().unwrap().to_string()),
                Some("proposta") => proposal = Some(v),
                _ => {}
            }
        }

        // The person sees the floor plan in chat: five rooms, and no text.
        assert_eq!(drawings.len(), 1);
        assert_eq!(drawings[0]["id"], "casa");
        let svg = drawings[0]["svg"].as_str().unwrap();
        assert_eq!(svg.matches("<polygon").count(), 5);
        assert!(!svg.contains("<text"));
        assert!(
            svg.contains("viewBox=\"0 0 1280 682\""),
            "the free area of the frame"
        );
        assert_eq!(thumbnails, ["shutter-position"]);

        let p = proposal.expect("a proposal");
        assert_eq!(
            p["giudizio"]["ok"], true,
            "the validator does not pass it: {}",
            p["giudizio"]
        );
        // The floor plan goes to `planimetrie/`, in the model of the editor:
        // `at` became wall + fraction, the measures nobody gave are there.
        let plans = p["floor_plans"].as_array().unwrap();
        assert_eq!(plans.len(), 1);
        assert_eq!(plans[0]["id"], "casa");
        assert_eq!(plans[0]["aperture"][0]["muro"], "m-esterno");
        assert!(plans[0]["aperture"][0].get("at").is_none());
        assert_eq!(plans[0]["muri"][1]["altezza"], 2.7);
        // Its drawing goes to `images/`, with the generated backgrounds.
        assert_eq!(
            p["sfondi"],
            json!([{ "file": "ai-floor-plan-casa.svg", "svg": svg }])
        );
        // One drafted symbol, with the part that shows the position.
        assert_eq!(p["simboli"].as_array().unwrap().len(), 1);
        assert!(p["simboli"][0]["voce"]["parts"]
            .to_string()
            .contains("level"));
        // Bound to the variables that exist: none added, none lost.
        assert_eq!(p["project"]["tags"].as_array().unwrap().len(), 15);

        let page = &p["pages"][0];
        assert_eq!(page["id"], "casa");
        assert_eq!(
            page["sfondo_immagine"],
            "/api/project/images/ai-floor-plan-casa.svg"
        );
        let objects = page["objects"].as_array().unwrap();
        let object = |id: &str| {
            objects
                .iter()
                .find(|o| o["id"] == id)
                .unwrap_or_else(|| panic!("no object `{id}` in the page"))
        };

        // What the tool said, asked again as the model would: by id.
        let (tx, _rx) = mpsc::unbounded_channel::<String>();
        let layout = floor_plan_tool::run(
            &s,
            &tx,
            &mut bench,
            &json!({ "id": "casa", "page": "Casa",
                     "fit": { "x": 24, "y": 80, "w": 900, "h": 634 } }),
        )
        .await
        .unwrap();
        assert_eq!(
            layout["area"],
            json!({ "x": 0.0, "y": 56.0, "w": 1280.0, "h": 682.0 })
        );
        let room = |id: &str| {
            layout["rooms"]
                .as_array()
                .unwrap()
                .iter()
                .find(|r| r["id"] == id)
                .unwrap_or_else(|| panic!("no room `{id}`"))
                .clone()
        };
        // Every light is in the room its variable names.
        for name in ["soggiorno", "camera", "cucina", "ingresso", "bagno"] {
            let light = object(&format!("l_{name}"));
            assert_eq!(light["symbol_parts"]["lamp"]["tag"], format!("luce.{name}"));
            assert!(inside(&room(name), centre(light)), "the light of {name}");
        }
        // Every shutter is at the window of its room, where the tool says.
        for name in ["soggiorno", "camera", "cucina"] {
            let shutter = object(&format!("s_{name}"));
            assert_eq!(shutter["symbol_id"], "prj:shutter-position");
            assert_eq!(shutter["fill_level_tag"], format!("tapparella.{name}"));
            let window = layout["windows"]
                .as_array()
                .unwrap()
                .iter()
                .find(|w| w["room"] == name)
                .unwrap_or_else(|| panic!("no window in {name}"));
            let (x, y) = centre(shutter);
            let at = |i: usize| window["inside"][i].as_f64().unwrap();
            assert!(
                (x - at(0)).abs() <= 3.0 && (y - at(1)).abs() <= 3.0,
                "the shutter of {name} is at ({x}, {y}), the window says {}",
                window["inside"]
            );
        }
        assert_eq!(layout["windows"].as_array().unwrap().len(), 4);
        assert_eq!(layout["doors"].as_array().unwrap().len(), 5);
    }

    /// The plan the script draws, as the model writes it.
    fn scripted_plan() -> Value {
        let script: Value =
            serde_json::from_str(&std::fs::read_to_string(SCRIPT).unwrap()).unwrap();
        fn find(v: &Value) -> Option<&Value> {
            match v {
                Value::Object(o) => match o.get("plan").filter(|p| p.get("muri").is_some()) {
                    Some(p) => Some(p),
                    None => o.values().find_map(find),
                },
                Value::Array(a) => a.iter().find_map(find),
                _ => None,
            }
        }
        find(&script).expect("the script draws a plan").clone()
    }

    /// A floor plan the person drew is never replaced by one the model
    /// writes: with the same id the tool refuses, and says what to do.
    #[tokio::test]
    async fn a_plan_never_takes_the_place_of_one_of_the_project() {
        let d = tempfile::tempdir().unwrap();
        let project = d.path().join("bench-house");
        copy(Path::new(BENCH), &project);
        // The house, drawn by hand in the editor: a block and a camera the
        // model knows nothing about.
        let by_hand = "id: casa\nnome: Casa mia\nunita_px_m: 50\n\
            muri:\n  - { id: m1, punti: [[0, 0], [6, 0], [6, 4], [0, 4], [0, 0]] }\n\
            aperture: []\n\
            aree:\n  - { id: sala, etichetta: Sala, colore: '#e2e8f0', punti: [[0, 0], [6, 0], [6, 4], [0, 4]] }\n\
            blocchi:\n  - { id: b1, x: 1, y: 1, larghezza: 2, profondita: 1, altezza: 0.9 }\n\
            camera: { azimut: 30, elevazione: 45 }\n";
        std::fs::create_dir_all(project.join("planimetrie")).unwrap();
        std::fs::write(project.join("planimetrie/casa.yaml"), by_hand).unwrap();
        let s = crate::router::stato_di_prova(d.path()).await;
        *s.project_dir.write().await = Some(project.clone());
        let (tx, _rx) = mpsc::unbounded_channel::<String>();
        let mut bench = Banco::default();

        // The model is told the house is there before it draws anything.
        let read = super::super::tools::esegui(&s, "leggi_progetto", &json!({}))
            .await
            .unwrap();
        assert_eq!(
            read["floor_plans"],
            json!([{ "id": "casa", "name": "Casa mia" }])
        );

        let plan = scripted_plan();
        assert_eq!(plan["id"], "casa");
        let refused = floor_plan_tool::run(&s, &tx, &mut bench, &json!({ "plan": plan }))
            .await
            .expect_err("the id is taken");
        assert!(
            refused.contains("already has a floor plan `casa`"),
            "{refused}"
        );
        assert!(refused.contains("Taken: casa"), "{refused}");
        assert!(bench.floor_plans.is_empty());

        // The one of the project can be drawn as it is: only its drawing is
        // new, and a proposal does not carry the plan.
        let layout = floor_plan_tool::run(&s, &tx, &mut bench, &json!({ "id": "casa" }))
            .await
            .unwrap();
        assert_eq!(layout["rooms"][0]["id"], "sala");
        let proposal =
            json!({ "pages": [{ "name": "Casa", "sfondo_immagine": layout["background"] }] });
        let (plans, drawings) = floor_plan_tool::of_proposal(&proposal, &bench.floor_plans);
        assert!(plans.is_empty());
        assert_eq!(drawings.len(), 1);
        // Having looked at it does not make it a draft to write over.
        assert!(
            floor_plan_tool::run(&s, &tx, &mut bench, &json!({ "plan": plan }))
                .await
                .is_err()
        );

        // With an id of its own the plan is a draft like any other…
        let mut other = plan.clone();
        other["id"] = json!("casa-2");
        let layout = floor_plan_tool::run(&s, &tx, &mut bench, &json!({ "plan": other }))
            .await
            .unwrap();
        let proposal =
            json!({ "pages": [{ "name": "Casa", "sfondo_immagine": layout["background"] }] });
        let (plans, _) = floor_plan_tool::of_proposal(&proposal, &bench.floor_plans);
        assert_eq!(plans[0]["id"], "casa-2");
        assert!(floor_plan_tool::replaced(&s, &plans).await.is_empty());
        // …and once the person saved it, redrawing it is allowed, and the
        // proposal says it replaces a file.
        std::fs::write(
            project.join("planimetrie/casa-2.yaml"),
            serde_yaml::to_string(&plans[0]).unwrap(),
        )
        .unwrap();
        floor_plan_tool::run(&s, &tx, &mut bench, &json!({ "plan": other }))
            .await
            .expect("its own draft");
        let (plans, _) = floor_plan_tool::of_proposal(&proposal, &bench.floor_plans);
        assert_eq!(floor_plan_tool::replaced(&s, &plans).await, ["casa-2"]);
        // The file of the person is as it was.
        assert_eq!(
            std::fs::read_to_string(project.join("planimetrie/casa.yaml")).unwrap(),
            by_hand
        );
    }
}
