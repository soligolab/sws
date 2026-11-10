# Banco di collaudo

Una pagina con le prove da fare, una per scheda, e un clic per l'esito. Nata il 05-11-2026 per fare in fretta la
pulizia prima della 2.26.0; il resto delle prove viaggia con git, così si continua da un'altra macchina.

**Avvio**, sulla macchina di sviluppo:

```
python3 scripts/banco_collaudo/server.py        # porta 8471; un altro numero come argomento
```

Poi dal browser `http://<macchina>:8471`. I link «IDE 8460» puntano alla stessa macchina che serve il banco.

**Uso**: le prove sono in gruppi, da fare nell'ordine. `p` passa, `f` non passa, `d` dopo, `n` scrive una nota,
`j`/`k` per muoversi. Gli esiti si salvano in `esiti.json`, accanto al server, **fuori da git**: prima di chiudere la
sessione si fanno leggere a Claude, che spunta `docs/COLLAUDI_IN_SOSPESO.md`, archivia i piani e aggiorna i semi in
`docs/plans/semi/`, poi toglie da `prove.json` le prove fatte.

**Dove si fa cosa**: i gruppi «IDE 8460» e «cloud» vanno da qualunque macchina, con l'IDE del ramo avviato da
`./scripts/start_editor.sh`. I gruppi «WP630» vogliono il WP630 dell'ufficio. Un deploy con un nome nuovo cancella il
progetto **e gli account** del pannello: si fa prima la voce «Prima di tutto» del gruppo 6.

**Il banco della rc.10 si fa da casa** (09-11-2026): i gruppi 0-5 vogliono il TC620 con CasaDomotica, l'IDE nel cloud
(`sws.soligo.net`) e, dove è scritto, l'SSH sul pannello, da chiedere prima. Sul TC620 non si manda mai un progetto con
un altro nome: cancellerebbe CasaDomotica e il suo storico; quello che manca si aggiunge nella pagina «Collaudo».
Le prove del WP630 stanno tutte nel gruppo «9 · Solo ufficio (WP630)», in fondo, e aspettano l'ufficio.

**Le prove L0** (sandbox Python) vogliono RestrictedPython nel Python dell'IDE: se manca,
`python3 -m venv tmp/venv-rp && tmp/venv-rp/bin/pip install RestrictedPython==8.5`, e l'IDE si avvia con
`PYTHONPATH=$(echo $PWD/tmp/venv-rp/lib/python3*/site-packages) ./scripts/start_editor.sh`.
