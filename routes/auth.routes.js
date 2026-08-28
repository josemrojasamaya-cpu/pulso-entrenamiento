const express = require("express");
const bcrypt = require("bcryptjs");
const pool = require("../config/db");
const { firmarToken, requiereSesion } = require("../middleware/auth");

const router = express.Router();

router.post("/login", async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
        return res.status(400).json({ message: "Ingresá usuario y contraseña." });
    }

    try {
        const r = await pool.query(
            `SELECT id, username, password_hash, rol, nombre, activo
               FROM usuarios WHERE LOWER(username) = LOWER($1)`,
            [String(username).trim()]
        );
        const u = r.rows[0];

        // Se compara igual cuando el usuario no existe, contra un hash
        // descartable, para que el tiempo de respuesta no revele qué
        // nombres de usuario son reales.
        const hash = u ? u.password_hash : "$2a$10$invalidoinvalidoinvalidoinvalidoinvalidoinvalidoinvalid";
        const coincide = await bcrypt.compare(String(password), hash);

        if (!u || !coincide || !u.activo) {
            return res.status(401).json({ message: "Usuario o contraseña incorrectos." });
        }

        await pool.query("UPDATE usuarios SET ultimo_acceso = NOW() WHERE id = $1", [u.id]);

        const usuario = { id: u.id, username: u.username, rol: u.rol, nombre: u.nombre };
        res.json({ token: firmarToken(usuario), usuario });

    } catch (err) {
        console.error("[LOGIN]", err.message);
        res.status(500).json({ message: "No se pudo procesar el ingreso." });
    }
});

router.get("/yo", requiereSesion, async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT u.id, u.username, u.rol, u.nombre, u.email, u.entrenador_id,
                    e.nombre AS entrenador,
                    (p.usuario_id IS NOT NULL) AS tiene_perfil
               FROM usuarios u
               LEFT JOIN usuarios e ON e.id = u.entrenador_id
               LEFT JOIN perfiles p ON p.usuario_id = u.id
              WHERE u.id = $1`,
            [req.usuario.id]
        );
        if (r.rowCount === 0) return res.status(404).json({ message: "Cuenta no encontrada." });
        res.json({ usuario: r.rows[0] });
    } catch (err) {
        res.status(500).json({ message: "No se pudo leer la cuenta." });
    }
});

module.exports = router;
