const express = require("express");
const pool = require("../config/db");
const { requiereSesion } = require("../middleware/auth");
const { planDe, limite } = require("../lib/planes");

const router = express.Router();
router.use(requiereSesion);

/* ── Utilidades ───────────────────────────────────────────────────── */

/** Código de grupo: sin los caracteres que se confunden al dictarlo. */
function nuevoCodigo() {
    const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // sin I, O, 0, 1
    let c = "";
    for (let i = 0; i < 6; i++) c += alfabeto[Math.floor(Math.random() * alfabeto.length)];
    return c;
}

async function cuentaDe(usuarioId) {
    const r = await pool.query(
        "SELECT id, nombre, plan, plan_vence FROM usuarios WHERE id = $1", [usuarioId]
    );
    return r.rows[0] || null;
}

/** ¿Pertenece esta persona a este grupo? */
async function esMiembro(grupoId, usuarioId) {
    const r = await pool.query(
        "SELECT rol FROM grupo_miembros WHERE grupo_id = $1 AND usuario_id = $2",
        [grupoId, usuarioId]
    );
    return r.rowCount ? r.rows[0].rol : null;
}

/* ── Grupos ───────────────────────────────────────────────────────── */

/** Los grupos de la persona, con sus miembros y el ranking interno. */
router.get("/", async (req, res) => {
    try {
        const grupos = await pool.query(
            `SELECT g.*, gm.rol AS mi_rol,
                    (SELECT COUNT(*) FROM grupo_miembros m WHERE m.grupo_id = g.id)::int miembros,
                    (SELECT COUNT(*) FROM retos r
                      WHERE r.grupo_id = g.id AND r.estado = 'activo'
                        AND r.fin >= CURRENT_DATE)::int retos_activos
               FROM grupos g
               JOIN grupo_miembros gm ON gm.grupo_id = g.id
              WHERE gm.usuario_id = $1 AND g.activo
              ORDER BY g.creado_en DESC`,
            [req.usuario.id]
        );

        const cuenta = await cuentaDe(req.usuario.id);
        const plan = planDe(cuenta);

        res.json({
            grupos: grupos.rows,
            plan: { codigo: plan.codigo, nombre: plan.nombre, limites: plan.limites },
            puede_crear: grupos.rows.length < plan.limites.grupos
        });
    } catch (err) {
        console.error("[GRUPOS] listar:", err.message);
        res.status(500).json({ message: "No se pudieron leer tus grupos." });
    }
});

