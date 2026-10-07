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
    markerLine: "#ffffff",
    tooltipBg: "#ffffff",
    tooltipBorder: "#d98200",
    tooltipText: "#1a2230"
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
    markerLine: "#0d1117",
    tooltipBg: "#161b22",
    tooltipBorder: "#f2a900",
    tooltipText: "#e6edf3"
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
let goalSequence = 0;                       // invalida secuencias interrumpidas

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

async function playGoal(stadium, zoom = false) {
  const sequence = ++goalSequence;
  cancelMatchIntro();
  cancelPeopleAnimation();
  await initAudio();
  if (sequence !== goalSequence) return;
  stopAllSound(true);

  // Si el mapa está oculto, lo revelamos primero y esperamos a que
  // Plotly esté listo (necesitamos las coordenadas en pantalla).
  await showMap();
  if (sequence !== goalSequence) return;

  // Las barras también pueden solicitar acercamiento. Se hace después de
  // revelar el mapa, porque la redibujada de Plotly restablece la proyección.
  if (zoom) {
    await zoomToStadium(stadium);
    if (sequence !== goalSequence) return;
  }

  const intensity = intensityOf(stadium); // 0..1

  // Actualiza el texto de "sonando"
  const npEl = document.getElementById("now-playing");
  if (npEl) npEl.textContent =
    `⚽ ${stadium.name} — ${stadium.city} · Aforo ${stadium.capacity.toLocaleString("es")}`;

  // Anuncia el partido sobre el estadio antes de que empiece a llegar la gente.
  await showMatchIntro(stadium);
  if (sequence !== goalSequence) return;

  // Lanza la animación de personas + pitidos, luego el crowd-cheer
  await animatePeople(stadium, intensity);
  if (sequence !== goalSequence) return;
  playCrowdCheer(stadium, intensity);
}

// ============================================================
//  SONIDO DEL CROWD-CHEER (separado de la animación)
// ============================================================
function playCrowdCheer(stadium, intensity) {
  if (!audioReady) return;
  stopAllSound(false);

  const contrast = Math.pow(intensity, 0.8);
  const db = -20 + contrast * 20;
  const vol = Tone.dbToGain(db);

  const now = Tone.now();
  try { if (player.state === "started") player.stop(now); } catch (_) {}
  player.start(now + 0.02);

  playerGain.gain.cancelScheduledValues(now);
  playerGain.gain.setValueAtTime(0.0001, now);
  playerGain.gain.linearRampToValueAtTime(vol, now + 0.12);

  const clipMs = (player.buffer && player.buffer.duration)
    ? player.buffer.duration * 1000 : 4000;
  const maxMs = 3500 + Math.round(intensity * 2000);
  const durationMs = Math.min(clipMs, maxMs);

  startLevelPump();
  emitBus("goal:start", { stadium, intensity, durationMs });
  stopTimer = setTimeout(() => stopAllSound(false), durationMs);

  // Hace crecer y temblar el marcador del estadio seleccionado
  triggerMarkerShake();
}

// ============================================================
//  ANIMACIÓN DE PERSONAS CONVERGIENDO AL ESTADIO
// ============================================================
let peopleRAF = null;        // handle del loop de animación activo
let peopleCanvas = null;     // <canvas> superpuesto al stage
let peopleCancel = null;
let peopleTimeout = null;
let matchIntroEl = null;
let matchIntroTimer = null;
let matchIntroResolve = null;

// Número de personas según capacidad: 12 (mínimo) a 160 (máximo)
function personCount(intensity) {
  return Math.round(12 + intensity * 148);
}

function cancelPeopleAnimation() {
  if (peopleRAF) { cancelAnimationFrame(peopleRAF); peopleRAF = null; }
  if (peopleCanvas) { peopleCanvas.remove(); peopleCanvas = null; }
  if (peopleTimeout) { clearTimeout(peopleTimeout); peopleTimeout = null; }
  if (peopleCancel) {
    const cancel = peopleCancel;
    peopleCancel = null;
    cancel();
  }
}

