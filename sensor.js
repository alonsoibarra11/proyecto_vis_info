(() => {
  const $ = id => document.getElementById(id);
  const ZONA_MUERTA = 8;
  const SUAVIZADO = 0.5;
  const UMBRAL = 1;
  // Capacidad que equivale al tope físico del montaje (estadio más grande del
  // dataset). El computador envía el valor real junto con el estadio elegido.
  let maxCap = 132000;
  let betaActual = null;
  let betaReposo = null;
  let betaMaximo = null;
  let presionSuavizada = 0;
  let presionAnterior = null;
  let presion = 0;
  // Estadio elegido en el computador: { nombre, capacidad, requerido (0..1) }.
  let estadio = null;

  const fmt = n => Math.round(n).toLocaleString('es');
  const requerido = () => (estadio ? estadio.requerido : 1);
  const ocupacion = () => Math.min(100, presion / (requerido() * 100) * 100);

  function send(value) {
    // Protobject expone un identificador global; no necesariamente cuelga de
    // window como propiedad, por eso se consulta el nombre global directamente.
    if (typeof Protobject !== 'undefined' && Protobject.Core) {
      Protobject.Core.send(value).to('index.html');
    }
  }

  // Grados de inclinación (desde el reposo) que corresponden a una fracción
  // del recorrido, considerando la zona muerta inicial.
  function gradosPara(fraccion) {
    if (betaReposo === null || betaMaximo === null) return null;
    const rango = Math.abs(betaMaximo - betaReposo);
    return rango * (ZONA_MUERTA + fraccion * (100 - ZONA_MUERTA)) / 100;
  }

  function pintarMeta() {
    const req = requerido();
    const reqPct = Math.round(req * 100);
    $('calibrate-max').textContent = `PASO 2 · TOPE FÍSICO (= ${fmt(maxCap)} personas)`;
    $('sensor-target').style.bottom = reqPct + '%';
    if (!estadio) {
      $('target-name').textContent = 'Elige un estadio en el computador';
      $('target-capacity').textContent = '';
      $('target-goal').textContent = `El tope del montaje equivale a ${fmt(maxCap)} personas.`;
      return;
    }
    $('target-name').textContent = estadio.nombre;
    $('target-capacity').textContent = `Capacidad: ${fmt(estadio.capacidad)} personas`;
    const grados = gradosPara(req);
    const gradosTxt = grados === null ? '' : ` (≈ ${grados.toFixed(1)}° de inclinación)`;
    $('target-goal').innerHTML =
      `Para llenarlo presiona hasta <b>${reqPct}%</b> del recorrido${gradosTxt}.` +
      `<br><small>Más capacidad → más fuerza. El tope (100%) = ${fmt(maxCap)} personas.</small>`;
  }

  function pintarLectura() {
    const occ = Math.round(ocupacion());
    $('sensor-value').textContent = occ + '%';
    $('sensor-bar').style.height = Math.min(100, presion) + '%';
    const personas = estadio ? ` · ${fmt(occ * estadio.capacidad / 100)} personas` : '';
    $('sensor-pressure').textContent = `Presión: ${Math.round(presion)}% del recorrido${personas}`;
  }

  function actualizar(event) {
    if (event.beta === null || !Number.isFinite(event.beta)) return;
    betaActual = event.beta;
    $('calibrate-rest').disabled = false;
    if (betaReposo === null || betaMaximo === null) {
      $('sensor-value').textContent = '—';
      $('sensor-state').textContent = 'Sensor activo · completa los dos pasos de calibración.';
      return;
    }

    const rango = betaMaximo - betaReposo;
    if (Math.abs(rango) < 3) return;
    const pctCrudo = Math.max(0, Math.min(100, (betaActual - betaReposo) / rango * 100));
    const pctConZonaMuerta = pctCrudo <= ZONA_MUERTA
      ? 0
      : (pctCrudo - ZONA_MUERTA) / (100 - ZONA_MUERTA) * 100;
    presionSuavizada = presionSuavizada * SUAVIZADO + pctConZonaMuerta * (1 - SUAVIZADO);
    presion = Math.round(presionSuavizada * 10) / 10;
    pintarLectura();

    if (presionAnterior === null || Math.abs(presion - presionAnterior) >= UMBRAL || (presion === 0 && presionAnterior !== 0)) {
      presionAnterior = presion;
      // Se envía la presión cruda; el computador la convierte en ocupación
      // según la capacidad del estadio elegido.
      send(presion);
    }
  }

  function reiniciarLectura() {
    presionSuavizada = 0;
    presionAnterior = null;
    presion = 0;
    pintarLectura();
  }

  // Mensajes del computador (config.js registra este receptor en Protobject).
  window.handleV5ProtobjectMessage = message => {
    if (!message || message.tipo !== 'estadio') return;
    const capacidad = Number(message.capacidad);
    const req = Number(message.requerido);
    if (!Number.isFinite(capacidad) || !(req > 0)) return;
    if (Number(message.maxCap) > 0) maxCap = Number(message.maxCap);
    estadio = { nombre: String(message.nombre || 'Estadio'), capacidad, requerido: Math.min(1, req) };
    pintarMeta();
    pintarLectura();
  };

  window.addEventListener('deviceorientation', actualizar, true);
  window.addEventListener('deviceorientationabsolute', actualizar, true);

  $('calibrate-rest').addEventListener('click', () => {
    if (betaActual === null) { $('sensor-calibration').textContent = 'Esperando lectura del sensor… mueve ligeramente el teléfono.'; return; }
    betaReposo = betaActual;
    betaMaximo = null;
    reiniciarLectura();
    $('calibrate-max').disabled = false;
    $('sensor-state').textContent = 'Reposo guardado (0 personas).';
    $('sensor-calibration').textContent = `Ahora presiona el globo hasta el TOPE del montaje y toca el paso 2. Ese tope equivale al estadio más grande (${fmt(maxCap)} personas).`;
    pintarMeta();
    send(0);
  });

  $('calibrate-max').addEventListener('click', () => {
    if (betaActual === null) { $('sensor-calibration').textContent = 'Esperando lectura del sensor…'; return; }
    if (betaReposo === null) { $('sensor-calibration').textContent = 'Primero completa el paso 1.'; return; }
    if (Math.abs(betaActual - betaReposo) < 3) {
      $('sensor-calibration').textContent = 'El ángulo casi no cambió. Reinicia y presiona el globo con más fuerza.';
      return;
    }
    betaMaximo = betaActual;
    reiniciarLectura();
    $('sensor-state').textContent = 'Calibración lista · aprieta el globo';
    $('sensor-calibration').textContent = 'La línea oscura del medidor marca la presión necesaria para llenar el estadio elegido.';
    $('calibrate-max').disabled = true;
    pintarMeta();
  });

  $('calibrate-reset').addEventListener('click', () => {
    betaReposo = betaMaximo = null;
    reiniciarLectura();
    $('calibrate-max').disabled = true;
    $('sensor-value').textContent = '0%';
    $('sensor-state').textContent = 'Calibración reiniciada.';
    $('sensor-calibration').textContent = 'Con el globo sin apretar, toca el paso 1.';
    pintarMeta();
    send(0);
  });

  pintarMeta();
})();
