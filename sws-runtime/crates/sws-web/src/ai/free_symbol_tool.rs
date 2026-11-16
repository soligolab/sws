//! The free-SVG way of `bozza_simbolo` (plan
//! `docs/archive/2026-11-10-assistente-secondo-giro.md`, G3).
//!
//! A symbol is normally a description that SWS compiles (`prj:<slug>`). What
//! the description cannot say, the assistant draws as an SVG with the size of
//! the drawing and the ports of the pipes: it becomes a custom symbol of the
//! project (`custom:<slug>`, `CustomSymbol` with `view_box` and `ports`).
//!
//! Like every draft it lives on the bench of the conversation and touches
//! nothing. `valida` and `istantanea_pagina` see it, and the proposal whose
//! pages use it carries it in `project.custom_symbols`, which the editor
//! writes at Save.
//!
//! The custom symbols never travel through the model: `leggi_progetto` gives
//! them without their SVG, and [`merge_into_project`] puts back the ones of
//! the disk whatever the model sent. A proposal can add a custom symbol or
//! redraw one of its own; it cannot lose the ones the person imported.

use serde_json::{json, Value};
use sws_core::simboli_lib::PortaLib;
use sws_core::{CustomSymbol, CustomSymbolAttribution, Project};

use crate::validate::{Finding, Severity};

/// A free-SVG symbol of this conversation.
#[derive(Debug, Clone)]
pub struct FreeSymbolDraft {
    /// The symbol as it goes in `project.custom_symbols`; its label is the
    /// Italian one.
    pub symbol: CustomSymbol,
    /// The English label, for the chat of who reads in English.
    pub en: String,
}

impl FreeSymbolDraft {
    pub fn slug(&self) -> &str {
        &self.symbol.id
    }
}

/// `bozza_simbolo` was called with an SVG and not with a description.
pub(crate) fn is_free(input: &Value) -> bool {
    input.get("svg").is_some() && input.get("descrizione").is_none()
}

/// Reads and checks what the model sent: the draft, or everything to fix.
pub(crate) fn draft(input: &Value) -> Result<FreeSymbolDraft, Vec<String>> {
    let text = |k: &str| {
        input
            .get(k)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
    };
    let mut errors = Vec::new();
    let slug = text("slug").unwrap_or_default().to_string();
    if slug.is_empty() {
        errors.push("`slug` is missing: a-z, 0-9 and «-», from 3 to 40 characters".to_string());
    }
    let it = text("it").or(text("en")).unwrap_or_default().to_string();
    let en = text("en").or(text("it")).unwrap_or_default().to_string();
    if it.is_empty() {
        errors.push("`it` and `en` are missing: the labels of the symbol".to_string());
    }
    let svg = text("svg").unwrap_or_default();
    if svg.is_empty() {
        errors.push("`svg` is missing: the drawing, from <svg …> to </svg>".to_string());
    }
    let view_box: Option<[f64; 2]> = input
        .get("view_box")
        .and_then(|v| serde_json::from_value(v.clone()).ok());
    if view_box.is_none() {
        errors.push(
            "`view_box` is missing or is not [w, h]: the size of the drawing, the same as \
             the viewBox of the SVG (0 0 w h)"
                .to_string(),
        );
    }
    let ports: Vec<PortaLib> = match input.get("ports") {
        None | Some(Value::Null) => Vec::new(),
        Some(v) => match serde_json::from_value(v.clone()) {
            Ok(p) => p,
            Err(e) => {
                errors.push(format!(
                    "`ports` does not read ({e}): it is a list of {{id, x, y, side, d}}"
                ));
                Vec::new()
            }
        },
    };
    if let Some(reason) = crate::router::svg_ostile(svg) {
        errors.push(format!("svg: {reason}"));
    }
    let (Some(view_box), true) = (view_box, errors.is_empty()) else {
        return Err(errors);
    };
    let drawing = sws_core::free_symbol::check(&slug, svg, view_box, &ports)?;
    Ok(FreeSymbolDraft {
        symbol: CustomSymbol {
            id: slug,
            label: it,
            url: String::new(),
            attribution: CustomSymbolAttribution {
                author: "SWS assistant".into(),
                source: "bozza_simbolo".into(),
                license: String::new(),
            },
            svg: Some(drawing),
            colorable_ids: None,
            view_box: Some(view_box),
            ports: (!ports.is_empty()).then_some(ports),
        },
        en,
    })
}

