// Cálculos hidrológicos sobre series diarias y anuales.
import type { Serie } from "./datos";

const MS_DIA = 86_400_000;

export interface Fila {
  etiqueta: string;
  anio: number;
  mes?: number;
  valor: number | null;
  n_validos: number;
  n_dias: number;
}

// Convierte un número de días desde 1970-01-01 a fecha UTC.
export function fechaDeDia(d: number): Date {
  return new Date(d * MS_DIA);
}

// Convierte un número de días desde 1970-01-01 a texto ISO.
export function isoDeDia(d: number): string {
  return fechaDeDia(d).toISOString().slice(0, 10);
}

// Convierte una fecha ISO (AAAA, AAAA-MM o AAAA-MM-DD) al número de días desde 1970-01-01.
export function diaDeIso(txt: string, alFinal = false): number {
  const p = txt.split("-").map(Number);
  if (p.some(Number.isNaN) || p.length < 1 || p.length > 3) throw new Error(`Fecha no válida: ${txt}`);
  const [a, m, d] = p;
  if (p.length === 1) return Date.UTC(alFinal ? a + 1 : a, 0, 1) / MS_DIA - (alFinal ? 1 : 0);
  if (p.length === 2) return Date.UTC(alFinal ? a : a, alFinal ? m : m - 1, 1) / MS_DIA - (alFinal ? 1 : 0);
  return Date.UTC(a, m - 1, d) / MS_DIA;
}

// Convierte desde/hasta en días; con año hidrológico, un año solo (AAAA) abarca el año hidrológico completo que empieza en él.
export function periodo(desde?: string, hasta?: string, mesInicio = 1): [number | undefined, number | undefined] {
  const soloAnio = /^\d{4}$/;
  const hidro = mesInicio !== 1;
  const a = desde === undefined ? undefined : hidro && soloAnio.test(desde) ? Date.UTC(Number(desde), mesInicio - 1, 1) / MS_DIA : diaDeIso(desde);
  const b =
    hasta === undefined ? undefined : hidro && soloAnio.test(hasta) ? Date.UTC(Number(hasta) + 1, mesInicio - 1, 1) / MS_DIA - 1 : diaDeIso(hasta, true);
  return [a, b];
}

// Recorta una serie al período pedido (índices de tiempo inclusivos).
export function recortar(s: Serie, desde?: number, hasta?: number): Serie {
  const fin = s.inicio + s.valores.length - 1;
  const a = Math.max(s.inicio, desde ?? s.inicio);
  const b = Math.min(fin, hasta ?? fin);
  if (b < a) return { ...s, inicio: a, valores: new Float32Array(0) };
  return { ...s, inicio: a, valores: s.valores.subarray(a - s.inicio, b - s.inicio + 1) };
}

// Cuenta valores válidos de una serie.
export function nValidos(v: Float32Array): number {
  let n = 0;
  for (let i = 0; i < v.length; i++) if (!Number.isNaN(v[i])) n++;
  return n;
}

// Agrega una serie diaria a meses o años; un período con completitud menor que el mínimo queda nulo.
export function agregar(
  s: Serie,
  paso: "mensual" | "anual",
  agregacion: "media" | "suma" | "ultimo",
  minCompletitud: number,
  mesInicio = 1,
): Fila[] {
  const grupos = new Map<number, { suma: number; n: number; dias: number; anio: number; mes?: number }>();
  for (let i = 0; i < s.valores.length; i++) {
    const f = fechaDeDia(s.inicio + i);
    const y = f.getUTCFullYear();
    const m = f.getUTCMonth() + 1;
    let clave: number, anio: number, mes: number | undefined;
    if (paso === "mensual") {
      clave = y * 12 + m;
      anio = y;
      mes = m;
    } else {
      anio = m >= mesInicio ? y : y - 1;
      clave = anio;
    }
    let g = grupos.get(clave);
    if (!g) {
      g = { suma: 0, n: 0, dias: 0, anio, mes };
      grupos.set(clave, g);
    }
    g.dias++;
    const v = s.valores[i];
    if (!Number.isNaN(v)) {
      g.suma += v;
      g.n++;
    }
  }
  const filas: Fila[] = [];
  for (const [, g] of [...grupos.entries()].sort((x, y) => x[0] - y[0])) {
    const diasPeriodo = paso === "mensual" ? diasDelMes(g.anio, g.mes!) : diasDelAnio(g.anio, mesInicio);
    const completo = g.n / diasPeriodo >= minCompletitud;
    let valor: number | null = null;
    if (completo && g.n > 0) valor = agregacion === "suma" ? (g.suma / g.n) * diasPeriodo : g.suma / g.n;
    const etiqueta =
      paso === "mensual"
        ? `${g.anio}-${String(g.mes).padStart(2, "0")}`
        : mesInicio === 1
          ? String(g.anio)
          : `${g.anio}/${String((g.anio + 1) % 100).padStart(2, "0")}`;
    filas.push({ etiqueta, anio: g.anio, mes: g.mes, valor, n_validos: g.n, n_dias: diasPeriodo });
  }
  return filas;
}

