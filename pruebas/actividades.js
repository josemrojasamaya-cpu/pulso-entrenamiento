/**
 * pruebas/actividades.js — cardio, deportes y GPS.
 *
 * Lo que se prueba son las decisiones que el GPS obliga a tomar: qué es
 * ruido, qué es un salto imposible, y qué números no se pueden inventar.
 */
const A = require("../lib/actividades");

let ok = 0, mal = 0;
const prueba = (n, f) => {
    try { f(); console.log("  ok   " + n); ok++; }
    catch (e) { console.log("  MAL  " + n + "\n       " + e.message); mal++; }
};
const igual = (a, b, m) => { if (a !== b) throw new Error(`${m || ""} esperaba ${b}, llegó ${a}`); };
const cierto = (c, m) => { if (!c) throw new Error(m || "debería ser cierto"); };
const cerca = (a, b, tol, m) => {
    if (Math.abs(a - b) > tol) throw new Error(`${m || ""} esperaba ~${b}, llegó ${a}`);
};

console.log("\nDISTANCIA");

prueba("mide bien una distancia conocida", () => {
    // Un grado de latitud son ~111,3 km en cualquier punto del planeta.
    const d = A.distancia({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
    cerca(d, 111195, 500);
});

prueba("la distancia de un punto a sí mismo es cero", () => {
    igual(A.distancia({ lat: 9.93, lon: -84.09 }, { lat: 9.93, lon: -84.09 }), 0);
});

console.log("\nRECORRIDO CON RUIDO DE GPS");

/** Puntos en línea recta hacia el norte, separados por metros. */
function linea(n, metrosEntre, opciones) {
    const o = opciones || {};
    const paso = metrosEntre / 111195;
    return Array.from({ length: n }, (_, i) => ({
        lat: 9.93 + i * paso, lon: -84.09,
        t: 1000000 + i * (o.segundos || 5) * 1000,
        precision: o.precision === undefined ? 5 : o.precision,
        altitud: o.altitud ? o.altitud(i) : undefined
    }));
}

prueba("suma una recta simple", () => {
    const r = A.recorrer(linea(11, 100));   // 10 tramos de 100 m
    cerca(r.metros, 1000, 15);
});

prueba("NO suma el temblor del GPS estando parado", () => {
    // El caso real: la persona espera en un semáforo un minuto y el punto
    // salta dos o tres metros. Sumar eso infla la distancia de la salida.
    const parado = Array.from({ length: 60 }, (_, i) => ({
        lat: 9.93 + (i % 2 ? 0.00002 : -0.00002),   // ±2 m
        lon: -84.09, t: 1000000 + i * 1000, precision: 8
    }));
    const r = A.recorrer(parado);
    igual(r.metros, 0, "un minuto parado tiene que dar cero metros:");
});

prueba("descarta el salto imposible cuando el GPS reengancha", () => {
    const p = linea(5, 100);
    // Salto de ~2 km en cinco segundos: eso es reenganche, no velocidad.
    p.push({ lat: p[4].lat + 0.02, lon: -84.09, t: p[4].t + 5000, precision: 5 });
    p.push({ lat: p[4].lat + 0.0209, lon: -84.09, t: p[4].t + 10000, precision: 5 });
    const r = A.recorrer(p);
    cerca(r.metros, 400, 120, "el salto no debería sumarse:");
});

prueba("descarta los puntos con precisión inservible", () => {
    const p = linea(6, 100, { precision: 200 });   // 200 m de error
    igual(A.recorrer(p).metros, 0,
        "con 200 m de error no se puede afirmar que se movió 100 m");
});

prueba("cuenta la subida cuando es real", () => {
    const p = linea(11, 100, { altitud: i => 1000 + i * 10 });   // +10 m por tramo
    const r = A.recorrer(p);
    cerca(r.subida, 100, 6);
    igual(r.bajada, 0);
});

prueba("NO cuenta desnivel donde el terreno es plano", () => {
    // La altitud del GPS oscila metro y medio estando quieto. Sumarla
    // daría "subiste 30 metros" en una vuelta a la manzana plana.
    const p = linea(21, 100, { altitud: i => 1000 + (i % 2 ? 1.5 : -1.5) });
    igual(A.recorrer(p).subida, 0);
});

prueba("separa subida de bajada", () => {
    const p = linea(11, 100, { altitud: i => 1000 + (i <= 5 ? i * 10 : (10 - i) * 10 + 100) });
    const r = A.recorrer(p);
    cierto(r.subida > 0 && r.bajada > 0, "una ida y vuelta a un cerro tiene las dos");
});

prueba("con menos de dos puntos no inventa distancia", () => {
    igual(A.recorrer([{ lat: 9.93, lon: -84.09, t: 1, precision: 5 }]).metros, 0);
    igual(A.recorrer([]).metros, 0);
    igual(A.recorrer(null).metros, 0);
});

console.log("\nRITMO Y VELOCIDAD");

prueba("cinco kilómetros en media hora son 6:00 min/km", () => {
    igual(A.ritmo(5000, 1800), "6:00");
});

prueba("redondea los segundos sin dar 60", () => {
    const r = A.ritmo(1000, 359.7);
    cierto(!/:60$/.test(r), "nunca puede terminar en :60, llegó " + r);
});

prueba("sin distancia no hay ritmo", () => {
    igual(A.ritmo(0, 1800), null, "una clase de boxeo no tiene min/km");
});

prueba("velocidad en km/h", () => {
    igual(A.velocidad(20000, 3600), 20);
});

console.log("\nCALORÍAS");

prueba("estima con la fórmula del MET", () => {
    // Correr a ritmo medio: 9.8 MET × 70 kg × 1 h = 686 kcal
    const c = A.calorias("correr", 60, 70, "medio");
    cerca(c.kcal, 686, 5);
    igual(c.estimada, true, "tiene que declararse como estimación:");
});

prueba("la intensidad cambia el resultado", () => {
    const suave  = A.calorias("correr", 60, 70, "suave").kcal;
    const fuerte = A.calorias("correr", 60, 70, "fuerte").kcal;
    cierto(fuerte > suave * 1.5, "correr suave y correr fuerte no gastan lo mismo");
});

prueba("SIN el peso no inventa un número", () => {
    // Suponer 70 kg le erraría un 40% a alguien de 100 kg, y ese número
    // aparecería en pantalla como si fuera suyo.
    igual(A.calorias("correr", 60, null, "medio"), null);
    igual(A.calorias("correr", 60, 0, "medio"), null);
});

prueba("un deporte que no existe no da calorías", () => {
    igual(A.calorias("quidditch", 60, 70, "medio"), null);
});

console.log("\nVALIDACIÓN");

prueba("una actividad normal pasa", () => {
    igual(A.validar({ deporte: "correr", segundos: 1800, metros: 5000 }), null);
});

prueba("rechaza la velocidad de un auto corriendo", () => {
    // El error real: cronómetro parado y distancia tecleada a mano.
    const e = A.validar({ deporte: "correr", segundos: 600, metros: 30000 });
    cierto(e && /no es posible/.test(e), "180 km/h corriendo debería rechazarse");
});

prueba("en bicicleta el techo es más alto", () => {
    // 60 km/h en bici es una bajada fuerte, no un error.
    igual(A.validar({ deporte: "bicicleta", segundos: 3600, metros: 60000 }), null);
    cierto(A.validar({ deporte: "correr", segundos: 3600, metros: 60000 }) !== null,
        "los mismos 60 km/h corriendo sí son un error");
});

prueba("una sesión sin tiempo no se guarda", () => {
    cierto(A.validar({ deporte: "natacion", segundos: 0 }) !== null);
});

prueba("veinticinco horas no es una sesión", () => {
    cierto(A.validar({ deporte: "caminar", segundos: 90000, metros: 1000 }) !== null);
});

prueba("natación sin distancia es válida", () => {
    // En la piscina no hay GPS. Registrar sólo tiempo es lo normal.
    igual(A.validar({ deporte: "natacion", segundos: 2400, metros: 0 }), null);
});

prueba("artes marciales sin distancia es válida", () => {
    igual(A.validar({ deporte: "marciales", segundos: 3600, metros: 0 }), null);
});

console.log("\nPUNTOS");

prueba("una sesión muy corta no da puntos", () => {
    igual(A.puntosDeActividad({ segundos: 120 }), 0);
});

prueba("caminar y correr media hora dan lo MISMO", () => {
    // Pagar por kilómetros premiaría a quien corre rápido y castigaría a
    // quien camina, a quien empieza y a quien pesa más: justo las
    // personas a las que hay que sostener.
    const correr  = A.puntosDeActividad({ deporte: "correr",  segundos: 1800, metros: 6000 });
    const caminar = A.puntosDeActividad({ deporte: "caminar", segundos: 1800, metros: 2500 });
    igual(correr, caminar);
});

prueba("los puntos tienen techo", () => {
    const dosHoras   = A.puntosDeActividad({ segundos: 7200 });
    const seisHoras  = A.puntosDeActividad({ segundos: 21600 });
    igual(dosHoras, seisHoras,
        "sin techo, el ranking lo gana quien tiene más tiempo libre");
});

prueba("más tiempo da más puntos hasta el techo", () => {
    cierto(A.puntosDeActividad({ segundos: 3600 }) > A.puntosDeActividad({ segundos: 900 }));
});

console.log(`\n  ${ok} bien · ${mal} mal\n`);
process.exit(mal > 0 ? 1 : 0);
