/* ============================================================
   fetch_stadiums.mjs — genera ../data.js desde Wikidata (CC0)
   ------------------------------------------------------------
   Consulta el endpoint SPARQL de Wikidata (WDQS) por estadios con
   CAPACIDAD y COORDENADAS, más país / ciudad / año de inauguración.
   Filtra valores absurdos, deduplica, ordena por capacidad y escribe
   los top N como `const STADIUMS = [...]` en data.js.

   Uso:
     node scripts/fetch_stadiums.mjs            # top 200, cap 15k–130k
     node scripts/fetch_stadiums.mjs --limit 300 --min 20000 --max 120000

   Requiere Node 18+ (fetch nativo).
   ============================================================ */

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------- Parámetros de línea de comandos ----------
function argVal(flag, def) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const LIMIT = parseInt(argVal("--limit", "200"), 10);
const CAP_MIN = parseInt(argVal("--min", "15000"), 10);
const CAP_MAX = parseInt(argVal("--max", "130000"), 10);

const ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT = "proyecto_vis_info/1.0 (dataset generator; educational use)";

// ---------- Query SPARQL ----------
// P31/P279* Q483110 = instancia (o subclase) de "estadio".
// P1083 capacidad · P625 coordenadas · P17 país · P131 ubicación admin ·
// P571 fecha de inauguración.
//
// IMPORTANTE — evitar datos erróneos:
// Wikidata contiene muchos estadios DEMOLIDOS/CERRADOS con su capacidad
// histórica (p. ej. el viejo Estádio da Luz con 120.000, demolido en 2003).
// Para quedarnos con estadios EN USO:
//   - Excluimos los que tienen fecha de disolución/demolición (P576).
//   - Excluimos los marcados como "estructura desaparecida" (Q19860854)
//     o "ex edificio/estructura" vía P31.
// `wdt:P1083` ya devuelve el valor de mayor rango (preferente) de capacidad.
const QUERY = `
SELECT ?s ?sLabel ?cap ?coord ?countryLabel ?cityLabel ?inception WHERE {
  ?s wdt:P31/wdt:P279* wd:Q483110 ;
     wdt:P1083 ?cap ;
     wdt:P625 ?coord .
  FILTER NOT EXISTS { ?s wdt:P576 ?dissolved. }        # sin fecha de demolición
  FILTER NOT EXISTS { ?s wdt:P31 wd:Q19860854. }       # no "estructura desaparecida"
  OPTIONAL { ?s wdt:P17 ?country. }
  OPTIONAL { ?s wdt:P131 ?city. }
  OPTIONAL { ?s wdt:P571 ?inception. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en". }
}
ORDER BY DESC(?cap)
LIMIT ${Math.round(LIMIT * 2.5)}
`;

// ---------- Mapa país -> confederación (para el filtro de la app) ----------
// Cobertura de los países presentes en el dataset. Si al regenerar con otros
// parámetros aparecen países nuevos, el resumen final los mostrará bajo
// "Otros" y bastará con añadirlos aquí.
const CONFEDERATION = {
  // UEFA (Europa)
  "España": "UEFA", "Inglaterra": "UEFA", "Reino Unido": "UEFA", "Alemania": "UEFA",
  "Italia": "UEFA", "Francia": "UEFA", "Portugal": "UEFA", "Países Bajos": "UEFA",
  "Bélgica": "UEFA", "Escocia": "UEFA", "Rusia": "UEFA", "Ucrania": "UEFA",
  "Turquía": "UEFA", "Grecia": "UEFA", "Polonia": "UEFA", "Suecia": "UEFA",
  "Noruega": "UEFA", "Dinamarca": "UEFA", "Suiza": "UEFA", "Austria": "UEFA",
  "Irlanda": "UEFA", "República Checa": "UEFA", "Rumania": "UEFA", "Rumanía": "UEFA",
  "Hungría": "UEFA", "Croacia": "UEFA", "Serbia": "UEFA", "Bulgaria": "UEFA",
  "Gales": "UEFA", "Georgia": "UEFA", "Armenia": "UEFA",
  // CONMEBOL (Sudamérica)
  "Brasil": "CONMEBOL", "Argentina": "CONMEBOL", "Chile": "CONMEBOL", "Perú": "CONMEBOL",
  "Colombia": "CONMEBOL", "Uruguay": "CONMEBOL", "Paraguay": "CONMEBOL",
  "Ecuador": "CONMEBOL", "Bolivia": "CONMEBOL", "Venezuela": "CONMEBOL",
  // CONCACAF (Norte/Centroamérica y Caribe)
  "México": "CONCACAF", "Estados Unidos": "CONCACAF", "EE.UU.": "CONCACAF",
  "Canadá": "CONCACAF", "Costa Rica": "CONCACAF", "Honduras": "CONCACAF",
  "Guatemala": "CONCACAF", "Jamaica": "CONCACAF", "Cuba": "CONCACAF",
  "El Salvador": "CONCACAF",
  // CAF (África)
  "Sudáfrica": "CAF", "Egipto": "CAF", "Marruecos": "CAF", "Argelia": "CAF",
  "Túnez": "CAF", "Nigeria": "CAF", "Ghana": "CAF", "Camerún": "CAF", "Senegal": "CAF",
  "República Democrática del Congo": "CAF", "Zambia": "CAF", "Libia": "CAF",
  "Zimbabue": "CAF", "Etiopía": "CAF", "Tanzania": "CAF", "Costa de Marfil": "CAF",
  "Kenia": "CAF", "Somalia": "CAF", "Guinea": "CAF", "Mali": "CAF", "Angola": "CAF",
  "Uganda": "CAF", "Sierra Leona": "CAF", "Mozambique": "CAF", "Gabón": "CAF",
  // AFC (Asia)
  "China": "AFC", "República Popular China": "AFC", "República de China": "AFC",
  "Japón": "AFC", "Corea del Sur": "AFC", "Corea del Norte": "AFC",
  "Catar": "AFC", "Qatar": "AFC", "Arabia Saudita": "AFC", "Arabia Saudí": "AFC",
  "Irán": "AFC", "Irak": "AFC", "Siria": "AFC", "Kuwait": "AFC",
  "Emiratos Árabes Unidos": "AFC", "India": "AFC", "Indonesia": "AFC",
  "Malasia": "AFC", "Tailandia": "AFC", "Australia": "AFC",
  "Pakistán": "AFC", "Singapur": "AFC", "Camboya": "AFC", "Birmania": "AFC",
  // OFC (Oceanía)
  "Nueva Zelanda": "OFC"
};