/// What the model receives from a draft that passed.
pub(crate) fn result(d: &FreeSymbolDraft) -> Value {
    json!({
        "ok": true,
        "symbol_id": d.symbol.symbol_id(),
        "viewBox": d.symbol.view_box,
        "bocche": d.symbol.ports.clone().unwrap_or_default(),
        "parti": [],
        "nota": "it is a draft drawn as free SVG: valida and istantanea_pagina see it, and it \
                 enters the project (as a custom symbol) with proponi_modifica when a proposed \
                 page uses it. In the page: type symbol, symbol_id as above, with the same \
                 proportions as the viewBox; a pipe attaches with from_obj_id/to_obj_id and the \
                 id of a port in from_port/to_port. It has no live parts and does not take the \
                 style of the project. To look at it: istantanea_pagina without a name.",
    })
}

/// The frame that shows the draft in chat, like a compiled one.
pub(crate) fn chat_frame(d: &FreeSymbolDraft) -> Value {
    json!({ "t": "simbolo", "slug": d.slug(), "it": d.symbol.label, "en": d.en,
            "svg": d.symbol.svg })
}

/// Every `symbol_id` of some pages, at any depth (grid cells, groups).
fn symbol_ids(pages: &[Value]) -> Vec<&str> {
    fn visit<'a>(v: &'a Value, out: &mut Vec<&'a str>) {
        match v {
            Value::Array(a) => a.iter().for_each(|x| visit(x, out)),
            Value::Object(o) => {
                for (k, x) in o {
                    match x.as_str() {
                        Some(id) if k == "symbol_id" => out.push(id),
                        _ => visit(x, out),
                    }
                }
            }
            _ => {}
        }
    }
    let mut out = Vec::new();
    pages.iter().for_each(|p| visit(p, &mut out));
    out
}

/// The free drafts a proposal carries into the project: the ones its pages
/// use and the ones listed in `simboli` as `custom:<slug>`. Without
/// `only_used` all of them: it is `valida`, which must see what the model is
/// building.
pub(crate) fn to_carry<'a>(
    input: &Value,
    raw_pages: &[Value],
    drafts: &'a [FreeSymbolDraft],
    only_used: bool,
) -> Vec<&'a FreeSymbolDraft> {
    if !only_used {
        return drafts.iter().collect();
    }
    let used = symbol_ids(raw_pages);
    let listed: Vec<&str> = input
        .get("simboli")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect();
    drafts
        .iter()
        .filter(|d| {
            let id = d.symbol.symbol_id();
            used.contains(&id.as_str()) || listed.contains(&id.as_str())
        })
        .collect()
}

/// Writes in the proposed project the custom symbols it must have: the ones
/// of the disk, with the carried drafts on top (a draft with the id of one of
/// the disk redraws it). Whatever the model sent in `custom_symbols` is
/// dropped: it read them without their SVG.
pub(crate) fn merge_into_project(
    project: &mut Value,
    disk: &Project,
    carried: &[&FreeSymbolDraft],
) -> Result<(), String> {
    let mut symbols = disk.custom_symbols.clone();
    for d in carried {
        match symbols.iter().position(|s| s.id == d.symbol.id) {
            Some(i) => symbols[i] = d.symbol.clone(),
            None => symbols.push(d.symbol.clone()),
        }
    }
    let Some(map) = project.as_object_mut() else {
        return Err("the proposed project is not an object".into());
    };
    if symbols.is_empty() {
        map.remove("custom_symbols");
    } else {
        map.insert(
            "custom_symbols".into(),
            serde_json::to_value(&symbols).map_err(|e| e.to_string())?,
        );
    }
    Ok(())
}

