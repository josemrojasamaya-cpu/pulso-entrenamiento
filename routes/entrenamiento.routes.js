const express = require("express");
const pool = require("../config/db");
const { requiereSesion, puedeVerAtleta } = require("../middleware/auth");
const { generar } = require("../lib/motor-rutinas");
const { estimar1RM } = require("../lib/progresion");
const { enlaceVideo } = require("../db/ejercicios");

const router = express.Router();
router.use(requiereSesion);

/* ── Utilidades ───────────────────────────────────────────────────── */

function hoyISO(desplazamientoDias = 0) {
    const d = new Date();
    d.setDate(d.getDate() + desplazamientoDias);
    return d.toISOString().slice(0, 10);
}

/**
 * Reúne todo lo que el motor necesita saber de una persona.
 *
 * Va en una sola función porque generar la rutina de hoy y la de mañana
 * necesitan exactamente lo mismo, y duplicar esta recolección es la
 * forma más segura de que las dos rutinas terminen calculándose con
 * criterios distintos.
 */
async function reunirContexto(usuarioId) {
    const [perfil, condiciones, catalogo, recientes, sesiones] = await Promise.all([
        pool.query("SELECT * FROM perfiles WHERE usuario_id = $1", [usuarioId]),
        pool.query("SELECT codigo FROM condiciones WHERE usuario_id = $1 AND activa", [usuarioId]),
        pool.query("SELECT * FROM ejercicios WHERE activo ORDER BY id"),
        // Ejercicios hechos en las últimas 72 horas: se evitan para que
        // la rutina de hoy no repita la de anteayer.
        pool.query(
            `SELECT DISTINCT ejercicio_id FROM series
              WHERE usuario_id = $1 AND realizada_en > NOW() - INTERVAL '72 hours'`,
            [usuarioId]
        ),
        pool.query(
            "SELECT COUNT(*)::int n FROM rutinas WHERE usuario_id = $1 AND estado = 'completada'",
            [usuarioId]
        )
    ]);

    // Historial por ejercicio, para sugerir peso. Se traen sólo las
    // últimas series de cada uno: con el historial completo la consulta
    // crece sin límite y la sugerencia no mejora.
    const hist = await pool.query(
        `SELECT ejercicio_id, peso_kg, repeticiones, rpe, realizada_en FROM (
            SELECT s.*, ROW_NUMBER() OVER (
                     PARTITION BY ejercicio_id ORDER BY realizada_en DESC) AS n
              FROM series s WHERE usuario_id = $1
         ) t WHERE n <= 10`,
        [usuarioId]
    );

    const historial = {};
    for (const s of hist.rows) {
        (historial[s.ejercicio_id] = historial[s.ejercicio_id] || []).push(s);
    }

    return {
        perfil: perfil.rows[0] || null,
        condiciones: condiciones.rows.map(c => c.codigo),
        catalogo: catalogo.rows,
        historial,
        ejerciciosRecientes: recientes.rows.map(r => r.ejercicio_id),
        sesionIndice: sesiones.rows[0].n
    };
}

