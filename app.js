/* ============================================================
   Estadios del mundo — mapa sonoro
   - Plotly scattergeo para el mapa
   - Plotly bar para el ranking (por capacidad)
   - Filtro de estadios por confederación
   - Tone.js para el grito de multitud
   - Bus de eventos para fisicalización (Arduino / servo)
   ============================================================ */

// ============================================================
//  BUS DE EVENTOS (desacople para el Arduino)
//  Cualquier módulo (p.ej. arduino.js) puede escuchar estos
//  eventos sin que app.js sepa nada del hardware.
//    - "goal:start"  -> { stadium, intensity }  al empezar el GOOOL
//    - "goal:level"  -> { level }  nivel de audio en vivo (0..1)
//    - "goal:stop"   -> {}         al terminar / cortar el sonido
// ============================================================
const StadiumBus = new EventTarget();
function emitBus(type, detail) {
  StadiumBus.dispatchEvent(new CustomEvent(type, { detail }));
}
// Exponer globalmente para arduino.js (que se carga aparte).
window.StadiumBus = StadiumBus;

// ---------- Utilidades de escala ----------
const capacities = STADIUMS.map(s => s.capacity);
const CAP_MIN = Math.min(...capacities), CAP_MAX = Math.max(...capacities);

// Devuelve 0..1 según la capacidad del estadio (más aforo = más intenso).
function intensityOf(st) {
  return (st.capacity - CAP_MIN) / (CAP_MAX - CAP_MIN || 1); // 0..1
}

// ============================================================
//  FILTROS DE ESTADIOS (combinables, se aplican con AND)
//  `visibleStadiums()` devuelve el subconjunto activo; el mapa y el
//  ranking se dibujan siempre a partir de este subconjunto.
//    - confederation: "Todas" o una confederación concreta
//    - country:       "Todos" o un país concreto
//    - minCapacity:   capacidad mínima (espectadores)
// ============================================================
const CONFEDERATIONS = ["Todas", "UEFA", "CONMEBOL", "CONCACAF", "CAF", "AFC", "OFC"];

const filters = {
  confederation: "Todas",
  country: "Todos",
  minCapacity: CAP_MIN
};

// Países presentes en el dataset, ordenados alfabéticamente (para el <select>).
const COUNTRIES = [...new Set(STADIUMS.map(s => s.country).filter(Boolean))]
  .sort((a, b) => a.localeCompare(b, "es"));

function visibleStadiums() {
  return STADIUMS.filter(s => {
    if (filters.confederation !== "Todas" && s.confederation !== filters.confederation) return false;
    if (filters.country !== "Todos" && s.country !== filters.country) return false;
    if (s.capacity < filters.minCapacity) return false;
    return true;
  });
}

// ============================================================
//  TEMA (claro / oscuro)
// ============================================================
const THEMES = {
  light: {
    paper: "rgba(0,0,0,0)",     // transparente: deja ver el fondo del panel
    plot: "rgba(0,0,0,0)",
    text: "#1a2230",
    muted: "#5b6472",
    grid: "#dfe4ec",
    land: "#dfe4ec",
    ocean: "#eef2f8",
    country: "#c3cad6",
    coast: "#c3cad6",
    markerLine: "#ffffff"
  },
  dark: {
    paper: "rgba(0,0,0,0)",
    plot: "rgba(0,0,0,0)",
    text: "#e6edf3",
    muted: "#8b949e",
    grid: "#30363d",
    land: "#21262d",
    ocean: "#0d1117",
    country: "#30363d",
    coast: "#30363d",
    markerLine: "#0d1117"
  }
};

function currentTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}
function palette() {
  return THEMES[currentTheme()];
}

// ============================================================
//  SONIDO — Grito de multitud (archivo assets/crowd-cheer.mp3)
//  Reproducimos el mp3 con Tone.Player; el VOLUMEN es
//  proporcional a la intensidad del estadio (más grande y con
//  más aforo => más fuerte). Mantenemos un Tone.Meter para leer
//  el nivel en vivo y alimentar el temblor del servo (Arduino).
// ============================================================
const CROWD_SOUND = "assets/crowd-cheer.mp3";

