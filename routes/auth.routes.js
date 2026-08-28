const express = require("express");
const bcrypt = require("bcryptjs");
const pool = require("../config/db");
const { firmarToken, requiereSesion } = require("../middleware/auth");

const router = express.Router();

/** Versión vigente de los documentos legales. Ver public/terminos.html. */
const VERSION_TERMINOS = "1.0";

/** Código de invitación: seis caracteres sin los que se confunden al dictar. */
function nuevoCodigoInvitacion() {
    const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // sin I, O, 0, 1
    let c = "";
    for (let i = 0; i < 6; i++) c += alfabeto[Math.floor(Math.random() * alfabeto.length)];
    return c;
}

function ipDe(req) {
    const reenviada = req.get("x-forwarded-for");
    const ip = reenviada ? reenviada.split(",")[0].trim() : req.ip;
    return ip ? String(ip).slice(0, 60) : null;
}

/**
 * Registro de una cuenta nueva.
 *
 * Crea el usuario, deja constancia del consentimiento y guarda de una vez
 * los datos físicos que ya se pidieron, para que la persona no tenga que
 * escribirlos otra vez en el perfil.
 */
router.post("/registro", async (req, res) => {
    const b = req.body || {};
    const nombre   = String(b.nombre || "").trim();
    const email    = String(b.email || "").trim().toLowerCase();
    const username = String(b.username || "").trim();
    const password = String(b.password || "");

    if (nombre.length < 3)   return res.status(400).json({ message: "Escribí tu nombre completo." });
    if (username.length < 3) return res.status(400).json({ message: "El usuario necesita al menos tres caracteres." });
    if (!/^[a-z0-9._-]+$/i.test(username)) {
        return res.status(400).json({ message: "El usuario sólo puede llevar letras, números, punto, guion y guion bajo." });
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return res.status(400).json({ message: "Ese correo no parece válido." });
    }
    if (password.length < 8) {
        return res.status(400).json({ message: "La contraseña necesita ocho caracteres o más." });
    }
    // Sin consentimiento no se crea la cuenta. No es una formalidad: esta
    // aplicación trata datos de salud.
    if (!b.acepta_terminos) {
        return res.status(400).json({ message: "Hay que aceptar los términos para crear la cuenta." });
    }

    const altura = b.altura_cm === null || b.altura_cm === undefined || b.altura_cm === ""
        ? null : Number(b.altura_cm);
    const peso = b.peso_kg === null || b.peso_kg === undefined || b.peso_kg === ""
        ? null : Number(b.peso_kg);

    if (altura !== null && (!Number.isFinite(altura) || altura < 100 || altura > 250)) {
        return res.status(400).json({ message: "La altura tiene que estar entre 100 y 250 cm." });
    }
    if (peso !== null && (!Number.isFinite(peso) || peso < 25 || peso > 400)) {
        return res.status(400).json({ message: "El peso tiene que estar entre 25 y 400 kg." });
    }

    const cliente = await pool.connect();
    try {
        await cliente.query("BEGIN");

        const ocupado = await cliente.query(
            "SELECT username, email FROM usuarios WHERE LOWER(username) = LOWER($1) OR LOWER(email) = $2",
            [username, email]
        );
        if (ocupado.rowCount > 0) {
            await cliente.query("ROLLBACK");
            const f = ocupado.rows[0];
            return res.status(409).json({
                message: String(f.email || "").toLowerCase() === email
                    ? "Ya hay una cuenta con ese correo."
                    : "Ese nombre de usuario ya está tomado."
            });
        }

        // Código único. Se reintenta ante la colisión improbable en vez de
        // confiar en que no va a pasar nunca.
        let codigo = null;
        for (let intento = 0; intento < 5 && !codigo; intento++) {
            const c = nuevoCodigoInvitacion();
            const existe = await cliente.query(
                "SELECT 1 FROM usuarios WHERE codigo_invitacion = $1", [c]
            );
            if (existe.rowCount === 0) codigo = c;
        }

        // El rol se elige al registrarse, y sólo entre los dos que la
        // pantalla ofrece. Se valida contra una lista blanca y NUNCA se
        // pasa lo que llegue del cliente: sin esta comprobación bastaría
        // con mandar rol:"admin" desde la consola del navegador para
        // crearse una cuenta con permisos de administrador.
        const ROLES_PERMITIDOS = ["atleta", "entrenador"];
        const rol = ROLES_PERMITIDOS.includes(b.rol) ? b.rol : "atleta";

        const r = await cliente.query(
            `INSERT INTO usuarios (username, password_hash, rol, nombre, email, telefono, codigo_invitacion)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             RETURNING id, username, rol, nombre, email, plan, codigo_invitacion`,
            [username, await bcrypt.hash(password, 10), rol, nombre, email,
             b.telefono ? String(b.telefono).trim().slice(0, 40) : null, codigo]
        );
        const u = r.rows[0];

        // Constancia del consentimiento, con versión, fecha y origen.
        for (const documento of ["terminos", "privacidad", "salud"]) {
            await cliente.query(
                `INSERT INTO consentimientos (usuario_id, documento, version, ip)
                 VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
                [u.id, documento, VERSION_TERMINOS, ipDe(req)]
            );
        }

        // Perfil inicial con lo que ya se preguntó.
        await cliente.query(
            `INSERT INTO perfiles (usuario_id, fecha_nacimiento, sexo, altura_cm)
             VALUES ($1,$2::date,$3,$4) ON CONFLICT (usuario_id) DO NOTHING`,
            [u.id, b.fecha_nacimiento || null, b.sexo || null, altura]
        );

        // El peso de hoy es la primera medición: el punto de partida
        // contra el que se van a comparar todas las demás.
        if (peso !== null) {
            await cliente.query(
                `INSERT INTO mediciones (usuario_id, fecha, peso_kg, notas)
                 VALUES ($1, CURRENT_DATE, $2, 'Registro inicial')
                 ON CONFLICT (usuario_id, fecha) DO NOTHING`,
                [u.id, peso]
            );
        }

        await cliente.query("COMMIT");

        const usuario = { id: u.id, username: u.username, rol: u.rol, nombre: u.nombre };
        res.status(201).json({
            token: firmarToken(usuario),
            usuario: { ...usuario, email: u.email, plan: u.plan, codigo_invitacion: u.codigo_invitacion }
        });

    } catch (err) {
        await cliente.query("ROLLBACK").catch(() => {});
        console.error("[REGISTRO]", err.message);
        res.status(500).json({ message: "No se pudo crear la cuenta. Probá de nuevo." });
    } finally {
        cliente.release();
    }
});

router.post("/login", async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
        return res.status(400).json({ message: "Ingresá usuario y contraseña." });
    }

    try {
        // Se acepta el usuario o el correo: es lo que dice el campo, y a
        // los pocos días nadie recuerda cuál de los dos eligió.
        const r = await pool.query(
            `SELECT id, username, password_hash, rol, nombre, activo
               FROM usuarios
              WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1)`,
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
