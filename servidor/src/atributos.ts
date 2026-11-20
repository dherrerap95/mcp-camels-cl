// Grupos y descripción de los atributos de cuenca de CAMELS-CL.

export const GRUPOS: { nombre: string; patron: RegExp; descripcion: string }[] = [
  { nombre: "identificacion", patron: /^(gauge_|record_period|n_obs|outlet_camels)/, descripcion: "Código y nombre de la estación DGA, coordenadas de la estación y de la salida delineada, período y número de días con caudal" },
  { nombre: "topografia", patron: /^(area_km2|mean_elev|med_elev|max_elev|min_elev|mean_slope_perc)$/, descripcion: "Área (km²), elevaciones media, mediana, máxima y mínima (m s.n.m.) y pendiente media (%)" },
  { nombre: "geologia", patron: /^geol_/, descripcion: "Primera y segunda clase litológica dominante (GLiM) y su fracción del área" },
  { nombre: "cobertura", patron: /^lc_/, descripcion: "Cobertura de suelo en % del área (cultivos, bosque nativo, plantación, pradera, matorral, humedal, impermeable, suelo desnudo, nieve, glaciar) y clase dominante" },
  { nombre: "clima", patron: /^(pet_mean|p_mean|aridity|p_seasonality|frac_snow|high_prec|low_prec)/, descripcion: "Índices climáticos por producto de precipitación (cr2met, chirps, mswep, tmpa) y período (1979-2010 o 1990-2010)" },
  { nombre: "hidrologia", patron: /^(q_mean|runoff_ratio|stream_elas|slope_fdc|baseflow_index|hfd_mean|Q5_|Q95_|high_q|low_q|zero_q)/, descripcion: "Firmas hidrológicas calculadas con el caudal 1979-2010" },
  { nombre: "intervencion", patron: /^(sur_rights|gw_rights|IAI_|dam_index)/, descripcion: "Derechos consuntivos otorgados e índices de intervención humana" },
];

export const DESCRIPCIONES: Record<string, string> = {
  pet_mean: "evapotranspiración potencial media (mm/día)",
  p_mean: "precipitación media (mm/día)",
  aridity: "índice de aridez, ETP media / P media (adimensional)",
  p_seasonality: "estacionalidad de la precipitación (negativo: lluvia concentrada en invierno)",
  frac_snow: "fracción de la precipitación que cae con temperatura bajo 0 °C",
  high_prec_freq: "frecuencia de días con P ≥ 5 veces la media (días/año)",
  high_prec_dur: "duración media de eventos de P alta (días)",
  high_prec_timing: "estación en que ocurren más días de P alta",
  low_prec_freq: "frecuencia de días secos, P < 1 mm (días/año)",
  low_prec_dur: "duración media de períodos secos (días)",
  low_prec_timing: "estación en que ocurren más días secos",
  p_mean_spread: "dispersión de la P media entre productos",
  q_mean: "caudal medio específico (mm/día)",
  runoff_ratio: "coeficiente de escorrentía Q/P (sobre 1 indica aporte nival o glaciar, o P subestimada)",
  stream_elas: "elasticidad del caudal respecto de la precipitación",
  slope_fdc: "pendiente de la curva de duración entre percentiles 33 y 66",
  baseflow_index: "índice de flujo base (0 a 1)",
  hfd_mean: "día medio del año hidrológico en que pasa la mitad del volumen anual",
  Q5_: "caudal del percentil 5, caudal bajo (mm/día)",
  Q95_: "caudal del percentil 95, caudal alto (mm/día)",
  high_q_freq: "frecuencia de días con Q ≥ 9 veces la mediana (días/año)",
  high_q_dur: "duración media de eventos de Q alto (días)",
  low_q_freq: "frecuencia de días con Q ≤ 0,2 veces la media (días/año)",
  low_q_dur: "duración media de eventos de Q bajo (días)",
  zero_q_freq: "fracción de días con caudal cero",
  sur_rights_flow_m3s: "derechos consuntivos superficiales otorgados en la cuenca (m³/s)",
  gw_rights_flow_m3s: "derechos consuntivos subterráneos otorgados en la cuenca (m³/s)",
  IAI_Q: "índice de intervención: derechos consuntivos respecto del caudal medio",
  IAI_P: "índice de intervención: derechos consuntivos respecto de la precipitación media",
  dam_index: "índice de embalses en la cuenca",
  area_km2: "área de la cuenca (km²)",
  mean_elev: "elevación media (m s.n.m.)",
  mean_slope_perc: "pendiente media (%)",
};

// Devuelve el grupo de un atributo.
export function grupoDe(col: string): string {
  return GRUPOS.find((g) => g.patron.test(col))?.nombre ?? "otros";
}

// Devuelve la descripción de un atributo según su prefijo.
export function descripcionDe(col: string): string {
  if (DESCRIPCIONES[col]) return DESCRIPCIONES[col];
  const k = Object.keys(DESCRIPCIONES).find((p) => col.startsWith(p));
  return k ? DESCRIPCIONES[k] : "";
}
