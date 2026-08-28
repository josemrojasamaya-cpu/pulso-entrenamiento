const express = require("express");
const pool = require("../config/db");
const { requiereSesion } = require("../middleware/auth");
const { planDe } = require("../lib/planes");
const { esMiembro, cuentaDe } = require("./grupos.routes");

const router = express.Router();
router.use(requiereSesion);

/**
 * Tipos de reto.
 *
 * Todos se miden con lo que el sistema YA registra. Ninguno depende de
 * que alguien declare a mano cuánto hizo: eso invita a inflarlo, y un
 * ranking que se puede inflar deja de ser una competencia a los tres
 * días.
 *
 * `sql` recibe (usuario_id, inicio, fin) y devuelve un número.
 */
const TIPOS = {
    sesiones: {
        nombre: "Más sesiones completadas",
        descripcion: "Gana quien complete más entrenamientos en el período.",
        unidad: "sesiones",
        sql: `SELECT COUNT(*)::numeric v FROM rutinas
               WHERE usuario_id = $1 AND estado = 'completada'
                 AND fecha BETWEEN $2::date AND $3::date`
    },
    dias_activos: {
        nombre: "Más días entrenando",
        descripcion: "Gana quien aparezca más días, sin importar cuánto haga cada vez.",
        unidad: "días",
        sql: `SELECT COUNT(DISTINCT date_trunc('day', realizada_en))::numeric v
                FROM series
               WHERE usuario_id = $1
                 AND realizada_en::date BETWEEN $2::date AND $3::date`
    },
    volumen: {
        nombre: "Más peso movido",
        descripcion: "Series por repeticiones por peso. Favorece a quien ya es fuerte, " +
                     "así que conviene entre gente de nivel parecido.",
        unidad: "kg",
        sql: `SELECT COALESCE(SUM(peso_kg * repeticiones),0)::numeric v
                FROM series
               WHERE usuario_id = $1
                 AND realizada_en::date BETWEEN $2::date AND $3::date`
    },
    constancia: {
        nombre: "Mejor constancia",
        descripcion: "Gana quien cumpla mayor porcentaje de SU propio plan. " +
                     "El más justo: cada quien compite contra lo que se propuso.",
        unidad: "%",
        sql: `SELECT CASE
                       WHEN COALESCE((SELECT dias_por_semana FROM perfiles WHERE usuario_id = $1),0) = 0
                       THEN 0
                       ELSE LEAST(100, ROUND(
                         (SELECT COUNT(DISTINCT date_trunc('day', realizada_en))::numeric
                            FROM series
                           WHERE usuario_id = $1
                             AND realizada_en::date BETWEEN $2::date AND $3::date)
                         / GREATEST(1,
                             (SELECT dias_por_semana FROM perfiles WHERE usuario_id = $1)::numeric
                             * (($3::date - $2::date + 1)::numeric / 7))
                         * 100, 1))
                     END v`
    },
    mediciones: {
        nombre: "Más constante midiéndose",
        descripcion: "Gana quien registre más mediciones corporales. " +
                     "Sirve para arrancar el hábito de medirse.",
        unidad: "mediciones",
        sql: `SELECT COUNT(*)::numeric v FROM mediciones
               WHERE usuario_id = $1 AND fecha BETWEEN $2::date AND $3::date`
    },
    pasos: {
        nombre: "Más pasos",
        descripcion: "Requiere un reloj o pulsera conectada.",
        unidad: "pasos",
        sql: `SELECT COALESCE(SUM(valor),0)::numeric v FROM biometria
               WHERE usuario_id = $1 AND tipo = 'pasos'
                 AND medido_en::date BETWEEN $2::date AND $3::date`
    }
};

router.get("/tipos", (req, res) => {
    res.json(Object.entries(TIPOS).map(([codigo, t]) => ({
        codigo, nombre: t.nombre, descripcion: t.descripcion, unidad: t.unidad
    })));
});

/** Calcula la tabla de un reto en el momento de pedirla. */
async function tablaDe(reto) {
    const tipo = TIPOS[reto.tipo];
    if (!tipo) return [];

    const participantes = await pool.query(
        `SELECT u.id, u.nombre FROM reto_participantes rp
           JOIN usuarios u ON u.id = rp.usuario_id
          WHERE rp.reto_id = $1`, [reto.id]
    );

    const filas = [];
    for (const p of participantes.rows) {
        const r = await pool.query(tipo.sql, [p.id, reto.inicio, reto.fin]);
        filas.push({
            id: p.id,
            nombre: String(p.nombre).split(" ")[0],
            valor: Number(r.rows[0].v) || 0
        });
    }

    filas.sort((a, b) => b.valor - a.valor);
    return filas.map((f, i) => ({
        ...f,
        posicion: i + 1,
        cumplio: reto.meta ? f.valor >= Number(reto.meta) : null
    }));
}

