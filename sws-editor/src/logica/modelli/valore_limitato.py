#@ tag valore scrittura
#@ funzione principale
#@ parametro {{id:passo}} 1
# {{t:c1}}
# {{t:c2}}
{{id:minimo}} = 0
{{id:massimo}} = 100

{{id:nuovo}} = (tags.read("{{tag:valore}}") or 0) + {{id:passo}}
tags.write("{{tag:valore}}", max({{id:minimo}}, min({{id:massimo}}, {{id:nuovo}})))
