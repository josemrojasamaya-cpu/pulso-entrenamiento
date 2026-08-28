/**
 * Pulso — entrenador adaptativo.
 *
 * Sirve la interfaz (una PWA instalable) y expone la API.
 */

const express = require("express");
const path = require("path");
const pool = require("./config/db");

const app = express();

app.set("trust proxy", true);
app.use(express.json({ limit: "2mb" }));   // la sincronización manda lotes

/**
 * El service worker se sirve sin caché.
 *
 * Es el archivo que decide qué se guarda para usar sin conexión: si el
 * navegador se queda con una copia vieja, la aplicación puede quedar
 * congelada en una versión anterior sin forma de actualizarse.
 */
app.get("/sw.js", (req, res) => {
    res.set("Cache-Control", "no-cache, no-store, must-revalidate");
    res.sendFile(path.join(__dirname, "public", "sw.js"));
});

app.use(express.static(path.join(__dirname, "public")));

/** Estado del sistema. Declarado antes que los routers para que ningún
 *  middleware de sesión lo tape justo cuando hace falta diagnosticar. */
app.get("/api/salud", async (req, res) => {
    const estado = { servidor: "ok", base_de_datos: "sin verificar", tablas: null, contenido: null };
    try {
        await pool.query("SELECT 1");
        estado.base_de_datos = "conectada";

        const t = await pool.query(
            "SELECT COUNT(*)::int n FROM information_schema.tables WHERE table_schema = $1",
            [pool.ESQUEMA]
        );
        estado.tablas = t.rows[0].n;

        if (estado.tablas === 0) {
            estado.contenido = "sin tablas — falta aplicar el esquema (npm run setup)";
        } else {
            const c = await pool.query(`
                SELECT (SELECT COUNT(*) FROM usuarios)::int   usuarios,
                       (SELECT COUNT(*) FROM ejercicios)::int ejercicios,
                       (SELECT COUNT(*) FROM rutinas)::int    rutinas,
                       (SELECT COUNT(*) FROM series)::int     series,
                       (SELECT COUNT(*) FROM mediciones)::int mediciones
            `);
            estado.contenido = c.rows[0];
        }
        res.json(estado);
    } catch (err) {
        estado.base_de_datos = "sin conexión";
        estado.detalle = err.message;
        res.status(503).json(estado);
    }
});

app.use("/api", require("./routes/auth.routes"));
app.use("/api/atleta", require("./routes/perfil.routes"));
app.use("/api/entrenamiento", require("./routes/entrenamiento.routes"));
app.use("/api/progreso", require("./routes/progreso.routes"));
app.use("/api/grupos", require("./routes/grupos.routes"));
app.use("/api/retos", require("./routes/retos.routes"));
app.use("/api/salud", require("./routes/salud.routes"));
app.use("/api/actividades", require("./routes/actividades.routes"));

/** Catálogo de planes. Público: se muestra antes de tener cuenta. */
app.get("/api/planes", (req, res) => res.json(require("./lib/planes").catalogo()));

app.use("/api", (req, res) => res.status(404).json({ message: "Recurso no encontrado." }));

/** Instala la base al arrancar si está vacía. En planes sin consola es
 *  la única forma de aplicar el esquema. */
async function prepararBase() {
    try {
        const r = await pool.query(
            "SELECT COUNT(*)::int n FROM information_schema.tables WHERE table_schema = $1",
            [pool.ESQUEMA]
        );
        if (r.rows[0].n > 0) {
            const u = await pool.query("SELECT COUNT(*)::int n FROM usuarios").catch(() => null);
            if (u && u.rows[0].n > 0) {
                console.log(`[SETUP] base con ${r.rows[0].n} tablas y ${u.rows[0].n} cuentas: no se toca`);
                return;
            }
        }
        console.log("[SETUP] preparando la base…");
        await require("./db/setup").main({ cerrarPool: false });
        console.log("[SETUP] listo");
    } catch (err) {
        console.error("[SETUP] no se pudo preparar la base:", err.message);
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Pulso escuchando en el puerto ${PORT}`);
    prepararBase();
});
