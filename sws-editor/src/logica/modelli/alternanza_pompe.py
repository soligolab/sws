#@ tag richiesta lettura
#@ tag pompa1 scrittura
#@ tag pompa2 scrittura
#@ script principale
#@ trigger tag {{tag:richiesta}} any
# {{t:c1}}
# {{t:c2}}
if tags.read("{{tag:richiesta}}"):
    {{id:turno}} = state.get("{{id:turno}}", 1)
    tags.write("{{tag:pompa1}}", {{id:turno}} == 1)
    tags.write("{{tag:pompa2}}", {{id:turno}} == 2)
else:
    tags.write("{{tag:pompa1}}", False)
    tags.write("{{tag:pompa2}}", False)
    state.set("{{id:turno}}", 2 if state.get("{{id:turno}}", 1) == 1 else 1)
