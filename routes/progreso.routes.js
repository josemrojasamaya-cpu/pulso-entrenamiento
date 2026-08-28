const express = require("express");
const pool = require("../config/db");
const { requiereSesion, exigirAccesoAtleta } = require("../middleware/auth");
const { detectarEstancamiento, volumen } = require("../lib/progresion");
const { nivelDe, caloriasEstimadas } = require("../lib/puntos");

const router = express.Router();
router.use(requiereSesion);

/**
 * Resumen de progreso.
 *
 * Reúne en una sola respuesta lo que contesta "¿esto está funcionando?":
 * volumen por semana, marcas, adherencia y puntos. Son preguntas de la
 * misma sesión mental, y partirlas en cinco llamadas sólo agrega
 * latencia y estados donde la pantalla muestra medio panel.
 */
router.get("/:id/resumen", exigirAccesoAtleta, async (req, res) => {
    const id = req.atletaId;
    try {
        const [semanas, marcas, adherencia, pts, ultimaMedicion, sesiones] = await Promise.all([
            // Volumen semanal de las últimas doce semanas.
            pool.query(
                `SELECT date_trunc('week', realizada_en)::date semana,
                        SUM(peso_kg * repeticiones)::numeric  volumen,
                        COUNT(*)::int                          series,
                        COUNT(DISTINCT date_trunc('day', realizada_en))::int dias
                   FROM series
                  WHERE usuario_id = $1 AND realizada_en > NOW() - INTERVAL '12 weeks'
                  GROUP BY 1 ORDER BY 1`, [id]),

            pool.query(
                `SELECT m.*, e.nombre, e.grupo, e.equipo
                   FROM marcas m JOIN ejercicios e ON e.id = m.ejercicio_id
                  WHERE m.usuario_id = $1 AND m.mejor_1rm > 0
                  ORDER BY m.mejor_1rm DESC LIMIT 12`, [id]),

            /**
             * Constancia: días entrenados contra días planeados.
             *
             * Antes se medía contando rutinas marcadas como completadas,
             * y eso daba 0% a quien venía entrenando desde hace meses:
             * las sesiones quedaban registradas como series, pero sin una
             * rutina generada que marcar. La pregunta real es "¿apareciste
             * las veces que dijiste que ibas a aparecer?", y eso se
             * responde con los días en que efectivamente hubo trabajo.
             */
            pool.query(
                `SELECT
                    (SELECT COUNT(DISTINCT date_trunc('day', realizada_en))::int
                       FROM series
                      WHERE usuario_id = $1 AND realizada_en > NOW() - INTERVAL '30 days') dias_entrenados,
                    COALESCE((SELECT dias_por_semana FROM perfiles WHERE usuario_id = $1), 3) dias_plan,
                    (SELECT COUNT(*) FILTER (WHERE estado = 'completada')::int
                       FROM rutinas WHERE usuario_id = $1 AND fecha > CURRENT_DATE - 30) rutinas_completadas
                `, [id]),

            pool.query("SELECT COALESCE(SUM(puntos),0)::int total FROM puntos WHERE usuario_id = $1", [id]),

            pool.query("SELECT peso_kg FROM mediciones WHERE usuario_id = $1 AND peso_kg IS NOT NULL ORDER BY fecha DESC LIMIT 1", [id]),

            pool.query(
                `SELECT COUNT(DISTINCT date_trunc('day', realizada_en))::int dias,
                        COALESCE(SUM(peso_kg * repeticiones),0)::numeric volumen_total
                   FROM series WHERE usuario_id = $1`, [id])
        ]);

        const peso = ultimaMedicion.rows[0] ? Number(ultimaMedicion.rows[0].peso_kg) : 70;

        const a = adherencia.rows[0];
        // 30 días son algo más de cuatro semanas.
        const esperados = Math.round(a.dias_plan * (30 / 7));
        const porcentaje = esperados > 0
            ? Math.min(100, Math.round((a.dias_entrenados / esperados) * 100))
            : null;

        res.json({
            volumen_semanal: semanas.rows.map(s => ({
                semana: s.semana,
                volumen: Math.round(Number(s.volumen) || 0),
                series: s.series,
                dias: s.dias
            })),
            marcas: marcas.rows,
            adherencia: {
                dias_entrenados: a.dias_entrenados,
                dias_esperados: esperados,
                rutinas_completadas: a.rutinas_completadas,
                porcentaje
            },
            nivel: nivelDe(pts.rows[0].total),
            totales: {
                dias_entrenados: sesiones.rows[0].dias,
                volumen_total: Math.round(Number(sesiones.rows[0].volumen_total) || 0),
                // Estimación gruesa, presentada como tal.
                calorias_estimadas: caloriasEstimadas(sesiones.rows[0].dias * 45, peso)
            }
        });
    } catch (err) {
        console.error("[RESUMEN]", err.message);
        res.status(500).json({ message: "No se pudo armar el resumen." });
    }
});

