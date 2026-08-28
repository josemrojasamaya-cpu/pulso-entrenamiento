const express = require("express");
const pool = require("../config/db");
const { requiereSesion } = require("../middleware/auth");
const {
    DEPORTES, porCodigo, recorrer, ritmo, velocidad,
    calorias, validar, puntosDeActividad
} = require("../lib/actividades");

const router = express.Router();
router.use(requiereSesion);

/** Catálogo de deportes, para armar la pantalla. */
router.get("/deportes", (_req, res) => {
    res.json({ deportes: DEPORTES.map(d => ({
        codigo: d.codigo, nombre: d.nombre, gps: d.gps, icono: d.icono, ritmo: d.ritmo || null
    })) });
});

/**
 * Guarda una actividad.
 *
 * Los números NO se toman del cliente: llegan los puntos del GPS y el
 * servidor recalcula distancia, desnivel y velocidad. Confiar en un
 * "metros: 42000" enviado por el navegador dejaría el ranking a merced
 * de quien sepa abrir la consola.
 *
 * Lo mismo con las calorías: sólo se aceptan del cliente si vienen de un
 * dispositivo, y quedan marcadas como tales.
 */
router.post("/", async (req, res) => {
    const b = req.body || {};
    const deporte = porCodigo(String(b.deporte || ""));
    if (!deporte) return res.status(400).json({ message: "Ese deporte no está en la lista." });

    const puntos = Array.isArray(b.puntos) ? b.puntos.slice(0, 20000) : [];
    const segundos = Math.round(Number(b.segundos) || 0);

    // Techo de velocidad según el deporte, para el filtro de saltos.
    const techoVel = deporte.codigo === "bicicleta" ? 28 : 12;
    const medido = puntos.length >= 2 ? recorrer(puntos, techoVel) : null;

    // La distancia a mano sólo se acepta cuando NO hubo GPS: quien nada
    // en una piscina o corre en cinta la sabe y el teléfono no.
    const metros = medido ? medido.metros
        : (Number.isFinite(Number(b.metros)) ? Math.max(0, Math.round(Number(b.metros))) : 0);

    const actividad = {
        deporte: deporte.codigo,
        segundos,
        metros,
        pulso_medio: Number(b.pulso_medio) || null
    };

    const error = validar(actividad);
    if (error) return res.status(400).json({ message: error });

    const intensidad = ["suave", "medio", "fuerte"].includes(b.intensidad) ? b.intensidad : "medio";

    // Peso para estimar el gasto. Se lee de las mediciones de la persona
    // y no se pide en pantalla: ya lo tiene registrado, y preguntarlo en
    // cada actividad sería pedir dos veces lo mismo.
    let pesoKg = null;
    try {
        const p = await pool.query(
            `SELECT peso_kg FROM mediciones
              WHERE usuario_id = $1 AND peso_kg IS NOT NULL
              ORDER BY fecha DESC LIMIT 1`, [req.usuario.id]);
        if (p.rowCount) pesoKg = Number(p.rows[0].peso_kg);
    } catch (e) { /* sin peso simplemente no se estiman calorías */ }

    // Las del dispositivo mandan sobre la estimación: un pulsómetro mide,
    // una tabla de MET supone.
    const delReloj = Number(b.calorias_dispositivo);
    let kcal = null, origenKcal = null;
    if (Number.isFinite(delReloj) && delReloj > 0 && delReloj < 20000) {
        kcal = Math.round(delReloj); origenKcal = "dispositivo";
    } else {
        const est = calorias(deporte.codigo, segundos / 60, pesoKg, intensidad);
        if (est) { kcal = est.kcal; origenKcal = "estimada"; }
    }

    const cliente = await pool.connect();
    try {
        await cliente.query("BEGIN");

        const r = await cliente.query(
            `INSERT INTO actividades
               (id_local, usuario_id, deporte, intensidad, inicio, segundos, metros,
                subida_m, bajada_m, velocidad_max, pulso_medio, pulso_max,
                calorias, calorias_origen, notas, origen)
             VALUES ($1,$2,$3,$4, COALESCE($5::timestamptz, NOW()), $6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
             ON CONFLICT (usuario_id, id_local) DO NOTHING
             RETURNING id`,
            [b.id_local || null, req.usuario.id, deporte.codigo, intensidad,
             b.inicio || null, segundos, metros || null,
             medido ? medido.subida : null, medido ? medido.bajada : null,
             medido ? medido.velocidad_max : null,
             Number(b.pulso_medio) || null, Number(b.pulso_max) || null,
             kcal, origenKcal,
             b.notas ? String(b.notas).slice(0, 300) : null,
             puntos.length >= 2 ? "app" : (b.origen === "archivo" ? "archivo" : "manual")]
        );

        // Sin filas: ya estaba guardada. Es el reintento de una conexión
        // que se cortó, no un error, y no debe dar puntos otra vez.
        if (r.rowCount === 0) {
            await cliente.query("COMMIT");
            return res.status(200).json({ repetida: true, message: "Esta actividad ya estaba guardada." });
        }

        const id = r.rows[0].id;

        if (puntos.length >= 2) {
            // Se guardan los puntos ya filtrados y sin los campos que no
            // se van a volver a usar, para no arrastrar peso muerto.
            const limpios = puntos
                .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon))
                .map(p => ({ lat: Number(p.lat.toFixed(6)), lon: Number(p.lon.toFixed(6)),
                             t: p.t, a: Number.isFinite(p.altitud) ? Math.round(p.altitud) : null }));
            await cliente.query(
                "INSERT INTO recorridos (actividad_id, puntos, n_puntos) VALUES ($1,$2,$3)",
                [id, JSON.stringify(limpios), limpios.length]
            );
        }

        const pts = puntosDeActividad({ segundos });
        if (pts > 0) {
            await cliente.query(
                `INSERT INTO puntos (usuario_id, tipo, puntos, detalle, referencia)
                 VALUES ($1,'actividad',$2,$3,$4)
                 ON CONFLICT (usuario_id, tipo, referencia) DO NOTHING`,
                [req.usuario.id, pts, `${deporte.nombre} · ${Math.round(segundos / 60)} min`, `act-${id}`]
            );
        }

        await cliente.query("COMMIT");

        res.status(201).json({
            id, puntos_ganados: pts,
            metros, calorias: kcal, calorias_origen: origenKcal,
            subida: medido ? medido.subida : null,
            ritmo: ritmo(metros, segundos),
            velocidad: velocidad(metros, segundos),
            puntos_descartados: medido ? medido.puntos_descartados : 0
        });
    } catch (err) {
        await cliente.query("ROLLBACK").catch(() => {});
        console.error("[ACTIVIDADES] guardar:", err.message);
        res.status(500).json({ message: "No se pudo guardar la actividad." });
    } finally {
        cliente.release();
    }
});

