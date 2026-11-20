# Convierte CAMELS-CL desde el zip original a binarios por cuenca y JSON para el servidor MCP.
import json
import math
import struct
import sys
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

RAIZ = Path(__file__).resolve().parent.parent
EPOCA = pd.Timestamp("1970-01-01")


# Lee el archivo de parámetros de la fuente.
def leer_parametros():
    with open(RAIZ / "parametros" / "camels_cl.json", encoding="utf-8") as f:
        return json.load(f)


# Lee una matriz de CAMELS-CL (fechas en filas, cuencas en columnas) desde el zip.
def leer_matriz(zf, ruta):
    with zf.open(ruta) as f:
        d = pd.read_csv(f, index_col="date", parse_dates=True, na_values=["NA"])
    d = d.drop(columns=[c for c in ("year", "month", "day") if c in d.columns])
    d.columns = [int(c) for c in d.columns]
    return d.sort_index()


# Escribe una serie recortada a su primer y último dato válido: int32 inicio, int32 n, float32[n].
def escribir_binario(ruta, inicio, valores):
    ruta.parent.mkdir(parents=True, exist_ok=True)
    with open(ruta, "wb") as f:
        f.write(struct.pack("<ii", int(inicio), len(valores)))
        f.write(valores.astype("<f4").tobytes())


# Convierte una variable diaria o anual y devuelve su resumen por cuenca.
def convertir_variable(zf, carpeta, nombre, meta, salida):
    d = leer_matriz(zf, carpeta + meta["archivo"])
    if meta["paso"] == "diario":
        completo = pd.date_range(d.index.min(), d.index.max(), freq="D")
        d = d.reindex(completo)
    else:
        d.index = d.index.year
        d = d.reindex(range(d.index.min(), d.index.max() + 1))
    resumen = {}
    for cuenca in d.columns:
        s = d[cuenca]
        if s.notna().sum() == 0:
            continue
        s = s.loc[s.first_valid_index(): s.last_valid_index()]
        if meta["paso"] == "diario":
            inicio = (s.index[0] - EPOCA).days
            ini_txt, fin_txt = s.index[0].date().isoformat(), s.index[-1].date().isoformat()
        else:
            inicio = int(s.index[0])
            ini_txt, fin_txt = str(s.index[0]), str(s.index[-1])
        escribir_binario(salida / "series" / nombre / f"{cuenca}.bin", inicio, s.to_numpy(dtype="float64"))
        n_val = int(s.notna().sum())
        resumen[cuenca] = {
            "inicio": ini_txt,
            "fin": fin_txt,
            "n_validos": n_val,
            "pct_faltante": round(100 * (1 - n_val / len(s)), 2),
            "media": round(float(s.mean()), 4),
        }
    print(f"  {nombre}: {len(resumen)} cuencas con datos, {sum(r['n_validos'] for r in resumen.values())} valores")
    return resumen


# Convierte un valor de pandas a uno serializable en JSON (NaN a null).
def a_json(v):
    if v is None:
        return None
    if isinstance(v, (float, np.floating)):
        return None if math.isnan(v) else round(float(v), 6)
    if isinstance(v, (np.integer,)):
        return int(v)
    return v


# Guarda los atributos de las cuencas en formato de columnas.
def convertir_atributos(zf, carpeta, archivo, salida):
    with zf.open(carpeta + archivo) as f:
        a = pd.read_csv(f, na_values=["NA"])
    a = a.sort_values("gauge_id")
    datos = {c: [a_json(v) for v in a[c].tolist()] for c in a.columns}
    with open(salida / "atributos.json", "w", encoding="utf-8") as f:
        json.dump({"columnas": list(a.columns), "datos": datos}, f, ensure_ascii=False, separators=(",", ":"))
    print(f"  atributos: {a.shape[0]} cuencas, {a.shape[1]} columnas")
    return a["gauge_id"].tolist()


# Ejecuta la conversión completa y escribe el catálogo.
def main():
    par = leer_parametros()
    salida = RAIZ / par["salida"]
    salida.mkdir(parents=True, exist_ok=True)
    carpeta = par["carpeta_en_zip"]
    with zipfile.ZipFile(RAIZ / par["zip"]) as zf:
        cuencas = convertir_atributos(zf, carpeta, par["archivo_atributos"], salida)
        resumen = {str(c): {} for c in cuencas}
        for nombre, meta in par["variables"].items():
            for cuenca, r in convertir_variable(zf, carpeta, nombre, meta, salida).items():
                resumen.setdefault(str(cuenca), {})[nombre] = r
    with open(salida / "resumen.json", "w", encoding="utf-8") as f:
        json.dump(resumen, f, ensure_ascii=False, separators=(",", ":"))
    catalogo = {
        "fuente": "CAMELS-CL",
        "version": par["version"],
        "cita": par["cita"],
        "licencia": par["licencia"],
        "formato_series": "series/<variable>/<gauge_id>.bin: int32 inicio, int32 n, float32[n] little-endian; "
                          "inicio en días desde 1970-01-01 (diario) o año (anual); NaN = faltante",
        "variables": par["variables"],
    }
    with open(salida / "catalogo.json", "w", encoding="utf-8") as f:
        json.dump(catalogo, f, ensure_ascii=False, indent=2)
    print(f"Listo: {salida}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    main()
