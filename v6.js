/* ============================================================
   v6.js — Visualización animada del llenado (V6)
   ------------------------------------------------------------
   V6 usa exactamente la misma lógica que V5 (sensor, calibración,
   presión proporcional a la capacidad). v5.js llama a
   window.V6Stadium.update(ocupación, estadio) en cada lectura y
   este módulo solo dibuja:
     - un estadio en perspectiva con la cancha pintada,
     - hinchas que aparecen fila por fila (de abajo hacia arriba),
     - focos que se encienden con la ocupación,
     - al llenarse: ola, confeti, flashes, temblor y cartel.
   ============================================================ */
(() => {
  const canvas = document.getElementById('v6-canvas');
  const banner = document.getElementById('v6-banner');
  const view = document.getElementById('v5-view');
  if (!canvas || !view) return;
  const ctx = canvas.getContext('2d');

  // ----- Geometría (unidades "planas"; la cancha mide 2 × 1,3) -----
  const SQ = 0.6;          // aplastamiento vertical (cámara inclinada)
  const H = 0.55;          // cuánto sube en pantalla una unidad de altura
  const INNER = { rx: 1.3, ry: 1.0 };   // borde interior de las tribunas
  const OUTER = { rx: 1.95, ry: 1.58 }; // borde exterior
  const TOP_Z = 0.2;       // altura de la última fila
  const ROWS = 12;
  const SPACING = 0.064;
  const FAN_COLORS = ['#f3bd59', '#ee5849', '#ffffff', '#5aa9e6', '#f08a3c', '#ffd34e', '#e9e3d0', '#c84a5e'];
  const SEAT_COLORS = ['#2f4a63', '#5a2f3a'];
  const SKIN = ['#f1c9a5', '#d7a17b', '#a8714f', '#7a4e33'];

  let W = 0, Hpx = 0, s = 1, cx = 0, cy = 0, dpr = 1;
  let seats = [];
  let occupancy = 0;       // 0..100 objetivo
  let shown = 0;           // 0..100 suavizado (anima la aparición)
  let full = false, fullSince = 0;
  let confetti = [];
  let flashes = [];
  let raf = null;
  let lastT = 0;

  // Proyección de un punto (x, y en el plano; z altura) a píxeles.
  const P = (x, y, z = 0) => [cx + x * s, cy + (y * SQ - z * H) * s];

  // Pseudoaleatorio determinista: el orden de llenado no cambia entre recargas.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

  function buildSeats() {
    seats = [];
    for (let r = 0; r < ROWS; r++) {
      const t = (r + 0.5) / ROWS;
      const rx = INNER.rx + 0.06 + t * (OUTER.rx - INNER.rx - 0.1);
      const ry = INNER.ry + 0.06 + t * (OUTER.ry - INNER.ry - 0.1);
      const z = t * TOP_Z;
      const perimeter = 2 * Math.PI * Math.sqrt((rx * rx + ry * ry) / 2);
      const n = Math.round(perimeter / SPACING);
      for (let i = 0; i < n; i++) {
        const a = (i + (r % 2) * 0.5) / n * Math.PI * 2;
        // Sectores de asientos de dos colores, como en un estadio real.
        const sector = Math.floor(((a / (Math.PI * 2)) * 16 + 0.5)) % 2;
        seats.push({
          x: Math.cos(a) * rx, y: Math.sin(a) * ry, z, a, row: t,
          seat: SEAT_COLORS[sector],
          shirt: FAN_COLORS[Math.floor(rnd() * FAN_COLORS.length)],
          skin: SKIN[Math.floor(rnd() * SKIN.length)],
          // Se llenan primero las filas bajas, con algo de azar.
          rank: t * 0.6 + rnd() * 0.4,
          since: -1,
        });
      }
    }
    // Orden de llenado y orden de dibujo (de atrás hacia adelante).
    [...seats].sort((p, q) => p.rank - q.rank).forEach((st, i) => { st.order = i; });
    seats.sort((p, q) => p.y - q.y);
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = rect.width;
    Hpx = rect.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(Hpx * dpr);
    s = Math.min(W / 4.3, Hpx / 2.25);
    cx = W / 2;
    cy = Hpx / 2 + 0.16 * s;
  }

  // ---------- Dibujo ----------
  function ringPath(rx, ry, z) {
    ctx.beginPath();
    for (let i = 0; i <= 72; i++) {
      const a = i / 72 * Math.PI * 2;
      const [px, py] = P(Math.cos(a) * rx, Math.sin(a) * ry, z);
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
  }

  function poly(points, z = 0) {
    ctx.beginPath();
    points.forEach(([x, y], i) => { const [px, py] = P(x, y, z); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
  }

  function ellipseOnPitch(x0, y0, r, from = 0, to = Math.PI * 2) {
    ctx.beginPath();
    for (let i = 0; i <= 40; i++) {
      const a = from + (to - from) * i / 40;
      const [px, py] = P(x0 + Math.cos(a) * r, y0 + Math.sin(a) * r);
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
  }

  function drawBowl(light) {
    // Estructura exterior (techo/borde) y superficie de las tribunas.
    ringPath(OUTER.rx + 0.06, OUTER.ry + 0.06, TOP_Z + 0.07);
    ctx.fillStyle = '#4c5a53';
    ctx.fill();
    ringPath(OUTER.rx, OUTER.ry, TOP_Z);
    const g = ctx.createLinearGradient(0, cy - 1.2 * s, 0, cy + s);
    g.addColorStop(0, '#26352f');
    g.addColorStop(1, '#3b4a43');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = Math.max(2, s * 0.025);
    ctx.strokeStyle = `rgba(200,210,205,${0.35 + light * 0.4})`;
    ringPath(OUTER.rx + 0.06, OUTER.ry + 0.06, TOP_Z + 0.07);
    ctx.stroke();
  }

  function drawPitch(light) {
    // Pasto alrededor de la cancha.
    ringPath(INNER.rx, INNER.ry, 0);
    ctx.fillStyle = '#1d5a37';
    ctx.fill();
    ctx.save();
    ringPath(INNER.rx, INNER.ry, 0);
    ctx.clip();
    // Franjas de corte del pasto.
    const L = 1.0, B = 0.65, bands = 14;
    for (let i = 0; i < bands; i++) {
      const x0 = -L + (2 * L) * i / bands, x1 = -L + (2 * L) * (i + 1) / bands;
      poly([[x0, -B], [x1, -B], [x1, B], [x0, B]]);
      ctx.fillStyle = i % 2 ? '#2f8a4f' : '#287a45';
      ctx.fill();
    }
    // Iluminación de los focos sobre el pasto.
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 1.4 * s);
    glow.addColorStop(0, `rgba(255,255,230,${0.05 + light * 0.18})`);
    glow.addColorStop(1, 'rgba(255,255,230,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, Hpx);
    ctx.restore();

    // Líneas de la cancha.
    ctx.strokeStyle = 'rgba(255,255,255,.85)';
    ctx.lineWidth = Math.max(1, s * 0.008);
    ctx.lineJoin = 'round';
    poly([[-L, -B], [L, -B], [L, B], [-L, B]]); ctx.closePath(); ctx.stroke();
    poly([[0, -B], [0, B]]); ctx.stroke();
    ellipseOnPitch(0, 0, 0.175); ctx.stroke();
    for (const side of [-1, 1]) {
      poly([[side * L, -0.39], [side * (L - 0.31), -0.39], [side * (L - 0.31), 0.39], [side * L, 0.39]]); ctx.stroke();
      poly([[side * L, -0.18], [side * (L - 0.1), -0.18], [side * (L - 0.1), 0.18], [side * L, 0.18]]); ctx.stroke();
      ellipseOnPitch(side * (L - 0.21), 0, 0.175, side > 0 ? Math.PI * 0.72 : -Math.PI * 0.28, side > 0 ? Math.PI * 1.28 : Math.PI * 0.28);
      ctx.stroke();
      // Arcos (con altura).
      const [a1x, a1y] = P(side * L, -0.07, 0), [a2x, a2y] = P(side * L, 0.07, 0);
      const [b1x, b1y] = P(side * L, -0.07, 0.05), [b2x, b2y] = P(side * L, 0.07, 0.05);
      ctx.beginPath(); ctx.moveTo(a1x, a1y); ctx.lineTo(b1x, b1y); ctx.lineTo(b2x, b2y); ctx.lineTo(a2x, a2y);
      ctx.lineWidth = Math.max(1.5, s * 0.012); ctx.stroke(); ctx.lineWidth = Math.max(1, s * 0.008);
    }
    const [sx, sy] = P(0, 0);
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(sx, sy, Math.max(1.5, s * 0.01), 0, Math.PI * 2); ctx.fill();
  }

  function drawBoards(t) {
    // Publicidad LED alrededor de la cancha (se anima un poco).
    ctx.lineWidth = Math.max(2, s * 0.018);
    for (let i = 0; i < 36; i++) {
      const a0 = i / 36 * Math.PI * 2, a1 = (i + 0.85) / 36 * Math.PI * 2;
      const [x0, y0] = P(Math.cos(a0) * INNER.rx, Math.sin(a0) * INNER.ry, 0.015);
      const [x1, y1] = P(Math.cos(a1) * INNER.rx, Math.sin(a1) * INNER.ry, 0.015);
      const hue = (i * 40 + t * 0.05) % 360;
      ctx.strokeStyle = `hsla(${hue},70%,60%,.75)`;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
  }

  function drawLights(light, t) {
    // Cuatro torres de iluminación en las esquinas.
    const flicker = full ? 0.85 + 0.15 * Math.sin(t / 60) : 1;
    for (const a of [-0.7, -2.44, 0.7, 2.44]) {
      const x = Math.cos(a) * (OUTER.rx + 0.12), y = Math.sin(a) * (OUTER.ry + 0.12);
      const [bx, by] = P(x, y, TOP_Z);
      const [tx, ty] = P(x, y, TOP_Z + 0.42);
      ctx.strokeStyle = '#6d7a73';
      ctx.lineWidth = Math.max(2, s * 0.014);
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.fillStyle = light > 0.02 ? '#fffbe6' : '#56625c';
      ctx.fillRect(tx - s * 0.06, ty - s * 0.03, s * 0.12, s * 0.05);
      if (light > 0.02) {
        const r = s * (0.3 + light * 0.35);
        const g = ctx.createRadialGradient(tx, ty, 0, tx, ty, r);
        g.addColorStop(0, `rgba(255,248,215,${(0.25 + light * 0.55) * flicker})`);
        g.addColorStop(1, 'rgba(255,248,215,0)');
        ctx.fillStyle = g;
        ctx.fillRect(tx - r, ty - r, r * 2, r * 2);
      }
    }
  }

  const easeOutBack = x => 1 + 2.7 * Math.pow(x - 1, 3) + 1.7 * Math.pow(x - 1, 2);

  function drawSeats(t) {
    const nOcc = Math.round(shown / 100 * seats.length);
    const base = Math.max(1.6, s * 0.0158);
    const wavePos = full ? ((t - fullSince) / 1000) * 2.4 : null; // radianes recorridos por la ola
    for (const st of seats) {
      const [px, py] = P(st.x, st.y, st.z);
      const depth = 0.85 + 0.3 * ((st.y / OUTER.ry) + 1) / 2;   // más grande adelante
      const r = base * depth;
      const occupied = st.order < nOcc;
      if (!occupied) {
        st.since = -1;
        ctx.fillStyle = st.seat;
        ctx.fillRect(px - r, py - r * 0.6, r * 2, r * 1.2);
        continue;
      }
      if (st.since < 0) st.since = t;
      const k = Math.min(1, (t - st.since) / 280);
      const pop = Math.max(0, easeOutBack(k));
      // La ola: una franja que recorre el estadio en ángulo.
      let lift = 0;
      if (wavePos !== null) {
        const d = Math.cos(st.a - wavePos);
        lift = Math.pow(Math.max(0, d), 14);
      }
      const yOff = -lift * r * 2.6;
      ctx.fillStyle = st.shirt;
      ctx.beginPath();
      ctx.arc(px, py + yOff, r * pop, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = st.skin;
      ctx.beginPath();
      ctx.arc(px, py + yOff - r * 1.05 * pop, r * 0.62 * pop, 0, Math.PI * 2);
      ctx.fill();
      if (lift > 0.35) {
        // Brazos arriba durante la ola.
        ctx.strokeStyle = st.skin;
        ctx.lineWidth = Math.max(1, r * 0.45);
        ctx.beginPath();
        ctx.moveTo(px - r * 0.8, py + yOff - r * 0.4); ctx.lineTo(px - r * 1.2, py + yOff - r * 2.1);
        ctx.moveTo(px + r * 0.8, py + yOff - r * 0.4); ctx.lineTo(px + r * 1.2, py + yOff - r * 2.1);
        ctx.stroke();
      }
    }
  }

  function spawnConfetti() {
    confetti = [];
    for (let i = 0; i < 220; i++) {
      confetti.push({
        x: Math.random() * W, y: -Math.random() * Hpx * 0.8,
        vx: (Math.random() - 0.5) * 1.2, vy: 1.2 + Math.random() * 2.2,
        rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.25,
        w: 4 + Math.random() * 5, h: 2 + Math.random() * 3,
        color: FAN_COLORS[i % FAN_COLORS.length], sway: Math.random() * Math.PI * 2,
      });
    }
  }

  function drawConfetti(t) {
    for (const c of confetti) {
      c.sway += 0.05;
      c.x += c.vx + Math.sin(c.sway) * 0.6;
      c.y += c.vy;
      c.rot += c.vr;
      // Mientras siga lleno, el confeti vuelve a caer desde arriba.
      if (c.y > Hpx + 10 && full && t - fullSince < 6000) { c.y = -10; c.x = Math.random() * W; }
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot);
      ctx.fillStyle = c.color;
      ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h * Math.abs(Math.cos(c.rot * 2)) + 0.5);
      ctx.restore();
    }
    confetti = confetti.filter(c => c.y < Hpx + 20);
  }

  function drawFlashes(t) {
    // Flashes de cámaras en las tribunas.
    if (full && Math.random() < 0.6) {
      const st = seats[Math.floor(Math.random() * seats.length)];
      flashes.push({ st, born: t });
    }
    flashes = flashes.filter(f => t - f.born < 260);
    for (const f of flashes) {
      const [px, py] = P(f.st.x, f.st.y, f.st.z);
      const k = 1 - (t - f.born) / 260;
      const r = s * 0.05 * k;
      const g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, `rgba(255,255,255,${k})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(px - r, py - r, r * 2, r * 2);
    }
  }

  function frame(t) {
    raf = null;
    if (view.hidden || !view.classList.contains('is-v6') || document.hidden) { lastT = 0; return; }
    if (!W) { resize(); if (!W) { raf = requestAnimationFrame(frame); return; } }
    // Suaviza la ocupación mostrada para que los hinchas aparezcan en cascada
    // (basado en tiempo, no en cuadros: igual de rápido en cualquier equipo).
    const dt = lastT ? Math.min(100, t - lastT) : 16;
    lastT = t;
    shown += (occupancy - shown) * (1 - Math.exp(-dt / 140));
    if (Math.abs(occupancy - shown) < 0.05) shown = occupancy;
    const light = shown / 100;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, Hpx);
    // Temblor del estadio al llenarse (decae en ~0,8 s).
    const shakeK = full ? Math.max(0, 1 - (t - fullSince) / 800) : 0;
    if (shakeK > 0) ctx.translate((Math.random() - 0.5) * 10 * shakeK, (Math.random() - 0.5) * 8 * shakeK);

    drawLights(light, t);
    drawBowl(light);
    drawPitch(light);
    drawBoards(t);
    drawSeats(t);
    drawFlashes(t);
    if (confetti.length) drawConfetti(t);

    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function update(pct, stadium) {
    occupancy = Math.max(0, Math.min(100, Number(pct) || 0));
    const nowFull = occupancy >= 100;
    if (nowFull && !full) {
      fullSince = performance.now();
      spawnConfetti();
    }
    full = nowFull;
    if (banner) banner.hidden = !full;
    view.classList.toggle('v6-full', full);
    start();
  }

  buildSeats();
  new ResizeObserver(() => { resize(); start(); }).observe(canvas);
  document.addEventListener('visibilitychange', start);
  // Al cambiar a V6 (v5.js agrega la clase is-v6) arranca la animación.
  new MutationObserver(start).observe(view, { attributes: true, attributeFilter: ['class', 'hidden'] });

  // settle(): salta la transición (útil para probar desde la consola).
  window.V6Stadium = { update, settle: () => { shown = occupancy; start(); } };
})();