// Sintetiza un pitido breve con Tone.js cuando una persona llega al estadio.
// El tono sube levemente con cada persona para dar sensación de acumulación.
let beepSynth = null;
function beep(idx, total) {
  if (!audioReady) return;
  try {
    if (!beepSynth) {
      beepSynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sine" },
        envelope: { attack: 0.005, decay: 0.08, sustain: 0, release: 0.05 }
      }).connect(masterGain);
      beepSynth.volume.value = -14;
    }
    // Frecuencia: escala de 800 Hz a 1400 Hz a medida que llegan personas
    const freq = 800 + (idx / Math.max(1, total - 1)) * 600;
    beepSynth.triggerAttackRelease(freq, 0.045);
  } catch (_) {}
}

async function animatePeople(stadium, intensity) {
  return new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (peopleRAF) { cancelAnimationFrame(peopleRAF); peopleRAF = null; }
      if (peopleTimeout) { clearTimeout(peopleTimeout); peopleTimeout = null; }
      if (peopleCanvas) { peopleCanvas.remove(); peopleCanvas = null; }
      if (peopleCancel === finish) peopleCancel = null;
      resolve();
    };
    peopleCancel = finish;
    const stage = document.getElementById("stage");
    if (!stage || !mapGd) { finish(); return; }

    // Obtener posición en pantalla del estadio en el mapa
    const targetPx = getStadiumPixel(stadium);
    if (!targetPx) { finish(); return; }

    const stageRect = stage.getBoundingClientRect();
    // Posición del estadio relativa al stage (para el canvas)
    const targetX = targetPx.x - stageRect.left;
    const targetY = targetPx.y - stageRect.top;

    const N = personCount(intensity);
    // Intervalo entre llegadas (ms): más corto = más amontonados
    // Mantiene una secuencia de unos 2.6–3.8 s: pequeña = pausada,
    // grande = muchos pitidos muy juntos.
    const arrivalWindow = 2600 + intensity * 1200;
    const arrivalInterval = Math.round(arrivalWindow / Math.max(1, N - 1));

    // Crear canvas superpuesto
    const canvas = document.createElement("canvas");
    canvas.style.cssText = `
      position:absolute; inset:0; width:100%; height:100%;
      pointer-events:none; z-index:4;
    `;
    canvas.width = stageRect.width;
    canvas.height = stageRect.height;
    stage.appendChild(canvas);
    peopleCanvas = canvas;
    const ctx = canvas.getContext("2d");

    // Genera N personas con posición aleatoria de inicio
    const people = Array.from({ length: N }, (_, i) => {
      return {
        x: Math.random() * stageRect.width,
        y: Math.random() * stageRect.height,
        arrived: false,
        arriveAt: i * arrivalInterval,    // tiempo (ms) en que llega este punto
        startedAt: null,
        duration: 780 + Math.random() * 30,   // duración del trayecto (ms)
      };
    });

    let arrivedCount = 0;
    const startTime = performance.now();

    const loop = (now) => {
      const elapsed = now - startTime;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      let allDone = true;

      people.forEach((p, i) => {
        if (p.arrived) return;

        if (elapsed < p.arriveAt) {
          // Todavía no ha empezado a moverse, dibújalo en origen
          allDone = false;
          drawPerson(ctx, p.x, p.y, 0);
          return;
        }

        if (!p.startedAt) p.startedAt = now;
        const t = Math.min(1, (now - p.startedAt) / p.duration);
        const eased = easeInQuad(t);

        const cx = p.x + (targetX - p.x) * eased;
        const cy = p.y + (targetY - p.y) * eased;

        if (t < 1) {
          allDone = false;
          drawPerson(ctx, cx, cy, t);
        } else {
          // Llegó — emite pitido escalonado
          if (!p.arrived) {
            p.arrived = true;
            arrivedCount++;
            beep(arrivedCount - 1, N);
          }
        }
      });

      if (allDone) {
        // Pequeño flash en el destino al terminar
        ctx.beginPath();
        ctx.arc(targetX, targetY, 28, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(242, 169, 0, 0.45)";
        ctx.fill();
        peopleTimeout = setTimeout(finish, 180);
        return;
      }

      peopleRAF = requestAnimationFrame(loop);
    };

    peopleRAF = requestAnimationFrame(loop);
  });
}

