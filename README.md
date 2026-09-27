# proyecto_vis_info — Mapa sonoro de estadios del mundo

Página web interactiva que muestra en un mapa mundial los estadios más
importantes del mundo. Al hacer click en un estadio suena un **"¡GOOOOL!"**
sintetizado, cuya **intensidad crece con la capacidad y el tamaño** del
estadio. A un costado hay un gráfico de barras con el ranking de estadios,
conmutable entre **capacidad** y **superficie (m²)**.

Además, la página puede **fisicalizar** el gol: al conectar un **Arduino con
un servo** por USB, la plataforma de una maqueta tiembla con una intensidad
proporcional al estadio (ver sección *Integración con Arduino*).

Observa la página en el siguiente link: https://alonsoibarra11.github.io/proyecto_vis_info/


## Tecnologías
- **Plotly.js** — `scattergeo` para el mapa mundial y `bar` para el ranking.
- **Tone.js** — síntesis en vivo del "GOOOOL" (grito con vibrato + rugido de multitud).
- **Web Serial API** — comunicación con el Arduino por USB (Chrome/Edge).
- HTML/CSS/JS puro, sin build.

## Archivos
- `index.html` — estructura de la página y carga de CDN.
- `styles.css` — estilos (tema oscuro tipo estadio nocturno).
- `data.js` — datos de los estadios (capacidad, área, coordenadas).
- `app.js` — mapa, gráfico de barras y motor de sonido (`playGoal`).
- `arduino.js` — puente con el Arduino/servo vía Web Serial (fisicalización).
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
El "¡GOOOOL!" es 100% sintetizado con Tone.js y **no utiliza archivos de
audio**: es un grito ascendente y sostenido (dos osciladores con vibrato y un
filtro que imita el formante de una vocal abierta) sobre un rugido de
multitud que explota. El código está en `app.js`, función `playGoal`.

> ¿Por qué sintetizado y no un `.mp3`? Porque al generar el sonido en vivo
> podemos leer su **nivel de amplitud en tiempo real** con un `Tone.Meter` y
> usar esa señal para el temblor del servo. Nota: Tone.js no reproduce la
> palabra "GOOOOL" con voz humana real; produce un grito estilizado de
> celebración. Si se necesitara la voz literal, habría que usar un archivo de
> audio (y analizar su amplitud con `Tone.Player` + `Tone.Meter`).

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