// Días de un mes calendario.
function diasDelMes(a: number, m: number): number {
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}

// Días de un año que parte en el mes indicado.
function diasDelAnio(a: number, mesInicio: number): number {
  return (Date.UTC(a + 1, mesInicio - 1, 1) - Date.UTC(a, mesInicio - 1, 1)) / MS_DIA;
}

// Caudal (o valor) igualado o superado con la probabilidad p, posición de Weibull i/(n+1).
export function excedencia(ordenDesc: Float64Array, p: number): number | null {
  const n = ordenDesc.length;
  if (n === 0) return null;
  const pos = p * (n + 1);
  if (pos <= 1) return ordenDesc[0];
  if (pos >= n) return ordenDesc[n - 1];
  const i = Math.floor(pos);
  const f = pos - i;
  return ordenDesc[i - 1] + f * (ordenDesc[i] - ordenDesc[i - 1]);
}

// Valores válidos de una serie ordenados de mayor a menor.
export function validosDesc(v: Float32Array): Float64Array {
  const out: number[] = [];
  for (let i = 0; i < v.length; i++) if (!Number.isNaN(v[i])) out.push(v[i]);
  return Float64Array.from(out).sort().reverse();
}

// Media, desviación estándar, mínimo y máximo de una lista de números.
export function estadisticos(x: number[]): { n: number; media: number; desv: number; min: number; max: number } | null {
  if (x.length === 0) return null;
  const media = x.reduce((a, b) => a + b, 0) / x.length;
  const desv = x.length > 1 ? Math.sqrt(x.reduce((a, b) => a + (b - media) ** 2, 0) / (x.length - 1)) : 0;
  return { n: x.length, media, desv, min: Math.min(...x), max: Math.max(...x) };
}

// Máximo y mínimo diario de cada año con datos suficientes.
export function extremosAnuales(s: Serie, minCompletitud: number, mesInicio = 1): { anio: string; max: number; fechaMax: string; min: number; fechaMin: string }[] {
  const g = new Map<number, { n: number; max: number; iMax: number; min: number; iMin: number }>();
  for (let i = 0; i < s.valores.length; i++) {
    const v = s.valores[i];
    if (Number.isNaN(v)) continue;
    const f = fechaDeDia(s.inicio + i);
    const y = f.getUTCFullYear();
    const a = f.getUTCMonth() + 1 >= mesInicio ? y : y - 1;
    let r = g.get(a);
    if (!r) {
      r = { n: 0, max: -Infinity, iMax: 0, min: Infinity, iMin: 0 };
      g.set(a, r);
    }
    r.n++;
    if (v > r.max) {
      r.max = v;
      r.iMax = i;
    }
    if (v < r.min) {
      r.min = v;
      r.iMin = i;
    }
  }
  return [...g.entries()]
    .filter(([a, r]) => r.n / diasDelAnio(a, mesInicio) >= minCompletitud)
    .sort((x, y) => x[0] - y[0])
    .map(([a, r]) => ({
      anio: mesInicio === 1 ? String(a) : `${a}/${String((a + 1) % 100).padStart(2, "0")}`,
      max: r.max,
      fechaMax: isoDeDia(s.inicio + r.iMax),
      min: r.min,
      fechaMin: isoDeDia(s.inicio + r.iMin),
    }));
}

// Formatea un número con cifras significativas razonables.
export function num(v: number | null | undefined, dec?: number): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "s/d";
  if (dec !== undefined) return v.toFixed(dec);
  const a = Math.abs(v);
  if (a === 0) return "0";
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  return v.toPrecision(3);
}

// Arma una tabla Markdown.
export function tabla(cabecera: string[], filas: (string | number)[][]): string {
  const l = [`| ${cabecera.join(" | ")} |`, `|${cabecera.map(() => "---").join("|")}|`];
  for (const f of filas) l.push(`| ${f.join(" | ")} |`);
  return l.join("\n");
}
