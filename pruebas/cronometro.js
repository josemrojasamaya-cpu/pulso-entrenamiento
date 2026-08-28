/**
 * pruebas/cronometro.js — el cronómetro de sesión.
 *
 * Lo que se prueba acá son las decisiones, no el conteo: que un tiempo
 * absurdo no entre, que no se compare lo incomparable, y que los puntos
 * no se puedan inflar sin entrenar.
 */
const { descansoSugerido, compararTiempo, puntosDeSesion, tiempoCreible } = require("../lib/cronometro");

let ok = 0, mal = 0;
const prueba = (nombre, fn) => {
    try { fn(); console.log("  ok   " + nombre); ok++; }
    catch (e) { console.log("  MAL  " + nombre + "\n       " + e.message); mal++; }
};
const igual = (a, b, m) => { if (a !== b) throw new Error(`${m || ""} esperaba ${b}, llegó ${a}`); };
const cierto = (c, m) => { if (!c) throw new Error(m || "debería ser cierto"); };

console.log("\nDESCANSOS");

prueba("respeta lo que pidió la rutina cuando el esfuerzo fue normal", () => {
    igual(descansoSugerido({ descanso_seg: 90 }, 7), 90);
});

prueba("alarga el descanso cuando la serie llegó al límite", () => {
    cierto(descansoSugerido({ descanso_seg: 90 }, 10) > 90,
        "un RPE de 10 tiene que dar más descanso que uno de 7");
});

prueba("lo acorta cuando le sobró", () => {
    cierto(descansoSugerido({ descanso_seg: 90 }, 5) < 90);
});

prueba("nunca baja del piso ni pasa del techo", () => {
    cierto(descansoSugerido({ descanso_seg: 5 }, 5) >= 20, "piso");
    cierto(descansoSugerido({ descanso_seg: 600 }, 10) <= 300, "techo");
});

console.log("\nCOMPARACIÓN DE TIEMPOS");

const previas10x40 = [
    { repeticiones: 10, peso_kg: 40, segundos_trabajo: 60 },
    { repeticiones: 10, peso_kg: 40, segundos_trabajo: 62 },
    { repeticiones: 10, peso_kg: 40, segundos_trabajo: 58 }
];

prueba("no compara con menos de dos referencias", () => {
    const r = compararTiempo({ repeticiones: 10, peso_kg: 40, segundos_trabajo: 45 },
        [previas10x40[0]]);
    igual(r, null, "con una sola referencia no se puede concluir nada:");
});

prueba("detecta que fue más rápido", () => {
    const r = compararTiempo({ repeticiones: 10, peso_kg: 40, segundos_trabajo: 45 }, previas10x40);
    igual(r.estado, "mejor");
});

prueba("detecta que fue más lento", () => {
    const r = compararTiempo({ repeticiones: 10, peso_kg: 40, segundos_trabajo: 80 }, previas10x40);
    igual(r.estado, "peor");
});

prueba("una diferencia chica es ruido, no mejora", () => {
    const r = compararTiempo({ repeticiones: 10, peso_kg: 40, segundos_trabajo: 58 }, previas10x40);
    igual(r.estado, "igual", "2 segundos sobre 60 no es progreso:");
});

prueba("NO compara series de distintas repeticiones", () => {
    // Cinco repeticiones son más rápidas que diez por definición. Si esto
    // comparara, la aplicación felicitaría a alguien por hacer menos.
    const r = compararTiempo({ repeticiones: 5, peso_kg: 40, segundos_trabajo: 30 }, previas10x40);
    igual(r, null);
});

prueba("NO compara series de distinto peso", () => {
    const r = compararTiempo({ repeticiones: 10, peso_kg: 20, segundos_trabajo: 30 }, previas10x40);
    igual(r, null, "bajar el peso y ser más rápido no es mejorar:");
});

prueba("un tiempo disparatado en el historial no arrastra la referencia", () => {
    const conBasura = previas10x40.concat([
        { repeticiones: 10, peso_kg: 40, segundos_trabajo: 800 }
    ]);
    const r = compararTiempo({ repeticiones: 10, peso_kg: 40, segundos_trabajo: 60 }, conBasura);
    // Con promedio la referencia sería ~245 s y esto diría "mucho más
    // rápido". Con mediana sigue diciendo la verdad: igual que siempre.
    igual(r.estado, "igual");
});

console.log("\nTIEMPOS CREÍBLES");

prueba("un tiempo normal se guarda", () => {
    const r = tiempoCreible(58, 10);
    cierto(r.ok && r.guardar);
});

prueba("veinte minutos en una serie se rechaza", () => {
    igual(tiempoCreible(1200, 10).ok, false);
});

prueba("un doble toque se rechaza", () => {
    igual(tiempoCreible(2, 10).ok, false, "10 repeticiones en 2 segundos no existen:");
});

prueba("una repetición sola muy corta sí es posible", () => {
    // Un levantamiento máximo dura poquísimo, y es un registro legítimo.
    cierto(tiempoCreible(3, 1).ok);
});

prueba("cero se acepta pero no se guarda", () => {
    const r = tiempoCreible(0, 10);
    cierto(r.ok && !r.guardar, "quien no usó el cronómetro no debería ver un error");
});

console.log("\nPUNTOS");

prueba("sin series no hay puntos", () => {
    igual(puntosDeSesion({ series: [] }).total, 0);
});

prueba("terminar la sesión da puntos", () => {
    const p = puntosDeSesion({ series: [{ segundos_trabajo: 50 }] });
    cierto(p.total >= 30);
});

prueba("respetar los descansos suma", () => {
    const series = Array.from({ length: 6 }, () => ({
        descanso_objetivo: 90, segundos_descanso: 92, segundos_trabajo: 50
    }));
    const p = puntosDeSesion({ series });
    cierto(p.detalle.some(d => /Descansos respetados/.test(d.concepto)));
});

prueba("cortar todos los descansos NO suma", () => {
    const series = Array.from({ length: 6 }, () => ({
        descanso_objetivo: 90, segundos_descanso: 15, segundos_trabajo: 50
    }));
    const p = puntosDeSesion({ series });
    cierto(!p.detalle.some(d => /Descansos/.test(d.concepto)),
        "quince segundos de descanso en una rutina de noventa no es esa rutina");
});

prueba("los puntos no crecen sin límite con más series", () => {
    const pocas = puntosDeSesion({ series: Array.from({ length: 4 }, () => ({ segundos_trabajo: 50 })) });
    const muchas = puntosDeSesion({ series: Array.from({ length: 60 }, () => ({ segundos_trabajo: 50 })) });
    igual(pocas.total, muchas.total,
        "si pagara por serie, bastaría con tocar el botón sesenta veces");
});

prueba("ir más rápido en varias series suma una vez, no una por serie", () => {
    const mejor = { comparacion: { estado: "mejor" }, segundos_trabajo: 40 };
    const dos  = puntosDeSesion({ series: [mejor, mejor] });
    const diez = puntosDeSesion({ series: Array.from({ length: 10 }, () => mejor) });
    igual(dos.total, diez.total);
});

console.log(`\n  ${ok} bien · ${mal} mal\n`);
process.exit(mal > 0 ? 1 : 0);
