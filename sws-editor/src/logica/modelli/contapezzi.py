#@ tag sensore lettura
#@ tag pezzi scrittura
#@ script principale
#@ trigger tag {{tag:sensore}} rising
# {{t:c1}}
# {{t:c2}}
{{id:pezzi}} = tags.read("{{tag:pezzi}}") or 0
tags.write("{{tag:pezzi}}", {{id:pezzi}} + 1)
