(() => {
  const $ = id => document.getElementById(id);
  const view = $('v5-view');
  const selector = $('v5-stadium');
  let stadium = STADIUMS[0], wasFull = false, audioPrimed = false;
  // El tope físico del montaje (100 % de presión) equivale al estadio más
  // grande: la misma fuerza representa siempre la misma cantidad de personas,
  // así que un estadio chico se llena con menos presión que uno grande.
  const MAX_CAP = Math.max(...STADIUMS.map(s => s.capacity));
  const fmt = n => Math.round(n).toLocaleString('es');
  const requerido = (s = stadium) => s.capacity / MAX_CAP;
  let presion = 0, ultimoEnvio = 0;

  // Envía al teléfono el estadio elegido para que su pantalla de calibración
  // muestre cuánto hay que presionar. Usa el canal existente de Protobject.
  function enviarEstadioAlTelefono() {
    if (typeof Protobject === 'undefined' || !Protobject.Core) return;
    try {
      Protobject.Core.send({
        tipo: 'estadio', nombre: stadium.name, capacidad: stadium.capacity,
        requerido: requerido(), maxCap: MAX_CAP
      }).to('sensor.html');
      ultimoEnvio = Date.now();
    } catch (_) { /* el teléfono aún no está conectado */ }
  }
  selector.replaceChildren();
  [...STADIUMS].sort((a, b) => a.name.localeCompare(b.name, 'es')).forEach(s => {
    selector.add(new Option(`${s.name} · ${s.city}`, String(STADIUMS.indexOf(s))));
  });
  const seats = $('v5-seats');
  for (let i = 0; i < 180; i++) { const seat = document.createElement('i'); seats.append(seat); }
  function selectStadium(value = selector.value) {
    const index = Number.isInteger(value) ? value : Number(value);
    stadium = STADIUMS[index] || STADIUMS[0];
    selector.value = String(STADIUMS.indexOf(stadium));
    $('v5-name').textContent = stadium.name;
    $('v5-location').textContent = `📍 ${stadium.city}, ${stadium.country}`;
    const reqPct = Math.round(requerido() * 100);
    $('v5-goal').innerHTML =
      `Para llenarlo hay que presionar el estadio hasta el <b>${reqPct}%</b> del recorrido. ` +
      `El tope (100%) equivale a ${fmt(MAX_CAP)} personas: cada 1% de presión ≈ ${fmt(MAX_CAP / 100)} personas.`;
    $('v5-press-target').style.left = reqPct + '%';
    render(presion);
    enviarEstadioAlTelefono();
  }
  selector.addEventListener('change', () => selectStadium());

  document.querySelectorAll('.version-tab').forEach(button => button.addEventListener('click', () => {
    const on = button.dataset.version === 'v5';
    view.hidden = !on;
    if (on) setTimeout(() => view.scrollIntoView({ behavior: 'smooth', block: 'start' }), 180);
  }));

  window.addEventListener('v5:stadium-selected', event => {
    const index = STADIUMS.indexOf(event.detail);
    if (index >= 0) selectStadium(index);
    view.hidden = false;
    setTimeout(() => view.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  });

  function mountProtobjectConnectButton() {
    const frameworkButton = document.getElementById('ProtobjectPlusButton');
    const placeholder = $('v5-connect');
    if (!frameworkButton || !placeholder || frameworkButton === placeholder) return false;
    frameworkButton.textContent = '＋ Conectar teléfono';
    frameworkButton.title = 'Conectar teléfono con Protobject';
    frameworkButton.setAttribute('aria-label', 'Conectar teléfono con Protobject');
    frameworkButton.addEventListener('click', () => {
      $('v5-phone-status').textContent = 'Escanea el QR de Protobject con el teléfono.';
      initAudio().then(() => { audioPrimed = true; }).catch(() => {});
    });
    placeholder.replaceWith(frameworkButton);
    return true;
  }
  window.mountProtobjectConnectButton = mountProtobjectConnectButton;
  if (!mountProtobjectConnectButton()) {
    const observer = new MutationObserver(() => {
      if (mountProtobjectConnectButton()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function render(value) {
    presion = Math.max(0, Math.min(100, Number(value) || 0));
    const pct = Math.min(100, Math.round(presion / requerido() * 10) / 10);
    $('v5-percent').textContent = Math.round(pct) + '%';
    $('v5-capacity').textContent = `${fmt(pct * stadium.capacity / 100)} de ${fmt(stadium.capacity)} personas`;
    $('v5-press-fill').style.width = presion + '%';
    $('v5-press-value').textContent = Math.round(presion) + '%';
    $('v5-fill').style.width = pct + '%';
    [...seats.children].forEach((seat, index) => seat.classList.toggle('occupied', index < Math.round(pct * seats.children.length / 100)));
    const full = pct >= 100;
    $('v5-full').hidden = !full;
    if (full && !wasFull && audioPrimed) playCrowdCheer(stadium, 1);
    if (!full && wasFull && audioReady) stopAllSound(true);
    wasFull = full;
  }

  $('v5-reset').addEventListener('click', () => render(0));
  selectStadium();

  window.handleV5ProtobjectMessage = message => {
    const value = typeof message === 'number' ? message : Number(message?.presion ?? message?.intensidad ?? message?.value);
    if (!Number.isFinite(value)) return;
    $('v5-phone-status').textContent = '● Teléfono conectado · señal en vivo';
    // Si el teléfono recargó, vuelve a recibir el estadio elegido.
    if (Date.now() - ultimoEnvio > 5000) enviarEstadioAlTelefono();
    render(value);
  };
  window.handleV5Connection = page => {
    if (page && page !== 'index.html') {
      $('v5-phone-status').textContent = '● Teléfono conectado · calibra el sensor';
      enviarEstadioAlTelefono();
    }
  };
  (window.v5PendingMessages || []).splice(0).forEach(window.handleV5ProtobjectMessage);
  (window.v5PendingConnections || []).splice(0).forEach(window.handleV5Connection);
})();