/// What the caller changed in `custom_symbols`, said as a warning: the
/// section is not taken from a proposal ([`merge_into_project`] writes the
/// ones of the disk and the drafts), and whoever sent a different list must
/// know its verdict is about the symbols of the disk. In chat the model sends
/// back what it read and nothing is said; an agent that validates a project
/// from outside (`valida` over MCP) with a symbol moved, redrawn or removed
/// would otherwise read `ok` for a change that was never looked at.
///
/// An entry is known when it is the symbol of the disk or a carried draft
/// with that id; without `svg` it is compared without, as the model read it.
pub(crate) fn ignored_changes(
    sent: Option<&Value>,
    disk: &[CustomSymbol],
    carried: &[&FreeSymbolDraft],
) -> Option<Finding> {
    let sent = sent?.as_array()?;
    // Through the type, so `80` and `80.0` or a missing default are the same.
    let canonical = |s: &CustomSymbol, with_svg: bool| {
        let mut v = serde_json::to_value(s).unwrap_or(Value::Null);
        if let (false, Some(o)) = (with_svg, v.as_object_mut()) {
            o.remove("svg");
        }
        v
    };
    let mut changed: Vec<String> = Vec::new();
    for entry in sent {
        let known = serde_json::from_value::<CustomSymbol>(entry.clone())
            .ok()
            .is_some_and(|symbol| {
                let with_svg = symbol.svg.is_some();
                disk.iter()
                    .chain(carried.iter().map(|d| &d.symbol))
                    .filter(|k| k.id == symbol.id)
                    .any(|k| canonical(k, with_svg) == canonical(&symbol, with_svg))
            });
        if !known {
            changed.push(
                entry
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or("?")
                    .to_string(),
            );
        }
    }
    let removed: Vec<&str> = disk
        .iter()
        .map(|k| k.id.as_str())
        .filter(|id| {
            !sent
                .iter()
                .any(|e| e.get("id").and_then(Value::as_str) == Some(id))
        })
        .collect();
    if changed.is_empty() && removed.is_empty() {
        return None;
    }
    let mut what = Vec::new();
    if !changed.is_empty() {
        what.push(format!("new or changed: {}", changed.join(", ")));
    }
    if !removed.is_empty() {
        what.push(format!("removed: {}", removed.join(", ")));
    }
    Some(Finding {
        severity: Severity::Warning,
        path: "project.custom_symbols".into(),
        message: format!(
            "custom_symbols is not changed from here ({}): this was judged with the custom \
             symbols the project has on disk",
            what.join("; ")
        ),
        hint: Some(
            "draw or redraw a symbol with bozza_simbolo (svg, view_box, ports); a symbol is \
             removed in the editor, tab Risorse"
                .into(),
        ),
    })
}

/// The custom symbols of a project as the model reads them: without the SVG,
/// which is long and which it cannot change from here.
pub(crate) fn strip_drawings(project: &mut Value) {
    for s in project
        .get_mut("custom_symbols")
        .and_then(Value::as_array_mut)
        .into_iter()
        .flatten()
    {
        if let Some(o) = s.as_object_mut() {
            o.remove("svg");
        }
    }
}

/// The custom symbols the proposed pages name and the project does not have:
/// on the page they would be a placeholder, and the validator of the project
/// does not say it (a `custom:` id is declared by the project, not by the
/// schema).
pub(crate) fn missing(raw_pages: &[Value], project: &Project) -> Vec<Finding> {
    let mut out = Vec::new();
    for page in raw_pages {
        let name = page.get("name").and_then(Value::as_str).unwrap_or("?");
        let mut seen: Vec<&str> = Vec::new();
        for id in symbol_ids(std::slice::from_ref(page)) {
            let Some(rest) = id.strip_prefix("custom:") else {
                continue;
            };
            if seen.contains(&id) || project.custom_symbols.iter().any(|s| s.id == rest) {
                continue;
            }
            seen.push(id);
            out.push(Finding {
                severity: Severity::Error,
                path: format!("pages[{name}].symbol_id"),
                message: format!("the custom symbol `{id}` does not exist"),
                hint: Some(
                    "draw it first with bozza_simbolo (svg, view_box, ports), or use an id \
                     that cerca_simboli gives"
                        .into(),
                ),
            });
        }
    }
    out
}

/// The entry of `cerca_simboli` for a custom symbol of the project.
pub(crate) fn catalog_entry(s: &CustomSymbol) -> Value {
    let ports: Vec<String> = s
        .ports_with_view_box()
        .map(|(_, ports)| {
            ports
                .iter()
                .map(|p| format!("{}@{}", p.id, p.side))
                .collect()
        })
        .unwrap_or_default();
    json!({
        "id": s.symbol_id(), "famiglia": "project", "tipo": "custom",
        "it": s.label, "en": s.label,
        "w": s.view_box.map(|v| v[0]), "h": s.view_box.map(|v| v[1]),
        "parti": [], "bocche": ports,
    })
}

