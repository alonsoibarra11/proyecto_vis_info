/* ============================================================
   Estadios del mundo — mapa sonoro
   - Plotly scattergeo para el mapa
   - Plotly bar para el ranking (capacidad / área)
   - Tone.js para sintetizar un cántico de barra brava
   ============================================================ */

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
//  SONIDO — Barra brava sintetizada con Tone.js
// ============================================================
let audioReady = false;
let crowdNoise, crowdFilter, crowdGain;   // rugido de multitud (ruido filtrado)
let kick, kickGain;                        // bombo de la hinchada
let chantSynth, chantGain;                 // coro "oh oh oh"
let reverb, masterGain;
let currentLoop = null;
let stopTimer = null;

async function initAudio() {
  if (audioReady) return;
  await Tone.start();

  masterGain = new Tone.Gain(0.9).toDestination();
  reverb = new Tone.Reverb({ decay: 2.6, wet: 0.28 }).connect(masterGain);

  // --- Rugido de multitud: ruido rosa a través de un filtro pasa-banda que se mueve ---
  crowdGain = new Tone.Gain(0).connect(reverb);
  crowdFilter = new Tone.Filter({ type: "bandpass", frequency: 700, Q: 0.6 }).connect(crowdGain);
  crowdNoise = new Tone.Noise("pink").connect(crowdFilter);
  crowdNoise.start();
  // LFO para dar "oleaje" al murmullo del público
  const crowdLFO = new Tone.LFO({ frequency: 0.35, min: 450, max: 1100 }).start();
  crowdLFO.connect(crowdFilter.frequency);

  // --- Bombo de la barra ---
  kickGain = new Tone.Gain(0).connect(reverb);
  kick = new Tone.MembraneSynth({
    pitchDecay: 0.04,
    octaves: 6,
    envelope: { attack: 0.001, decay: 0.32, sustain: 0.01, release: 0.4 }
  }).connect(kickGain);

  // --- Coro "oh oh oh" (cántico) ---
  // filtro pasa-bajos para que las voces suenen más "corales" y menos ásperas
  const chantFilter = new Tone.Filter(1200, "lowpass").connect(reverb);
  chantGain = new Tone.Gain(0).connect(chantFilter);
  chantSynth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "sawtooth" },
    envelope: { attack: 0.08, decay: 0.2, sustain: 0.6, release: 0.5 }
  }).connect(chantGain);

  audioReady = true;
}

// Notas del cántico (melodía tipo "dale dale dale... oh oh oh")
const CHANT_NOTES = ["C3", "C3", "D3", "E3", "E3", "D3", "C3", "G2"];

function stopAllSound(fast = true) {
  if (!audioReady) return;
  if (currentLoop) { currentLoop.stop(); currentLoop.dispose(); currentLoop = null; }
  if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
  const t = fast ? 0.15 : 0.4;
  crowdGain.gain.rampTo(0, t);
  kickGain.gain.rampTo(0, t);
  chantGain.gain.rampTo(0, t);
  Tone.Transport.stop();
  Tone.Transport.cancel();
}

async function playChant(stadium) {
  await initAudio();
  stopAllSound(true);

  const intensity = intensityOf(stadium); // 0..1
  // La intensidad controla volúmenes y densidad rítmica.
  const crowdVol = 0.12 + intensity * 0.45;   // murmullo base
  const kickVol  = 0.25 + intensity * 0.75;   // fuerza del bombo
  const chantVol = 0.15 + intensity * 0.55;   // fuerza del coro

  // Tempo: los estadios más grandes suenan más "épicos" y con más pulso.
  Tone.Transport.bpm.value = 96 + Math.round(intensity * 40); // 96..136

  crowdGain.gain.rampTo(crowdVol, 0.4);
  kickGain.gain.rampTo(kickVol, 0.2);
  chantGain.gain.rampTo(chantVol, 0.3);

  let step = 0;
  currentLoop = new Tone.Loop((time) => {
    const idx = step % CHANT_NOTES.length;

    // Bombo en cada pulso; doble golpe en estadios muy intensos.
    kick.triggerAttackRelease("C1", "8n", time);
    if (intensity > 0.6) {
      kick.triggerAttackRelease("C1", "16n", time + Tone.Time("8n").toSeconds());
    }

    // Coro: acorde en cada nota del cántico.
    const root = CHANT_NOTES[idx];
    const chord = [root];
    if (intensity > 0.4) chord.push(Tone.Frequency(root).transpose(7).toNote()); // quinta
    if (intensity > 0.75) chord.push(Tone.Frequency(root).transpose(12).toNote()); // octava
    chantSynth.triggerAttackRelease(chord, "4n", time + 0.02);

    step++;
  }, "4n").start(0);

  Tone.Transport.start();

  // El cántico dura un rato y se apaga solo (loop de ~ 6 s + fade).
  stopTimer = setTimeout(() => stopAllSound(false), 6000);

  document.getElementById("now-playing").textContent =
    `🔊 Sonando: ${stadium.name} — ${stadium.city}, ${stadium.country} · ` +
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
          if (pt) playChant(STADIUMS[pt.pointIndex]);
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
        if (pt && pt.customdata) playChant(pt.customdata);
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
