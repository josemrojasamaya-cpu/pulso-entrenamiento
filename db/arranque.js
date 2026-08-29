/**
 * db/arranque.js — abre el puerto primero, prepara la base después.
 *
 * El orden importa y es la causa de que los dos despliegues anteriores
 * fallaran.
 *
 * Render vigila que el servicio abra su puerto en los primeros segundos.
 * Si no lo ve, lo mata con "no open ports detected" y marca el
 * despliegue como fallido. Pero setup.js no solo crea tablas: siembra
 * meses de historial de ejemplo, y eso tarda. Con el arranque anterior
 * -esperar a la base, preparar, y recién entonces escuchar- el servidor
 * pasaba ese rato sin puerto abierto y Render lo daba por muerto antes
 * de que llegara a servir nada.
 *
 * Acá se escucha PRIMERO. La preparación corre después, en segundo
 * plano, y si tarda un minuto no le importa a nadie: el puerto ya está
 * abierto y la pantalla de acceso ya responde.
 *
 * Lo que se pierde: durante esos segundos, quien entre va a ver errores
 * de datos. Es mucho mejor que un servicio que nunca arranca.
 */

// Esto abre el puerto de inmediato: app.js llama a listen() al cargarse.
require("../app");

const pool = require("../config/db");

const INTENTOS = 20;
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

(async () => {
    if (!await esperarBase()) {
        console.error("[ARRANQUE] la base nunca respondió en un minuto. " +
                      "El servidor sigue en pie, pero todo lo que necesite datos va a fallar.");
        return;
    }

    try {
        // Idempotente: crea lo que falta y no toca lo que ya está.
        await require("./setup").main({ cerrarPool: false });
        console.log("[ARRANQUE] esquema y datos al día");
    } catch (err) {
        console.error("[ARRANQUE] la preparación de la base falló:", err.message);
        console.error("[ARRANQUE] el servidor sigue en pie; revisá este error.");
    }
})();
