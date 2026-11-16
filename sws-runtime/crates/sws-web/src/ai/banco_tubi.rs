//! Il banco fisso dei tubi d'acciaio (piano
//! `docs/archive/2026-11-10-assistente-secondo-giro.md`, G1): il copione finto
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

    /// The bench through the second protocol (G4): every turn of the script
    /// becomes a recorded Mistral stream — text in pieces, the arguments of
    /// each tool call cut every 40 characters, the calls interleaved — and must
    /// come back as the same tool calls with the same inputs. Then the whole
    /// conversation goes out again as a chat-completions request: the proposal
    /// with the full page is the biggest input the assistant ever writes.
    #[test]
    fn the_tubes_script_survives_the_mistral_protocol() {
        use crate::ai::chat_completions::{drain_events, request_body, StreamState, MISTRAL};
        use serde_json::json;

        let script: Value =
            serde_json::from_str(&std::fs::read_to_string(COPIONE).unwrap()).unwrap();
        let mut conversation =
            vec![json!({ "role": "user", "content": "Disegna la linea dei tubi" })];
        let mut calls_seen = 0;
        for (t, turn) in script["turni"].as_array().unwrap().iter().enumerate() {
            let mut chunks = Vec::new();
            if let Some(text) = turn["testo"].as_str() {
                for piece in text.split_inclusive(' ') {
                    chunks.push(
                        json!({ "choices": [{ "index": 0, "delta": { "content": piece } }] }),
                    );
                }
            }
            let tools: Vec<&Value> = turn["strumenti"].as_array().into_iter().flatten().collect();
            let pieces: Vec<Vec<String>> = tools
                .iter()
                .map(|st| {
                    let args: Vec<char> = st["input"].to_string().chars().collect();
                    args.chunks(40).map(|c| c.iter().collect()).collect()
                })
                .collect();
            for (i, st) in tools.iter().enumerate() {
                chunks.push(
                    json!({ "choices": [{ "index": 0, "delta": { "tool_calls": [{
                    "index": i, "id": format!("t{t:02}c{i:04}"), "type": "function",
                    "function": { "name": st["nome"], "arguments": "" } }] } }] }),
                );
            }
            // Round robin over the calls: the pieces of different calls interleave.
            let longest = pieces.iter().map(Vec::len).max().unwrap_or(0);
            for k in 0..longest {
                for (i, p) in pieces.iter().enumerate() {
                    if let Some(piece) = p.get(k) {
                        chunks.push(
                            json!({ "choices": [{ "index": 0, "delta": { "tool_calls": [{
                            "index": i, "function": { "arguments": piece } }] } }] }),
                        );
                    }
                }
            }
            let reason = if tools.is_empty() {
                "stop"
            } else {
                "tool_calls"
            };
            chunks.push(
                json!({ "choices": [{ "index": 0, "delta": {}, "finish_reason": reason }],
                                "usage": { "prompt_tokens": 9000, "completion_tokens": 700 } }),
            );

            let mut sse: String = chunks.iter().map(|c| format!("data: {c}\n\n")).collect();
            sse.push_str("data: [DONE]\n\n");
            let mut state = StreamState::default();
            let mut buf = String::new();
            // Network chunks cut by characters (the real reader decodes the
            // bytes of each chunk; a character cut in half is its own problem).
            let chars: Vec<char> = sse.chars().collect();
            for net in chars.chunks(1500) {
                buf.extend(net.iter());
                for d in drain_events(&mut buf) {
                    state.feed(&d, &mut |_| {});
                }
            }
            let r = state.finish().expect("the turn must parse");
            let uses = r.tool_uses();
            assert_eq!(uses.len(), tools.len(), "turn {t}");
            for ((_, name, input), st) in uses.iter().zip(&tools) {
                assert_eq!(*name, st["nome"].as_str().unwrap(), "turn {t}");
                assert_eq!(
                    *input, &st["input"],
                    "turn {t}: the input changed on the way"
                );
            }
            calls_seen += uses.len();
            let results: Vec<Value> = uses
                .iter()
                .map(|(id, _, _)| {
                    json!({ "type": "tool_result", "tool_use_id": id, "content": "{\"ok\":true}" })
                })
                .collect();
            conversation.push(json!({ "role": "assistant", "content": r.content }));
            if !results.is_empty() {
                conversation.push(json!({ "role": "user", "content": results }));
            }
        }
        assert!(
            calls_seen >= 6,
            "the script has the five drafts and the proposal"
        );

        let body = request_body(
            &MISTRAL,
            "mistral-large-latest",
            &[],
            &conversation,
            &[],
            true,
            64000,
        );
        let messages = body["messages"].as_array().unwrap();
        assert_eq!(
            messages.iter().filter(|m| m["role"] == "tool").count(),
            calls_seen
        );
        // The order Mistral accepts: after a tool result, another result or
        // the assistant, never the user.
        for pair in messages.windows(2) {
            if pair[0]["role"] == "tool" {
                assert_ne!(pair[1]["role"], "user");
            }
        }
        // Every result answers a call of the assistant message before it.
        let mut open: Vec<String> = Vec::new();
        for m in messages {
            if let Some(calls) = m["tool_calls"].as_array() {
                open = calls
                    .iter()
                    .map(|c| c["id"].as_str().unwrap().to_string())
                    .collect();
                for c in calls {
                    let id = c["id"].as_str().unwrap();
                    assert!(
                        id.len() == 9 && id.chars().all(|c| c.is_ascii_alphanumeric()),
                        "{id}"
                    );
                    let args: Value =
                        serde_json::from_str(c["function"]["arguments"].as_str().unwrap()).unwrap();
                    assert!(args.is_object());
                }
            }
            if m["role"] == "tool" {
                let id = m["tool_call_id"].as_str().unwrap();
                assert!(open.iter().any(|o| o == id), "result {id} answers no call");
            }
        }
    }
}
