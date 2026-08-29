/**
 * db/arranque.js — prepara la base y levanta el servidor.
 *
 * Antes el arranque en Render era `node db/setup.js && npm start`, y ese
 * `&&` tenía dos problemas que en local no se ven:
 *
 *   1. Si la base todavía no acepta conexiones —normal los primeros
 *      segundos de un despliegue nuevo, o cuando despierta— setup.js
 *      falla, el `&&` corta, y el servicio muere entero. Sin servidor no
 *      hay a dónde entrar a mirar qué pasó.
 *
 *   2. Cuando muere así, lo único que queda es el registro de un proceso
 *      que ya terminó. Diagnosticar a ciegas es mucho más caro que
 *      dejar el servidor en pie diciendo qué le falta.
 *
 * Acá se espera a que la base responda, se prepara, y si algo sale mal
 * el servidor arranca IGUAL: sirve la aplicación y deja el error en el
 * registro, donde se puede leer.
 */
const pool = require("../config/db");

const INTENTOS = 10;
const ESPERA_MS = 3000;

async function esperarBase() {
    for (let i = 1; i <= INTENTOS; i++) {
        try {
            await pool.query("SELECT 1");
            console.log(`[ARRANQUE] base disponible (intento ${i})`);
            return true;
        } catch (err) {
            console.log(`[ARRANQUE] la base no responde todavía (${i}/${INTENTOS}): ${err.message}`);
            if (i < INTENTOS) await new Promise(r => setTimeout(r, ESPERA_MS));
        }
    }
    return false;
}

async function arrancar() {
    const viva = await esperarBase();

    if (viva) {
        try {
            // setup.js es idempotente: crea lo que falta y no toca lo que
            // ya está. Correrlo en cada arranque es seguro y mantiene el
            // esquema al día sin un paso manual después de cada despliegue.
            await require("./setup").main({ cerrarPool: false });
            console.log("[ARRANQUE] esquema al día");
        } catch (err) {
            console.error("[ARRANQUE] la preparación de la base falló:", err.message);
            console.error("[ARRANQUE] el servidor arranca igual; revisá este error.");
        }
    } else {
        console.error("[ARRANQUE] la base nunca respondió. El servidor arranca, " +
                      "pero todo lo que necesite datos va a fallar.");
    }

    require("../app");
}

arrancar();
