// Protobject asigna el computador como página principal (QR) y el teléfono
// como sensor remoto. setProduction permite el emparejamiento en GitHub Pages.
Protobject.setProduction(true);
Protobject.initialize([
  { name: "Visualización de estadios", page: "index.html", main: true, debug: "master" },
  { name: "Sensor de peso", page: "sensor.html", debug: "local" }
]);
