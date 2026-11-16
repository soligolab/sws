//! The `floor_plan` tool of the assistant (plan
//! `docs/archive/2026-11-10-assistente-secondo-giro.md`, G2).
//!
//! «The plan of my house with lights, shutters and climate»: the assistant
//! writes a floor plan in the model the editor already has
//! (`planimetrie/<id>.yaml`, in metres), and this tool turns it into the two
//! things a page needs — the flat drawing that goes behind the objects
//! (`sfondo_immagine` of the page) and the position of rooms, windows and
//! doors **in page pixels**.
//!
//! Like a symbol draft, a floor plan lives on the bench of the conversation
//! and touches nothing: the proposal that uses its drawing carries the plan
//! and the SVG to the browser, which writes them at Save
//! ([`of_proposal`]).

use serde_json::{json, Value};
use tokio::sync::mpsc;

use super::Banco;
use crate::floor_plan::{self, Placement, Rect};
use crate::router::{active_dir, AppState};

/// Free pixels around the drawing, when nobody says where it goes.
const MARGIN: f64 = 24.0;
/// The largest side of a drawing, as for any page background
/// (`sized_image::MAX_SIDE`).
const MAX_SIDE: f64 = 4096.0;

/// A floor plan of this conversation, drawn for a page.
pub(crate) struct FloorPlanDraft {
    pub id: String,
    pub name: String,
    /// The plan as it goes in `planimetrie/<id>.yaml`.
    pub plan: Value,
    /// The plan is already in the project: only its drawing is new.
    pub on_disk: bool,
    pub svg: String,
}

impl FloorPlanDraft {
    /// The file in `images/` of the project, once the proposal is applied.
    pub fn file(&self) -> String {
        format!("ai-floor-plan-{}.svg", self.id)
    }
    /// What a page writes in `sfondo_immagine`.
    pub fn src(&self) -> String {
        format!("/api/project/images/{}", self.file())
    }
}

/// The area of a page where its background image is drawn
/// (`cornici::sfondo_area`): between header and footer of its frame, or the
/// whole page. A page that does not exist yet gets the default frame and the
/// default size of the project.
async fn page_area(s: &AppState, page: Option<&str>) -> Result<Rect, String> {
    let dir = active_dir(s)
        .await
        .map_err(|_| "no project is open".to_string())?;
    let project =
        sws_core::Project::load(&dir).map_err(|e| format!("the project does not load: {e:#}"))?;
    let layout = project.page_layout.as_ref();
    let default_frame = layout
        .and_then(|l| l.cornice_predefinita.clone())
        .filter(|id| !id.is_empty());
    let pages = super::tools::carica_pagine(s).await?;
    let found = page.and_then(|name| {
        pages
            .iter()
            .find(|p| p.name == name)
            .or_else(|| pages.iter().find(|p| p.id == name))
    });
    let frame_id = match found {
        Some(p) => crate::cornici::cornice_della_pagina(p, default_frame.as_deref()),
        None => default_frame,
    };
    if let Some(id) = frame_id {
        let frames = crate::schema_api::carica_cornici(&dir).await;
        if let Some(frame) = frames.iter().find(|c| c.id == id) {
            let a = crate::cornici::area_libera(frame);
            return Ok(Rect {
                x: a.x,
                y: a.y,
                w: a.w,
                h: a.h,
            });
        }
    }
    Ok(Rect {
        x: 0.0,
        y: 0.0,
        w: found
            .and_then(|p| p.width)
            .or(layout.and_then(|l| l.default_width))
            .unwrap_or(1280.0),
        h: found
            .and_then(|p| p.height)
            .or(layout.and_then(|l| l.default_height))
            .unwrap_or(800.0),
    })
}

/// The box the plan must fit in, in the coordinates of the drawing: the one
/// asked with `fit` (page pixels), cut to the area, or the area less a margin.
fn fit_box(area: Rect, fit: Option<&Value>) -> Result<Rect, String> {
    let Some(fit) = fit.filter(|v| !v.is_null()) else {
        let m = MARGIN.min(area.w / 4.0).min(area.h / 4.0);
        return Ok(Rect {
            x: m,
            y: m,
            w: area.w - 2.0 * m,
            h: area.h - 2.0 * m,
        });
    };
    let side = |k: &str| fit.get(k).and_then(Value::as_f64).filter(|v| v.is_finite());
    let (Some(x), Some(y), Some(w), Some(h)) = (side("x"), side("y"), side("w"), side("h")) else {
        return Err("`fit` must be {x, y, w, h} in page pixels".into());
    };
    let x0 = x.max(area.x);
    let y0 = y.max(area.y);
    let x1 = (x + w).min(area.x + area.w);
    let y1 = (y + h).min(area.y + area.h);
    if x1 - x0 < 50.0 || y1 - y0 < 50.0 {
        return Err(format!(
            "`fit` leaves less than 50 px inside the area of the page (x {}, y {}, w {}, h {})",
            area.x, area.y, area.w, area.h
        ));
    }
    Ok(Rect {
        x: x0 - area.x,
        y: y0 - area.y,
        w: x1 - x0,
        h: y1 - y0,
    })
}

