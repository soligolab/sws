#@ tag contatore scrittura
#@ funzione azzera
# {{t:c1}}
# {{t:c2}}
tags.write("{{tag:contatore}}", 0)
#@ script mezzanotte
#@ trigger cron 0 0 * * *
# {{t:c3}}
# {{t:utc}}
functions.run("{{nome:azzera}}")
