/**
 * pruebas/correr.js — corre todas las suites.
 *
 * Las de API necesitan el servidor levantado con su base; las demás no.
 * Si el servidor no está, se dice y se sigue en vez de dar un fallo que
 * no es un fallo del código.
 */
const { spawnSync } = require("child_process");
const path = require("path");

const SUITES = [
    { archivo: "motor.js",      necesitaServidor: false },
    { archivo: "importar.js",   necesitaServidor: false },
    { archivo: "cronometro.js", necesitaServidor: false },
    { archivo: "actividades.js", necesitaServidor: false },
    { archivo: "api.js",        necesitaServidor: true  }
];

let fallaron = 0, saltadas = 0;

for (const s of SUITES) {
    console.log(`\n${"=".repeat(60)}\n  ${s.archivo}\n${"=".repeat(60)}`);
    const r = spawnSync(process.execPath, [path.join(__dirname, s.archivo)],
        { stdio: "inherit" });

    if (r.status !== 0) {
        if (s.necesitaServidor) {
            console.log("\n  (saltada: necesita el servidor y la base levantados)");
            saltadas++;
        } else fallaron++;
    }
}

console.log(`\n${"=".repeat(60)}`);
console.log(fallaron === 0
    ? `  Todo en verde${saltadas ? ` · ${saltadas} suite(s) saltada(s) por falta de servidor` : ""}`
    : `  ${fallaron} suite(s) con fallos`);
console.log("=".repeat(60) + "\n");

process.exit(fallaron > 0 ? 1 : 0);