/** ¿Está estancado en este ejercicio? */
router.get("/:id/ejercicio/:ejercicioId", exigirAccesoAtleta, async (req, res) => {
    const ejercicioId = Number(req.params.ejercicioId);
    try {
        const r = await pool.query(
            `SELECT peso_kg, repeticiones, rpe, realizada_en FROM series
              WHERE usuario_id = $1 AND ejercicio_id = $2 AND peso_kg > 0
              ORDER BY realizada_en DESC LIMIT 40`,
            [req.atletaId, ejercicioId]
        );
        const ej = await pool.query("SELECT nombre, equipo FROM ejercicios WHERE id = $1", [ejercicioId]);

        res.json({
            ejercicio: ej.rows[0] || null,
            series: r.rows,
            diagnostico: detectarEstancamiento(r.rows),
            volumen_total: Math.round(volumen(r.rows))
        });
    } catch (err) {
        res.status(500).json({ message: "No se pudo analizar el ejercicio." });
    }
});

/* ── Biometría ────────────────────────────────────────────────────── */

const TIPOS_BIO = ["pulso", "presion", "pasos", "calorias", "sueno_min", "spo2", "vo2max"];

router.post("/:id/biometria", exigirAccesoAtleta, async (req, res) => {
    const lote = Array.isArray(req.body && req.body.lecturas) ? req.body.lecturas : [req.body || {}];
    if (lote.length > 2000) {
        return res.status(400).json({ message: "Demasiadas lecturas en un solo envío." });
    }

    let guardadas = 0, rechazadas = 0;
    const cliente = await pool.connect();
    try {
        await cliente.query("BEGIN");
        for (const l of lote) {
            const tipo = String(l.tipo || "");
            const valor = Number(l.valor);
            if (!TIPOS_BIO.includes(tipo) || !Number.isFinite(valor)) { rechazadas++; continue; }

            // Rangos fisiológicos: un pulso de 400 es un fallo del sensor
            // o del archivo, y meterlo en el historial arruina toda
            // media posterior.
            const rangos = {
                pulso: [25, 230], presion: [50, 260], pasos: [0, 200000],
                calorias: [0, 20000], sueno_min: [0, 1440], spo2: [50, 100], vo2max: [10, 90]
            };
            const [min, max] = rangos[tipo];
            if (valor < min || valor > max) { rechazadas++; continue; }

            const r = await cliente.query(
                `INSERT INTO biometria (usuario_id, tipo, valor, valor2, origen, contexto, medido_en)
                 VALUES ($1,$2,$3,$4,$5,$6, COALESCE($7::timestamptz, NOW()))
                 ON CONFLICT (usuario_id, tipo, medido_en) DO NOTHING`,
                [req.atletaId, tipo, valor,
                 l.valor2 !== undefined && l.valor2 !== null ? Number(l.valor2) : null,
                 ["manual", "bluetooth", "archivo", "reloj"].includes(l.origen) ? l.origen : "manual",
                 l.contexto || null, l.medido_en || null]
            );
            if (r.rowCount) guardadas++;
        }
        await cliente.query("COMMIT");
    } catch (err) {
        await cliente.query("ROLLBACK").catch(() => {});
        console.error("[BIOMETRIA]", err.message);
        return res.status(500).json({ message: "No se pudieron guardar las lecturas." });
    } finally {
        cliente.release();
    }

    res.status(201).json({ guardadas, rechazadas, recibidas: lote.length });
});

