# proyecto_vis_info — Mapa sonoro de estadios del mundo

Página web interactiva que muestra en un mapa mundial ~400 de los estadios
más grandes del mundo (datos de **Wikidata**). Cada estadio se representa con
una **foto** sobre su ubicación (más grande cuanto mayor es su capacidad). Al
hacer click suena un **grito de multitud** (`assets/crowd-cheer.mp3`), cuyo
**volumen crece con la capacidad** del estadio. A un costado hay un gráfico de
barras con el ranking por **capacidad** y un **panel de filtros combinables**
que controla qué estadios se muestran tanto en el mapa como en el ranking:

- **Confederación** (UEFA, CONMEBOL, CONCACAF, CAF, AFC, OFC).
- **País** (todos los países presentes en el dataset).
- **Capacidad mínima** (deslizador).

Los filtros se aplican en conjunto (AND) y hay un contador de resultados y un
botón para limpiarlos.

Además, la página puede **fisicalizar** el gol: al conectar un **Arduino con
un servo** por USB, la plataforma de una maqueta tiembla con una intensidad
proporcional al estadio (ver sección *Integración con Arduino*).

Observa la página en el siguiente link: https://alonsoibarra11.github.io/proyecto_vis_info/


## Tecnologías
- **Plotly.js** — `scattergeo` para el mapa mundial y `bar` para el ranking.
- **Tone.js** — reproduce el archivo de sonido (`Tone.Player`) y mide su nivel (`Tone.Meter`).
- **Web Serial API** — comunicación con el Arduino por USB (Chrome/Edge).
- **Wikidata (SPARQL)** — fuente de datos de los estadios (ver *Fuente de datos*).
- HTML/CSS/JS puro, sin build.

## Archivos
- `index.html` — estructura de la página y carga de CDN.
- `styles.css` — estilos (tema oscuro tipo estadio nocturno).
- `data.js` — datos de los estadios (**generado** desde Wikidata, no editar a mano).
- `app.js` — mapa, ranking, filtro y motor de sonido (`playGoal`).
- `arduino.js` — puente con el Arduino/servo vía Web Serial (fisicalización).
- `server.js` — servidor estático mínimo para previsualizar.
- `scripts/fetch_stadiums.mjs` — script que baja los datos de Wikidata y regenera `data.js`.
- `assets/estadio.png` — imagen (sin fondo) usada como marcador de cada estadio en el mapa.
- `assets/crowd-cheer.mp3` — grito de multitud que suena al hacer click.

## Cómo ejecutar
Necesita servirse por HTTP (el audio del navegador requiere interacción y
los CDN no cargan bien con `file://`):

```bash
node server.js
# abre http://localhost:8000
```

El servidor lee `PORT`, `HOST` y `STATIC_ROOT` desde `.env` (ver más abajo). Si
el puerto ya está en uso, arranca en otro:

```bash
PORT=8001 node server.js
# o libera el 8000:  lsof -ti tcp:8000 | xargs kill
```