/** Guarda una rutina generada y devuelve la versión completa. */
async function persistir(usuarioId, fecha, plan) {
    const cliente = await pool.connect();
    try {
        await cliente.query("BEGIN");

        const r = await cliente.query(
            `INSERT INTO rutinas (usuario_id, fecha, nombre, enfoque, minutos_estimados, justificacion)
             VALUES ($1,$2::date,$3,$4,$5,$6::jsonb)
             ON CONFLICT (usuario_id, fecha) DO NOTHING
             RETURNING id`,
            [usuarioId, fecha, plan.nombre, plan.enfoque, plan.minutos_estimados,
             JSON.stringify(plan.justificacion)]
        );

        // Si ya existía, se respeta la que estaba: regenerarla borraría
        // las series que la persona ya registró contra ella.
        if (r.rowCount === 0) {
            await cliente.query("COMMIT");
            return null;
        }

        const rutinaId = r.rows[0].id;
        let orden = 1;
        for (const e of plan.ejercicios) {
            await cliente.query(
                `INSERT INTO rutina_ejercicios
                   (rutina_id, ejercicio_id, orden, series, rep_min, rep_max,
                    peso_sugerido_kg, descanso_seg, nota)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
                [rutinaId, e.ejercicio.id, orden++, e.series, e.rep_min, e.rep_max,
                 e.peso_sugerido_kg, e.descanso_seg, e.nota]
            );
        }

        await cliente.query("COMMIT");
        return rutinaId;
    } catch (err) {
        await cliente.query("ROLLBACK").catch(() => {});
        throw err;
    } finally {
        cliente.release();
    }
}

/** Lee una rutina ya guardada, con sus ejercicios y lo ya registrado. */
async function leerRutina(usuarioId, fecha) {
    const r = await pool.query(
        "SELECT * FROM rutinas WHERE usuario_id = $1 AND fecha = $2::date",
        [usuarioId, fecha]
    );
    if (r.rowCount === 0) return null;
    const rutina = r.rows[0];

    const ej = await pool.query(
        `SELECT re.*, e.nombre, e.grupo, e.patron, e.equipo, e.unilateral,
                e.instrucciones, e.video_url, e.nivel, e.medida
           FROM rutina_ejercicios re
           JOIN ejercicios e ON e.id = re.ejercicio_id
          WHERE re.rutina_id = $1 ORDER BY re.orden`,
        [rutina.id]
    );

    const hechas = await pool.query(
        `SELECT rutina_ejercicio_id, serie_num, repeticiones, peso_kg, rpe, realizada_en
           FROM series WHERE usuario_id = $1
            AND rutina_ejercicio_id = ANY($2::int[])
          ORDER BY serie_num`,
        [usuarioId, ej.rows.map(e => e.id)]
    );

    const porEjercicio = {};
    for (const s of hechas.rows) {
        (porEjercicio[s.rutina_ejercicio_id] = porEjercicio[s.rutina_ejercicio_id] || []).push(s);
    }

    return {
        ...rutina,
        ejercicios: ej.rows.map(e => ({
            ...e,
            video: e.video_url || enlaceVideo(e.nombre + " tecnica"),
            realizadas: porEjercicio[e.id] || []
        }))
    };
}

/* ── Rutina de un día ─────────────────────────────────────────────── */

/**
 * Devuelve la rutina de una fecha, generándola si no existe.
 *
 * Acepta fechas futuras a propósito: la aplicación pide la de mañana el
 * día anterior y la deja guardada en el teléfono. Así, quien llega al
 * gimnasio sin señal ya la tiene, que es el caso normal en un sótano
 * con paredes de concreto.
 */
router.get("/dia/:fecha", async (req, res) => {
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(req.params.fecha) ? req.params.fecha : hoyISO();
    const usuarioId = Number(req.query.atleta_id) || req.usuario.id;

    if (!(await puedeVerAtleta(req.usuario, usuarioId))) {
        return res.status(404).json({ message: "No encontrado." });
    }

    // No se generan rutinas con más de siete días de anticipación: el
    // plan depende de lo que la persona haga esta semana, y adelantarlo
    // un mes sería inventar.
    const diasAdelante = Math.round((new Date(fecha) - new Date(hoyISO())) / 86400000);
    if (diasAdelante > 7) {
        return res.status(400).json({
            message: "Sólo se puede preparar la rutina de los próximos siete días."
        });
    }

    try {
        let rutina = await leerRutina(usuarioId, fecha);
        if (rutina) {
            // Los avisos de seguridad se recalculan y se devuelven SIEMPRE,
            // no sólo al generar la rutina. Antes desaparecían a partir de
            // la segunda vez que se abría la aplicación en el día: quien
            // tiene hipertensión dejaba de ver justo la advertencia sobre
            // no contener la respiración.
            const cond = await pool.query(
                "SELECT codigo FROM condiciones WHERE usuario_id = $1 AND activa", [usuarioId]
            );
            const { restricciones } = require("../lib/salud");
            return res.json({
                rutina,
                generada: false,
                avisos: restricciones(cond.rows.map(c => c.codigo)).avisos
            });
        }

        const ctx = await reunirContexto(usuarioId);
        if (!ctx.perfil) {
            return res.status(409).json({
                message: "Falta completar tu perfil de entrenamiento.",
                falta_perfil: true
            });
        }

        const plan = generar({
            perfil: ctx.perfil,
            condiciones: ctx.condiciones,
            catalogo: ctx.catalogo,
            fecha,
            usuarioId,
            historial: ctx.historial,
            sesionIndice: ctx.sesionIndice,
            ejerciciosRecientes: ctx.ejerciciosRecientes
        });

        if (plan.error) return res.status(409).json(plan);

        await persistir(usuarioId, fecha, plan);
        rutina = await leerRutina(usuarioId, fecha);

        res.json({ rutina, generada: true, avisos: plan.avisos });
    } catch (err) {
        console.error("[RUTINA]", err.message);
        res.status(500).json({ message: "No se pudo preparar la rutina." });
    }
});

/**
 * Paquete para trabajar sin conexión: hoy y los próximos días.
 *
 * Se descarga entero antes de salir de casa. Incluye los avisos de salud
 * y las instrucciones de cada ejercicio, porque en el gimnasio sin señal
 * son justamente lo que hace falta consultar.
 */
router.get("/paquete", async (req, res) => {
    const usuarioId = req.usuario.id;
    const dias = Math.min(Math.max(Number(req.query.dias) || 2, 1), 7);

    try {
        const ctx = await reunirContexto(usuarioId);
        if (!ctx.perfil) {
            return res.status(409).json({ message: "Falta completar tu perfil.", falta_perfil: true });
        }

        const rutinas = [];
        for (let i = 0; i < dias; i++) {
            const fecha = hoyISO(i);
            let r = await leerRutina(usuarioId, fecha);
            if (!r) {
                const plan = generar({
                    perfil: ctx.perfil, condiciones: ctx.condiciones, catalogo: ctx.catalogo,
                    fecha, usuarioId, historial: ctx.historial,
                    sesionIndice: ctx.sesionIndice + i,
                    ejerciciosRecientes: ctx.ejerciciosRecientes
                });
                if (plan.error) continue;
                await persistir(usuarioId, fecha, plan);
                r = await leerRutina(usuarioId, fecha);
            }
            if (r) rutinas.push(r);
        }

        const { restricciones } = require("../lib/salud");
        res.json({
            generado_en: new Date().toISOString(),
            usuario: { id: usuarioId, nombre: req.usuario.nombre },
            avisos: restricciones(ctx.condiciones).avisos,
            rutinas
        });
    } catch (err) {
        console.error("[PAQUETE]", err.message);
        res.status(500).json({ message: "No se pudo preparar el paquete." });
    }
});

/* ── Registro de series ───────────────────────────────────────────── */

/**
 * Registra una o varias series.
 *
 * Acepta un lote porque es la misma ruta que usa la sincronización: el
 * teléfono junta lo que hizo sin señal y lo manda todo de una vez al
 * recuperar conexión.
 *
 * `id_local` es lo que hace segura esa sincronización. Si el envío se
 * corta a mitad y el teléfono reintenta, las series ya guardadas caen en
 * el mismo renglón en vez de duplicarse. Sin eso, un mal momento de
 * señal convertiría tres series en seis.
 */
router.post("/series", async (req, res) => {
    const cuerpo = req.body || {};
    const lote = Array.isArray(cuerpo.series) ? cuerpo.series : [cuerpo];
    const usuarioId = req.usuario.id;

    if (lote.length === 0) return res.status(400).json({ message: "No se envió ninguna serie." });
    if (lote.length > 200) return res.status(400).json({ message: "Demasiadas series en un solo envío." });

    const guardadas = [];
    const rechazadas = [];

    const cliente = await pool.connect();
    try {
        await cliente.query("BEGIN");

        for (const s of lote) {
            const ejercicioId = Number(s.ejercicio_id);
            const reps = Number(s.repeticiones);
            const peso = s.peso_kg === null || s.peso_kg === undefined ? 0 : Number(s.peso_kg);
            const rpe  = s.rpe === null || s.rpe === undefined || s.rpe === "" ? null : Number(s.rpe);

            if (!Number.isInteger(ejercicioId) || !Number.isInteger(reps) || reps < 1 || reps > 500) {
                rechazadas.push({ id_local: s.id_local || null, motivo: "ejercicio o repeticiones inválidos" });
                continue;
            }
            if (!Number.isFinite(peso) || peso < 0 || peso > 1000) {
                rechazadas.push({ id_local: s.id_local || null, motivo: "peso fuera de rango" });
                continue;
            }
            if (rpe !== null && (!Number.isFinite(rpe) || rpe < 1 || rpe > 10)) {
                rechazadas.push({ id_local: s.id_local || null, motivo: "esfuerzo fuera de la escala de 1 a 10" });
                continue;
            }

            const r = await cliente.query(
                `INSERT INTO series
                   (id_local, usuario_id, rutina_ejercicio_id, ejercicio_id,
                    serie_num, repeticiones, peso_kg, rpe, realizada_en)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8, COALESCE($9::timestamptz, NOW()))
                 ON CONFLICT (usuario_id, id_local) DO NOTHING
                 RETURNING id`,
                [s.id_local || null, usuarioId, s.rutina_ejercicio_id || null, ejercicioId,
                 Number(s.serie_num) || 1, reps, peso, rpe, s.realizada_en || null]
            );

            guardadas.push({
                id_local: s.id_local || null,
                id: r.rowCount ? r.rows[0].id : null,
                duplicada: r.rowCount === 0
            });
        }

        await cliente.query("COMMIT");
    } catch (err) {
        await cliente.query("ROLLBACK").catch(() => {});
        console.error("[SERIES]", err.message);
        return res.status(500).json({ message: "No se pudieron guardar las series." });
    } finally {
        cliente.release();
    }

    // Las marcas se recalculan fuera de la transacción: son un dato
    // derivado, y un fallo acá no debe tirar abajo el registro real del
    // entrenamiento, que es lo que no se puede volver a capturar.
    actualizarMarcas(usuarioId, [...new Set(lote.map(s => Number(s.ejercicio_id)))])
        .catch(e => console.error("[MARCAS]", e.message));

    res.status(201).json({
        guardadas: guardadas.filter(g => !g.duplicada).length,
        duplicadas: guardadas.filter(g => g.duplicada).length,
        rechazadas,
        detalle: guardadas
    });
});

/** Recalcula las mejores marcas de los ejercicios tocados. */
async function actualizarMarcas(usuarioId, ejercicioIds) {
    for (const id of ejercicioIds.filter(Number.isInteger)) {
        const r = await pool.query(
            `SELECT peso_kg, repeticiones, realizada_en FROM series
              WHERE usuario_id = $1 AND ejercicio_id = $2 AND peso_kg > 0
              ORDER BY realizada_en DESC LIMIT 200`,
            [usuarioId, id]
        );
        if (r.rowCount === 0) continue;

        let mejor1rm = 0, mejorPeso = 0, mejorReps = 0;
        for (const s of r.rows) {
            const e = estimar1RM(s.peso_kg, s.repeticiones);
            if (e && e.valor > mejor1rm) mejor1rm = e.valor;
            if (Number(s.peso_kg) > mejorPeso) {
                mejorPeso = Number(s.peso_kg);
                mejorReps = s.repeticiones;
            }
        }

        await pool.query(
            `INSERT INTO marcas (usuario_id, ejercicio_id, mejor_1rm, mejor_peso, mejor_reps, ultima_fecha, sesiones)
             VALUES ($1,$2,$3,$4,$5,CURRENT_DATE,$6)
             ON CONFLICT (usuario_id, ejercicio_id) DO UPDATE SET
               mejor_1rm    = GREATEST(marcas.mejor_1rm, EXCLUDED.mejor_1rm),
               mejor_peso   = GREATEST(marcas.mejor_peso, EXCLUDED.mejor_peso),
               mejor_reps   = CASE WHEN EXCLUDED.mejor_peso >= marcas.mejor_peso
                                   THEN EXCLUDED.mejor_reps ELSE marcas.mejor_reps END,
               ultima_fecha = CURRENT_DATE,
               sesiones     = EXCLUDED.sesiones`,
            [usuarioId, id, Math.round(mejor1rm * 10) / 10, mejorPeso, mejorReps, r.rowCount]
        );
    }
}

/* ── Estado de la sesión ──────────────────────────────────────────── */

router.post("/rutina/:id/estado", async (req, res) => {
    const id = Number(req.params.id);
    const estado = String((req.body && req.body.estado) || "");
    const validos = ["pendiente", "en_curso", "completada", "omitida"];

    if (!validos.includes(estado)) {
        return res.status(400).json({ message: `Estado inválido. Debe ser: ${validos.join(", ")}.` });
    }

    try {
        const r = await pool.query(
            "SELECT usuario_id, fecha, estado FROM rutinas WHERE id = $1", [id]
        );
        if (r.rowCount === 0) return res.status(404).json({ message: "Rutina no encontrada." });
        if (r.rows[0].usuario_id !== req.usuario.id) {
            return res.status(404).json({ message: "Rutina no encontrada." });
        }

        await pool.query(
            `UPDATE rutinas SET estado = $1,
                    iniciada_en  = COALESCE(iniciada_en, CASE WHEN $1 = 'en_curso' THEN NOW() END),
                    terminada_en = CASE WHEN $1 = 'completada' THEN NOW() ELSE terminada_en END
              WHERE id = $2`,
            [estado, id]
        );

        // Los puntos se otorgan una sola vez por rutina, gracias a la
        // restricción única sobre (usuario, tipo, referencia).
        if (estado === "completada") {
            await pool.query(
                `INSERT INTO puntos (usuario_id, tipo, puntos, detalle, referencia, fecha)
                 VALUES ($1,'sesion_completada',50,'Sesión completada',$2,$3)
                 ON CONFLICT (usuario_id, tipo, referencia) DO NOTHING`,
                [req.usuario.id, `rutina-${id}`, r.rows[0].fecha]
            ).catch(() => {});
        }

        res.json({ ok: true, estado });
    } catch (err) {
        console.error("[ESTADO RUTINA]", err.message);
        res.status(500).json({ message: "No se pudo actualizar la rutina." });
    }
});

/** Catálogo completo, para el buscador de ejercicios. */
router.get("/ejercicios", async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT id, nombre, grupo, patron, equipo, nivel, unilateral, compuesto,
                    exigencia, video_url, instrucciones, contraindicado_en
               FROM ejercicios WHERE activo ORDER BY grupo, nombre`
        );
        res.json(r.rows.map(e => ({ ...e, video: e.video_url || enlaceVideo(e.nombre + " tecnica") })));
    } catch (err) {
        res.status(500).json({ message: "No se pudo leer el catálogo." });
    }
});

module.exports = router;