router.get("/:id/biometria", exigirAccesoAtleta, async (req, res) => {
    const tipo = req.query.tipo;
    const dias = Math.min(Number(req.query.dias) || 30, 365);
    try {
        const r = await pool.query(
            `SELECT tipo, valor, valor2, origen, contexto, medido_en
               FROM biometria
              WHERE usuario_id = $1
                AND ($2::varchar IS NULL OR tipo = $2)
                AND medido_en > NOW() - ($3::int || ' days')::interval
              ORDER BY medido_en ASC LIMIT 3000`,
            [req.atletaId, TIPOS_BIO.includes(tipo) ? tipo : null, dias]
        );
        res.json(r.rows);
    } catch (err) {
        res.status(500).json({ message: "No se pudieron leer las lecturas." });
    }
});

/* ── Ranking ──────────────────────────────────────────────────────── */

/**
 * Tabla de posiciones por CONSTANCIA, no por peso levantado.
 *
 * Un ranking por kilos lo gana siempre quien lleva diez años entrenando
 * y pesa noventa kilos, y quien empieza no tiene ninguna posibilidad:
 * deja de ser una competencia y pasa a ser un recordatorio de lo lejos
 * que está. Ordenar por puntos —que se ganan apareciendo, sosteniendo la
 * racha y midiéndose— deja a todos compitiendo por lo mismo.
 */
router.get("/ranking", async (req, res) => {
    try {
        const r = await pool.query(`
            SELECT u.id, u.nombre,
                   COALESCE(SUM(p.puntos),0)::int puntos,
                   COUNT(DISTINCT r.id) FILTER (WHERE r.estado = 'completada')::int sesiones,
                   COUNT(DISTINCT date_trunc('day', s.realizada_en))::int dias_activos
              FROM usuarios u
              LEFT JOIN puntos  p ON p.usuario_id = u.id
              LEFT JOIN rutinas r ON r.usuario_id = u.id
              LEFT JOIN series  s ON s.usuario_id = u.id
             WHERE u.activo AND u.rol = 'atleta'
             GROUP BY u.id, u.nombre
             ORDER BY puntos DESC, sesiones DESC
             LIMIT 50
        `);

        const tabla = r.rows.map((f, i) => ({
            posicion: i + 1,
            id: f.id,
            // Sólo el nombre de pila: el ranking es público entre los
            // usuarios y no hay razón para exponer el apellido completo.
            nombre: String(f.nombre).split(" ")[0],
            puntos: f.puntos,
            sesiones: f.sesiones,
            dias_activos: f.dias_activos,
            ...nivelDe(f.puntos),
            soy_yo: f.id === req.usuario.id
        }));

        res.json({ tabla, mi_posicion: tabla.find(t => t.soy_yo) || null });
    } catch (err) {
        console.error("[RANKING]", err.message);
        res.status(500).json({ message: "No se pudo armar la tabla." });
    }
});

/** Atletas a cargo de un entrenador. */
router.get("/mis-atletas", async (req, res) => {
    if (!["entrenador", "admin"].includes(req.usuario.rol)) {
        return res.status(403).json({ message: "Sólo para entrenadores." });
    }
    try {
        const r = await pool.query(`
            SELECT u.id, u.nombre, u.username,
                   p.objetivo, p.nivel, p.dias_por_semana,
                   (SELECT COUNT(*) FROM condiciones c WHERE c.usuario_id = u.id AND c.activa)::int condiciones,
                   (SELECT MAX(fecha) FROM mediciones m WHERE m.usuario_id = u.id) ultima_medicion,
                   (SELECT MAX(realizada_en) FROM series s WHERE s.usuario_id = u.id) ultimo_entreno,
                   (SELECT COUNT(*) FROM rutinas r
                     WHERE r.usuario_id = u.id AND r.estado = 'completada'
                       AND r.fecha > CURRENT_DATE - 30)::int sesiones_mes,
                   COALESCE((SELECT SUM(puntos) FROM puntos pt WHERE pt.usuario_id = u.id),0)::int puntos
              FROM usuarios u
              LEFT JOIN perfiles p ON p.usuario_id = u.id
             WHERE u.activo AND ($1 = 'admin' OR u.entrenador_id = $2)
               AND u.rol = 'atleta'
             ORDER BY u.nombre`,
            [req.usuario.rol, req.usuario.id]
        );
        res.json(r.rows.map(a => ({ ...a, nivel_juego: nivelDe(a.puntos) })));
    } catch (err) {
        console.error("[ATLETAS]", err.message);
        res.status(500).json({ message: "No se pudo leer la lista." });
    }
});

module.exports = router;
