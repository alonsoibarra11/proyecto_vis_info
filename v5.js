(() => {
  const $ = id => document.getElementById(id);
  const view = $('v5-view');
  const selector = $('v5-stadium');
  let stadium = STADIUMS[0], wasFull = false, audioPrimed = false;
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
    $('v5-capacity').textContent = `Capacidad del estadio: ${stadium.capacity.toLocaleString('es')} personas`;
  }
  selector.addEventListener('change', selectStadium);
  selectStadium();

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

  $('v5-connect').addEventListener('click', () => {
    const connectButton = document.getElementById('ProtobjectPlusButton');
    if (!connectButton) {
      $('v5-phone-status').textContent = 'Protobject no está listo. Recarga la página e inténtalo otra vez.';
      return;
    }
    // El click del usuario debe activar primero el botón real de Protobject.
    connectButton.click();
    $('v5-phone-status').textContent = 'Escanea el QR de Protobject con el teléfono.';
    initAudio().then(() => { audioPrimed = true; }).catch(() => {});
  });

  function render(value) {
    const pct = Math.max(0, Math.min(100, Number(value) || 0));
    $('v5-percent').textContent = pct + '%';
    $('v5-fill').style.width = pct + '%';
    [...seats.children].forEach((seat, index) => seat.classList.toggle('occupied', index < Math.round(pct * seats.children.length / 100)));
    const full = pct >= 100;
    $('v5-full').hidden = !full;
    if (full && !wasFull && audioPrimed) playCrowdCheer(stadium, 1);
    if (!full && wasFull && audioReady) stopAllSound(true);
    wasFull = full;
  }

  $('v5-reset').addEventListener('click', () => render(0));

  window.handleV5ProtobjectMessage = message => {
    const value = typeof message === 'number' ? message : Number(message?.intensidad ?? message?.value);
    if (!Number.isFinite(value)) return;
    $('v5-phone-status').textContent = '● Teléfono conectado · señal en vivo';
    render(value);
  };
})();
