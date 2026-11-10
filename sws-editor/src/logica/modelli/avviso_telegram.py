#@ tag allarme lettura
#@ script principale
#@ trigger interval 1
# {{t:c1}}
# {{t:c2}}
{{id:attesa_ms}} = 10000
{{id:pausa_ms}} = 600000

if tags.read("{{tag:allarme}}"):
    {{id:dal}} = state.get("{{id:dal}}", 0)
    if {{id:dal}} == 0:
        state.set("{{id:dal}}", now_ms())
    elif now_ms() - {{id:dal}} >= {{id:attesa_ms}} and now_ms() - state.get("{{id:inviato}}", 0) >= {{id:pausa_ms}}:
        send_telegram("{{t:messaggio}} {{tag:allarme}}")
        state.set("{{id:inviato}}", now_ms())
else:
    state.set("{{id:dal}}", 0)
