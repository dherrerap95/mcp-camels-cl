// Servidor MCP público de CAMELS-CL sobre Cloudflare Workers.
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { GRUPOS, descripcionDe, grupoDe } from "./atributos";
import {
  agregar,
  estadisticos,
  excedencia,
  extremosAnuales,
  isoDeDia,
  nValidos,
  num,
  periodo,
  recortar,
  tabla,
  validosDesc,
} from "./calculos";
import { catalogo, columnas, cuenca, cuencas, resumen, serie, type Cuenca, type Env } from "./datos";

const VARIABLES = ["q_m3s", "p_cr2met", "p_mswep", "p_chirps", "p_tmpa", "tmin", "tmean", "tmax", "pet", "derechos_sup", "derechos_sub"] as const;
const CITA_CORTA = "Fuente: CAMELS-CL v202201 (Alvarez-Garreton et al., 2018, Hydrology and Earth System Sciences 22, 5817-5849, https://hess.copernicus.org/articles/22/5817/2018/), licencia CC BY 4.0.";
const AUTOR = "Diego Herrera Pino";
const ANOTACIONES ={ readOnlyHint: true, openWorldHint: false } as const;

type Resultado = { content: { type: "text"; text: string }[]; isError?: boolean };

// Respuesta de texto con la cita al final.
function texto(t: string): Resultado {
  return { content: [{ type: "text", text: `${t}\n\n${CITA_CORTA}` }] };
}

// Respuesta de error para el modelo.
function error(t: string): Resultado {
  return { content: [{ type: "text", text: t }], isError: true };
}

// Quita tildes y pasa a minúsculas para comparar nombres.
function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Distancia en km entre dos puntos geográficos.
function distanciaKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 12_742 * Math.asin(Math.sqrt(a));
}

// Valor de celda para tablas.
function celda(v: unknown, clave = ""): string {
  if (v === null || v === undefined) return "s/d";
  if (typeof v === "number" && /_(lat|lon)$/.test(clave)) return v.toFixed(4);
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : num(v);
  return String(v);
}

// Convierte desde/hasta en índices de tiempo según el paso de la serie.
function limites(paso: "diario" | "anual", desde?: string, hasta?: string, mesInicio = 1): [number | undefined, number | undefined] {
  if (paso === "anual") return [desde ? Number(desde.slice(0, 4)) : undefined, hasta ? Number(hasta.slice(0, 4)) : undefined];
  return periodo(desde, hasta, mesInicio);
}

const REGLA_PERIODO =
  "Con mes_inicio_anio distinto de 1 (por ejemplo 4, año hidrológico abril-marzo), desde y hasta escritos solo como año (AAAA) se interpretan como años hidrológicos completos nombrados por su año de inicio: desde '1980' y hasta '2019' abarcan 1980/81 a 2019/20 (1980-04-01 a 2020-03-31). Para cortar por fechas exactas use AAAA-MM o AAAA-MM-DD.";

const esquemaFecha = z
  .string()
  .regex(/^\d{4}(-\d{2}(-\d{2})?)?$/, "Use AAAA, AAAA-MM o AAAA-MM-DD")
  .optional();

