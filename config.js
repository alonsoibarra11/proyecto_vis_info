// Protobject asigna el computador como página principal (QR) y el teléfono
// como sensor remoto. setProduction permite el emparejamiento en GitHub Pages.
Protobject.setProduction(true);
Protobject.initialize([
  { name: "Visualización de estadios", page: "index.html", main: true, debug: "master" },
  { name: "Sensor de peso", page: "sensor.html", debug: "local" }
]);

// Registrar el receptor después de initialize: Protobject prepara
// el canal de mensajes durante la inicialización de las páginas.
if (window.handleV5ProtobjectMessage) {
  Protobject.Core.onReceived(window.handleV5ProtobjectMessage);
}