/** Crear un grupo. Quien lo crea queda como dueño. */
router.post("/", async (req, res) => {
    const nombre = String((req.body && req.body.nombre) || "").trim();
    if (nombre.length < 3) {
        return res.status(400).json({ message: "El grupo necesita un nombre de al menos tres letras." });
    }

    const cuenta = await cuentaDe(req.usuario.id);
    const plan = planDe(cuenta);

    const propios = await pool.query(
        `SELECT COUNT(*)::int n FROM grupo_miembros gm
           JOIN grupos g ON g.id = gm.grupo_id
          WHERE gm.usuario_id = $1 AND g.activo`,
        [req.usuario.id]
    );
    if (propios.rows[0].n >= plan.limites.grupos) {
        return res.status(402).json({
            message: `El plan ${plan.nombre} permite ${plan.limites.grupos} ` +
                     `grupo${plan.limites.grupos === 1 ? "" : "s"}. Para tener más, hay que cambiar de plan.`,
            requiere_plan: true
        });
    }

    const cliente = await pool.connect();
    try {
        await cliente.query("BEGIN");

        // Se reintenta ante la colisión improbable en vez de confiar en
        // que no va a pasar nunca.
        let codigo = null;
        for (let i = 0; i < 6 && !codigo; i++) {
            const c = nuevoCodigo();
            const existe = await cliente.query("SELECT 1 FROM grupos WHERE codigo = $1", [c]);
            if (existe.rowCount === 0) codigo = c;
        }
        if (!codigo) throw new Error("no se pudo generar un código único");

        const g = await cliente.query(
            `INSERT INTO grupos (nombre, descripcion, creador_id, codigo, tipo, max_miembros)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [nombre.slice(0, 80),
             String((req.body && req.body.descripcion) || "").trim().slice(0, 200) || null,
             req.usuario.id, codigo,
             req.usuario.rol === "entrenador" ? "equipo" : "amigos",
             plan.limites.miembros_por_grupo]
        );

        await cliente.query(
            "INSERT INTO grupo_miembros (grupo_id, usuario_id, rol) VALUES ($1,$2,'dueño')",
            [g.rows[0].id, req.usuario.id]
        );

        await cliente.query("COMMIT");
        res.status(201).json({ grupo: { ...g.rows[0], mi_rol: "dueño", miembros: 1 } });
    } catch (err) {
        await cliente.query("ROLLBACK").catch(() => {});
        console.error("[GRUPOS] crear:", err.message);
        res.status(500).json({ message: "No se pudo crear el grupo." });
    } finally {
        cliente.release();
    }
});

/**
 * Detalle de un grupo: miembros y ranking interno.
 *
 * El ranking del grupo NO muestra pesos ni medidas de nadie. Sólo
 * puntos, sesiones y días activos: es lo que se acordó en los términos
 * y es lo único que se puede comparar entre personas distintas sin que
 * el resultado sea una tabla ordenada por genética.
 */
router.get("/:id", async (req, res) => {
    const id = Number(req.params.id);
    try {
        const rol = await esMiembro(id, req.usuario.id);
        if (!rol) return res.status(404).json({ message: "Grupo no encontrado." });

        const [grupo, miembros, retos] = await Promise.all([
            pool.query("SELECT * FROM grupos WHERE id = $1 AND activo", [id]),

            pool.query(
                `SELECT u.id, u.nombre, gm.rol, gm.unido_en,
                        COALESCE((SELECT SUM(p.puntos) FROM puntos p
                                   WHERE p.usuario_id = u.id),0)::int puntos,
                        (SELECT COUNT(*) FROM rutinas r
                          WHERE r.usuario_id = u.id AND r.estado = 'completada')::int sesiones,
                        (SELECT COUNT(DISTINCT date_trunc('day', s.realizada_en))::int
                           FROM series s
                          WHERE s.usuario_id = u.id
                            AND s.realizada_en > NOW() - INTERVAL '30 days') dias_mes,
                        (SELECT MAX(s.realizada_en) FROM series s WHERE s.usuario_id = u.id) ultimo
                   FROM grupo_miembros gm
                   JOIN usuarios u ON u.id = gm.usuario_id
                  WHERE gm.grupo_id = $1
                  ORDER BY puntos DESC`, [id]),

            pool.query(
                `SELECT r.*, u.nombre AS creador,
                        (SELECT COUNT(*) FROM reto_participantes rp
                          WHERE rp.reto_id = r.id)::int participantes
                   FROM retos r JOIN usuarios u ON u.id = r.creador_id
                  WHERE r.grupo_id = $1
                  ORDER BY r.estado, r.fin DESC LIMIT 20`, [id])
        ]);

        if (grupo.rowCount === 0) return res.status(404).json({ message: "Grupo no encontrado." });

        const { nivelDe } = require("../lib/puntos");

        res.json({
            grupo: { ...grupo.rows[0], mi_rol: rol },
            miembros: miembros.rows.map((m, i) => ({
                ...m,
                // Sólo el nombre de pila: el grupo puede tener gente que
                // apenas se conoce.
                nombre: String(m.nombre).split(" ")[0],
                posicion: i + 1,
                soy_yo: m.id === req.usuario.id,
                nivel: nivelDe(m.puntos)
            })),
            retos: retos.rows
        });
    } catch (err) {
        console.error("[GRUPOS] detalle:", err.message);
        res.status(500).json({ message: "No se pudo leer el grupo." });
    }
});

/** Vista previa por código, antes de entrar. */
router.get("/codigo/:codigo", async (req, res) => {
    const codigo = String(req.params.codigo || "").toUpperCase().trim();
    try {
        const r = await pool.query(
            `SELECT g.id, g.nombre, g.descripcion, g.tipo, g.max_miembros,
                    u.nombre AS creador,
                    (SELECT COUNT(*) FROM grupo_miembros m WHERE m.grupo_id = g.id)::int miembros
               FROM grupos g JOIN usuarios u ON u.id = g.creador_id
              WHERE g.codigo = $1 AND g.activo`, [codigo]
        );
        if (r.rowCount === 0) {
            return res.status(404).json({ message: "Ese código no corresponde a ningún grupo." });
        }
        const g = r.rows[0];
        res.json({
            grupo: { ...g, creador: String(g.creador).split(" ")[0] },
            ya_soy_miembro: Boolean(await esMiembro(g.id, req.usuario.id)),
            lleno: g.miembros >= g.max_miembros
        });
    } catch (err) {
        res.status(500).json({ message: "No se pudo consultar el código." });
    }
});

/** Unirse con un código. Es lo que hay detrás del QR y del enlace. */
router.post("/unirme", async (req, res) => {
    const codigo = String((req.body && req.body.codigo) || "").toUpperCase().trim();
    if (!/^[A-Z0-9]{4,10}$/.test(codigo)) {
        return res.status(400).json({ message: "Ese código no tiene la forma correcta." });
    }

    try {
        const g = await pool.query(
            "SELECT id, nombre, max_miembros FROM grupos WHERE codigo = $1 AND activo", [codigo]
        );
        if (g.rowCount === 0) {
            return res.status(404).json({ message: "Ese código no corresponde a ningún grupo." });
        }
        const grupo = g.rows[0];

        if (await esMiembro(grupo.id, req.usuario.id)) {
            return res.status(409).json({ message: "Ya sos parte de este grupo.", grupo_id: grupo.id });
        }

        const cuantos = await pool.query(
            "SELECT COUNT(*)::int n FROM grupo_miembros WHERE grupo_id = $1", [grupo.id]
        );
        if (cuantos.rows[0].n >= grupo.max_miembros) {
            return res.status(409).json({
                message: `"${grupo.nombre}" ya está completo (${grupo.max_miembros} personas). ` +
                         "Quien lo creó puede ampliarlo cambiando de plan."
            });
        }

        // El límite de grupos también aplica a quien se une, no sólo a
        // quien crea: si no, se esquiva pidiéndole a otro que cree.
        const cuenta = await cuentaDe(req.usuario.id);
        const plan = planDe(cuenta);
        const propios = await pool.query(
            `SELECT COUNT(*)::int n FROM grupo_miembros gm
               JOIN grupos g ON g.id = gm.grupo_id
              WHERE gm.usuario_id = $1 AND g.activo`, [req.usuario.id]
        );
        if (propios.rows[0].n >= plan.limites.grupos) {
            return res.status(402).json({
                message: `El plan ${plan.nombre} permite estar en ${plan.limites.grupos} ` +
                         `grupo${plan.limites.grupos === 1 ? "" : "s"}. Salí de uno o cambiá de plan.`,
                requiere_plan: true
            });
        }

        await pool.query(
            "INSERT INTO grupo_miembros (grupo_id, usuario_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
            [grupo.id, req.usuario.id]
        );

        res.status(201).json({ ok: true, grupo_id: grupo.id, nombre: grupo.nombre });
    } catch (err) {
        console.error("[GRUPOS] unirse:", err.message);
        res.status(500).json({ message: "No se pudo entrar al grupo." });
    }
});

/** Salir de un grupo, o sacar a alguien si sos el dueño. */
router.delete("/:id/miembros/:usuarioId", async (req, res) => {
    const grupoId = Number(req.params.id);
    const objetivo = Number(req.params.usuarioId);

    try {
        const miRol = await esMiembro(grupoId, req.usuario.id);
        if (!miRol) return res.status(404).json({ message: "Grupo no encontrado." });

        const esYo = objetivo === req.usuario.id;
        if (!esYo && miRol !== "dueño") {
            return res.status(403).json({ message: "Sólo quien creó el grupo puede sacar a alguien." });
        }

        // El dueño no puede irse dejando el grupo sin dueño: o lo cierra,
        // o antes le pasa el grupo a otro.
        if (esYo && miRol === "dueño") {
            const otros = await pool.query(
                "SELECT COUNT(*)::int n FROM grupo_miembros WHERE grupo_id = $1 AND usuario_id <> $2",
                [grupoId, req.usuario.id]
            );
            if (otros.rows[0].n > 0) {
                return res.status(409).json({
                    message: "Sos quien creó el grupo. Pasáselo a alguien o cerralo, " +
                             "pero no lo dejes sin dueño."
                });
            }
            await pool.query("UPDATE grupos SET activo = FALSE WHERE id = $1", [grupoId]);
        }

        await pool.query(
            "DELETE FROM grupo_miembros WHERE grupo_id = $1 AND usuario_id = $2",
            [grupoId, objetivo]
        );
        res.json({ ok: true });
    } catch (err) {
        console.error("[GRUPOS] salir:", err.message);
        res.status(500).json({ message: "No se pudo completar la acción." });
    }
});

module.exports = router;
module.exports.esMiembro = esMiembro;
module.exports.cuentaDe = cuentaDe;