/// The free symbols a proposal brings, for the thumbnails of the diff.
pub(crate) fn of_proposal(input: &Value, drafts: &[FreeSymbolDraft]) -> Vec<Value> {
    let pages: Vec<Value> = input
        .get("pages")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    to_carry(input, &pages, drafts, true)
        .into_iter()
        .map(|d| {
            json!({ "slug": d.slug(), "it": d.symbol.label, "en": d.en,
                    "svg": d.symbol.svg, "symbol_id": d.symbol.symbol_id() })
        })
        .collect()
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A cyclone separator: a shape the description of a symbol does not have
    /// (a cone), an inlet on the left and an outlet at the bottom.
    pub(crate) fn cyclone_input() -> Value {
        json!({
            "slug": "cyclone", "it": "Ciclone separatore", "en": "Cyclone separator",
            "view_box": [80, 120],
            "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 80 120\">\
                    <defs><linearGradient id=\"body\" x1=\"0\" x2=\"1\">\
                    <stop offset=\"0\" stop-color=\"#94a3b8\"/><stop offset=\"1\" stop-color=\"#475569\"/>\
                    </linearGradient></defs>\
                    <g stroke=\"#1c2329\" stroke-width=\"1\">\
                    <rect x=\"0\" y=\"15\" width=\"12\" height=\"10\" fill=\"#64748b\"/>\
                    <path d=\"M12 10 H68 V60 L46 110 H34 L12 60 Z\" fill=\"url(#body)\"/>\
                    <rect x=\"35\" y=\"110\" width=\"10\" height=\"10\" fill=\"#64748b\"/>\
                    </g></svg>",
            "ports": [
                { "id": "n-left", "x": 0, "y": 20, "side": "left", "d": 10 },
                { "id": "n-bottom", "x": 40, "y": 120, "side": "bottom", "d": 10 },
            ],
        })
    }

    #[test]
    fn a_free_svg_becomes_a_custom_symbol_with_ports() {
        let input = cyclone_input();
        assert!(is_free(&input));
        assert!(!is_free(&json!({ "descrizione": {} })));
        let d = draft(&input).expect("the cyclone is a plain drawing");
        assert_eq!(d.symbol.symbol_id(), "custom:cyclone");
        assert_eq!(d.symbol.label, "Ciclone separatore");
        assert_eq!(d.en, "Cyclone separator");
        assert_eq!(d.symbol.view_box, Some([80.0, 120.0]));
        let (_, ports) = d.symbol.ports_with_view_box().expect("two ports");
        assert_eq!(
            ports.iter().map(|p| p.id.as_str()).collect::<Vec<_>>(),
            ["n-left", "n-bottom"]
        );
        // The drawing is kept in the checked form, ids prefixed.
        let svg = d.symbol.svg.as_deref().unwrap();
        assert!(svg.contains("id=\"cs-cyclone-body\"") && svg.contains("url(#cs-cyclone-body)"));

        let r = result(&d);
        assert_eq!(r["symbol_id"], "custom:cyclone");
        assert_eq!(r["viewBox"], json!([80.0, 120.0]));
        assert_eq!(r["bocche"][1]["id"], "n-bottom");
        assert_eq!(chat_frame(&d)["t"], "simbolo");
        assert_eq!(
            catalog_entry(&d.symbol)["bocche"],
            json!(["n-left@left", "n-bottom@bottom"])
        );
    }

    #[test]
    fn a_wrong_free_svg_says_everything_to_fix() {
        let errors = |change: &dyn Fn(&mut Value)| {
            let mut input = cyclone_input();
            change(&mut input);
            draft(&input).expect_err("it must be refused").join(" | ")
        };
        assert!(errors(
            &|v| v["svg"] = json!("<svg viewBox=\"0 0 80 120\"><script>x</script></svg>")
        )
        .contains("<script>"));
        assert!(errors(&|v| v["svg"] = json!(
            "<svg viewBox=\"0 0 80 120\"><rect onload=\"x()\" width=\"1\" height=\"1\"/></svg>"
        ))
        .contains("on*="));
        assert!(errors(&|v| v["svg"] =
            json!("<svg viewBox=\"0 0 80 120\"><text x=\"0\" y=\"9\">P</text></svg>"))
        .contains("no fonts"));
        assert!(
            errors(&|v| v["view_box"] = json!([80, 100])).contains("view_box says «0 0 80 100»")
        );
        assert!(errors(&|v| v["view_box"] = json!("80x120")).contains("`view_box`"));
        assert!(errors(&|v| v["ports"][0]["x"] = json!(-10)).contains("outside the drawing"));
        assert!(errors(&|v| v["ports"][0]["id"] = json!("left")).contains("anchors of the box"));
        assert!(
            errors(&|v| v["ports"] = json!([{ "id": "n-a" }])).contains("`ports` does not read")
        );
        assert!(errors(&|v| v["slug"] = json!("My Symbol")).contains("slug"));
        let e = errors(&|v| {
            v.as_object_mut().unwrap().remove("slug");
            v.as_object_mut().unwrap().remove("it");
            v.as_object_mut().unwrap().remove("en");
        });
        assert!(e.contains("`slug`") && e.contains("`it`"), "{e}");
    }

    #[test]
    fn a_proposal_carries_the_free_drafts_its_pages_use() {
        let mut other = cyclone_input();
        other["slug"] = json!("hopper");
        let drafts = vec![draft(&cyclone_input()).unwrap(), draft(&other).unwrap()];
        let slugs =
            |v: Vec<&FreeSymbolDraft>| v.iter().map(|d| d.slug().to_string()).collect::<Vec<_>>();
        // In a grid cell too: the id is looked for at any depth.
        let pages = vec![json!({ "name": "P", "objects": [
            { "type": "grid", "cells": [{ "child": { "symbol_id": "custom:hopper" } }] } ] })];
        assert_eq!(
            slugs(to_carry(&json!({}), &pages, &drafts, true)),
            ["hopper"]
        );
        assert_eq!(
            slugs(to_carry(&json!({}), &pages, &drafts, false)),
            ["cyclone", "hopper"]
        );
        assert_eq!(
            slugs(to_carry(
                &json!({ "simboli": ["custom:cyclone"] }),
                &pages,
                &drafts,
                true
            )),
            ["cyclone", "hopper"]
        );
        assert_eq!(
            of_proposal(&json!({ "pages": pages }), &drafts)[0]["symbol_id"],
            "custom:hopper"
        );
    }

    #[test]
    fn the_custom_symbols_of_the_disk_never_depend_on_the_model() {
        let mut disk: Project =
            serde_yaml::from_str("meta: { name: p, version: '1' }\ntags: []\nsources: []\n")
                .unwrap();
        let mut imported = draft(&cyclone_input()).unwrap().symbol;
        imported.id = "imported".into();
        disk.custom_symbols = vec![imported];

        // What the model reads has no drawings…
        let mut read = serde_json::to_value(&disk).unwrap();
        strip_drawings(&mut read);
        assert!(read["custom_symbols"][0].get("svg").is_none());
        assert_eq!(read["custom_symbols"][0]["ports"][0]["id"], "n-left");

        // …and what comes back, even emptied, gets the disk and the drafts.
        let mut proposed = read.clone();
        proposed["custom_symbols"] = json!([]);
        let d = draft(&cyclone_input()).unwrap();
        merge_into_project(&mut proposed, &disk, &[&d]).unwrap();
        let ids: Vec<&str> = proposed["custom_symbols"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s["id"].as_str().unwrap())
            .collect();
        assert_eq!(ids, ["imported", "cyclone"]);
        assert!(proposed["custom_symbols"][0]["svg"]
            .as_str()
            .unwrap()
            .starts_with("<svg"));
        let p: Project = serde_json::from_value(proposed).unwrap();

        // The model sent the list emptied: it is told the symbol stays.
        let said = ignored_changes(Some(&json!([])), &disk.custom_symbols, &[&d]).unwrap();
        assert!(matches!(said.severity, Severity::Warning));
        assert_eq!(said.path, "project.custom_symbols");
        assert!(said.message.contains("removed: imported"), "{said:?}");
        // Sent back as it was read (no drawing, whole numbers) nothing is
        // said — nor when the field is not there, or carries its own draft.
        let mut as_read = read["custom_symbols"].clone();
        as_read[0]["view_box"] = json!([80, 120]);
        assert!(ignored_changes(Some(&as_read), &disk.custom_symbols, &[&d]).is_none());
        assert!(ignored_changes(None, &disk.custom_symbols, &[&d]).is_none());
        let mut with_draft = as_read.clone();
        with_draft
            .as_array_mut()
            .unwrap()
            .push(serde_json::to_value(&d.symbol).unwrap());
        assert!(ignored_changes(Some(&with_draft), &disk.custom_symbols, &[&d]).is_none());
        // A port moved, a drawing changed, a symbol nobody drew: said.
        let mut moved = as_read.clone();
        moved[0]["ports"][0]["x"] = json!(200);
        let said = ignored_changes(Some(&moved), &disk.custom_symbols, &[]).unwrap();
        assert!(
            said.message.contains("new or changed: imported"),
            "{said:?}"
        );
        let mut redrawn = as_read.clone();
        redrawn[0]["svg"] = json!("<svg/>");
        assert!(ignored_changes(Some(&redrawn), &disk.custom_symbols, &[]).is_some());
        assert!(
            ignored_changes(Some(&with_draft), &disk.custom_symbols, &[])
                .unwrap()
                .message
                .contains("new or changed: cyclone")
        );

        // A page that names a custom symbol nobody drew is told.
        let pages = vec![json!({ "name": "P", "objects": [
            { "symbol_id": "custom:cyclone" }, { "symbol_id": "custom:ghost" },
            { "symbol_id": "custom:ghost" }, { "symbol_id": "prj:other" } ] })];
        let f = missing(&pages, &p);
        assert_eq!(f.len(), 1);
        assert!(f[0].message.contains("custom:ghost"));
    }
}
