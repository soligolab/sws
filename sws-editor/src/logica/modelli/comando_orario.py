#@ tag uscita scrittura
#@ script accensione
#@ trigger cron 0 7 * * *
# {{t:c1}}
# {{t:utc}}
tags.write("{{tag:uscita}}", True)
#@ script spegnimento
#@ trigger cron 0 22 * * *
# {{t:c2}}
# {{t:utc}}
tags.write("{{tag:uscita}}", False)
