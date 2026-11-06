#!/usr/bin/env python3
"""Banco di collaudo: una pagina con le prove da fare, gli esiti salvati qui.

Si avvia sulla macchina di sviluppo (`python3 scripts/banco_collaudo/server.py`) e
si apre dal browser: http://<macchina>:8471. Le prove stanno in prove.json, gli
esiti in esiti.json (accanto a questo file, fuori da git): Claude li legge per
spuntare COLLAUDI_IN_SOSPESO.md, archiviare i piani e sfoltire Appunti.txt.
Solo libreria standard. Vedi LEGGIMI.md.
"""
import json, os, ssl, sys, threading, time, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

QUI = os.path.dirname(os.path.abspath(__file__))
PROVE = os.path.join(QUI, "prove.json")
ESITI = os.path.join(QUI, "esiti.json")
blocco = threading.Lock()


def leggi(path, vuoto):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return vuoto


def scrivi_esiti(esiti):
    tmp = ESITI + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(esiti, f, ensure_ascii=False, indent=1)
    os.replace(tmp, ESITI)


def sonda(url):
    """GET senza credenziali: risponde? Il certificato dei pannelli è firmato da sé."""
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(url, timeout=6, context=ctx) as r:
            corpo = r.read(400).decode("utf-8", "replace").strip()
            return {"ok": 200 <= r.status < 300, "stato": r.status, "ms": round((time.monotonic() - t0) * 1000),
                    "corpo": corpo[:200]}
    except Exception as e:  # noqa: BLE001 — qualunque guasto è un esito da mostrare
        return {"ok": False, "stato": None, "ms": round((time.monotonic() - t0) * 1000), "corpo": str(e)[:200]}


class Gestore(BaseHTTPRequestHandler):
    def _json(self, codice, dati):
        b = json.dumps(dati, ensure_ascii=False).encode("utf-8")
        self.send_response(codice)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            with open(os.path.join(QUI, "index.html"), "rb") as f:
                b = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)
        elif self.path == "/prove":
            self._json(200, leggi(PROVE, {"prove": []}))
        elif self.path == "/esiti":
            self._json(200, leggi(ESITI, {}))
        else:
            self._json(404, {"errore": "non c'è"})

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        try:
            dati = json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            return self._json(400, {"errore": "JSON non valido"})
        if self.path == "/esito":
            pid = str(dati.get("id", ""))
            if not pid:
                return self._json(400, {"errore": "manca id"})
            with blocco:
                esiti = leggi(ESITI, {})
                if dati.get("esito") is None and not dati.get("nota"):
                    esiti.pop(pid, None)
                else:
                    esiti[pid] = {"esito": dati.get("esito"), "nota": dati.get("nota", ""),
                                  "quando": time.strftime("%Y-%m-%d %H:%M:%S")}
                scrivi_esiti(esiti)
            return self._json(200, {"ok": True})
        if self.path == "/sonda":
            prove = leggi(PROVE, {"prove": []})
            url = next((p.get("sonda") for p in prove.get("prove", []) if p.get("id") == dati.get("id")), None)
            if not url:
                return self._json(400, {"errore": "questa prova non ha una sonda"})
            return self._json(200, sonda(url))
        self._json(404, {"errore": "non c'è"})

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    porta = int(sys.argv[1]) if len(sys.argv) > 1 else 8471
    print(f"banco di collaudo su http://0.0.0.0:{porta}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", porta), Gestore).serve_forever()