// Construye el servidor MCP con sus herramientas.
function crearServidor(env: Env): McpServer {
  const maxFilas = Number(env.MAX_FILAS);
  const maxCuencas = Number(env.MAX_CUENCAS);
  const minComp = Number(env.MIN_COMPLETITUD);
  const server = new McpServer({ name: "camels-cl", title: `MCP de CAMELS-CL (${AUTOR})`, version: "0.2.0" });

  server.registerTool(
    "describir_fuente",
    {
      title: "Describir CAMELS-CL",
      description:
        "Describe la base CAMELS-CL (516 cuencas de Chile): variables disponibles con unidades y período, grupos de atributos de cuenca, criterios de agregación y cómo citar. Úsela primero si no conoce los nombres de variables o atributos.",
      inputSchema: z.object({}),
      annotations: ANOTACIONES,
    },
    async () => {
      const cat = await catalogo(env);
      const res = await resumen(env);
      const filasVar = Object.entries(cat.variables).map(([k, m]) => {
        const r = Object.values(res).map((x) => x[k]).filter(Boolean);
        const ini = r.map((x) => x.inicio).sort()[0];
        const fin = r.map((x) => x.fin).sort().at(-1);
        return [k, m.descripcion, m.unidad, m.paso, m.agregacion, r.length, `${ini} a ${fin}`];
      });
      const cols = await columnas(env);
      const grupos = GRUPOS.map((g) => `- **${g.nombre}**: ${g.descripcion}. Atributos: ${cols.filter((c) => grupoDe(c) === g.nombre).join(", ")}`);
      return texto(
        [
          `# CAMELS-CL ${cat.version}`,
          `Servidor MCP desarrollado por ${AUTOR}, sin fines comerciales, para facilitar la consulta de CAMELS-CL. Los datos pertenecen a sus autores originales.`,
          "Atributos y series hidrometeorológicas promediadas por cuenca para 516 cuencas de Chile (17,8 °S a 55 °S), con caudal observado en estaciones de la DGA. Las series de forzantes son promedios areales de productos grillados.",
          "## Variables",
          tabla(["variable", "descripción", "unidad", "paso", "agregación", "cuencas", "período con datos"], filasVar),
          "## Grupos de atributos de cuenca",
          ...grupos,
          "## Criterios",
          `- Un mes o año se agrega solo si tiene al menos ${minComp * 100}% de días con dato; si no, aparece como s/d.`,
          "- Las variables de suma (precipitación, ETP) se escalan al número de días del período cuando faltan pocos días.",
          "- La curva de duración usa la posición de Weibull i/(n+1); Q90 es el caudal igualado o superado el 90% del tiempo.",
          "- En los atributos, Q5 y Q95 siguen la convención de CAMELS (percentil 5 = caudal bajo), opuesta a la de excedencia.",
          `- Las respuestas se limitan a ${maxFilas} filas y ${maxCuencas} cuencas.`,
          `## Cita\n${cat.cita}`,
        ].join("\n\n"),
      );
    },
  );

  server.registerTool(
    "buscar_cuencas",
    {
      title: "Buscar cuencas",
      description:
        "Busca cuencas de CAMELS-CL por nombre de estación (sin importar tildes), cercanía a una coordenada y filtros por atributos numéricos (por ejemplo area_km2, mean_elev, aridity_cr2met_1979_2010, frac_snow_cr2met_1979_2010, q_mean_1979_2010, baseflow_index_1979_2010, dam_index). Devuelve el código gauge_id que piden las demás herramientas.",
      inputSchema: z.object({
        texto: z.string().optional().describe("Parte del nombre de la estación, por ejemplo 'Aconcagua' o 'Maipo'"),
        lat: z.number().min(-56).max(-17).optional().describe("Latitud en grados decimales (negativa)"),
        lon: z.number().min(-76).max(-66).optional().describe("Longitud en grados decimales (negativa)"),
        radio_km: z.number().positive().max(500).optional().describe("Radio de búsqueda en km alrededor de lat/lon (50 por omisión)"),
        filtros: z
          .array(z.object({ atributo: z.string(), min: z.number().optional(), max: z.number().optional() }))
          .optional()
          .describe("Filtros por rango sobre atributos numéricos"),
        ordenar_por: z.string().optional().describe("Atributo por el que se ordena (o 'distancia')"),
        descendente: z.boolean().optional(),
        limite: z.number().int().min(1).max(50).optional().describe("Máximo de cuencas a devolver (15 por omisión)"),
      }),
      annotations: ANOTACIONES,
    },
    async ({ texto: t, lat, lon, radio_km, filtros, ordenar_por, descendente, limite }) => {
      const todas = await cuencas(env);
      const cols = new Set(await columnas(env));
      for (const f of filtros ?? []) if (!cols.has(f.atributo)) return error(`Atributo desconocido: ${f.atributo}. Use describir_fuente para ver la lista.`);
      if (ordenar_por && ordenar_por !== "distancia" && !cols.has(ordenar_por)) return error(`Atributo desconocido para ordenar: ${ordenar_por}.`);
      if ((lat === undefined) !== (lon === undefined)) return error("Indique lat y lon juntas.");
      let r: (Cuenca & { _dist?: number })[] = todas.map((c) => ({ ...c }));
      if (t) {
        const q = normalizar(t);
        r = r.filter((c) => normalizar(String(c["gauge_name"])).includes(q));
      }
      if (lat !== undefined && lon !== undefined) {
        const rad = radio_km ?? 50;
        for (const c of r) c._dist = distanciaKm(lat, lon, c["gauge_lat"] as number, c["gauge_lon"] as number);
        r = r.filter((c) => c._dist! <= rad);
      }
      for (const f of filtros ?? []) {
        r = r.filter((c) => {
          const v = c[f.atributo];
          return typeof v === "number" && (f.min === undefined || v >= f.min) && (f.max === undefined || v <= f.max);
        });
      }
      const clave = ordenar_por ?? (lat !== undefined ? "distancia" : "gauge_id");
      const val = (c: Cuenca & { _dist?: number }) => (clave === "distancia" ? c._dist : c[clave]);
      r.sort((a, b) => {
        const va = val(a), vb = val(b);
        if (va === null || va === undefined) return 1;
        if (vb === null || vb === undefined) return -1;
        return (va < vb ? -1 : va > vb ? 1 : 0) * (descendente ? -1 : 1);
      });
      const total = r.length;
      r = r.slice(0, limite ?? 15);
      const extra = [...new Set([...(filtros ?? []).map((f) => f.atributo), ...(ordenar_por && ordenar_por !== "distancia" ? [ordenar_por] : [])])];
      const base = ["gauge_id", "gauge_name", "gauge_lat", "gauge_lon", "area_km2", "mean_elev", "p_mean_cr2met_1979_2010", "q_mean_1979_2010", "record_period_start", "record_period_end"];
      const cab = [...base, ...extra.filter((e) => !base.includes(e)), ...(lat !== undefined ? ["distancia_km"] : [])];
      const filas = r.map((c) => cab.map((k) => (k === "distancia_km" ? num(c._dist, 1) : celda(c[k], k))));
      if (total === 0) return texto("No hay cuencas que cumplan los criterios.");
      return texto(
        `${total} cuencas cumplen los criterios; se muestran ${r.length}. p_mean y q_mean en mm/día (1979-2010), área en km², elevación en m s.n.m.\n\n${tabla(cab, filas)}`,
      );
    },
  );

  server.registerTool(
    "atributos_cuenca",
    {
      title: "Ficha de una cuenca",
      description:
        "Entrega la ficha de una cuenca de CAMELS-CL: todos sus atributos agrupados (topografía, geología, cobertura, clima, hidrología, intervención) y la disponibilidad de cada serie (período, % de faltantes y media).",
      inputSchema: z.object({
        gauge_id: z.number().int().describe("Código de la estación DGA, por ejemplo 5410002"),
        grupo: z.enum(["identificacion", "topografia", "geologia", "cobertura", "clima", "hidrologia", "intervencion"]).optional().describe("Mostrar solo un grupo de atributos"),
      }),
      annotations: ANOTACIONES,
    },
    async ({ gauge_id, grupo }) => {
      const c = await cuenca(env, gauge_id);
      if (!c) return error(`No existe la cuenca ${gauge_id}. Use buscar_cuencas.`);
      const cat = await catalogo(env);
      const res = (await resumen(env))[String(gauge_id)] ?? {};
      const partes = [`# ${c["gauge_name"]} (${gauge_id})`];
      for (const g of GRUPOS) {
        if (grupo && g.nombre !== grupo) continue;
        const filas = Object.keys(c)
          .filter((k) => grupoDe(k) === g.nombre)
          .map((k) => [k, celda(c[k], k), descripcionDe(k)]);
        partes.push(`## ${g.nombre}\n${g.descripcion}.\n\n${tabla(["atributo", "valor", "descripción"], filas)}`);
      }
      if (!grupo) {
        const disp = Object.entries(cat.variables).map(([k, m]) => {
          const r = res[k];
          return r ? [k, m.unidad, r.inicio, r.fin, r.n_validos, num(r.pct_faltante, 1), num(r.media)] : [k, m.unidad, "sin datos", "", "", "", ""];
        });
        partes.push(`## Series disponibles\n${tabla(["variable", "unidad", "inicio", "fin", "días o años válidos", "% faltante", "media"], disp)}`);
      }
      return texto(partes.join("\n\n"));
    },
  );

  server.registerTool(
    "serie",
    {
      title: "Serie de tiempo",
      description:
        "Entrega la serie de una variable para una cuenca y período, en paso diario, mensual o anual (año calendario o hidrológico con mes_inicio_anio=4). Caudal y temperaturas se promedian; precipitación y ETP se suman. Para períodos largos use paso mensual o anual: la salida se limita en filas. " + REGLA_PERIODO,
      inputSchema: z.object({
        gauge_id: z.number().int(),
        variable: z.enum(VARIABLES),
        paso: z.enum(["diario", "mensual", "anual"]).optional().describe("mensual por omisión"),
        desde: esquemaFecha.describe("Inicio del período (AAAA, AAAA-MM o AAAA-MM-DD)"),
        hasta: esquemaFecha.describe("Fin del período (AAAA, AAAA-MM o AAAA-MM-DD)"),
        mes_inicio_anio: z.number().int().min(1).max(12).optional().describe("Mes de inicio del año (1 calendario, 4 hidrológico abril-marzo); define la agregación anual y cómo se leen desde y hasta escritos como año"),
      }),
      annotations: ANOTACIONES,
    },
    async ({ gauge_id, variable, paso, desde, hasta, mes_inicio_anio }) => {
      const c = await cuenca(env, gauge_id);
      if (!c) return error(`No existe la cuenca ${gauge_id}. Use buscar_cuencas.`);
      const meta = (await catalogo(env)).variables[variable];
      const p = meta.paso === "anual" ? "anual" : (paso ?? "mensual");
      const s0 = await serie(env, variable, gauge_id, meta.paso);
      if (!s0) return error(`La cuenca ${gauge_id} no tiene datos de ${variable}.`);
      const [a, b] = limites(meta.paso, desde, hasta, mes_inicio_anio ?? 1);
      const s = recortar(s0, a, b);
      if (s.valores.length === 0) return error(`Sin datos de ${variable} en el período pedido para la cuenca ${gauge_id}.`);
      const val = nValidos(s.valores);
      let cab: string[];
      let filas: (string | number)[][];
      if (meta.paso === "anual") {
        cab = ["año", `${variable} (${meta.unidad})`];
        filas = Array.from(s.valores, (v, i) => [s.inicio + i, num(v)]);
      } else if (p === "diario") {
        cab = ["fecha", `${variable} (${meta.unidad})`];
        filas = Array.from(s.valores, (v, i) => [isoDeDia(s.inicio + i), num(v)]);
      } else {
        const agg = agregar(s, p, meta.agregacion, minComp, mes_inicio_anio ?? 1);
        cab = [p === "mensual" ? "mes" : "año", `${variable} (${meta.unidad}${meta.agregacion === "suma" ? `/${p === "mensual" ? "mes" : "año"}` : ""})`, "días con dato"];
        filas = agg.map((f) => [f.etiqueta, num(f.valor), `${f.n_validos}/${f.n_dias}`]);
      }
      const n = filas.length;
      const recorte = n > maxFilas ? `\n\nSe muestran las primeras ${maxFilas} de ${n} filas; acote el período o use un paso mayor.` : "";
      const per = meta.paso === "anual" ? `${s.inicio} a ${s.inicio + s.valores.length - 1}` : `${isoDeDia(s.inicio)} a ${isoDeDia(s.inicio + s.valores.length - 1)}`;
      return texto(
        `# ${variable} en ${c["gauge_name"]} (${gauge_id})\n${meta.descripcion}. Período ${per}; ${num(100 * (1 - val / s.valores.length), 1)}% de faltantes; agregación: ${meta.agregacion}.\n\n${tabla(cab, filas.slice(0, maxFilas))}${recorte}`,
      );
    },
  );

  server.registerTool(
    "estadisticas",
    {
      title: "Estadísticas de una variable",
      description:
        "Calcula estadísticas de una variable diaria en una cuenca y período: media, valores anuales (media, desviación, mínimo y máximo), régimen mensual y, para caudal (q_m3s), curva de duración (Q5 a Q95 por excedencia) y extremos diarios anuales. " + REGLA_PERIODO,
      inputSchema: z.object({
        gauge_id: z.number().int(),
        variable: z.enum(["q_m3s", "p_cr2met", "p_mswep", "p_chirps", "p_tmpa", "tmin", "tmean", "tmax", "pet"]),
        desde: esquemaFecha,
        hasta: esquemaFecha,
        mes_inicio_anio: z.number().int().min(1).max(12).optional().describe("4 para año hidrológico abril-marzo (por omisión 1); define cómo se leen desde y hasta escritos como año"),
      }),
      annotations: ANOTACIONES,
    },
    async ({ gauge_id, variable, desde, hasta, mes_inicio_anio }) => {
      const c = await cuenca(env, gauge_id);
      if (!c) return error(`No existe la cuenca ${gauge_id}. Use buscar_cuencas.`);
      const meta = (await catalogo(env)).variables[variable];
      const s0 = await serie(env, variable, gauge_id, "diario");
      if (!s0) return error(`La cuenca ${gauge_id} no tiene datos de ${variable}.`);
      const [a, b] = limites("diario", desde, hasta, mes_inicio_anio ?? 1);
      const s = recortar(s0, a, b);
      const val = nValidos(s.valores);
      if (val === 0) return error(`Sin datos de ${variable} en el período pedido para la cuenca ${gauge_id}.`);
      const mi = mes_inicio_anio ?? 1;
      const u = meta.unidad;
      const partes = [
        `# Estadísticas de ${variable} en ${c["gauge_name"]} (${gauge_id})`,
        `${meta.descripcion}. Período ${isoDeDia(s.inicio)} a ${isoDeDia(s.inicio + s.valores.length - 1)}; ${val} días con dato (${num(100 * (1 - val / s.valores.length), 1)}% faltante). Año ${mi === 1 ? "calendario" : `desde el mes ${mi}`}; un mes o año entra con al menos ${minComp * 100}% de días con dato.`,
      ];
      const desc = validosDesc(s.valores);
      const mediaDiaria = desc.reduce((x, y) => x + y, 0) / desc.length;
      partes.push(`Media diaria: ${num(mediaDiaria)} ${u}.`);
      const anual = agregar(s, "anual", meta.agregacion, minComp, mi).filter((f) => f.valor !== null);
      const ea = estadisticos(anual.map((f) => f.valor!));
      if (ea) {
        const ua = meta.agregacion === "suma" ? `${u}/año` : u;
        const fMin = anual.find((f) => f.valor === ea.min)!, fMax = anual.find((f) => f.valor === ea.max)!;
        partes.push(
          `## Valores anuales (${ea.n} años completos)\n${tabla(["media", "desv. estándar", "CV", "mínimo (año)", "máximo (año)"], [[`${num(ea.media)} ${ua}`, num(ea.desv), num(ea.desv / ea.media, 2), `${num(ea.min)} (${fMin.etiqueta})`, `${num(ea.max)} (${fMax.etiqueta})`]])}`,
        );
      }
      const mensual = agregar(s, "mensual", meta.agregacion, minComp).filter((f) => f.valor !== null);
      const nombresMes = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
      const orden = Array.from({ length: 12 }, (_, i) => ((mi - 1 + i) % 12) + 1);
      const filasMes = orden.map((m) => {
        const e = estadisticos(mensual.filter((f) => f.mes === m).map((f) => f.valor!));
        return [nombresMes[m - 1], e ? num(e.media) : "s/d", e ? num(e.min) : "s/d", e ? num(e.max) : "s/d", e ? e.n : 0];
      });
      partes.push(`## Régimen mensual (${meta.agregacion === "suma" ? `${u}/mes` : u})\n${tabla(["mes", "media", "mínimo", "máximo", "años"], filasMes)}`);
      if (variable === "q_m3s") {
        const ps = [0.05, 0.1, 0.25, 0.5, 0.75, 0.85, 0.9, 0.95];
        partes.push(
          `## Curva de duración (caudal igualado o superado el p% del tiempo, m³/s)\n${tabla(ps.map((p) => `Q${Math.round(p * 100)}`), [ps.map((p) => num(excedencia(desc, p)))])}`,
        );
        const ext = extremosAnuales(s, minComp, mi);
        const emx = estadisticos(ext.map((e) => e.max));
        const emn = estadisticos(ext.map((e) => e.min));
        if (emx && emn) {
          const xMax = ext.reduce((p, e) => (e.max > p.max ? e : p));
          const xMin = ext.reduce((p, e) => (e.min < p.min ? e : p));
          partes.push(
            `## Extremos diarios anuales (${ext.length} años)\n${tabla(
              ["", "media", "desv. estándar", "extremo del período (fecha)"],
              [
                ["máximo diario anual", num(emx.media), num(emx.desv), `${num(xMax.max)} (${xMax.fechaMax})`],
                ["mínimo diario anual", num(emn.media), num(emn.desv), `${num(xMin.min)} (${xMin.fechaMin})`],
              ],
            )}`,
          );
        }
      }
      return texto(partes.join("\n\n"));
    },
  );

  server.registerTool(
    "comparar_cuencas",
    {
      title: "Comparar cuencas",
      description: "Compara varias cuencas de CAMELS-CL en una tabla con los atributos indicados (o un conjunto básico de topografía, clima, hidrología e intervención).",
      inputSchema: z.object({
        gauge_ids: z.array(z.number().int()).min(2).max(20),
        atributos: z.array(z.string()).optional().describe("Atributos a comparar; por omisión un conjunto básico"),
      }),
      annotations: ANOTACIONES,
    },
    async ({ gauge_ids, atributos }) => {
      const cols = new Set(await columnas(env));
      const sel =
        atributos ??
        ["area_km2", "mean_elev", "mean_slope_perc", "p_mean_cr2met_1979_2010", "pet_mean_1979_2010", "aridity_cr2met_1979_2010", "frac_snow_cr2met_1979_2010", "q_mean_1979_2010", "runoff_ratio_cr2met_1979_2010", "baseflow_index_1979_2010", "lc_dom_name", "lc_glacier", "sur_rights_flow_m3s", "gw_rights_flow_m3s", "dam_index"];
      const malos = sel.filter((a) => !cols.has(a));
      if (malos.length) return error(`Atributos desconocidos: ${malos.join(", ")}.`);
      const cs: Cuenca[] = [];
      for (const id of gauge_ids) {
        const c = await cuenca(env, id);
        if (!c) return error(`No existe la cuenca ${id}.`);
        cs.push(c);
      }
      const cab = ["atributo", ...cs.map((c) => `${c["gauge_name"]} (${c["gauge_id"]})`)];
      const filas = sel.map((a) => [a, ...cs.map((c) => celda(c[a], a))]);
      return texto(tabla(cab, filas));
    },
  );

  return server;
}

// Página de inicio con instrucciones de conexión.
function inicio(url: URL): Response {
  const cuerpo = {
    nombre: "MCP de CAMELS-CL",
    descripcion: "Servidor MCP público, gratuito y sin fines comerciales para facilitar la consulta de CAMELS-CL v202201 (516 cuencas de Chile).",
    autor: AUTOR,
    licencia_codigo: "GNU GPL v3 o posterior",
    mcp: `${url.origin}/mcp`,
    uso: "Agregue la URL del campo 'mcp' como conector personalizado en Claude (Configuración > Conectores).",
    herramientas: ["describir_fuente", "buscar_cuencas", "atributos_cuenca", "serie", "estadisticas", "comparar_cuencas"],
    datos: `${url.origin}/camels_cl/catalogo.json`,
    cita: CITA_CORTA,
  };
  return new Response(JSON.stringify(cuerpo, null, 2), { headers: { "content-type": "application/json; charset=utf-8" } });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
      return createMcpHandler(() => crearServidor(env))(request, env, ctx);
    }
    if (url.pathname === "/") return inicio(url);
    return new Response("No encontrado", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