// Dibuja un punto "persona" con tamaño que crece al acercarse (t = 0..1)
function drawPerson(ctx, x, y, t) {
  const r = 3 + t * 3;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(242, 169, 0, ${0.5 + t * 0.5})`;
  ctx.fill();
  // Estela
  if (t > 0.1) {
    ctx.beginPath();
    ctx.arc(x, y, r * 1.8, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(242, 169, 0, ${0.12 + t * 0.1})`;
    ctx.fill();
  }
}

function easeInQuad(t) { return t * t; }

// Obtiene la posición en pantalla (absoluta) del estadio en el mapa actual.
function getStadiumPixel(stadium) {
  if (!mapGd) return null;
  // Intentamos leer desde los puntos del SVG (más preciso)
  const pts = mapGd.querySelectorAll(".scatterlayer .trace .point");
  if (pts && pts.length > 0) {
    const idx = mapList.indexOf(stadium);
    if (idx !== -1) {
      const node = pts[idx];
      if (node) {
        const r = node.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
    }
  }
  // Fallback: proyección geo
  const project = getGeoProjector(mapGd);
  if (!project) return null;
  const px = project(stadium.lon, stadium.lat);
  if (!px || !isFinite(px.x)) return null;
  const mapRect = mapGd.getBoundingClientRect();
  return { x: mapRect.left + px.x, y: mapRect.top + px.y };
}

function cancelMatchIntro() {
  if (matchIntroTimer !== null) {
    clearTimeout(matchIntroTimer);
    matchIntroTimer = null;
  }
  if (matchIntroEl) {
    matchIntroEl.remove();
    matchIntroEl = null;
  }
  if (matchIntroResolve) {
    const resolve = matchIntroResolve;
    matchIntroResolve = null;
    resolve();
  }
}

function showMatchIntro(stadium) {
  cancelMatchIntro();
  const stage = document.getElementById("stage");
  const targetPx = getStadiumPixel(stadium);
  if (!stage || !targetPx) return Promise.resolve();

  const stageRect = stage.getBoundingClientRect();
  const x = targetPx.x - stageRect.left;
  const y = targetPx.y - stageRect.top;
  const announcement = document.createElement("div");
  announcement.className = "match-announcement";
  announcement.setAttribute("role", "status");
  announcement.textContent = "El partido está a punto de empezar!";
  announcement.style.left = `${x}px`;
  announcement.style.top = `${y}px`;
  stage.appendChild(announcement);

  const bubbleRect = announcement.getBoundingClientRect();
  const halfWidth = bubbleRect.width / 2;
  announcement.style.left = `${Math.max(halfWidth + 12, Math.min(stageRect.width - halfWidth - 12, x))}px`;
  announcement.dataset.placement = y < bubbleRect.height + 34 ? "below" : "above";
  matchIntroEl = announcement;

  return new Promise(resolve => {
    matchIntroResolve = resolve;
    matchIntroTimer = setTimeout(cancelMatchIntro, 1450);
  });
}

// Hace crecer y temblar el marcador del estadio seleccionado al sonar el crowd-cheer
function triggerMarkerShake() {
  const marker = document.getElementById("selected-stadium-marker");
  if (!marker || marker.style.display === "none") return;
  marker.classList.remove("marker-shake");
  // Forzamos reflow para que la animación se reinicie
  void marker.offsetWidth;
  marker.classList.add("marker-shake");
  setTimeout(() => marker.classList.remove("marker-shake"), 1200);
}

// ============================================================
//  LAYOUT: mapa oculto / visible
//  Vista inicial = solo ranking a pantalla completa.
//  Al revelar el mapa, el panel vuelve a flotar sobre él.
// ============================================================
let mapVisible = false;
let mapReadyPromise = Promise.resolve();

function showMap() {
  if (mapVisible) return mapReadyPromise;
  mapVisible = true;
  const stage = document.getElementById("stage");
  if (stage) stage.classList.remove("map-hidden");
  // Plotly necesita recalcular su tamaño ahora que el contenedor es visible.
  mapReadyPromise = new Promise(resolve => setTimeout(() => {
    resizeMapSoon();
    Promise.all([
      drawMap(),  // redibuja el mapa con dimensiones reales
      drawBar()   // redibuja el bar para que encaje en el panel flotante
    ]).then(resolve);
  }, 50));
  return mapReadyPromise;
}


let mapInitialized = false;
let selectedMapStadium = null;

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
      `<b>${s.name}</b><br>📍 ${s.city}, ${s.country}` +
      `<br>👥 ${s.capacity.toLocaleString("es")} espectadores` +
      (s.year ? `<br>Inaugurado en ${s.year}` : "")),
    hoverinfo: "text",
    hoverlabel: {
      bgcolor: p.tooltipBg,
      bordercolor: p.tooltipBorder,
      font: { family: "Segoe UI, system-ui, sans-serif", size: 13, color: p.tooltipText },
      align: "left",
      namelength: -1
    },
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

  return Plotly.react("map", [trace], layout, { responsive: true, displayModeBar: false })
    .then(gd => {
      mapGd = gd;
      if (showPhotos) {
        buildStadiumImages(list);              // (re)crea los <img> del subconjunto
        schedulePositionImages();              // los coloca (throttle con rAF)
        requestAnimationFrame(schedulePositionImages);
      } else {
        clearStadiumImages();                  // muchos: sin fotos, todo nativo
      }
      scheduleSelectedMarker();
      if (!mapInitialized) {
        gd.on("plotly_hover", ev => {
          const pt = ev.points && ev.points[0];
          const stadium = pt && mapList[pt.pointIndex];
          if (stadium) clearSelectedMarkerIfSame(stadium);
        });
        gd.on("plotly_click", ev => {
          const pt = ev.points[0];
          const stadium = pt && mapList[pt.pointIndex];
          if (stadium) {
            clearSelectedMarkerIfSame(stadium);
            selectedMapStadium = stadium;
            scheduleSelectedMarker();
            playGoal(stadium);
          }
        });
        // Reposicionar las fotos en cada render, pero SOLO si hay fotos y
        // como mucho una vez por frame (rAF), para no congelar el zoom/pan.
        gd.on("plotly_afterplot", () => {
          schedulePositionImages();
          scheduleSelectedMarker();
        });
        gd.on("plotly_relayout", () => {
          schedulePositionImages();
          scheduleSelectedMarker();
        });
        window.addEventListener("resize", () => {
          schedulePositionImages();
          scheduleSelectedMarker();
        });
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
let selectedMarkerRAF = null;

function scheduleSelectedMarker() {
  if (selectedMarkerRAF) return;
  selectedMarkerRAF = requestAnimationFrame(() => {
    selectedMarkerRAF = null;
    positionSelectedMarker();
  });
}

function positionSelectedMarker() {
  const marker = document.getElementById("selected-stadium-marker");
  const label = marker && marker.querySelector(".selected-marker-label");
  if (!marker || !selectedMapStadium || !mapGd) {
    if (marker) marker.style.display = "none";
    return;
  }
  const index = mapList.indexOf(selectedMapStadium);
  if (index < 0) { marker.style.display = "none"; return; }

  // Usa una capa visible y estable como referencia: el resaltado puede estar
  // oculto mientras termina el zoom y su bounding box entonces mide cero.
  const positions = readPlottedPointPositions(mapGd, imgContainer());
  const point = positions && positions[index];
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    marker.style.display = "none";
    return;
  }
  marker.style.display = "block";
  marker.style.transform = `translate(${point.x}px, ${point.y}px) translate(-50%, -50%)`;
  if (label) label.textContent = selectedMapStadium.name;
}

function clearSelectedMarkerIfSame(stadium) {
  if (selectedMapStadium !== stadium) return;
  selectedMapStadium = null;
  const marker = document.getElementById("selected-stadium-marker");
  if (marker) marker.style.display = "none";
}

function showStadiumTooltip(stadium, event) {
  const tooltip = document.getElementById("stadium-tooltip");
  if (!tooltip) return;
  document.getElementById("stadium-tooltip-name").textContent = stadium.name;
  document.getElementById("stadium-tooltip-location").textContent = `📍 ${stadium.city}, ${stadium.country}`;
  document.getElementById("stadium-tooltip-capacity").textContent =
    `👥 ${stadium.capacity.toLocaleString("es")} espectadores`;
  const year = document.getElementById("stadium-tooltip-year");
  year.textContent = stadium.year ? `Inaugurado en ${stadium.year}` : "";
  year.hidden = !stadium.year;
  tooltip.hidden = false;

  const offset = 16;
  const rect = tooltip.getBoundingClientRect();
  const left = event.clientX + rect.width + offset < window.innerWidth
    ? event.clientX + offset
    : event.clientX - rect.width - offset;
  const top = event.clientY + rect.height + offset < window.innerHeight
    ? event.clientY + offset
    : event.clientY - rect.height - offset;
  tooltip.style.left = `${Math.max(8, left)}px`;
  tooltip.style.top = `${Math.max(8, top)}px`;
}

function hideStadiumTooltip() {
  const tooltip = document.getElementById("stadium-tooltip");
  if (tooltip) tooltip.hidden = true;
}

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
    el.setAttribute("aria-label", `${s.name} — ${s.city}, ${s.country}`);
    el.loading = "lazy";
    // Tamaño fijo por estadio (no cambia en zoom/pan): evita recalcular estilo.
    const size = 26 + intensityOf(s) * 40;
    el.style.width = size + "px";
    el.style.height = size + "px";
    el.style.zIndex = String(3 + Math.round(intensityOf(s) * 10));
    // Click en la foto = mismo efecto que click en el punto.
    el.addEventListener("click", () => {
      clearSelectedMarkerIfSame(s);
      selectedMapStadium = s;
      scheduleSelectedMarker();
      playGoal(s);
    });
    el.addEventListener("mouseenter", () => clearSelectedMarkerIfSame(s));
    el.addEventListener("pointerenter", event => showStadiumTooltip(s, event));
    el.addEventListener("pointermove", event => showStadiumTooltip(s, event));
    el.addEventListener("pointerleave", hideStadiumTooltip);
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
// Cuántas barras mostrar como máximo para mantener legible el ranking.
const BAR_TOP_N = 8;

function drawBar() {
  const p = palette();

  // Ranking por capacidad del subconjunto visible (filtro), top N.
  const sorted = [...visibleStadiums()]
    .sort((a, b) => b.capacity - a.capacity)
    .slice(0, BAR_TOP_N);
  const values = sorted.map(s => s.capacity);
  const labels = sorted.map(s => s.name);
  const barElement = document.getElementById("bar");
  const overview = !mapVisible;
  const barWidth = barElement?.clientWidth || 500;
  const labelMargin = overview
    ? Math.max(220, Math.min(360, Math.round(barWidth * 0.23)))
    : Math.max(105, Math.min(210, Math.round(barWidth * 0.4)));

  const trace = {
    type: "bar",
    orientation: "h",
    x: values,
    y: labels,
    text: overview ? values.map(value => value.toLocaleString("es")) : undefined,
    textposition: overview ? "outside" : "none",
    textfont: { size: overview ? 15 : 10, color: p.text },
    cliponaxis: !overview,
    customdata: sorted,
    marker: {
      color: values,
      colorscale: overview
        ? [[0, "#3976b8"], [0.58, "#5489b4"], [1, "#e58b00"]]
        : [[0, "#2b6cb0"], [1, "#f2a900"]],
      line: { color: p.markerLine, width: 0.5 }
    },
    hovertemplate: "<b>%{y}</b><br>Capacidad: %{x:,.0f} espectadores<extra></extra>"
  };

  const layout = {
    paper_bgcolor: p.paper,
    plot_bgcolor: p.plot,
    font: { color: p.text },
    separators: overview ? ",." : undefined,
    height: overview ? Math.max(450, Math.min(600, Math.round(window.innerHeight * 0.58))) : undefined,
    margin: { l: labelMargin, r: overview ? 86 : 16, t: overview ? 16 : 6, b: overview ? 58 : 44 },
    bargap: overview ? 0.34 : 0.18,
    xaxis: {
      title: { text: overview ? "Aforo (personas)" : "Capacidad (espectadores)", font: { size: overview ? 13 : 11, color: p.muted }, standoff: 12 },
      gridcolor: p.grid, zerolinecolor: p.grid,
      tickfont: { size: overview ? 12 : 10, color: p.muted },
      tickformat: overview ? ",.0f" : undefined,
      range: overview && values.length ? [0, Math.max(...values) * 1.16] : undefined,
      showline: false,
      fixedrange: overview
    },
    yaxis: {
      autorange: "reversed",
      tickfont: { size: overview ? 15 : 10, color: p.text },
      automargin: true
    }
  };

  return Plotly.react("bar", [trace], layout, { responsive: true, displayModeBar: false })
    .then(gd => {
      gd.removeAllListeners && gd.removeAllListeners("plotly_click");
      gd.on("plotly_click", ev => {
        const pt = ev.points[0];
        if (pt && pt.customdata) {
          selectedMapStadium = pt.customdata;
          const marker = document.getElementById("selected-stadium-marker");
          if (marker) marker.style.display = "none";
          playGoal(pt.customdata, true);  // revela, acerca el mapa y reproduce
        }
      });
    });
}

// Centra y acerca el mapa geo al estadio indicado (animado).
const GEO_ZOOM_SCALE = 6;   // nivel de acercamiento (1 = mundo completo)
function zoomToStadium(stadium) {
  if (!mapGd || !stadium) return Promise.resolve();
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
  const done = () => {
    schedulePositionImages();
    // Esperamos a que Plotly termine de actualizar el SVG del mapa antes de
    // calcular la posición final del resaltado.
    window.setTimeout(scheduleSelectedMarker, 100);
  };
  const fallback = () => Plotly.relayout(mapGd, relayout).then(done);
  try {
    return Plotly.animate(mapGd, { layout: relayout }, {
      transition: { duration: 700, easing: "cubic-in-out" },
      frame: { duration: 700, redraw: true }
    }).then(done, fallback);
  } catch (_) {
    return fallback();
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

// ---------- Panel movible: el usuario puede reubicarlo dentro del mapa ----------
const rankingPanel = document.getElementById("ranking-panel");
const panelDragHandle = document.getElementById("panel-drag");
if (rankingPanel && panelDragHandle) {
  panelDragHandle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (!mapVisible) return;  // no arrastrar en modo mapa-oculto
    const stage = rankingPanel.parentElement;
    const panelRect = rankingPanel.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    const offsetX = event.clientX - panelRect.left;
    const offsetY = event.clientY - panelRect.top;
    rankingPanel.style.right = "auto";
    rankingPanel.style.bottom = "auto";
    rankingPanel.style.height = `${panelRect.height}px`;
    rankingPanel.style.left = `${panelRect.left - stageRect.left}px`;
    rankingPanel.style.top = `${panelRect.top - stageRect.top}px`;
    panelDragHandle.setPointerCapture(event.pointerId);

    const movePanel = (moveEvent) => {
      const left = Math.max(0, Math.min(stage.clientWidth - rankingPanel.offsetWidth,
        moveEvent.clientX - stageRect.left - offsetX));
      const top = Math.max(0, Math.min(stage.clientHeight - rankingPanel.offsetHeight,
        moveEvent.clientY - stageRect.top - offsetY));
      rankingPanel.style.left = `${left}px`;
      rankingPanel.style.top = `${top}px`;
    };
    const stopMoving = () => {
      panelDragHandle.removeEventListener("pointermove", movePanel);
      panelDragHandle.removeEventListener("pointerup", stopMoving);
      panelDragHandle.removeEventListener("pointercancel", stopMoving);
    };
    panelDragHandle.addEventListener("pointermove", movePanel);
    panelDragHandle.addEventListener("pointerup", stopMoving);
    panelDragHandle.addEventListener("pointercancel", stopMoving);
  });
}

// Arrastrar cualquiera de los bordes cambia directamente el ancho o el alto.
if (rankingPanel) {
  rankingPanel.querySelectorAll(".panel-resize-edge").forEach(handle => {
    handle.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      if (!mapVisible) return;  // no redimensionar en modo mapa-oculto
      event.preventDefault();
      const stage = rankingPanel.parentElement;
      const stageRect = stage.getBoundingClientRect();
      const panelRect = rankingPanel.getBoundingClientRect();
      const edge = handle.dataset.resize;
      const startX = event.clientX;
      const startY = event.clientY;
      const startLeft = panelRect.left - stageRect.left;
      const startTop = panelRect.top - stageRect.top;
      const startWidth = panelRect.width;
      const startHeight = panelRect.height;

      rankingPanel.style.right = "auto";
      rankingPanel.style.bottom = "auto";
      rankingPanel.style.left = `${startLeft}px`;
      rankingPanel.style.top = `${startTop}px`;
      rankingPanel.style.width = `${startWidth}px`;
      rankingPanel.style.height = `${startHeight}px`;
      handle.setPointerCapture(event.pointerId);

      const resizePanel = moveEvent => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        if (edge === "right") {
          rankingPanel.style.width = `${Math.max(350, Math.min(stage.clientWidth - startLeft, startWidth + dx))}px`;
        } else if (edge === "left") {
          const width = Math.max(350, Math.min(startLeft + startWidth, startWidth - dx));
          rankingPanel.style.width = `${width}px`;
          rankingPanel.style.left = `${startLeft + startWidth - width}px`;
        } else if (edge === "bottom") {
          rankingPanel.style.height = `${Math.max(360, Math.min(stage.clientHeight - startTop, startHeight + dy))}px`;
        } else if (edge === "top") {
          const height = Math.max(360, Math.min(startTop + startHeight, startHeight - dy));
          rankingPanel.style.height = `${height}px`;
          rankingPanel.style.top = `${startTop + startHeight - height}px`;
        }
      };
      const stopResize = () => {
        handle.removeEventListener("pointermove", resizePanel);
        handle.removeEventListener("pointerup", stopResize);
        handle.removeEventListener("pointercancel", stopResize);
      };
      handle.addEventListener("pointermove", resizePanel);
      handle.addEventListener("pointerup", stopResize);
      handle.addEventListener("pointercancel", stopResize);
    });
  });
}

// Redibuja Plotly al variar el espacio disponible en el ranking.
const barResizeTarget = document.getElementById("bar");
if (barResizeTarget && "ResizeObserver" in window) {
  let resizeFrame = null;
  const barResizeObserver = new ResizeObserver(() => {
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null;
      if (!barResizeTarget.data || !window.Plotly) return;
      Plotly.Plots.resize(barResizeTarget);
      const overview = !mapVisible;
      const labelMargin = overview
        ? Math.max(220, Math.min(360, Math.round(barResizeTarget.clientWidth * 0.23)))
        : Math.max(105, Math.min(210, Math.round(barResizeTarget.clientWidth * 0.4)));
      Plotly.relayout(barResizeTarget, { "margin.l": labelMargin });
    });
  });
  barResizeObserver.observe(barResizeTarget);
}

// ---------- Botón "Explorar en el mapa" (revela el mapa) ----------
const showMapBtn = document.getElementById("btn-show-map");
if (showMapBtn) showMapBtn.addEventListener("click", showMap);

// ---------- Portada: "Averígualo aquí!" hace scroll hasta el mapa ----------
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
