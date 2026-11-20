// Pruebas unitarias de los cálculos hidrológicos.
import { describe, expect, it } from "vitest";
import { agregar, diaDeIso, excedencia, extremosAnuales, isoDeDia, nValidos, recortar, validosDesc } from "../src/calculos";
import type { Serie } from "../src/datos";

// Crea una serie diaria desde una fecha ISO con los valores dados.
function serieDiaria(inicio: string, valores: number[]): Serie {
  return { paso: "diario", inicio: diaDeIso(inicio), valores: Float32Array.from(valores) };
}

describe("fechas", () => {
  it("convierte fechas ISO a días y de vuelta", () => {
    expect(diaDeIso("1970-01-01")).toBe(0);
    expect(isoDeDia(diaDeIso("2019-12-31"))).toBe("2019-12-31");
  });
  it("interpreta año y mes como inicio o fin del período", () => {
    expect(isoDeDia(diaDeIso("2019"))).toBe("2019-01-01");
    expect(isoDeDia(diaDeIso("2019", true))).toBe("2019-12-31");
    expect(isoDeDia(diaDeIso("2020-02", true))).toBe("2020-02-29");
  });
  it("rechaza fechas no válidas", () => {
    expect(() => diaDeIso("2019-xx")).toThrow();
  });
});

describe("recortar", () => {
  it("limita la serie al período pedido", () => {
    const s = serieDiaria("2000-01-01", [1, 2, 3, 4, 5]);
    const r = recortar(s, diaDeIso("2000-01-02"), diaDeIso("2000-01-04"));
    expect(Array.from(r.valores)).toEqual([2, 3, 4]);
    expect(isoDeDia(r.inicio)).toBe("2000-01-02");
  });
  it("devuelve una serie vacía fuera del período", () => {
    const s = serieDiaria("2000-01-01", [1, 2]);
    expect(recortar(s, diaDeIso("2001-01-01")).valores.length).toBe(0);
  });
});

describe("agregar", () => {
  it("promedia por mes y respeta la completitud mínima", () => {
    const enero = Array(31).fill(2);
    const febrero = [...Array(20).fill(4), ...Array(9).fill(NaN)];
    const f = agregar(serieDiaria("2020-01-01", [...enero, ...febrero]), "mensual", "media", 0.8);
    expect(f[0]).toMatchObject({ etiqueta: "2020-01", valor: 2, n_validos: 31, n_dias: 31 });
    expect(f[1]).toMatchObject({ etiqueta: "2020-02", valor: null, n_validos: 20, n_dias: 29 });
  });
  it("suma por mes y escala cuando faltan pocos días", () => {
    const v = [...Array(30).fill(1), NaN];
    const f = agregar(serieDiaria("2021-01-01", v), "mensual", "suma", 0.8);
    expect(f[0].valor).toBeCloseTo(31, 6);
  });
  it("agrupa por año hidrológico desde el mes indicado", () => {
    const dias = 365 + 366;
    const f = agregar(serieDiaria("2019-04-01", Array(dias).fill(1)), "anual", "suma", 0.8, 4);
    expect(f.map((x) => x.etiqueta)).toEqual(["2019/20", "2020/21"]);
    expect(f[0].valor).toBeCloseTo(366, 6);
  });
});

describe("curva de duración", () => {
  it("usa la posición de Weibull i/(n+1)", () => {
    const desc = validosDesc(Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, NaN]));
    expect(desc.length).toBe(9);
    expect(excedencia(desc, 0.5)).toBeCloseTo(5, 6);
    expect(excedencia(desc, 0.1)).toBeCloseTo(9, 6);
    expect(excedencia(desc, 0.9)).toBeCloseTo(1, 6);
  });
  it("devuelve null sin datos", () => {
    expect(excedencia(new Float64Array(0), 0.5)).toBeNull();
  });
});

describe("extremos y conteos", () => {
  it("encuentra máximo y mínimo diario de cada año completo", () => {
    const v = Array.from({ length: 365 }, (_, i) => i);
    const e = extremosAnuales(serieDiaria("2021-01-01", v), 0.8);
    expect(e).toEqual([{ anio: "2021", max: 364, fechaMax: "2021-12-31", min: 0, fechaMin: "2021-01-01" }]);
  });
  it("cuenta valores válidos", () => {
    expect(nValidos(Float32Array.from([1, NaN, 3]))).toBe(2);
  });
});