/** Historial. El recorrido NO viene acá: pesa y casi nunca se mira. */
router.get("/", async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT id, deporte, intensidad, inicio, segundos, metros, subida_m,
                    pulso_medio, calorias, calorias_origen, notas, origen
               FROM actividades WHERE usuario_id = $1
              ORDER BY inicio DESC LIMIT 100`, [req.usuario.id]);

        const conCalculos = r.rows.map(a => ({
            ...a,
            nombre_deporte: (porCodigo(a.deporte) || {}).nombre || a.deporte,
            ritmo: ritmo(a.metros, a.segundos),
            velocidad: velocidad(a.metros, a.segundos)
        }));

        // Resumen de los últimos treinta días, que es lo que la persona
        // mira para saber si está sosteniendo el hábito.
        const res30 = await pool.query(
            `SELECT deporte, COUNT(*)::int veces, SUM(segundos)::int segundos,
                    COALESCE(SUM(metros),0)::int metros
               FROM actividades
              WHERE usuario_id = $1 AND inicio > NOW() - INTERVAL '30 days'
              GROUP BY deporte ORDER BY segundos DESC`, [req.usuario.id]);

        res.json({
            actividades: conCalculos,
            resumen_30d: res30.rows.map(x => ({
                ...x, nombre: (porCodigo(x.deporte) || {}).nombre || x.deporte
            }))
        });
    } catch (err) {
        console.error("[ACTIVIDADES] listar:", err.message);
        res.status(500).json({ message: "No se pudo leer tu historial." });
    }
});

/** Una actividad con su recorrido, para dibujar el mapa. */
router.get("/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ message: "Identificador inválido." });

    try {
        const a = await pool.query(
            "SELECT * FROM actividades WHERE id = $1 AND usuario_id = $2",
            [id, req.usuario.id]
        );
        // 404 y no 403: un 403 confirmaría que la actividad existe y es
        // de otra persona, que ya es más información de la que hace falta.
        if (a.rowCount === 0) return res.status(404).json({ message: "No se encontró esa actividad." });

        const rec = await pool.query("SELECT puntos FROM recorridos WHERE actividad_id = $1", [id]);
        const act = a.rows[0];

        res.json({
            actividad: {
                ...act,
                nombre_deporte: (porCodigo(act.deporte) || {}).nombre || act.deporte,
                ritmo: ritmo(act.metros, act.segundos),
                velocidad: velocidad(act.metros, act.segundos)
            },
            recorrido: rec.rowCount ? rec.rows[0].puntos : null
        });
    } catch (err) {
        res.status(500).json({ message: "No se pudo leer la actividad." });
    }
});

router.delete("/:id", async (req, res) => {
    try {
        const r = await pool.query(
            "DELETE FROM actividades WHERE id = $1 AND usuario_id = $2 RETURNING id",
            [Number(req.params.id), req.usuario.id]
        );
        if (r.rowCount === 0) return res.status(404).json({ message: "No se encontró esa actividad." });
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ message: "No se pudo borrar." });
    }
});

module.exports = router;
