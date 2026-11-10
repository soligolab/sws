#@ tag misura lettura
#@ tag uscita scrittura
#@ script principale
#@ trigger interval 1
# {{t:c1}}
# {{t:c2}}
{{id:accendi_sotto}} = 19.0
{{id:spegni_sopra}} = 21.0

{{id:misura}} = tags.read("{{tag:misura}}")
{{id:acceso}} = bool(tags.read("{{tag:uscita}}"))
if {{id:misura}} is not None:
    if {{id:misura}} <= {{id:accendi_sotto}} and not {{id:acceso}}:
        tags.write("{{tag:uscita}}", True)
    elif {{id:misura}} >= {{id:spegni_sopra}} and {{id:acceso}}:
        tags.write("{{tag:uscita}}", False)
