const jwt = require("jsonwebtoken");
const pool = require("../config/db");

/**
 * Autenticación y permisos.
 *
 * Los datos de entrenamiento son personales: peso, medidas corporales,
 * condiciones de salud. Un entrenador ve los de sus atletas y nada más;
 * un atleta ve los suyos.
 *
 * El permiso se resuelve contra la base en cada petición y no contra lo
 * que diga el token: si un atleta deja a su entrenador, el token viejo
 * de ese entrenador no debe seguir sirviendo.
 */

const SECRETO = process.env.JWT_SECRET || "forja-desarrollo-local";
const VIGENCIA = "30d";   // en el celular, pedir sesión cada 8 h es inusable

if (!process.env.JWT_SECRET) {
    console.warn("[AUTH] JWT_SECRET sin definir: se usa una clave de desarrollo.");
}

function firmarToken(u) {
    return jwt.sign(
        { id: u.id, username: u.username, rol: u.rol, nombre: u.nombre },
        SECRETO,
        { expiresIn: VIGENCIA }
    );
}

function requiereSesion(req, res, next) {
    const cabecera = req.get("authorization") || "";
    const token = cabecera.startsWith("Bearer ") ? cabecera.slice(7) : null;

    if (!token) return res.status(401).json({ message: "Se requiere iniciar sesión." });

    try {
        req.usuario = jwt.verify(token, SECRETO);
        next();
    } catch (err) {
        const expirado = err.name === "TokenExpiredError";
        res.status(401).json({
            message: expirado ? "La sesión venció. Entrá de nuevo." : "Sesión inválida.",
            expirado
        });
    }
}

function requiereRol(...roles) {
    return (req, res, next) => {
        if (!req.usuario) return res.status(401).json({ message: "Se requiere iniciar sesión." });
        if (!roles.includes(req.usuario.rol)) {
            return res.status(403).json({ message: "Tu cuenta no tiene permiso para esto." });
        }
        next();
    };
}

/**
 * ¿Puede este usuario ver los datos de este atleta?
 *
 *   uno mismo   → siempre
 *   entrenador  → sólo sus atletas asignados
 *   admin       → todos
 */
async function puedeVerAtleta(usuario, atletaId) {
    if (!usuario) return false;
    if (Number(usuario.id) === Number(atletaId)) return true;
    if (usuario.rol === "admin") return true;

    if (usuario.rol === "entrenador") {
        const r = await pool.query(
            "SELECT 1 FROM usuarios WHERE id = $1 AND entrenador_id = $2",
            [atletaId, usuario.id]
        );
        return r.rowCount > 0;
    }
    return false;
}

/**
 * Corta la petición si no hay permiso sobre el atleta de la ruta.
 *
 * Responde 404 y no 403: un 403 confirmaría que esa cuenta existe.
 */
async function exigirAccesoAtleta(req, res, next) {
    const id = Number(req.params.id || req.params.atletaId);
    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ message: "Identificador inválido." });
    }
    try {
        if (await puedeVerAtleta(req.usuario, id)) {
            req.atletaId = id;
            return next();
        }
        return res.status(404).json({ message: "No encontrado." });
    } catch (err) {
        console.error("[AUTH] error verificando permiso:", err.message);
        return res.status(500).json({ message: "No se pudo verificar el permiso." });
    }
}

module.exports = {
    firmarToken, requiereSesion, requiereRol, puedeVerAtleta, exigirAccesoAtleta
};
