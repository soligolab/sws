#@ tag marcia lettura
#@ tag ore scrittura
#@ script principale
#@ trigger interval 1
# {{t:c1}}
# {{t:c2}}
{{id:ore}} = tags.read("{{tag:ore}}") or 0
if tags.read("{{tag:marcia}}"):
    tags.write("{{tag:ore}}", {{id:ore}} + delta_ms() / 3600000)