/** Los retos en los que participa la persona. */
router.get("/", async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT r.*, g.nombre AS grupo, u.nombre AS creador,
                    (SELECT COUNT(*) FROM reto_participantes rp WHERE rp.reto_id = r.id)::int participantes
               FROM retos r
               JOIN reto_participantes mio ON mio.reto_id = r.id AND mio.usuario_id = $1
               LEFT JOIN grupos g ON g.id = r.grupo_id
               JOIN usuarios u ON u.id = r.creador_id
              ORDER BY (r.estado = 'activo' AND r.fin >= CURRENT_DATE) DESC, r.fin DESC
              LIMIT 30`,
            [req.usuario.id]
        );

        const retos = [];
        for (const reto of r.rows) {
            retos.push({
                ...reto,
                unidad: TIPOS[reto.tipo] ? TIPOS[reto.tipo].unidad : "",
                nombre_tipo: TIPOS[reto.tipo] ? TIPOS[reto.tipo].nombre : reto.tipo,
                vigente: reto.estado === "activo" && new Date(reto.fin) >= new Date(new Date().toDateString()),
                tabla: await tablaDe(reto)
            });
        }
        res.json(retos);
    } catch (err) {
        console.error("[RETOS] listar:", err.message);
        res.status(500).json({ message: "No se pudieron leer los retos." });
    }
});

/** Crear un reto dentro de un grupo. Se une automáticamente quien lo crea. */
router.post("/", async (req, res) => {
    const b = req.body || {};
    const grupoId = Number(b.grupo_id);
    const tipo = String(b.tipo || "");
    const titulo = String(b.titulo || "").trim();

    if (!TIPOS[tipo]) {
        return res.status(400).json({ message: "Ese tipo de reto no existe." });
    }
    if (titulo.length < 3) {
        return res.status(400).json({ message: "Ponele un título al reto." });
    }
    if (!(await esMiembro(grupoId, req.usuario.id))) {
        return res.status(404).json({ message: "Grupo no encontrado." });
    }

    const hoy = new Date().toISOString().slice(0, 10);
    const inicio = /^\d{4}-\d{2}-\d{2}$/.test(b.inicio) ? b.inicio : hoy;
    const fin = /^\d{4}-\d{2}-\d{2}$/.test(b.fin) ? b.fin : null;

    if (!fin) return res.status(400).json({ message: "Falta la fecha de cierre." });
    if (fin < inicio) return res.status(400).json({ message: "El reto no puede terminar antes de empezar." });

    // Un reto de un año no es un reto: es un propósito. Se acota para que
    // tenga tensión y para que la tabla se pueda calcular rápido.
    const dias = Math.round((new Date(fin) - new Date(inicio)) / 86400000);
    if (dias > 120) {
        return res.status(400).json({ message: "Un reto puede durar como máximo cuatro meses." });
    }

    const cuenta = await cuentaDe(req.usuario.id);
    const plan = planDe(cuenta);
    const activos = await pool.query(
        `SELECT COUNT(*)::int n FROM retos r
           JOIN reto_participantes rp ON rp.reto_id = r.id
          WHERE rp.usuario_id = $1 AND r.estado = 'activo' AND r.fin >= CURRENT_DATE`,
        [req.usuario.id]
    );
    if (activos.rows[0].n >= plan.limites.retos_activos) {
        return res.status(402).json({
            message: `El plan ${plan.nombre} permite ${plan.limites.retos_activos} ` +
                     `reto${plan.limites.retos_activos === 1 ? "" : "s"} a la vez.`,
            requiere_plan: true
        });
    }

    const cliente = await pool.connect();
    try {
        await cliente.query("BEGIN");
        const r = await cliente.query(
            `INSERT INTO retos (grupo_id, creador_id, titulo, tipo, meta, inicio, fin)
             VALUES ($1,$2,$3,$4,$5,$6::date,$7::date) RETURNING *`,
            [grupoId, req.usuario.id, titulo.slice(0, 120), tipo,
             b.meta !== undefined && b.meta !== null && b.meta !== "" ? Number(b.meta) : null,
             inicio, fin]
        );
        await cliente.query(
            "INSERT INTO reto_participantes (reto_id, usuario_id) VALUES ($1,$2)",
            [r.rows[0].id, req.usuario.id]
        );
        await cliente.query("COMMIT");

        res.status(201).json({
            reto: { ...r.rows[0], unidad: TIPOS[tipo].unidad, nombre_tipo: TIPOS[tipo].nombre }
        });
    } catch (err) {
        await cliente.query("ROLLBACK").catch(() => {});
        console.error("[RETOS] crear:", err.message);
        res.status(500).json({ message: "No se pudo crear el reto." });
    } finally {
        cliente.release();
    }
});

/** Sumarse a un reto del grupo. */
router.post("/:id/unirme", async (req, res) => {
    const id = Number(req.params.id);
    try {
        const r = await pool.query("SELECT grupo_id, estado, fin FROM retos WHERE id = $1", [id]);
        if (r.rowCount === 0) return res.status(404).json({ message: "Reto no encontrado." });
        const reto = r.rows[0];

        if (!(await esMiembro(reto.grupo_id, req.usuario.id))) {
            return res.status(404).json({ message: "Reto no encontrado." });
        }
        if (reto.estado !== "activo" || new Date(reto.fin) < new Date(new Date().toDateString())) {
            return res.status(409).json({ message: "Ese reto ya terminó." });
        }

        await pool.query(
            "INSERT INTO reto_participantes (reto_id, usuario_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
            [id, req.usuario.id]
        );
        res.status(201).json({ ok: true });
    } catch (err) {
        res.status(500).json({ message: "No se pudo entrar al reto." });
    }
});

/** Salirse de un reto. */
router.delete("/:id/participo", async (req, res) => {
    try {
        await pool.query(
            "DELETE FROM reto_participantes WHERE reto_id = $1 AND usuario_id = $2",
            [Number(req.params.id), req.usuario.id]
        );
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ message: "No se pudo salir del reto." });
    }
});

module.exports = router;