function confederationOf(country) {
  if (!country) return "Otros";
  return CONFEDERATION[country] || "Otros";
}

// "Point(lon lat)" -> { lat, lon }
function parsePoint(wkt) {
  const m = /Point\(([-\d.]+)\s+([-\d.]+)\)/.exec(wkt || "");
  if (!m) return null;
  return { lon: parseFloat(m[1]), lat: parseFloat(m[2]) };
}

// "1998-05-...T..." -> 1998
function parseYear(iso) {
  if (!iso) return null;
  const m = /^(-?\d{1,4})/.exec(iso.replace(/^\+/, ""));
  return m ? parseInt(m[1], 10) : null;
}

async function main() {
  console.log(`Consultando Wikidata (cap ${CAP_MIN}-${CAP_MAX}, top ${LIMIT})...`);

  const url = `${ENDPOINT}?format=json&query=${encodeURIComponent(QUERY)}`;

  // WDQS a veces devuelve 429/504 bajo carga; reintentamos con backoff.
  let json = null;
  const MAX_TRIES = 4;
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    const res = await fetch(url, {
      headers: { "Accept": "application/sparql-results+json", "User-Agent": USER_AGENT }
    });
    if (res.ok) { json = await res.json(); break; }
    if (attempt === MAX_TRIES) {
      throw new Error(`WDQS respondió ${res.status} ${res.statusText} tras ${MAX_TRIES} intentos`);
    }
    const waitMs = 2000 * attempt;
    console.warn(`WDQS ${res.status}; reintentando en ${waitMs / 1000}s (intento ${attempt + 1}/${MAX_TRIES})...`);
    await new Promise(r => setTimeout(r, waitMs));
  }
  const rows = json.results.bindings;
  console.log(`Filas crudas recibidas: ${rows.length}`);

  const seen = new Set();       // por QID, para deduplicar
  const seenName = new Set();   // por nombre+ciudad, dedupe secundaria
  const out = [];

  for (const r of rows) {
    const cap = parseInt(r.cap?.value, 10);
    if (!Number.isFinite(cap) || cap < CAP_MIN || cap > CAP_MAX) continue;

    const pt = parsePoint(r.coord?.value);
    if (!pt || (pt.lat === 0 && pt.lon === 0)) continue;
    if (!Number.isFinite(pt.lat) || !Number.isFinite(pt.lon)) continue;

    const qid = r.s?.value?.split("/").pop();
    if (qid && seen.has(qid)) continue;

    const name = r.sLabel?.value?.trim();
    if (!name || /^Q\d+$/.test(name)) continue;   // sin etiqueta legible

    const country = r.countryLabel?.value?.trim() || "";
    let city = r.cityLabel?.value?.trim() || "";
    if (/^Q\d+$/.test(city)) city = "";

    const nameKey = (name + "|" + city).toLowerCase();
    if (seenName.has(nameKey)) continue;

    if (qid) seen.add(qid);
    seenName.add(nameKey);

    out.push({
      name,
      city,
      country,
      confederation: confederationOf(country),
      capacity: cap,
      year: parseYear(r.inception?.value),
      lat: +pt.lat.toFixed(5),
      lon: +pt.lon.toFixed(5)
    });

    if (out.length >= LIMIT) break;
  }

  console.log(`Estadios tras filtrar/deduplicar: ${out.length}`);

  // ---------- Escribir data.js ----------
  const header = `// data.js — GENERADO AUTOMÁTICAMENTE. No editar a mano.
// Fuente: Wikidata (https://www.wikidata.org), licencia CC0 (dominio público).
// Generado por scripts/fetch_stadiums.mjs el ${new Date().toISOString().slice(0, 10)}.
//
// Filtros aplicados: capacidad entre ${CAP_MIN.toLocaleString("en")} y ${CAP_MAX.toLocaleString("en")}; top ${LIMIT} por capacidad.
// Campos: name, city, country, confederation, capacity, year (inauguración), lat, lon.
`;

  const body =
    "const STADIUMS = [\n" +
    out.map(s => "  " + JSON.stringify(s)).join(",\n") +
    "\n];\n";

  const dataPath = join(__dirname, "..", "data.js");
  await writeFile(dataPath, header + "\n" + body, "utf8");
  console.log(`Escrito ${dataPath} con ${out.length} estadios.`);

  // Resumen por confederación (útil para verificar el filtro).
  const byConf = {};
  for (const s of out) byConf[s.confederation] = (byConf[s.confederation] || 0) + 1;
  console.log("Por confederación:", byConf);
}

main().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