/// The ids of the floor plans a conversation can name: the ones of the
/// project and its own drafts.
async fn known_ids(dir: &std::path::Path, bench: &Banco) -> Vec<String> {
    let mut known = crate::planimetrie::list_ids(dir).await;
    for d in &bench.floor_plans {
        if !known.contains(&d.id) {
            known.push(d.id.clone());
        }
    }
    known
}

/// The plan to draw: the one in the input, a draft of this conversation, or
/// one of the project. `true` when it comes from the project as it is.
///
/// A plan written here **never takes the id of one the project already has**:
/// at Save it would replace the file, and with it the walls, the 3D blocks
/// and the camera the person drew in the editor. The model cannot edit that
/// plan faithfully either — it reads its layout in pixels, not the plan. The
/// one exception is a draft of this same conversation that went into the
/// project meanwhile: redrawing it is what the person asked.
async fn plan_to_draw(s: &AppState, bench: &Banco, input: &Value) -> Result<(Value, bool), String> {
    if let Some(plan) = input.get("plan").filter(|p| p.is_object()) {
        if let Some(id) = plan.get("id").and_then(Value::as_str) {
            let own_draft = bench.floor_plans.iter().any(|d| d.id == id && !d.on_disk);
            if !own_draft {
                let dir = active_dir(s)
                    .await
                    .map_err(|_| "no project is open".to_string())?;
                if crate::planimetrie::exists(&dir, id).await {
                    return Err(format!(
                        "the project already has a floor plan `{id}`: a `plan` written here \
                         cannot take its place. To draw the page on THAT plan call \
                         floor_plan with `id: \"{id}\"` and no `plan`; to draw a new one give \
                         it an id that is not taken. Taken: {}",
                        known_ids(&dir, bench).await.join(", ")
                    ));
                }
            }
        }
        return Ok((plan.clone(), false));
    }
    let Some(id) = input.get("id").and_then(Value::as_str) else {
        return Err("give `plan` (a floor plan to draw) or `id` (one that exists)".into());
    };
    if let Some(d) = bench.floor_plans.iter().find(|d| d.id == id) {
        return Ok((d.plan.clone(), d.on_disk));
    }
    let dir = active_dir(s)
        .await
        .map_err(|_| "no project is open".to_string())?;
    match crate::planimetrie::load(&dir, id).await {
        Some(stored) => Ok((
            serde_json::to_value(&stored).map_err(|e| e.to_string())?,
            true,
        )),
        None => {
            let known = known_ids(&dir, bench).await;
            Err(format!(
                "there is no floor plan `{id}`. The project has: {}",
                if known.is_empty() {
                    "none — write one and pass it as `plan`".to_string()
                } else {
                    known.join(", ")
                }
            ))
        }
    }
}

/// `floor_plan`: checks the plan, draws it for the page, keeps it on the
/// bench and answers with rooms, windows and doors in page pixels.
pub(crate) async fn run(
    s: &AppState,
    tx: &mpsc::UnboundedSender<String>,
    bench: &mut Banco,
    input: &Value,
) -> Result<Value, String> {
    let (raw, on_disk) = plan_to_draw(s, bench, input).await?;
    let (plan, typed) = floor_plan::normalize(&raw).map_err(|errors| {
        json!({ "ok": false, "errors": errors,
                "note": "fix the plan and call floor_plan again with the same id" })
        .to_string()
    })?;
    let area = page_area(s, input.get("page").and_then(Value::as_str)).await?;
    if area.w < 100.0 || area.h < 100.0 || area.w > MAX_SIDE || area.h > MAX_SIDE {
        return Err(format!(
            "the area of the page is {} × {} px: a floor plan needs from 100 to {MAX_SIDE} px per side",
            area.w, area.h
        ));
    }
    let place = Placement::fit(&typed, fit_box(area, input.get("fit"))?)
        .ok_or("the plan has nothing to draw")?;
    let wall_color = input
        .get("wall_color")
        .and_then(Value::as_str)
        .unwrap_or(floor_plan::DEFAULT_WALL_COLOR);
    let svg = floor_plan::svg(&typed, &place, area.w, area.h, wall_color);
    let draft = FloorPlanDraft {
        id: typed.id.clone(),
        name: typed.name.clone(),
        plan,
        on_disk,
        svg,
    };
    super::invia(
        tx,
        json!({ "t": "floor_plan", "id": draft.id, "name": draft.name, "svg": draft.svg }),
    );

    let mut out = floor_plan::layout(&typed, &place, [area.x, area.y]);
    out["ok"] = json!(true);
    out["id"] = json!(draft.id);
    out["background"] = json!(draft.src());
    out["area"] = json!({ "x": area.x, "y": area.y, "w": area.w, "h": area.h });
    out["note"] = json!(
        "The drawing is a draft of this conversation. Put `background` in `sfondo_immagine` of \
         the page: it fills `area`, and every x/y here is in pixels of that page. The plan and \
         its drawing enter the project with proponi_modifica, when a proposed page uses that \
         background. The drawing has no text: room names are text objects at `center`."
    );
    bench.floor_plans.retain(|d| d.id != draft.id);
    bench.floor_plans.push(draft);
    Ok(out)
}

