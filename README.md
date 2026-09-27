# proyecto_vis_info — Mapa sonoro de estadios del mundo

Página web interactiva que muestra en un mapa mundial los estadios más
importantes del mundo. Al hacer click en un estadio suena un cántico de
barra brava sintetizado, cuya **intensidad crece con la capacidad y el
tamaño** del estadio. A un costado hay un gráfico de barras con el ranking
de estadios, conmutable entre **capacidad** y **superficie (m²)**.

## Tecnologías
- **Plotly.js** — `scattergeo` para el mapa mundial y `bar` para el ranking.
- **Tone.js** — síntesis en vivo del cántico (rugido de multitud + bombo + coro).
- HTML/CSS/JS puro, sin build.

## Archivos
- `index.html` — estructura de la página y carga de CDN.
- `styles.css` — estilos (tema oscuro tipo estadio nocturno).
- `data.js` — datos de los estadios (capacidad, área, coordenadas).
- `app.js` — mapa, gráfico de barras y motor de sonido.
- `server.js` — servidor estático mínimo para previsualizar.

## Cómo ejecutar
Necesita servirse por HTTP (el audio del navegador requiere interacción y
los CDN no cargan bien con `file://`):

```bash
node server.js
# abre http://localhost:8000
```

## Uso
1. Click en un punto del mapa → suena la barra brava de ese estadio.
2. Los puntos más grandes/rojos = estadios más grandes = sonido más intenso.
3. Botones "Por capacidad" / "Por tamaño (m²)" cambian el gráfico de barras.
4. Click en una barra también reproduce el cántico.

## Tema claro / oscuro
La página abre en **modo claro** por defecto. El botón superior derecho
alterna entre claro y oscuro; ambos gráficos se redibujan con la paleta del
tema activo.

## Notas sobre el sonido
El cántico es 100% sintetizado con Tone.js (no usa archivos de audio). Si
prefieres usar grabaciones reales de hinchada/gol, puedo integrar archivos
`.mp3`/`.wav`: solo hay que indicarlo y proporcionarlos.
