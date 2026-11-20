# Extrae una muestra de cuencas de los datos procesados para las pruebas automáticas.
import json
import shutil
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
CUENCAS = [1001002, 4308001, 5410002]


# Copia catálogo, atributos, resumen y series de las cuencas de muestra.
def main():
    par = json.loads((RAIZ / "parametros" / "camels_cl.json").read_text(encoding="utf-8"))
    origen = RAIZ / par["salida"]
    destino = RAIZ / "servidor" / "test" / "muestra" / "camels_cl"
    if destino.exists():
        shutil.rmtree(destino)
    destino.mkdir(parents=True)
    shutil.copy(origen / "catalogo.json", destino / "catalogo.json")
    atrib = json.loads((origen / "atributos.json").read_text(encoding="utf-8"))
    idx = [i for i, g in enumerate(atrib["datos"]["gauge_id"]) if g in CUENCAS]
    atrib["datos"] = {c: [v[i] for i in idx] for c, v in atrib["datos"].items()}
    (destino / "atributos.json").write_text(json.dumps(atrib, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    resumen = json.loads((origen / "resumen.json").read_text(encoding="utf-8"))
    resumen = {k: v for k, v in resumen.items() if int(k) in CUENCAS}
    (destino / "resumen.json").write_text(json.dumps(resumen, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    n = 0
    for var in par["variables"]:
        for g in CUENCAS:
            f = origen / "series" / var / f"{g}.bin"
            if f.exists():
                (destino / "series" / var).mkdir(parents=True, exist_ok=True)
                shutil.copy(f, destino / "series" / var / f.name)
                n += 1
    print(f"Muestra: {len(idx)} cuencas, {n} series en {destino}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    main()