let audioReady = false;
let audioLoading = null;                    // promesa de carga del buffer
let player, playerGain, masterGain, meter;  // reproductor + salida + medidor
let stopTimer = null;
let levelRAF = null;                        // requestAnimationFrame del medidor

async function initAudio() {
  if (audioReady) return;
  if (audioLoading) return audioLoading;    // ya se está cargando

  audioLoading = (async () => {
    await Tone.start();

    masterGain = new Tone.Gain(1).toDestination();

    // Medidor de nivel en vivo (para el bus del Arduino).
    meter = new Tone.Meter({ smoothing: 0.85 });
    masterGain.connect(meter);

    // Gain que module el volumen según la intensidad del estadio.
    playerGain = new Tone.Gain(0).connect(masterGain);

    // Cargamos el mp3 y esperamos a que el buffer esté listo.
    player = new Tone.Player({ url: CROWD_SOUND, autostart: false }).connect(playerGain);
    await Tone.loaded();                     // espera a que TODOS los buffers carguen

    audioReady = true;
  })();

  return audioLoading;
}

// Lee el medidor y publica el nivel (0..1) para el Arduino.
function startLevelPump() {
  stopLevelPump();
  const tick = () => {
    if (!audioReady) return;
    const db = meter.getValue();           // dBFS (número, o -Infinity en silencio)
    const val = typeof db === "number" ? db : -60;
    // Normalizamos -60dB..0dB → 0..1
    const level = Math.max(0, Math.min(1, (val + 60) / 60));
    emitBus("goal:level", { level });
    levelRAF = requestAnimationFrame(tick);
  };
  levelRAF = requestAnimationFrame(tick);
}
function stopLevelPump() {
  if (levelRAF) { cancelAnimationFrame(levelRAF); levelRAF = null; }
}

function stopAllSound(fast = true) {
  if (!audioReady) return;
  if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
  const t = fast ? 0.12 : 0.4;
  playerGain.gain.rampTo(0, t);
  if (player && player.state === "started") {
    // Paramos un poco después del fade para que no corte de golpe.
    try { player.stop("+" + (t + 0.05)); } catch (_) { /* noop */ }
  }
  stopLevelPump();
  emitBus("goal:stop", {});
}

async function playGoal(stadium) {
  await initAudio();
  stopAllSound(true);

  const intensity = intensityOf(stadium); // 0..1

  // Volumen proporcional a la intensidad: 0.30 (chico) .. 1.0 (enorme).
  const vol = 0.30 + intensity * 0.70;

  const now = Tone.now();

  // Reinicia el reproductor desde el principio y sube el volumen.
  try { if (player.state === "started") player.stop(now); } catch (_) { /* noop */ }
  player.start(now + 0.02);

  playerGain.gain.cancelScheduledValues(now);
  playerGain.gain.setValueAtTime(0.0001, now);
  playerGain.gain.linearRampToValueAtTime(vol, now + 0.12);

  // Duración: el clip completo, o un máximo que crece con la intensidad.
  const clipMs = (player.buffer && player.buffer.duration)
    ? player.buffer.duration * 1000
    : 4000;
  const maxMs = 3500 + Math.round(intensity * 2000); // 3.5s..5.5s
  const durationMs = Math.min(clipMs, maxMs);

  // Nivel de audio en vivo → bus → Arduino.
  startLevelPump();

  // Aviso a quien fisicalice (Arduino/servo): empieza el festejo.
  emitBus("goal:start", { stadium, intensity, durationMs });

  stopTimer = setTimeout(() => stopAllSound(false), durationMs);

  document.getElementById("now-playing").textContent =
    `⚽ ¡GOOOOL! en ${stadium.name} — ${stadium.city}, ${stadium.country} · ` +
    `Aforo ${stadium.capacity.toLocaleString("es")} · Intensidad ${(intensity * 100).toFixed(0)}%`;
}

