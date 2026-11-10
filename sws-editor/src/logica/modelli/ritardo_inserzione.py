#@ tag ingresso lettura
#@ tag uscita scrittura
#@ script principale
#@ trigger interval_ms 200
# {{t:c1}}
# {{t:c2}}
{{id:ritardo_ms}} = 5000

{{id:attiva}} = False
if tags.read("{{tag:ingresso}}"):
    {{id:dal}} = state.get("{{id:dal}}", 0)
    if {{id:dal}} == 0:
        {{id:dal}} = now_ms()
        state.set("{{id:dal}}", {{id:dal}})
    {{id:attiva}} = now_ms() - {{id:dal}} >= {{id:ritardo_ms}}
else:
    state.set("{{id:dal}}", 0)

if tags.read("{{tag:uscita}}") != {{id:attiva}}:
    tags.write("{{tag:uscita}}", {{id:attiva}})
