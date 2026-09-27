// Datos de los estadios más importantes del mundo.
// capacity: aforo máximo (espectadores)
// areaM2: superficie construida aproximada del estadio (m²)
// lat / lon: coordenadas geográficas
const STADIUMS = [
  { name: "Rungrado 1st of May Stadium", city: "Pyongyang", country: "Corea del Norte", capacity: 114000, areaM2: 207000, lat: 39.0725, lon: 125.7625 },
  { name: "Michigan Stadium", city: "Ann Arbor", country: "EE.UU.", capacity: 107601, areaM2: 145000, lat: 42.2658, lon: -83.7487 },
  { name: "Melbourne Cricket Ground", city: "Melbourne", country: "Australia", capacity: 100024, areaM2: 180000, lat: -37.8200, lon: 144.9834 },
  { name: "Camp Nou", city: "Barcelona", country: "España", capacity: 99354, areaM2: 168000, lat: 41.3809, lon: 2.1228 },
  { name: "FNB Stadium (Soccer City)", city: "Johannesburgo", country: "Sudáfrica", capacity: 94736, areaM2: 145000, lat: -26.2347, lon: 27.9822 },
  { name: "Rose Bowl", city: "Pasadena", country: "EE.UU.", capacity: 92542, areaM2: 130000, lat: 34.1613, lon: -118.1676 },
  { name: "Wembley Stadium", city: "Londres", country: "Inglaterra", capacity: 90000, areaM2: 165000, lat: 51.5560, lon: -0.2795 },
  { name: "Estadio Azteca", city: "Ciudad de México", country: "México", capacity: 87523, areaM2: 155000, lat: 19.3029, lon: -99.1505 },
  { name: "Bukit Jalil National Stadium", city: "Kuala Lumpur", country: "Malasia", capacity: 87411, areaM2: 130000, lat: 3.0547, lon: 101.6917 },
  { name: "Estadio Santiago Bernabéu", city: "Madrid", country: "España", capacity: 83186, areaM2: 137000, lat: 40.4531, lon: -3.6883 },
  { name: "Estadio Maracaná", city: "Río de Janeiro", country: "Brasil", capacity: 78838, areaM2: 130000, lat: -22.9121, lon: -43.2302 },
  { name: "San Siro (Giuseppe Meazza)", city: "Milán", country: "Italia", capacity: 75923, areaM2: 100000, lat: 45.4781, lon: 9.1240 },
  { name: "Allianz Arena", city: "Múnich", country: "Alemania", capacity: 75024, areaM2: 171000, lat: 48.2188, lon: 11.6247 },
  { name: "Signal Iduna Park", city: "Dortmund", country: "Alemania", capacity: 81365, areaM2: 92000, lat: 51.4926, lon: 7.4519 },
  { name: "Old Trafford", city: "Mánchester", country: "Inglaterra", capacity: 74310, areaM2: 90000, lat: 53.4631, lon: -2.2913 },
  { name: "Stade de France", city: "Saint-Denis", country: "Francia", capacity: 80698, areaM2: 170000, lat: 48.9245, lon: 2.3601 },
  { name: "Lusail Stadium", city: "Lusail", country: "Catar", capacity: 88966, areaM2: 195000, lat: 25.4200, lon: 51.4900 },
  { name: "Estadio Monumental (River Plate)", city: "Buenos Aires", country: "Argentina", capacity: 83214, areaM2: 110000, lat: -34.5453, lon: -58.4497 },
  { name: "La Bombonera", city: "Buenos Aires", country: "Argentina", capacity: 54000, areaM2: 42000, lat: -34.6356, lon: -58.3648 },
  { name: "Estadio Nacional (Perú)", city: "Lima", country: "Perú", capacity: 50086, areaM2: 60000, lat: -12.0672, lon: -77.0339 },
  { name: "Estadio Monumental (Chile)", city: "Santiago", country: "Chile", capacity: 47347, areaM2: 55000, lat: -33.5083, lon: -70.6056 },
  { name: "Beijing National Stadium (Nido de Pájaro)", city: "Pekín", country: "China", capacity: 91000, areaM2: 258000, lat: 39.9928, lon: 116.3975 }
];
