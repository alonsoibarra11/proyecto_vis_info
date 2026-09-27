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

## Variables de entorno
La configuración se define en un archivo `.env` en la raíz del proyecto. Se
incluye `.env.example` como plantilla:

```bash
cp .env.example .env
```

| Variable       | Descripción                                                      | Valor por defecto                |
| -------------- | ---------------------------------------------------------------- | -------------------------------- |
| `PORT`         | Puerto en el que escucha el servidor de previsualización.        | `8000`                           |
| `HOST`         | Host/interfaz de escucha (`0.0.0.0` para exponer en la red).     | `localhost`                      |
| `STATIC_ROOT`  | Directorio raíz que se sirve estáticamente.                      | `.`                              |
| `NODE_ENV`     | Entorno de ejecución (`development` / `production`).             | `development`                    |
| `APP_BASE_URL` | URL base con la que se abre la app en el navegador.              | `http://localhost:8000`          |
| `PLOTLY_CDN`   | URL del CDN de Plotly.js (permite fijar versión o usar mirror).  | CDN oficial de Plotly: https://cdn.plot.ly/plotly-2.35.2.min.js            |
| `TONE_CDN`     | URL del CDN de Tone.js (permite fijar versión o usar mirror).    | CDN oficial de Tone: https://cdnjs.cloudflare.com/ajax/libs/tone/14.8.49/Tone.js              |

El archivo `.env` está ignorado por Git y no debe subirse al repositorio.

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
El cántico es 100% sintetizado con Tone.js y no utiliza archivos de audio.
El código de síntesis se encuentra en `app.js` (sección de sonido con
Tone.js).
