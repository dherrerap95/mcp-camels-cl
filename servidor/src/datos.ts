// Lectura de los datos de CAMELS-CL desde los archivos estáticos del Worker.

export interface Env {
  ASSETS: Fetcher;
  MAX_FILAS: string;
  MAX_CUENCAS: string;
  MIN_COMPLETITUD: string;
}

export type Valor = number | string | null;
export type Cuenca = Record<string, Valor>;

export interface MetaVariable {
  archivo: string;
  paso: "diario" | "anual";
  unidad: string;
  agregacion: "media" | "suma" | "ultimo";
  descripcion: string;
}

export interface Catalogo {
  fuente: string;
  version: string;
  cita: string;
  licencia: string;
  formato_series: string;
  variables: Record<string, MetaVariable>;
}

export interface ResumenVariable {
  inicio: string;
  fin: string;
  n_validos: number;
  pct_faltante: number;
  media: number;
}

export interface Serie {
  paso: "diario" | "anual";
  inicio: number;
  valores: Float32Array;
}

const PREFIJO = "/camels_cl";
let cacheCuencas: Cuenca[] | null = null;
let cacheResumen: Record<string, Record<string, ResumenVariable>> | null = null;
let cacheCatalogo: Catalogo | null = null;

// Pide un archivo estático por su ruta.
async function pedir(env: Env, ruta: string): Promise<Response> {
  return env.ASSETS.fetch(new Request("https://assets.local" + PREFIJO + ruta));
}

// Lee un JSON estático y falla si no existe.
async function leerJson<T>(env: Env, ruta: string): Promise<T> {
  const r = await pedir(env, ruta);
  if (!r.ok) throw new Error(`No se pudo leer ${ruta} (${r.status})`);
  return (await r.json()) as T;
}

// Devuelve las cuencas con sus atributos como filas.
export async function cuencas(env: Env): Promise<Cuenca[]> {
  if (cacheCuencas) return cacheCuencas;
  const a = await leerJson<{ columnas: string[]; datos: Record<string, Valor[]> }>(env, "/atributos.json");
  const n = a.datos["gauge_id"].length;
  const filas: Cuenca[] = [];
  for (let i = 0; i < n; i++) {
    const f: Cuenca = {};
    for (const c of a.columnas) f[c] = a.datos[c][i];
    filas.push(f);
  }
  cacheCuencas = filas;
  return filas;
}

// Devuelve las columnas de atributos en su orden original.
export async function columnas(env: Env): Promise<string[]> {
  const c = await cuencas(env);
  return Object.keys(c[0]);
}

// Devuelve el resumen de disponibilidad por cuenca y variable.
export async function resumen(env: Env): Promise<Record<string, Record<string, ResumenVariable>>> {
  if (!cacheResumen) cacheResumen = await leerJson(env, "/resumen.json");
  return cacheResumen!;
}

// Devuelve el catálogo de la fuente.
export async function catalogo(env: Env): Promise<Catalogo> {
  if (!cacheCatalogo) cacheCatalogo = await leerJson(env, "/catalogo.json");
  return cacheCatalogo!;
}

// Busca una cuenca por su código.
export async function cuenca(env: Env, id: number): Promise<Cuenca | undefined> {
  return (await cuencas(env)).find((c) => c["gauge_id"] === id);
}

// Lee la serie binaria de una cuenca y variable; null si no hay datos.
export async function serie(env: Env, variable: string, id: number, paso: "diario" | "anual"): Promise<Serie | null> {
  const r = await pedir(env, `/series/${variable}/${id}.bin`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`No se pudo leer la serie ${variable}/${id} (${r.status})`);
  const buf = await r.arrayBuffer();
  const dv = new DataView(buf);
  const inicio = dv.getInt32(0, true);
  const n = dv.getInt32(4, true);
  return { paso, inicio, valores: new Float32Array(buf.slice(8, 8 + 4 * n)) };
}
