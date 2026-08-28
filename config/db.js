const { Pool } = require("pg");

/**
 * Conexión a PostgreSQL.
 *
 * Las tablas viven en un esquema propio, así que esta aplicación puede
 * compartir una base con otra sin que los nombres choquen.
 */
const DB_URL =
    process.env.DATABASE_URL ||
    "postgres://postgres:postgres@localhost:5432/forja";

const ESQUEMA = process.env.DB_SCHEMA || "forja";

/**
 * El SSL se decide por el destino, no por la existencia de la variable:
 * la misma DATABASE_URL apuntando a un PostgreSQL local no lo soporta, y
 * exigirlo ahí falla con un error que no explica el motivo.
 */
function usaSSL(url) {
    if (process.env.PGSSLMODE === "disable") return false;
    try {
        const host = new URL(url).hostname;
        return !(host === "localhost" || host === "127.0.0.1" || host === "::1");
    } catch {
        return false;
    }
}

const conSSL = usaSSL(DB_URL);

const pool = new Pool({
    connectionString: DB_URL,
    ssl: conSSL ? { rejectUnauthorized: false } : false,
    options: `-c search_path=${ESQUEMA},public`,
    connectionTimeoutMillis: 8000,
    idleTimeoutMillis: 30000,
    max: 10
});

function hostVisible(url) {
    try {
        const u = new URL(url);
        return `${u.hostname}${u.pathname}`;
    } catch {
        return "(cadena de conexión no interpretable)";
    }
}

console.log(`[DB] destino: ${hostVisible(DB_URL)} · esquema: ${ESQUEMA} · SSL ${conSSL ? "sí" : "no"}`);

pool.on("error", (err) => {
    console.error("[DB] error en el pool:", err.message);
});

/**
 * El esquema se fija por tres caminos, de más a menos duradero:
 *
 *   1. `ALTER DATABASE ... SET search_path`, que el instalador ejecuta
 *      una vez. Queda grabado en la base y vale para toda conexión
 *      futura, venga por donde venga.
 *   2. El `options` de arriba, en el saludo de cada conexión.
 *   3. Nada más: un listener de `connect` que lanzara un SET aquí
 *      ejecutaría una consulta sobre un cliente todavía ocupado, y eso
 *      node-postgres lo da por obsoleto.
 *
 * Con el primero basta; el segundo cubre el caso de una base donde el
 * ALTER no se pudo aplicar por permisos.
 */
async function fijarEsquemaEnLaBase() {
    try {
        // El nombre de la base sale de la propia conexión y se escapa con
        // quote_ident: nunca se concatena texto que venga de afuera.
        const r = await pool.query("SELECT current_database() db");
        const nombre = r.rows[0].db;
        const ident = await pool.query("SELECT quote_ident($1) q", [nombre]);
        await pool.query(`ALTER DATABASE ${ident.rows[0].q} SET search_path TO ${ESQUEMA}, public`);
        return true;
    } catch (err) {
        console.warn(`[DB] no se pudo fijar el esquema en la base (${err.message}).`);
        console.warn("[DB] Se seguirá usando el parámetro de conexión.");
        return false;
    }
}
module.exports.fijarEsquemaEnLaBase = fijarEsquemaEnLaBase;

pool.query("SELECT 1")
    .then(() => console.log("[DB] conexión verificada"))
    .catch((err) => console.error("[DB] NO SE PUDO CONECTAR:", err.message));

module.exports = pool;
module.exports.ESQUEMA = ESQUEMA;
