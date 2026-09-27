/* ============================================================
   Estadios del mundo — mapa sonoro
   - Plotly scattergeo para el mapa
   - Plotly bar para el ranking (capacidad / área)
   - Tone.js para sintetizar un "GOOOOL!" de celebración
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
const areas = STADIUMS.map(s => s.areaM2);
const CAP_MIN = Math.min(...capacities), CAP_MAX = Math.max(...capacities);
const AREA_MIN = Math.min(...areas), AREA_MAX = Math.max(...areas);

// Devuelve 0..1 según cuán grande/lleno es el estadio.
// Combinamos capacidad (peso 0.65) y área (peso 0.35) para la "intensidad".
function intensityOf(st) {
  const capN = (st.capacity - CAP_MIN) / (CAP_MAX - CAP_MIN || 1);
  const areaN = (st.areaM2 - AREA_MIN) / (AREA_MAX - AREA_MIN || 1);
  return 0.65 * capN + 0.35 * areaN; // 0..1
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
//  SONIDO — "GOOOOL!" sintetizado con Tone.js (sin archivos)
//  Un grito ascendente y sostenido (voz estilizada con vibrato)
//  sobre un rugido de multitud que explota. Todo se genera en
//  vivo, así podemos leer el nivel de audio en tiempo real con
//  un Tone.Meter y usarlo para el temblor del servo (Arduino).
// ============================================================
let audioReady = false;
let crowdNoise, crowdFilter, crowdGain;    // rugido de la multitud
let voiceA, voiceB, voiceGain;             // "voces" del GOOOOL (osciladores)
let vibrato, voiceFilter;                  // vibrato + formante del grito
let reverb, masterGain, meter;             // salida + medidor de nivel
let stopTimer = null;
let levelRAF = null;                        // requestAnimationFrame del medidor

async function initAudio() {
  if (audioReady) return;
  await Tone.start();

  masterGain = new Tone.Gain(0.9).toDestination();

  // Medidor de nivel en vivo (0..1 aprox tras normalizar dB).
  meter = new Tone.Meter({ smoothing: 0.85 });
  masterGain.connect(meter);

  reverb = new Tone.Reverb({ decay: 3.2, wet: 0.3 }).connect(masterGain);

  // --- Rugido de multitud: ruido rosa por un pasa-banda con "oleaje" ---
  crowdGain = new Tone.Gain(0).connect(reverb);
  crowdFilter = new Tone.Filter({ type: "bandpass", frequency: 800, Q: 0.5 }).connect(crowdGain);
  crowdNoise = new Tone.Noise("pink").connect(crowdFilter);
  crowdNoise.start();
  const crowdLFO = new Tone.LFO({ frequency: 0.4, min: 500, max: 1300 }).start();
  crowdLFO.connect(crowdFilter.frequency);

  // --- "Voz" del GOOOOL: dos osciladores (grito) con vibrato y un ---
  //     filtro que imita el formante de una vocal abierta ("ooo").
  voiceFilter = new Tone.Filter({ type: "bandpass", frequency: 900, Q: 3 }).connect(reverb);
  voiceGain = new Tone.Gain(0).connect(voiceFilter);

  voiceA = new Tone.Oscillator({ type: "sawtooth", frequency: 220 }).connect(voiceGain);
  voiceB = new Tone.Oscillator({ type: "square",  frequency: 223 }).connect(voiceGain); // leve desafine = coro
  voiceA.start();
  voiceB.start();

  // Vibrato del grito (le da la vibración humana al "GOOOOL").
  // El LFO oscila directamente en cents (±100 ≈ ±1 semitono) y se
  // conecta al detune de ambos osciladores.
  vibrato = new Tone.LFO({ frequency: 5.5, min: -100, max: 100 }).start();
  vibrato.connect(voiceA.detune);
  vibrato.connect(voiceB.detune);

  audioReady = true;
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
  const t = fast ? 0.15 : 0.5;
  crowdGain.gain.rampTo(0, t);
  voiceGain.gain.rampTo(0, t);
  stopLevelPump();
  emitBus("goal:stop", {});
}

async function playGoal(stadium) {
  await initAudio();
  stopAllSound(true);

  const intensity = intensityOf(stadium); // 0..1

  // Volúmenes proporcionales a la intensidad del estadio.
  const crowdVol = 0.15 + intensity * 0.5;
  const voiceVol = 0.18 + intensity * 0.55;

  // La nota base del grito sube un poco con la intensidad (más épico).
  const baseFreq = 180 + intensity * 90; // 180..270 Hz

  const now = Tone.now();

  // 1) La multitud explota de golpe y luego se sostiene.
  crowdGain.gain.cancelScheduledValues(now);
  crowdGain.gain.setValueAtTime(0.0001, now);
  crowdGain.gain.exponentialRampToValueAtTime(crowdVol, now + 0.15);

  // 2) El "GOOOOL": barrido de frecuencia ascendente (portamento) +
  //    apertura del formante (el filtro sube) = sensación de grito.
  voiceA.frequency.cancelScheduledValues(now);
  voiceB.frequency.cancelScheduledValues(now);
  voiceA.frequency.setValueAtTime(baseFreq * 0.75, now);
  voiceB.frequency.setValueAtTime(baseFreq * 0.75 + 3, now);
  // Sube rápido (la "G-O") y se sostiene en la "OOOO".
  voiceA.frequency.exponentialRampToValueAtTime(baseFreq, now + 0.35);
  voiceB.frequency.exponentialRampToValueAtTime(baseFreq + 3, now + 0.35);

  voiceFilter.frequency.cancelScheduledValues(now);
  voiceFilter.frequency.setValueAtTime(500, now);
  voiceFilter.frequency.exponentialRampToValueAtTime(1400, now + 0.4);
  voiceFilter.frequency.exponentialRampToValueAtTime(700, now + 3.2);

  // Envolvente del grito: ataque marcado, sostiene y decae.
  voiceGain.gain.cancelScheduledValues(now);
  voiceGain.gain.setValueAtTime(0.0001, now);
  voiceGain.gain.exponentialRampToValueAtTime(voiceVol, now + 0.12);
  voiceGain.gain.setValueAtTime(voiceVol, now + 2.4);
  voiceGain.gain.exponentialRampToValueAtTime(0.0001, now + 4.0);

  // Duración total del festejo escala levemente con la intensidad.
  const durationMs = 3500 + Math.round(intensity * 1500); // 3.5s..5s

  // Nivel de audio en vivo → bus → Arduino.
  startLevelPump();

  // Aviso a quien fisicalice (Arduino/servo): empieza el gol.
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
  const sizes = STADIUMS.map(s => 10 + intensityOf(s) * 26); // tamaño del punto
  const colors = STADIUMS.map(s => intensityOf(s));

  const trace = {
    type: "scattergeo",
    mode: "markers",
    lat: STADIUMS.map(s => s.lat),
    lon: STADIUMS.map(s => s.lon),
    text: STADIUMS.map(s =>
      `<b>${s.name}</b><br>${s.city}, ${s.country}` +
      `<br>Capacidad: ${s.capacity.toLocaleString("es")}` +
      `<br>Superficie: ${s.areaM2.toLocaleString("es")} m²`),
    hoverinfo: "text",
    marker: {
      size: sizes,
      color: colors,
      colorscale: [[0, "#2b6cb0"], [0.5, "#f2a900"], [1, "#e53e3e"]],
      cmin: 0, cmax: 1,
      opacity: 0.92,
      line: { color: p.markerLine, width: 1 },
      colorbar: {
        title: { text: "Intensidad", font: { color: p.text } },
        tickfont: { color: p.muted },
        outlinecolor: p.grid,
        len: 0.7, x: 0.99, xanchor: "right"
      }
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
      if (!mapInitialized) {
        gd.on("plotly_click", ev => {
          const pt = ev.points[0];
          if (pt) playGoal(STADIUMS[pt.pointIndex]);
        });
        mapInitialized = true;
      }
    });
}

// ============================================================
//  GRÁFICO DE BARRAS — capacidad / área conmutable
// ============================================================
let currentMetric = "capacity";

function drawBar(metric) {
  currentMetric = metric;
  const isCap = metric === "capacity";
  const p = palette();

  // Ordenamos de mayor a menor por la métrica elegida.
  const sorted = [...STADIUMS].sort((a, b) => b[metric] - a[metric]);
  const values = sorted.map(s => s[metric]);
  const labels = sorted.map(s => s.name);

  const trace = {
    type: "bar",
    orientation: "h",
    x: values,
    y: labels,
    customdata: sorted,
    marker: {
      color: values,
      colorscale: isCap
        ? [[0, "#2b6cb0"], [1, "#f2a900"]]
        : [[0, "#2b6cb0"], [1, "#e53e3e"]],
      line: { color: p.markerLine, width: 0.5 }
    },
    hovertemplate: isCap
      ? "<b>%{y}</b><br>Capacidad: %{x:,} espectadores<extra></extra>"
      : "<b>%{y}</b><br>Superficie: %{x:,} m²<extra></extra>"
  };

  const layout = {
    paper_bgcolor: p.paper,
    plot_bgcolor: p.plot,
    font: { color: p.text },
    margin: { l: 210, r: 16, t: 6, b: 44 },
    bargap: 0.18,
    xaxis: {
      title: { text: isCap ? "Capacidad (espectadores)" : "Superficie (m²)" },
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

// ---------- Toggle de métrica ----------
document.getElementById("btn-cap").addEventListener("click", () => {
  setActive("btn-cap");
  drawBar("capacity");
});
document.getElementById("btn-area").addEventListener("click", () => {
  setActive("btn-area");
  drawBar("areaM2");
});
function setActive(id) {
  document.querySelectorAll("button.toggle").forEach(b => b.classList.remove("active"));
  document.getElementById(id).classList.add("active");
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
  drawBar(currentMetric);
});

// ---------- Init ----------
applyThemeLabel();
drawMap();
drawBar("capacity");
