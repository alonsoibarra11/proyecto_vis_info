(() => {
  const $ = id => document.getElementById(id);
  const ZONA_MUERTA = 8;
  const SUAVIZADO = 0.5;
  const UMBRAL = 2;
  let betaActual = null;
  let betaReposo = null;
  let betaMaximo = null;
  let intensidadSuavizada = 0;
  let intensidadAnterior = null;

  function send(value) {
    if (window.Protobject?.Core) Protobject.Core.send(value).to('index.html');
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
    intensidadSuavizada = intensidadSuavizada * SUAVIZADO + pctConZonaMuerta * (1 - SUAVIZADO);
    const intensidad = Math.round(intensidadSuavizada);
    $('sensor-value').textContent = intensidad + '%';
    $('sensor-bar').style.height = intensidad + '%';

    if (intensidadAnterior === null || Math.abs(intensidad - intensidadAnterior) >= UMBRAL) {
      intensidadAnterior = intensidad;
      send(intensidad);
    }
  }

  window.addEventListener('deviceorientation', actualizar, true);
  window.addEventListener('deviceorientationabsolute', actualizar, true);

  $('calibrate-rest').addEventListener('click', () => {
    if (betaActual === null) { $('sensor-calibration').textContent = 'Esperando lectura del sensor… mueve ligeramente el teléfono.'; return; }
    betaReposo = betaActual;
    betaMaximo = null;
    intensidadSuavizada = 0;
    intensidadAnterior = null;
    $('calibrate-max').disabled = false;
    $('sensor-value').textContent = '0%';
    $('sensor-bar').style.height = '0%';
    $('sensor-state').textContent = 'Reposo guardado.';
    $('sensor-calibration').textContent = 'Ahora presiona el globo al máximo y toca el paso 2.';
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
    intensidadSuavizada = 0;
    intensidadAnterior = null;
    $('sensor-state').textContent = 'Calibración lista · aprieta el globo';
    $('sensor-calibration').textContent = 'Aprieta con distinta fuerza. Recalibra si cambias el montaje.';
    $('calibrate-max').disabled = true;
  });

  $('calibrate-reset').addEventListener('click', () => {
    betaReposo = betaMaximo = null;
    intensidadSuavizada = 0;
    intensidadAnterior = null;
    $('calibrate-max').disabled = true;
    $('sensor-value').textContent = '0%';
    $('sensor-bar').style.height = '0%';
    $('sensor-state').textContent = 'Calibración reiniciada.';
    $('sensor-calibration').textContent = 'Con el globo sin apretar, toca el paso 1.';
    send(0);
  });
})();