/// What a proposal carries of the floor plans of the bench: those whose
/// drawing a proposed page uses. The plans to write in `planimetrie/` (not the
/// ones the project already has), and the drawings to write in `images/`, in
/// the shape of the generated backgrounds (`{file, svg}` where they have
/// `{file, jpg}`).
pub(crate) fn of_proposal(input: &Value, drafts: &[FloorPlanDraft]) -> (Vec<Value>, Vec<Value>) {
    let pages = input.get("pages").map(Value::to_string).unwrap_or_default();
    let used: Vec<&FloorPlanDraft> = drafts.iter().filter(|d| pages.contains(&d.src())).collect();
    (
        used.iter()
            .filter(|d| !d.on_disk)
            .map(|d| d.plan.clone())
            .collect(),
        used.iter()
            .map(|d| json!({ "file": d.file(), "svg": d.svg }))
            .collect(),
    )
}

/// Of the plans a proposal carries, the ids that have a file in the project
/// today: at Save they replace it, and the diff must say so. It happens when
/// a plan of this conversation is redrawn after it was saved.
pub(crate) async fn replaced(s: &AppState, plans: &[Value]) -> Vec<String> {
    let Ok(dir) = active_dir(s).await else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for id in plans.iter().filter_map(|p| p.get("id")?.as_str()) {
        if crate::planimetrie::exists(&dir, id).await {
            out.push(id.to_string());
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn draft(id: &str, on_disk: bool) -> FloorPlanDraft {
        FloorPlanDraft {
            id: id.into(),
            name: id.into(),
            plan: json!({ "id": id }),
            on_disk,
            svg: "<svg/>".into(),
        }
    }

    #[test]
    fn a_proposal_carries_only_the_floor_plans_its_pages_use() {
        let drafts = [
            draft("casa", false),
            draft("garage", false),
            draft("ufficio", true),
        ];
        let input = json!({ "pages": [
            { "name": "Casa", "sfondo_immagine": "/api/project/images/ai-floor-plan-casa.svg" },
            { "name": "Ufficio", "sfondo_immagine": "/api/project/images/ai-floor-plan-ufficio.svg" },
        ] });
        let (plans, images) = of_proposal(&input, &drafts);
        // `ufficio` is already in the project: only its drawing is new.
        assert_eq!(plans, [json!({ "id": "casa" })]);
        let files: Vec<&str> = images.iter().map(|i| i["file"].as_str().unwrap()).collect();
        assert_eq!(
            files,
            ["ai-floor-plan-casa.svg", "ai-floor-plan-ufficio.svg"]
        );
        assert_eq!(images[0]["svg"], "<svg/>");
        assert_eq!(of_proposal(&json!({}), &drafts), (vec![], vec![]));
    }

    #[test]
    fn the_plan_fits_the_area_less_a_margin_or_the_box_asked() {
        let area = Rect {
            x: 0.0,
            y: 56.0,
            w: 1280.0,
            h: 684.0,
        };
        assert_eq!(
            fit_box(area, None).unwrap(),
            Rect {
                x: 24.0,
                y: 24.0,
                w: 1232.0,
                h: 636.0
            }
        );
        // In page pixels on the way in, in pixels of the drawing on the way
        // out, and cut to the area: the header is not a place for a house.
        assert_eq!(
            fit_box(area, Some(&json!({ "x": 20, "y": 0, "w": 800, "h": 400 }))).unwrap(),
            Rect {
                x: 20.0,
                y: 0.0,
                w: 800.0,
                h: 344.0
            }
        );
        assert!(fit_box(area, Some(&json!({ "x": 0, "y": 0, "w": 800, "h": 60 }))).is_err());
        assert!(fit_box(area, Some(&json!({ "x": 0 }))).is_err());
    }
}
