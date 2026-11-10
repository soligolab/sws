#@ tag misura lettura
#@ tag filtrata scrittura
#@ script principale
#@ trigger interval 1
# {{t:c1}}
# {{t:c2}}
{{id:alfa}} = 0.2

{{id:misura}} = tags.read("{{tag:misura}}")
if {{id:misura}} is not None:
    {{id:filtrato}} = state.get("{{id:filtrato}}", {{id:misura}})
    {{id:filtrato}} = {{id:filtrato}} + {{id:alfa}} * ({{id:misura}} - {{id:filtrato}})
    state.set("{{id:filtrato}}", {{id:filtrato}})
    tags.write("{{tag:filtrata}}", round({{id:filtrato}}, 2))
