/**
 * pruebas/rangos.js — la escala competitiva.
 *
 * Lo que se prueba son las propiedades que hacen que un ranking
 * signifique algo: que no se pueda saltar, que no baje de golpe, y que
 * el orden sea el que la gente espera.
 */
const { RANGOS, rangoDe, distancia, decaimiento } = require("../lib/rangos");

let ok = 0, mal = 0;
const prueba = (n, f) => {
    try { f(); console.log("  ok   " + n); ok++; }
    catch (e) { console.log("  MAL  " + n + "\n       " + e.message); mal++; }
};
const igual = (a, b, m) => { if (a !== b) throw new Error(`${m || ""} esperaba ${b}, llegó ${a}`); };
const cierto = (c, m) => { if (!c) throw new Error(m || "debería ser cierto"); };

console.log("\nESCALA");

prueba("se empieza en Bronce III", () => {
    igual(rangoDe(0).nombre, "Bronce III");
});

prueba("las divisiones van de III a I, de peor a mejor", () => {
    // Es la convención de todos los juegos competitivos. Al revés
    // confundiría a cualquiera que ya la conoce.
    const nombres = [0, 150, 350, 550].map(p => rangoDe(p).nombre);
    igual(nombres[0], "Bronce III");
    cierto(nombres.includes("Bronce II") && nombres.includes("Bronce I"),
        "faltan divisiones intermedias: " + nombres.join(", "));
});

prueba("cada rango empieza donde dice su umbral", () => {
    for (const r of RANGOS) igual(rangoDe(r.desde).base, r.nombre, `en ${r.desde} puntos:`);
});

prueba("el último rango no tiene divisiones", () => {
    igual(rangoDe(20000).nombre, "Legendario");
});

prueba("más puntos NUNCA dan un rango peor", () => {
    // La propiedad que sostiene todo: si en algún tramo sumar puntos
    // bajara el rango, el ranking entero deja de tener sentido.
    let anterior = -1;
    for (let p = 0; p <= 25000; p += 25) {
        const r = rangoDe(p);
        const i = RANGOS.findIndex(x => x.codigo === r.codigo);
        const orden = i * 3 + (3 - r.division);
        if (orden < anterior) throw new Error(`con ${p} puntos el rango bajó`);
        anterior = orden;
    }
});

prueba("no se salta ninguna división al subir de a poco", () => {
    const vistos = [];
    for (let p = 0; p <= 20000; p += 5) {
        const n = rangoDe(p).nombre;
        if (vistos[vistos.length - 1] !== n) vistos.push(n);
    }
    // 5 rangos con 3 divisiones + Legendario = 16
    igual(vistos.length, 16, "secuencia: " + vistos.join(" → "));
});

prueba("un valor negativo o basura no rompe nada", () => {
    igual(rangoDe(-500).nombre, "Bronce III");
    igual(rangoDe(null).nombre, "Bronce III");
    igual(rangoDe("hola").nombre, "Bronce III");
});

console.log("\nAVANCE");

prueba("el avance va de 0 a 100 en todo el recorrido", () => {
    for (let p = 0; p <= 20000; p += 37) {
        const a = rangoDe(p).avance;
        cierto(a >= 0 && a <= 100, `con ${p} puntos el avance fue ${a}`);
    }
});

prueba("recién ascendido, el avance está cerca de cero", () => {
    cierto(rangoDe(600).avance < 10, "al entrar a Plata el avance debería empezar de nuevo");
});

prueba("dice cuál es el siguiente escalón", () => {
    igual(rangoDe(0).siguiente, "Bronce II");
    igual(rangoDe(1700).siguiente, "Oro III", "desde la última división se pasa al rango siguiente");
});

prueba("en Legendario no hay siguiente", () => {
    igual(rangoDe(30000).siguiente, null);
    igual(rangoDe(30000).max, true);
});

prueba("las primeras divisiones cuestan menos que las últimas", () => {
    // Quien empieza tiene que ver progreso en la primera semana; quien
    // va por Diamante tiene que sudarlo.
    const primerSalto = rangoDe(0).falta;
    const saltoAlto = rangoDe(8000).falta;
    cierto(saltoAlto > primerSalto * 3,
        `subir arriba tiene que costar mucho más: ${primerSalto} vs ${saltoAlto}`);
});

console.log("\nDISTANCIA");

prueba("mide la diferencia en divisiones, no en puntos", () => {
    igual(distancia(0, 0), 0);
    cierto(distancia(0, 16000) >= 15, "de Bronce III a Legendario hay toda la escala");
});

prueba("es simétrica", () => {
    igual(distancia(500, 3000), distancia(3000, 500));
});

console.log("\nDECAIMIENTO");

prueba("un mes sin entrenar no cuesta nada", () => {
    // La gente se enferma, viaja y tiene hijos. Castigar eso es la forma
    // más rápida de que no vuelva.
    igual(decaimiento(3000, 30).perdidos, 0);
    igual(decaimiento(3000, 12).perdidos, 0);
});

prueba("después del mes se empiezan a perder puntos", () => {
    cierto(decaimiento(3000, 120).perdidos > 0);
});

prueba("NUNCA se baja del rango base ya alcanzado", () => {
    // Quien llegó a Oro no vuelve a Plata. Perder un rango entero por
    // una lesión larga es la forma más rápida de que alguien no vuelva.
    const r = decaimiento(1900, 3000);   // Oro recién alcanzado, años sin entrar
    igual(rangoDe(r.puntos).base, "Oro");
});

prueba("el decaimiento es lento, no un desplome", () => {
    const dosMeses = decaimiento(4000, 60);
    cierto(dosMeses.perdidos < 4000 * 0.06,
        `dos meses fuera no pueden costar el 6% de todo: perdió ${dosMeses.perdidos}`);
});

console.log(`\n  ${ok} bien · ${mal} mal\n`);
process.exit(mal > 0 ? 1 : 0);
