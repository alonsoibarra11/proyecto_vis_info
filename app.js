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

  // --- Volumen mucho más contrastado según capacidad ---
  // El oído percibe el volumen en DECIBELES, no en ganancia lineal, así que
  // mapeamos la intensidad a un rango amplio de dB: estadio chico ≈ -20 dB
  // (claramente más bajo) y estadio enorme = 0 dB (a tope). Una gamma 0.8
  // reparte bien el contraste entre la mayoría de estadios, que se concentran
  // en el tramo bajo-medio de capacidad.
  const contrast = Math.pow(intensity, 0.8); // 0..1
  const MIN_DB = -20, MAX_DB = 0;
  const db = MIN_DB + contrast * (MAX_DB - MIN_DB);
  const vol = Tone.dbToGain(db); // dB -> ganancia lineal para el Gain node

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

// Con más estadios visibles que este umbral, mostramos marcadores nativos
// (que Plotly reposiciona solo, sin coste por frame). Con pocos, mostramos
// además las fotos de estadio. Así la página nunca se congela.
const PHOTO_THRESHOLD = 40;

function drawMap() {
  const p = palette();
  const list = visibleStadiums();                 // subconjunto activo (filtro)
  mapList = list;                                  // fuente única para el overlay
  const sizes = list.map(s => 8 + intensityOf(s) * 20);  // tamaño del punto
  const colors = list.map(s => intensityOf(s));

  const showPhotos = list.length > 0 && list.length <= PHOTO_THRESHOLD;

  // Marcadores NATIVOS de Plotly: los dibuja y reposiciona el propio Plotly
  // (fluido incluso con cientos de puntos). Cuando mostramos fotos encima,
  // atenuamos el círculo para que la foto sea la protagonista.
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
      color: colors,
      colorscale: [[0, "#2b6cb0"], [0.5, "#f2a900"], [1, "#e53e3e"]],
      cmin: 0, cmax: 1,
      opacity: showPhotos ? 0.15 : 0.9,
      line: { color: p.markerLine, width: showPhotos ? 0 : 0.5 }
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
      mapGd = gd;
      if (showPhotos) {
        buildStadiumImages(list);              // (re)crea los <img> del subconjunto
        schedulePositionImages();              // los coloca (throttle con rAF)
        requestAnimationFrame(schedulePositionImages);
      } else {
        clearStadiumImages();                  // muchos: sin fotos, todo nativo
      }
      if (!mapInitialized) {
        gd.on("plotly_click", ev => {
          const pt = ev.points[0];
          if (pt && mapList[pt.pointIndex]) playGoal(mapList[pt.pointIndex]);
        });
        // Reposicionar las fotos en cada render, pero SOLO si hay fotos y
        // como mucho una vez por frame (rAF), para no congelar el zoom/pan.
        gd.on("plotly_afterplot", schedulePositionImages);
        gd.on("plotly_relayout", schedulePositionImages);
        window.addEventListener("resize", schedulePositionImages);
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

let mapGd = null;          // referencia al gráfico de Plotly
let positionRAF = null;    // rAF pendiente para reposicionar fotos (throttle)

function imgContainer() {
  return document.getElementById("stadium-images");
}

function clearStadiumImages() {
  const cont = imgContainer();
  if (cont) cont.innerHTML = "";
  stadiumImgEls = [];
  if (positionRAF) { cancelAnimationFrame(positionRAF); positionRAF = null; }
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
    el.loading = "lazy";
    // Tamaño fijo por estadio (no cambia en zoom/pan): evita recalcular estilo.
    const size = 26 + intensityOf(s) * 40;
    el.style.width = size + "px";
    el.style.height = size + "px";
    el.style.zIndex = String(3 + Math.round(intensityOf(s) * 10));
    // Click en la foto = mismo efecto que click en el punto.
    el.addEventListener("click", () => playGoal(s));
    cont.appendChild(el);
    return el;
  });
}

// Reposiciona como mucho una vez por frame (rAF). Barato y sin congelar.
function schedulePositionImages() {
  if (!stadiumImgEls.length) return;   // no hay fotos: nada que hacer
  if (positionRAF) return;             // ya hay uno agendado
  positionRAF = requestAnimationFrame(() => {
    positionRAF = null;
    if (mapGd) positionStadiumImages(mapGd);
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
  if (!cont || !stadiumImgEls.length || !gd || !gd._fullLayout || !gd._fullLayout.geo) return;

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

    // Posicionamos con transform (capa de composición, sin reflow) y
    // centramos con -50%. width/height/zIndex ya se fijaron en buildStadiumImages.
    el.style.display = "block";
    el.style.transform = `translate(${px.x}px, ${px.y}px) translate(-50%, -50%)`;
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
        if (pt && pt.customdata) {
          zoomToStadium(pt.customdata);   // acerca el mapa a ese estadio
          playGoal(pt.customdata);        // y reproduce su sonido
        }
      });
    });
}

// Centra y acerca el mapa geo al estadio indicado (animado).
const GEO_ZOOM_SCALE = 6;   // nivel de acercamiento (1 = mundo completo)
function zoomToStadium(stadium) {
  if (!mapGd || !stadium) return;
  // En projection "natural earth", rotation.lon/lat centra el mapa y
  // projection.scale hace el zoom. center.lon/lat cubre el caso scoped.
  const relayout = {
    "geo.projection.rotation.lon": stadium.lon,
    "geo.projection.rotation.lat": stadium.lat,
    "geo.projection.scale": GEO_ZOOM_SCALE,
    "geo.center.lon": stadium.lon,
    "geo.center.lat": stadium.lat
  };
  // Intentamos animarlo; si la versión no anima layout.geo, caemos a relayout.
  const done = () => schedulePositionImages();
  try {
    Plotly.animate(mapGd, { layout: relayout }, {
      transition: { duration: 700, easing: "cubic-in-out" },
      frame: { duration: 700, redraw: true }
    }).then(done, () => Plotly.relayout(mapGd, relayout).then(done));
  } catch (_) {
    Plotly.relayout(mapGd, relayout).then(done);
  }
}

