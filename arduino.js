/* ============================================================
   arduino.js — Fisicalización del GOOOOL con un servo
   ------------------------------------------------------------
   La plataforma de la maqueta "tiembla" moviendo un servo de un
   lado a otro. La VELOCIDAD del temblor es proporcional a la
   intensidad del estadio (aforo + tamaño), tal como en el patrón
   de la figura de referencia:

       const speed = Math.round(scale(m, 5, 9, 600, 1500));
       ...send({ speed }) ... ; setTimeout(() => send({ speed: 0 }), 4000);

   Aquí lo hacemos con la Web Serial API (Chrome/Edge), enviando
   líneas de texto por USB al Arduino:

       "S<valor>\n"   valor 0..180  → ángulo/velocidad objetivo del servo
       "X\n"          detener (centro / reposo)

   El módulo NO conoce nada del mapa ni del audio: solo escucha
   los eventos del StadiumBus que publica app.js.
     - "goal:start" { intensity, durationMs } → arranca el temblor
     - "goal:level" { level }                 → (opcional) sigue el audio
     - "goal:stop"                            → detiene el servo
   ============================================================ */

(function () {
  "use strict";

  // ----- Config -----
  const BAUD_RATE = 9600;
  // Cuando FOLLOW_AUDIO es true, la amplitud del temblor sigue el
  // nivel de audio en vivo. Si es false, usa solo la intensidad del
  // estadio (más parecido al ejemplo de la figura, más estable).
  const FOLLOW_AUDIO = true;

  // ----- Estado de la conexión serial -----
  let port = null;
  let writer = null;
  let connected = false;

  // ----- Estado del "temblor" -----
  let shakeRAF = null;      // bucle de animación del vaivén
  let currentAmp = 0;       // 0..1 amplitud actual del temblor
  let targetAmp = 0;        // 0..1 amplitud objetivo (suavizada)
  let shakeHz = 6;          // frecuencia del vaivén (osc. por segundo)
  let lastSentAngle = -1;   // para no saturar el puerto con valores repetidos
  let lastSendTime = 0;

  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const scale = (x, inMin, inMax, outMin, outMax) =>
    outMin + ((x - inMin) / (inMax - inMin)) * (outMax - outMin);

  // ============================================================
  //  Conexión Web Serial (requiere gesto del usuario: un click)
  // ============================================================
  async function connect() {
    if (!("serial" in navigator)) {
      updateStatus("⚠️ Web Serial no disponible (usa Chrome/Edge por HTTPS o localhost).", true);
      return false;
    }
    try {
      port = await navigator.serial.requestPort();      // el usuario elige el puerto
      await port.open({ baudRate: BAUD_RATE });
      writer = port.writable.getWriter();
      connected = true;
      updateStatus("🔌 Arduino conectado.");
      // Posición de reposo.
      await sendAngle(90);
      return true;
    } catch (err) {
      updateStatus("❌ No se pudo conectar al Arduino: " + err.message, true);
      connected = false;
      return false;
    }
  }

  async function disconnect() {
    stopShake();
    try {
      if (writer) { await sendAngle(90); writer.releaseLock(); }
      if (port) await port.close();
    } catch (_) { /* noop */ }
    writer = null;
    port = null;
    connected = false;
    updateStatus("🔌 Arduino desconectado.");
  }

  // Envía un ángulo (0..180) como línea "S<ang>\n".
  async function sendAngle(angle) {
    if (!connected || !writer) return;
    const a = Math.round(clamp01(angle / 180) * 180);
    // Evita spamear el puerto: como mucho ~50 mensajes/seg y solo si cambia.
    const now = performance.now();
    if (a === lastSentAngle && now - lastSendTime < 20) return;
    lastSentAngle = a;
    lastSendTime = now;
    try {
      await writer.write(new TextEncoder().encode("S" + a + "\n"));
    } catch (err) {
      updateStatus("❌ Error enviando al Arduino: " + err.message, true);
    }
  }

  async function sendStop() {
    if (!connected || !writer) return;
    try {
      await writer.write(new TextEncoder().encode("X\n"));
    } catch (_) { /* noop */ }
  }

  // ============================================================
  //  Motor del "temblor": vaivén del servo alrededor de 90°
  //  amplitud (grados) y velocidad (Hz) derivadas de la intensidad.
  // ============================================================
  function startShake(intensity) {
    // La intensidad (0..1) marca la agresividad del sismo.
    // Frecuencia del vaivén: 4..10 Hz. Amplitud máx: 15..60°.
    shakeHz = scale(clamp01(intensity), 0, 1, 4, 10);
    targetAmp = clamp01(intensity);
    if (!FOLLOW_AUDIO) currentAmp = targetAmp;

    if (shakeRAF) return; // ya corriendo
    const t0 = performance.now();
    const loop = (t) => {
      const secs = (t - t0) / 1000;
      // Suavizado de amplitud hacia el objetivo (evita saltos bruscos).
      currentAmp += (targetAmp - currentAmp) * 0.15;
      const maxDeg = scale(clamp01(intensity), 0, 1, 15, 60);
      const deg = Math.sin(secs * shakeHz * 2 * Math.PI) * maxDeg * currentAmp;
      sendAngle(90 + deg);
      shakeRAF = requestAnimationFrame(loop);
    };
    shakeRAF = requestAnimationFrame(loop);
  }

  function stopShake() {
    if (shakeRAF) { cancelAnimationFrame(shakeRAF); shakeRAF = null; }
    currentAmp = 0;
    targetAmp = 0;
    sendAngle(90);   // vuelve al centro
    sendStop();
  }

  // ============================================================
  //  Puente con el StadiumBus (lo publica app.js)
  // ============================================================
  function wireBus() {
    const bus = window.StadiumBus;
    if (!bus) {
      console.warn("[arduino] StadiumBus no encontrado; ¿se cargó app.js antes?");
      return;
    }

    bus.addEventListener("goal:start", (e) => {
      const { intensity } = e.detail;
      if (connected) startShake(intensity);
    });

    // Si seguimos el audio, la amplitud del temblor late con el sonido.
    bus.addEventListener("goal:level", (e) => {
      if (!connected || !FOLLOW_AUDIO) return;
      targetAmp = clamp01(e.detail.level);
    });

    bus.addEventListener("goal:stop", () => {
      if (connected) stopShake();
    });
  }

  // ============================================================
  //  UI mínima: botón conectar/desconectar + estado
  // ============================================================
  function updateStatus(msg, isError) {
    const el = document.getElementById("arduino-status");
    if (el) {
      el.textContent = msg;
      el.classList.toggle("error", !!isError);
    }
    if (isError) console.warn("[arduino]", msg);
    else console.log("[arduino]", msg);
  }

  function wireButton() {
    const btn = document.getElementById("btn-arduino");
    if (!btn) return;
    btn.addEventListener("click", async () => {
      if (connected) {
        await disconnect();
        btn.textContent = "🔌 Conectar Arduino";
      } else {
        const ok = await connect();
        if (ok) btn.textContent = "⏏️ Desconectar Arduino";
      }
    });
  }

  // ----- Init -----
  window.addEventListener("DOMContentLoaded", () => {
    wireBus();
    wireButton();
    if (!("serial" in navigator)) {
      updateStatus("Web Serial no soportado en este navegador.", true);
    }
  });

  // Exponer una pequeña API por si se quiere controlar desde consola.
  window.ArduinoBridge = { connect, disconnect, startShake, stopShake, sendAngle };
})();
