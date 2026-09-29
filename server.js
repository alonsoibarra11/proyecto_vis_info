// Servidor estático mínimo para previsualizar la página localmente.
// Uso: node server.js   ->   http://localhost:8000
//
// Respeta las variables de entorno del archivo .env (ver .env.example):
//   PORT         puerto de escucha            (por defecto 8000)
//   HOST         interfaz de escucha          (por defecto localhost)
//   STATIC_ROOT  directorio que se sirve      (por defecto la raíz del proyecto)
const http = require("http");
const fs = require("fs");
const path = require("path");

// ---- Carga mínima de .env (sin dependencias) ----
// Lee KEY=VALUE por línea, ignora comentarios (#) y líneas vacías.
// No sobreescribe variables ya presentes en process.env.
function loadEnv(file) {
  try {
    const text = fs.readFileSync(file, "utf8");
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      // Quita comillas envolventes si las hubiera.
      if ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key && !(key in process.env)) process.env[key] = val;
    }
  } catch (_) {
    // Sin .env no pasa nada: se usan los valores por defecto.
  }
}
loadEnv(path.join(__dirname, ".env"));

const PORT = parseInt(process.env.PORT, 10) || 8000;
const HOST = process.env.HOST || "localhost";
// STATIC_ROOT se resuelve relativo a la carpeta del proyecto.
const ROOT = path.resolve(__dirname, process.env.STATIC_ROOT || ".");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".gif": "image/gif"
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";

  // Evita salir de ROOT (path traversal): normalizamos y comprobamos prefijo.
  const filePath = path.join(ROOT, urlPath);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("403 Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("404 Not Found: " + urlPath);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": TYPES[ext] || "application/octet-stream" });
    res.end(data);
  });
});

// Manejo claro de errores en vez de un stack trace crudo.
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n⚠️  El puerto ${PORT} ya está en uso.`);
    console.error(`   Otro proceso (probablemente otro "node server.js") lo tiene ocupado.`);
    console.error(`   Opciones:`);
    console.error(`     • Libéralo:   lsof -ti tcp:${PORT} | xargs kill`);
    console.error(`     • O usa otro: PORT=8001 node server.js\n`);
    process.exit(1);
  }
  console.error("Error del servidor:", err.message);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`Servidor listo en http://${HOST}:${PORT}`);
  console.log(`Sirviendo: ${ROOT}`);
});