// Botón para volver a la vista mundial (des-zoom).
function resetMapView() {
  if (!mapGd) return;
  Plotly.relayout(mapGd, {
    "geo.projection.rotation.lon": 0,
    "geo.projection.rotation.lat": 0,
    "geo.projection.scale": 1,
    "geo.center.lon": 0,
    "geo.center.lat": 0
  }).then(() => schedulePositionImages());
}

// ---------- Panel de filtros (confederación + país + capacidad mínima) ----------
// Redibuja mapa y ranking, y refresca el texto de resultados.
function applyFilters() {
  drawMap();
  drawBar();
  updateFilterSummary();
}

function updateFilterSummary() {
  const el = document.getElementById("filter-summary");
  if (!el) return;
  const n = visibleStadiums().length;
  el.textContent = `${n} de ${STADIUMS.length} estadios`;
}

function buildFilter() {
  const confSel = document.getElementById("filter-confederation");
  const countrySel = document.getElementById("filter-country");
  const capRange = document.getElementById("filter-capacity");
  const capOut = document.getElementById("filter-capacity-value");

  // --- Confederación (con conteo por opción) ---
  if (confSel) {
    const counts = {};
    for (const s of STADIUMS) counts[s.confederation] = (counts[s.confederation] || 0) + 1;
    confSel.innerHTML = "";
    CONFEDERATIONS.forEach(conf => {
      const n = conf === "Todas" ? STADIUMS.length : (counts[conf] || 0);
      if (conf !== "Todas" && n === 0) return;
      const opt = document.createElement("option");
      opt.value = conf;
      opt.textContent = `${conf} (${n})`;
      confSel.appendChild(opt);
    });
    confSel.value = filters.confederation;
    confSel.addEventListener("change", () => {
      filters.confederation = confSel.value;
      applyFilters();
    });
  }

  // --- País ---
  if (countrySel) {
    countrySel.innerHTML = "";
    const optAll = document.createElement("option");
    optAll.value = "Todos";
    optAll.textContent = `Todos (${STADIUMS.length})`;
    countrySel.appendChild(optAll);
    COUNTRIES.forEach(country => {
      const n = STADIUMS.filter(s => s.country === country).length;
      const opt = document.createElement("option");
      opt.value = country;
      opt.textContent = `${country} (${n})`;
      countrySel.appendChild(opt);
    });
    countrySel.value = filters.country;
    countrySel.addEventListener("change", () => {
      filters.country = countrySel.value;
      applyFilters();
    });
  }

  // --- Capacidad mínima (slider) ---
  if (capRange) {
    // Paso "redondo" para que el slider se sienta natural.
    capRange.min = String(Math.floor(CAP_MIN / 1000) * 1000);
    capRange.max = String(Math.ceil(CAP_MAX / 1000) * 1000);
    capRange.step = "1000";
    capRange.value = String(filters.minCapacity);
    const fmt = (v) => Number(v).toLocaleString("es") + " espectadores";
    if (capOut) capOut.textContent = fmt(capRange.value);
    // input = actualiza etiqueta en vivo; change = redibuja (más barato).
    capRange.addEventListener("input", () => {
      if (capOut) capOut.textContent = fmt(capRange.value);
    });
    capRange.addEventListener("change", () => {
      filters.minCapacity = parseInt(capRange.value, 10) || CAP_MIN;
      applyFilters();
    });
  }

  // --- Botón limpiar ---
  const resetBtn = document.getElementById("filter-reset");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      filters.confederation = "Todas";
      filters.country = "Todos";
      filters.minCapacity = CAP_MIN;
      if (confSel) confSel.value = "Todas";
      if (countrySel) countrySel.value = "Todos";
      if (capRange) capRange.value = String(CAP_MIN);
      if (capOut) capOut.textContent = Number(CAP_MIN).toLocaleString("es") + " espectadores";
      applyFilters();
    });
  }

  updateFilterSummary();
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

// ---------- Botón "Ver mundo" (des-zoom) ----------
const resetViewBtn = document.getElementById("btn-reset-view");
if (resetViewBtn) resetViewBtn.addEventListener("click", resetMapView);

// ---------- Portada: "Explorar estadios" hace scroll hasta el mapa ----------
function resizeMapSoon() {
  const gd = document.getElementById("map");
  if (gd && window.Plotly) {
    Plotly.Plots.resize(gd);
    schedulePositionImages();
  }
}
function goToMap() {
  const target = document.getElementById("app-top");
  if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
}
const exploreBtn = document.getElementById("btn-explore");
if (exploreBtn) exploreBtn.addEventListener("click", goToMap);
const heroScroll = document.getElementById("hero-scroll");
if (heroScroll) heroScroll.addEventListener("click", goToMap);

// El mapa se dibuja estando fuera de vista (bajo la portada). La primera vez
// que entra en pantalla, forzamos un resize para que Plotly ajuste su tamaño.
// Funciona tanto con el botón como con scroll manual.
(function watchMapVisibility() {
  const gd = document.getElementById("map");
  if (!gd || !("IntersectionObserver" in window)) {
    // Fallback: un resize diferido tras cargar.
    window.addEventListener("load", () => setTimeout(resizeMapSoon, 300));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) { resizeMapSoon(); }
    }
  }, { threshold: 0.15 });
  io.observe(gd);
})();

// ---------- Init ----------
applyThemeLabel();
buildFilter();
drawMap();
drawBar();