// ============================================================
//  MAPA — Plotly scattergeo
// ============================================================
let mapInitialized = false;

function drawMap() {
  const p = palette();
  const list = visibleStadiums();                 // subconjunto activo (filtro)
  mapList = list;                                  // fuente única para el overlay
  const sizes = list.map(s => 10 + intensityOf(s) * 26); // tamaño del punto

  // El scattergeo sigue existiendo como CAPA DE CLICK/HOVER: marcadores
  // casi transparentes que capturan el click y muestran el tooltip. Encima
  // dibujamos la foto del estadio como overlay HTML (ver positionStadiumImages).
  const trace = {
    type: "scattergeo",
    mode: "markers",
    lat: list.map(s => s.lat),
    lon: list.map(s => s.lon),
    text: list.map(s =>
      `<b>${s.name}</b><br>${s.city}, ${s.country}` +
      `<br>Capacidad: ${s.capacity.toLocaleString("es")}` +
      (s.year ? `<br>Inaugurado: ${s.year}` : "")),
    hoverinfo: "text",
    marker: {
      size: sizes,
      color: "rgba(0,0,0,0)",           // invisible: la foto va encima
      line: { color: "rgba(0,0,0,0)", width: 0 },
      opacity: 0.01                      // casi 0 pero clickeable
    }
  };

  const layout = {
    paper_bgcolor: p.paper,
    plot_bgcolor: p.plot,
    margin: { l: 0, r: 0, t: 0, b: 0 },
    geo: {
      bgcolor: p.plot,
      showland: true, landcolor: p.land,
      showocean: true, oceancolor: p.ocean,
      showcountries: true, countrycolor: p.country,
      coastlinecolor: p.coast,
      projection: { type: "natural earth" }
    }
  };

  Plotly.react("map", [trace], layout, { responsive: true, displayModeBar: false })
    .then(gd => {
      buildStadiumImages(list);      // (re)crea los <img> del subconjunto activo
      positionStadiumImages(gd);     // los coloca según la posición actual
      // Los <path> del scattergeo pueden aparecer un tick después del primer
      // render; reposicionamos en el siguiente frame para asegurar alineación.
      requestAnimationFrame(() => positionStadiumImages(gd));
      if (!mapInitialized) {
        gd.on("plotly_click", ev => {
          const pt = ev.points[0];
          if (pt && mapList[pt.pointIndex]) playGoal(mapList[pt.pointIndex]);
        });
        // Reposicionar las fotos en cada render (zoom, pan, resize).
        gd.on("plotly_afterplot", () => positionStadiumImages(gd));
        gd.on("plotly_relayout", () => positionStadiumImages(gd));
        window.addEventListener("resize", () => positionStadiumImages(gd));
        mapInitialized = true;
      }
    });
}

// ============================================================
//  OVERLAY DE FOTOS DE ESTADIO sobre el mapa
//  scattergeo no admite imágenes como símbolo de marcador, así que
//  superponemos un <img> por estadio. Para alinearlo con exactitud,
//  leemos la posición real de cada punto que Plotly ya dibujó en el
//  SVG (readPlottedPointPositions); si no estuviera disponible,
//  caemos a la proyección geo interna (getGeoProjector).
// ============================================================
const STADIUM_IMG = "assets/estadio.png";
let stadiumImgEls = [];
let mapList = STADIUMS;   // lista de estadios actualmente dibujada en el mapa

function imgContainer() {
  return document.getElementById("stadium-images");
}

// (Re)crea los <img> para la lista dada (el subconjunto visible del filtro).
function buildStadiumImages(list) {
  const cont = imgContainer();
  if (!cont) return;
  cont.innerHTML = "";
  stadiumImgEls = list.map((s) => {
    const el = document.createElement("img");
    el.src = STADIUM_IMG;
    el.className = "stadium-pin";
    el.alt = s.name;
    el.title = `${s.name} — ${s.city}, ${s.country}`;
    // Click en la foto = mismo efecto que click en el punto.
    el.addEventListener("click", () => playGoal(s));
    cont.appendChild(el);
    return el;
  });
}

