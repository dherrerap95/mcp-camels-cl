# Valida los binarios y JSON de CAMELS-CL contra los CSV originales del zip.
import json
import sys
import zipfile
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from convertir_camels_cl import EPOCA, RAIZ, leer_matriz, leer_parametros


# Lee un binario de serie y devuelve inicio y valores.
def leer_binario(ruta):
    b = ruta.read_bytes()
    inicio, n = np.frombuffer(b[:8], dtype="<i4")
    valores = np.frombuffer(b[8:], dtype="<f4")
    assert len(valores) == n, f"{ruta}: largo {len(valores)} distinto de n={n}"
    return int(inicio), valores


# Compara todas las cuencas de una variable con su CSV original y devuelve los errores.
def validar_variable(zf, carpeta, nombre, meta, salida, resumen):
    d = leer_matriz(zf, carpeta + meta["archivo"])
    errores, peor = [], 0.0
    for cuenca in d.columns:
        s = d[cuenca].dropna()
        ruta = salida / "series" / nombre / f"{cuenca}.bin"
        if s.empty:
            if ruta.exists():
                errores.append(f"{nombre}/{cuenca}: binario sin datos en el original")
            continue
        inicio, v = leer_binario(ruta)
        if meta["paso"] == "diario":
            pos = (s.index - EPOCA).days.to_numpy() - inicio
        else:
            pos = s.index.year.to_numpy() - inicio
        leidos = v[pos].astype("float64")
        dif = np.abs(leidos - s.to_numpy())
        tol = 1e-6 * np.maximum(1.0, np.abs(s.to_numpy()))
        if (dif > tol).any():
            errores.append(f"{nombre}/{cuenca}: {int((dif > tol).sum())} valores difieren")
        peor = max(peor, float((dif / np.maximum(1.0, np.abs(s.to_numpy()))).max()))
        if int(np.isfinite(v).sum()) != len(s):
            errores.append(f"{nombre}/{cuenca}: {int(np.isfinite(v).sum())} válidos en binario y {len(s)} en original")
        if resumen[str(cuenca)][nombre]["n_validos"] != len(s):
            errores.append(f"{nombre}/{cuenca}: resumen con n_validos distinto")
    print(f"  {nombre}: {d.shape[1]} cuencas revisadas, error relativo máximo {peor:.1e}, {len(errores)} errores")
    return errores


# Ejecuta todas las validaciones y termina con error si alguna falla.
def main():
    par = leer_parametros()
    salida = RAIZ / par["salida"]
    carpeta = par["carpeta_en_zip"]
    resumen = json.loads((salida / "resumen.json").read_text(encoding="utf-8"))
    atrib = json.loads((salida / "atributos.json").read_text(encoding="utf-8"))
    errores = []
    n_cuencas = len(atrib["datos"]["gauge_id"])
    if n_cuencas != 516 or len(atrib["columnas"]) != 111:
        errores.append(f"atributos: {n_cuencas} cuencas y {len(atrib['columnas'])} columnas (se esperaban 516 y 111)")
    if len(set(atrib["datos"]["gauge_id"])) != n_cuencas:
        errores.append("atributos: gauge_id repetidos")
    print(f"  atributos: {n_cuencas} cuencas, {len(atrib['columnas'])} columnas")
    with zipfile.ZipFile(RAIZ / par["zip"]) as zf:
        for nombre, meta in par["variables"].items():
            errores += validar_variable(zf, carpeta, nombre, meta, salida, resumen)
    if errores:
        print("\n".join(errores[:50]))
        sys.exit(f"Validación con {len(errores)} errores")
    print("Validación sin errores")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    main()
