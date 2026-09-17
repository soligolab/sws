# Banchi di prova — progetti che servono a noi, non all'utente

Qui stanno i progetti nati per **esercitare una funzione mentre la si costruisce**: non sono
template, non compaiono nella vetrina di `examples/templates/`, e non rispettano le regole del
parco template (`examples/templates/README.md`).

La distinzione è stata fatta il 17-09-2026, decidendo quelle regole. Un template è ciò che
l'utente copia: deve essere 1280×800, tradotto in tre lingue, semplice e senza la rete di
nessuno. Un banco di prova ha il compito opposto — mettere sotto sforzo una cosa sola — e
tenerlo nella vetrina significava o mentirgli addosso o applicargli regole scritte per un altro
scopo.

| Progetto | A cosa serve |
|---|---|
| [`t69-collaudo`](t69-collaudo/) | T-69: orologio, stato ritenuto, `interval_ms` sui trigger, funzioni da script globale. Due pagine, 45 oggetti, una lingua sola — ed è giusto così: qui si guarda se gli script girano, non come si legge il pannello |

Per aprirne uno: si copia la cartella in `<progetti>/` come qualunque progetto, non si «crea da
template» dall'IDE.
