// Protobject asigna el computador como página principal (QR) y el teléfono
// como sensor remoto. setProduction permite el emparejamiento en GitHub Pages.
Protobject.setProduction(true);
Protobject.initialize([
  { name: "Visualización de estadios", page: "index.html", main: true, debug: "master" },
  { name: "Sensor de peso", page: "sensor.html", debug: "local" }
]);

// initialize prepara la sesión; vuelve a registrar el receptor después para
// que Protobject no lo pierda al completar el arranque.
if (typeof window.handleV5ProtobjectMessage === "function") {
  Protobject.Core.onReceived(window.handleV5ProtobjectMessage);
}
if (typeof window.routeV5Connection === "function") {
  Protobject.Core.onConnected(window.routeV5Connection);
}
window.mountProtobjectConnectButton?.();
