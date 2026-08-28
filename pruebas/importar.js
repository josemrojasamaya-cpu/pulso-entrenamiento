/**
 * pruebas/importar.js — lectura de archivos exportados.
 *
 * Se prueba con archivos con la forma real que exportan Garmin (TCX),
 * cualquier reloj (GPX) y Samsung Health (CSV), incluido el formato
 * europeo con punto y coma y coma decimal, que es el que sale en
 * media Latinoamérica y rompe los lectores hechos a la ligera.
 *
 * Uso:  node pruebas/importar.js
 */

const { leer } = require('../lib/importar');

let ok=0, mal=0;
const check=(n,c,d='')=>c?(ok++,console.log('  OK    '+n)):(mal++,console.log('  FALLA '+n+' '+d));

// ── TCX como lo exporta Garmin ──
const tcx = `<?xml version="1.0"?>
<TrainingCenterDatabase><Activities><Activity Sport="Running"><Lap StartTime="2026-08-20T06:15:00Z">
<TotalTimeSeconds>2740</TotalTimeSeconds><DistanceMeters>7250.0</DistanceMeters>
<Calories>612</Calories>
<AverageHeartRateBpm><Value>148</Value></AverageHeartRateBpm>
<MaximumHeartRateBpm><Value>176</Value></MaximumHeartRateBpm>
<Track>
<Trackpoint><Time>2026-08-20T06:15:10Z</Time><HeartRateBpm><Value>112</Value></HeartRateBpm></Trackpoint>
<Trackpoint><Time>2026-08-20T06:16:10Z</Time><HeartRateBpm><Value>139</Value></HeartRateBpm></Trackpoint>
<Trackpoint><Time>2026-08-20T06:17:10Z</Time><HeartRateBpm><Value>151</Value></HeartRateBpm></Trackpoint>
</Track></Lap></Activity></Activities></TrainingCenterDatabase>`;
const t = leer('carrera.tcx', tcx);
check('TCX se reconoce', t.formato==='TCX', JSON.stringify(t).slice(0,80));
check('TCX lee la actividad', t.actividades.length===1 && t.actividades[0].calorias===612);
check('TCX lee el pulso medio y maximo',
  t.actividades[0].pulso_medio===148 && t.actividades[0].pulso_max===176);
check('TCX lee los puntos de pulso', t.lecturas.length===3 && t.lecturas[0].valor===112);

// ── GPX con extension de pulso ──
const gpx = `<?xml version="1.0"?><gpx version="1.1"><trk><name>Bici del domingo</name><trkseg>
<trkpt lat="9.93" lon="-84.08"><time>2026-08-21T07:00:00Z</time>
<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>124</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
<trkpt lat="9.94" lon="-84.09"><time>2026-08-21T07:30:00Z</time>
<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>141</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
</trkseg></trk></gpx>`;
const g = leer('bici.gpx', gpx);
check('GPX se reconoce', g.formato==='GPX');
check('GPX lee el pulso', g.lecturas.length===2 && g.lecturas[1].valor===141);
check('GPX calcula la duracion', g.actividades[0].segundos===1800, JSON.stringify(g.actividades[0]));

// ── CSV estilo Samsung Health ──
const csv = `Fecha,Pasos,Frecuencia cardiaca,Peso (kg),Sleep duration,Notas
2026-08-20,9412,68,74.5,412,dia normal
2026-08-21,12980,71,74.2,388,corri en la manana
2026-08-22,6100,66,74.0,455,descanso`;
const c = leer('samsung.csv', csv);
check('CSV se reconoce', c.formato==='CSV');
check('CSV mapea las columnas conocidas',
  c.columnas_reconocidas.length>=4, JSON.stringify(c.columnas_reconocidas));
check('CSV ignora lo que no entiende', c.columnas_ignoradas.includes('Notas'));
const pasos = c.lecturas.filter(l=>l.tipo==='pasos');
check('CSV lee los pasos', pasos.length===3 && pasos[1].valor===12980);
const pesos = c.lecturas.filter(l=>l.campo==='peso');
check('CSV separa el peso como medicion', pesos.length===3 && pesos[0].valor===74.5);

// ── CSV con punto y coma y coma decimal (formato europeo) ──
const csv2 = `Date;Weight;Body fat\n2026-08-20;74,5;18,2\n2026-08-21;74,2;18,0`;
const c2 = leer('bascula.csv', csv2);
check('CSV con punto y coma y coma decimal', 
  c2.lecturas.some(l=>l.campo==='peso' && l.valor===74.5), JSON.stringify(c2.lecturas).slice(0,100));

// ── Casos que deben fallar bien ──
check('FIT explica que no se puede y que hacer',
  /TCX o GPX/.test(leer('a.fit','binario').error||''));
check('archivo enorme se rechaza',
  /12 MB/.test(leer('g.csv','x'.repeat(13*1024*1024)).error||''));
check('formato desconocido se rechaza', Boolean(leer('a.xyz','contenido suelto').error));
check('archivo vacio no revienta', typeof leer('a.csv','')==='object');
check('xml roto no revienta', typeof leer('a.gpx','<gpx><trkpt>')==='object');

console.log('\n  '+ok+' pasaron · '+mal+' fallaron');
process.exit(mal?1:0);
