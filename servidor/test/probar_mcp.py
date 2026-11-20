# Prueba las herramientas de un servidor MCP por Streamable HTTP y muestra sus respuestas.
import json
import ssl
import sys
import time
import urllib.request

try:
    import certifi

    CONTEXTO = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    CONTEXTO = ssl.create_default_context()

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8787/mcp"
CABECERAS = {"content-type": "application/json", "accept": "application/json, text/event-stream", "user-agent": "prueba-mcp/0.1"}


# Envía un mensaje JSON-RPC y devuelve la respuesta (JSON o evento SSE).
def llamar(metodo, params=None, id_=1, extra=None):
    cuerpo = {"jsonrpc": "2.0", "method": metodo, "params": params or {}}
    if id_ is not None:
        cuerpo["id"] = id_
    req = urllib.request.Request(URL, data=json.dumps(cuerpo).encode(), headers={**CABECERAS, **(extra or {})}, method="POST")
    t = time.time()
    with urllib.request.urlopen(req, timeout=60, context=CONTEXTO) as r:
        txt = r.read().decode("utf-8")
        dt = (time.time() - t) * 1000
    if not txt.strip():
        return None, dt
    if txt.lstrip().startswith("{"):
        return json.loads(txt), dt
    datos = [l[5:].strip() for l in txt.splitlines() if l.startswith("data:")]
    return json.loads(datos[-1]), dt


FALLAS = []
CITA = "https://hess.copernicus.org/articles/22/5817/2018/"


# Ejecuta una herramienta, imprime su texto y registra si no responde lo esperado.
def herramienta(nombre, args, error=False, contiene=()):
    r, dt = llamar("tools/call", {"name": nombre, "arguments": args}, id_=2)
    res = r.get("result", r)
    texto = "\n".join(c.get("text", "") for c in res.get("content", [])) if "content" in res else json.dumps(res, ensure_ascii=False)
    es_error = bool(res.get("isError", False)) or "error" in r
    print(f"\n===== {nombre} {json.dumps(args, ensure_ascii=False)} ({dt:.0f} ms, error={es_error})\n{texto[:2500]}")
    if es_error != error:
        FALLAS.append(f"{nombre}: error={es_error}, se esperaba {error}")
    for c in (contiene if error else (*contiene, CITA)):
        if c not in texto:
            FALLAS.append(f"{nombre}: falta «{c}» en la respuesta")
    return res


# Recorre las herramientas con casos típicos y termina con error si alguno falla.
def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    r, dt = llamar("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "prueba", "version": "0"}})
    print("initialize:", json.dumps(r.get("result", r).get("serverInfo", r), ensure_ascii=False), f"{dt:.0f} ms")
    r, _ = llamar("tools/list", id_=3)
    nombres = [t["name"] for t in r["result"]["tools"]]
    print("herramientas:", nombres)
    esperadas = {"describir_fuente", "buscar_cuencas", "atributos_cuenca", "serie", "estadisticas", "comparar_cuencas"}
    if set(nombres) != esperadas:
        FALLAS.append(f"tools/list: {sorted(nombres)}")
    herramienta("describir_fuente", {}, contiene=["Diego Herrera Pino", "q_m3s"])
    herramienta("buscar_cuencas", {"texto": "aconcagua"}, contiene=["5410002"])
    herramienta("buscar_cuencas", {"lat": -33.45, "lon": -70.66, "radio_km": 60, "filtros": [{"atributo": "area_km2", "min": 100}], "limite": 5})
    herramienta("atributos_cuenca", {"gauge_id": 5410002, "grupo": "hidrologia"}, contiene=["baseflow_index_1979_2010"])
    herramienta("serie", {"gauge_id": 5410002, "variable": "q_m3s", "paso": "anual", "desde": "2000", "hasta": "2019", "mes_inicio_anio": 4}, contiene=["| 2000/01 | 42.7 |"])
    herramienta("serie", {"gauge_id": 5410002, "variable": "p_cr2met", "paso": "mensual", "desde": "2019-01", "hasta": "2019-12"}, contiene=["| 2019-06 | 39.3 |"])
    herramienta("serie", {"gauge_id": 5410002, "variable": "derechos_sup", "desde": "2010"}, contiene=["| 2010 | 385 |"])
    herramienta("estadisticas", {"gauge_id": 5410002, "variable": "q_m3s", "desde": "1980", "hasta": "2019", "mes_inicio_anio": 4}, contiene=["| 98.3 | 67.0 | 37.8 | 20.2 | 12.2 | 9.68 | 8.54 | 6.86 |"])
    herramienta("comparar_cuencas", {"gauge_ids": [5410002, 1001002]}, contiene=["Rio Caquena En Vertedero"])
    herramienta("atributos_cuenca", {"gauge_id": 999}, error=True)
    herramienta("serie", {"gauge_id": 5410002, "variable": "q_m3s", "desde": "ayer"}, error=True)
    if FALLAS:
        print("\nFALLAS:\n" + "\n".join(FALLAS))
        sys.exit(1)
    print("\nTodas las herramientas responden lo esperado")


if __name__ == "__main__":
    main()