## Fuente de datos
Los estadios provienen de **[Wikidata](https://www.wikidata.org)**, cuyos datos
están bajo licencia **CC0** (dominio público). El archivo `data.js` es
**generado automáticamente** por `scripts/fetch_stadiums.mjs` y no debe editarse
a mano.

Cada estadio incluye: `name`, `city`, `country`, `confederation`, `capacity`,
`year` (año de inauguración, puede ser `null`) y `lat`/`lon`.

Para regenerar el dataset (requiere Node 18+ con `fetch` nativo):

```bash
node scripts/fetch_stadiums.mjs
# opciones: --limit 200 (nº de estadios) --min 15000 --max 130000 (rango de capacidad)
```

El script consulta el endpoint SPARQL de Wikidata (WDQS), pide estadios con
capacidad y coordenadas, y aplica varios filtros para reducir datos erróneos:

- **Excluye estadios demolidos o cerrados** (los que tienen fecha de disolución
  `P576`, o están marcados como estructura desaparecida). Esto evita que
  aparezcan con su capacidad histórica (p. ej. el viejo Estádio da Luz con
  120.000, demolido en 2003).
- **Filtra por rango de capacidad** (`--min`/`--max`) para descartar valores
  absurdos (p. ej. registros con 400.000 o 1.500.000).
- Usa el valor de capacidad de mayor rango (preferente) de cada estadio,
  deduplica, ordena por capacidad y escribe los `--limit` más grandes.

La confederación se deriva del país mediante una tabla en el propio script.

> Notas sobre los datos abiertos: al ser una fuente colaborativa, todavía puede
> quedar algún caso con capacidad histórica inflada si la entidad no está
> marcada como demolida en Wikidata (p. ej. el Estadio Morumbi figura con su
> aforo histórico). También hay recintos de otros deportes (fútbol americano en
> EE.UU.) o ciudades expresadas como distrito administrativo. Ajusta
> `--min`/`--max` o la tabla de confederaciones si lo necesitas.

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
1. Click en la foto de un estadio del mapa → suena el grito de multitud.
2. Las fotos más grandes = estadios con más capacidad = sonido más fuerte.
3. El panel de filtros (confederación, país, capacidad mínima) acota qué
   estadios se ven en el mapa y en el ranking. "Limpiar filtros" los reinicia.
4. Click en una barra también reproduce el sonido del estadio.

## Tema claro / oscuro
La página abre en **modo claro** por defecto. El botón superior derecho
alterna entre claro y oscuro; ambos gráficos se redibujan con la paleta del
tema activo.

## Notas sobre el mapa
`scattergeo` de Plotly no admite imágenes como símbolo de marcador, así que la
foto de cada estadio se dibuja como una capa de `<img>` (`#stadium-images`)
superpuesta al mapa. Los puntos del `scattergeo` siguen existiendo pero son
**invisibles**: solo capturan el click y el tooltip. En cada render (zoom, pan
o resize) `positionStadiumImages()` reubica cada foto leyendo la **posición real
de cada punto que Plotly ya dibujó** en el SVG (así la alineación es exacta); si
esa capa no estuviera disponible, cae a la proyección interna de Plotly. El
tamaño de la foto escala con la capacidad del estadio. Para cambiar la foto,
reemplaza `assets/estadio.png` (o edita la constante `STADIUM_IMG` en `app.js`).

## Notas sobre el sonido
El sonido es el archivo **`assets/crowd-cheer.mp3`**, reproducido con
`Tone.Player`. El código está en `app.js`, función `playGoal`.

- El **volumen es proporcional a la capacidad** del estadio: va de `0.30`
  (estadio chico) a `1.0` (estadio enorme). Ver la variable `vol` en `playGoal`.
- Se mantiene un **`Tone.Meter`** conectado a la salida para leer el nivel de
  audio en vivo (0..1) y publicarlo en el bus como `goal:level`, que alimenta
  el temblor del servo del Arduino.
- Para cambiar el sonido, reemplaza `assets/crowd-cheer.mp3` (o edita la
  constante `CROWD_SOUND` en `app.js`). El buffer se carga una sola vez con
  `Tone.loaded()` en el primer click.

> El navegador solo permite audio tras una interacción del usuario, por eso el
> sonido se inicializa en el primer click sobre un estadio.

## Integración con Arduino (fisicalización del gol)
La página emite eventos que un módulo de hardware puede escuchar, sin acoplar
la lógica del mapa/sonido al dispositivo. El módulo `arduino.js` implementa el
puente por **Web Serial API** hacia un **servo**.

> **Estado actual:** la integración con Arduino está **preparada pero
> desactivada en la interfaz**. El módulo `arduino.js` se carga y escucha los
> eventos, pero el botón de conexión y el indicador de estado están comentados
> en `index.html` (aún no se necesita el hardware). Para activarlos, sigue la
> sección *Cómo activar el botón de Arduino* más abajo.

### Flujo
1. El usuario pulsa **"🔌 Conectar Arduino"** (Web Serial exige un gesto del
   usuario) y elige el puerto USB del Arduino.
2. Al hacer click en un estadio, `app.js` reproduce el GOOOOL y publica en un
   *bus* de eventos (`window.StadiumBus`):
   - `goal:start` → `{ stadium, intensity, durationMs }`
   - `goal:level` → `{ level }` (nivel de audio en vivo, 0..1)
   - `goal:stop`  → `{}`
3. `arduino.js` traduce esos eventos en un **vaivén del servo** alrededor de
   90°. La **frecuencia** (4–10 Hz) y la **amplitud** (15–60°) del temblor
   crecen con la intensidad del estadio. Con `FOLLOW_AUDIO = true`, la
   amplitud además late siguiendo el nivel del sonido.
4. Al terminar el sonido (`goal:stop`), el servo vuelve al centro y se detiene
   (igual que el `setTimeout(..., { speed: 0 })` de la maqueta de referencia).

### Cómo activar el botón de Arduino
El código del puente (`arduino.js`) ya está incluido y funcionando; solo hay
que **descomentar dos líneas** en `index.html`.

1. En el `<header>`, dentro de `<div class="header-actions">`, descomenta el
   botón:

   ```html
   <button id="btn-arduino" class="theme-btn" title="Conectar la maqueta (servo por USB)">🔌 Conectar Arduino</button>
   ```

2. Dentro de `<div class="stage">` (junto a `#now-playing`), descomenta el
   indicador de estado:

   ```html
   <div id="arduino-status">🔌 Arduino sin conectar.</div>
   ```

No hay que tocar `arduino.js` ni `app.js`: el módulo detecta el botón por su
`id` (`btn-arduino`) y lo conecta automáticamente al cargar la página. Si el
botón no existe, `arduino.js` simplemente no hace nada (no genera errores).

> Mientras el botón esté oculto, igual puedes probar el puente desde la
> **consola del navegador** con `ArduinoBridge.connect()` (ver más abajo).

### Protocolo serial
El navegador envía líneas de texto por USB a **9600 baud**:

| Mensaje       | Significado                                  |
| ------------- | -------------------------------------------- |
| `S<0-180>\n`  | Mover el servo a ese ángulo (0–180 grados).  |
| `X\n`         | Detener / volver a reposo.                   |

### Sketch de Arduino de ejemplo
```cpp
#include <Servo.h>

Servo servo;
String buffer = "";

void setup() {
  Serial.begin(9600);
  servo.attach(9);   // señal del servo en el pin D9
  servo.write(90);   // reposo
}

void loop() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n') {
      buffer.trim();
      if (buffer.length() > 0) {
        if (buffer[0] == 'S') {
          int ang = buffer.substring(1).toInt();
          ang = constrain(ang, 0, 180);
          servo.write(ang);
        } else if (buffer[0] == 'X') {
          servo.write(90);
        }
      }
      buffer = "";
    } else {
      buffer += c;
    }
  }
}
```

### Requisitos y notas
- **Web Serial** funciona en Chrome/Edge de escritorio, servido por
  `http://localhost` o HTTPS (no con `file://`).
- Un micro-servo (SG90) puede alimentarse por USB para pruebas, pero para un
  temblor fuerte conviene una **fuente externa de 5 V** con GND común.
- El vaivén rápido exige un servo ágil; si tiembla poco, baja la frecuencia
  (`shakeHz`) o sube la amplitud (`maxDeg`) en `arduino.js`.
- Para depurar sin hardware puedes llamar desde la consola del navegador:
  `ArduinoBridge.connect()`, `ArduinoBridge.startShake(0.8)`,
  `ArduinoBridge.stopShake()`.