// Coloca cada foto en pixel según la proyección geo actual y le da un
// tamaño proporcional a la intensidad del estadio.
// Obtiene una función que convierte [lon, lat] -> {x, y} en pixel del
// subplot geo. Plotly (interno) expone la proyección d3 de distintas formas
// según versión; probamos las conocidas y normalizamos la salida.
function getGeoProjector(gd) {
  const geo = gd && gd._fullLayout && gd._fullLayout.geo;
  const sp = geo && geo._subplot;
  if (!sp) return null;

  // Normaliza distintos formatos de retorno a {x, y}.
  const norm = (r) => {
    if (!r) return null;
    if (Array.isArray(r)) return { x: r[0], y: r[1] };
    if (typeof r.x === "number" && typeof r.y === "number") return { x: r.x, y: r.y };
    return null;
  };

  // PREFERIMOS sp.projection([lon,lat]): devuelve pixeles RELATIVOS AL DIV
  // COMPLETO del gráfico (que es el mismo sistema que #stadium-images, en
  // inset:0). En cambio sp.project() ya resta xaxis/yaxis._offset y quedaría
  // desplazado respecto al contenedor de imágenes.
  if (typeof sp.projection === "function") {
    return (lon, lat) => norm(sp.projection([lon, lat]));
  }
  // Fallback: sp.project() -> hay que volver a SUMAR el offset del subplot
  // para llevarlo al sistema del div completo.
  if (typeof sp.project === "function") {
    const xOff = (sp.xaxis && sp.xaxis._offset) || 0;
    const yOff = (sp.yaxis && sp.yaxis._offset) || 0;
    return (lon, lat) => {
      const p = norm(sp.project([lon, lat]));
      return p ? { x: p.x + xOff, y: p.y + yOff } : null;
    };
  }
  return null;
}

// Lee la posición EXACTA en pantalla de cada punto que Plotly ya dibujó en
// el SVG (elementos <path class="point">). Es lo más fiable: usamos las
// mismas coordenadas que Plotly calculó, sin reimplementar la proyección.
// Devuelve un array de {x, y} (relativo al contenedor cont) o null por punto.
function readPlottedPointPositions(gd, cont) {
  const pts = gd.querySelectorAll(".scatterlayer .trace .point");
  if (!pts || pts.length === 0) return null;

  const contRect = cont.getBoundingClientRect();
  const positions = new Array(mapList.length).fill(null);

  pts.forEach((node) => {
    // El índice del dato viene en node.__data__.i (o .index) según Plotly.
    const d = node.__data__;
    let idx = null;
    if (d) idx = (typeof d.i === "number") ? d.i : (typeof d.index === "number" ? d.index : null);
    // El centro real del punto = centro de su bounding box en pantalla.
    const r = node.getBoundingClientRect();
    const x = r.left + r.width / 2 - contRect.left;
    const y = r.top + r.height / 2 - contRect.top;
    if (idx == null) {
      // Sin índice fiable: asignamos en orden de aparición.
      const free = positions.indexOf(null);
      if (free !== -1) positions[free] = { x, y };
    } else if (idx >= 0 && idx < positions.length) {
      positions[idx] = { x, y };
    }
  });

  return positions;
}

function positionStadiumImages(gd) {
  const cont = imgContainer();
  if (!cont || !gd || !gd._fullLayout || !gd._fullLayout.geo) return;

  // 1) Vía preferida: leer la posición real de los puntos ya dibujados.
  let positions = readPlottedPointPositions(gd, cont);

  // 2) Fallback: proyección geo interna de Plotly.
  let project = null;
  if (!positions) {
    project = getGeoProjector(gd);
    if (!project) return; // no rompemos nada si nada está disponible
  }

  mapList.forEach((s, i) => {
    const el = stadiumImgEls[i];
    if (!el) return;

    const px = positions ? positions[i] : project(s.lon, s.lat);
    if (!px || !isFinite(px.x) || !isFinite(px.y)) { el.style.display = "none"; return; }

    // Tamaño: 26px..66px según intensidad.
    const size = 26 + intensityOf(s) * 40;
    el.style.display = "block";
    el.style.width = size + "px";
    el.style.height = size + "px";
    el.style.left = px.x + "px";
    el.style.top = px.y + "px";
    // z-index: los estadios más intensos, al frente.
    el.style.zIndex = String(3 + Math.round(intensityOf(s) * 10));
  });
}

// ============================================================
//  GRÁFICO DE BARRAS — capacidad / área conmutable
// ============================================================
// Cuántas barras mostrar como máximo (el dataset tiene ~200 estadios).
const BAR_TOP_N = 30;

function drawBar() {
  const p = palette();

  // Ranking por capacidad del subconjunto visible (filtro), top N.
  const sorted = [...visibleStadiums()]
    .sort((a, b) => b.capacity - a.capacity)
    .slice(0, BAR_TOP_N);
  const values = sorted.map(s => s.capacity);
  const labels = sorted.map(s => s.name);

  const trace = {
    type: "bar",
    orientation: "h",
    x: values,
    y: labels,
    customdata: sorted,
    marker: {
      color: values,
      colorscale: [[0, "#2b6cb0"], [1, "#f2a900"]],
      line: { color: p.markerLine, width: 0.5 }
    },
    hovertemplate: "<b>%{y}</b><br>Capacidad: %{x:,} espectadores<extra></extra>"
  };

  const layout = {
    paper_bgcolor: p.paper,
    plot_bgcolor: p.plot,
    font: { color: p.text },
    margin: { l: 210, r: 16, t: 6, b: 44 },
    bargap: 0.18,
    xaxis: {
      title: { text: "Capacidad (espectadores)" },
      gridcolor: p.grid, zerolinecolor: p.grid, tickfont: { size: 10 },
      showline: false
    },
    yaxis: {
      autorange: "reversed",
      tickfont: { size: 10, color: p.text },
      automargin: true
    },
    height: undefined
  };

  Plotly.react("bar", [trace], layout, { responsive: true, displayModeBar: false })
    .then(gd => {
      gd.removeAllListeners && gd.removeAllListeners("plotly_click");
      gd.on("plotly_click", ev => {
        const pt = ev.points[0];
        if (pt && pt.customdata) playGoal(pt.customdata);
      });
    });
}

// ---------- Filtro por confederación ----------
function buildFilter() {
  const sel = document.getElementById("filter-confederation");
  if (!sel) return;
  // Cuenta de estadios por confederación, para mostrar (n) en cada opción.
  const counts = {};
  for (const s of STADIUMS) counts[s.confederation] = (counts[s.confederation] || 0) + 1;

  sel.innerHTML = "";
  CONFEDERATIONS.forEach(conf => {
    const n = conf === "Todas" ? STADIUMS.length : (counts[conf] || 0);
    if (conf !== "Todas" && n === 0) return; // no ofrecer confederaciones vacías
    const opt = document.createElement("option");
    opt.value = conf;
    opt.textContent = `${conf} (${n})`;
    sel.appendChild(opt);
  });
  sel.value = activeConfederation;
  sel.addEventListener("change", () => {
    activeConfederation = sel.value;
    drawMap();
    drawBar();
  });
}

// ---------- Toggle de tema claro/oscuro ----------
const themeBtn = document.getElementById("btn-theme");
function applyThemeLabel() {
  const dark = currentTheme() === "dark";
  themeBtn.textContent = dark ? "☀️ Modo claro" : "🌙 Modo oscuro";
}
themeBtn.addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  applyThemeLabel();
  // Redibujamos ambos gráficos con la nueva paleta.
  drawMap();
  drawBar();
});

// ---------- Init ----------
applyThemeLabel();
buildFilter();
drawMap();
drawBar();
