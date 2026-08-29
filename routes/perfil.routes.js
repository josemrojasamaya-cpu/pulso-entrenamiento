const express = require("express");
const pool = require("../config/db");
const { requiereSesion, exigirAccesoAtleta } = require("../middleware/auth");
const { catalogoCondiciones, restricciones } = require("../lib/salud");
const { catalogoModelos, modeloSugerido, semanaDe, MODELOS } = require("../lib/periodizacion");

const router = express.Router();

/**
 * Descarta las rutinas futuras que todavía no se empezaron.
 *
 * Se llama cuando cambian las condiciones de salud o el perfil, porque
 * los dos alteran qué ejercicios corresponden y con qué parámetros. Las
 * rutinas se generan hasta con siete días de anticipación: sin esto,
 * quien declara un embarazo el lunes sigue recibiendo hasta el domingo
 * el plan que se armó cuando no lo había declarado.
 *
 * Las que ya tienen series registradas NO se tocan: ahí hay trabajo real
 * que no se puede perder. Esas se revisan al abrirlas y se corrigen en
 * el lugar o se avisa.
 */
async function descartarPlanFuturo(usuarioId) {
    const r = await pool.query(
        `DELETE FROM rutinas r
          WHERE r.usuario_id = $1
            AND r.fecha >= CURRENT_DATE
            AND r.estado = 'pendiente'
            AND NOT EXISTS (
                SELECT 1 FROM series s
                  JOIN rutina_ejercicios re ON re.id = s.rutina_ejercicio_id
                 WHERE re.rutina_id = r.id)
          RETURNING r.id`,
        [usuarioId]
    );
    return r.rowCount;
}
router.use(requiereSesion);

/** Condiciones que el formulario puede ofrecer. */
router.get("/condiciones/catalogo", (req, res) => res.json(catalogoCondiciones()));

/* ── Perfil de entrenamiento ──────────────────────────────────────── */

router.get("/:id/perfil", exigirAccesoAtleta, async (req, res) => {
    try {
        const [perfil, condiciones] = await Promise.all([
            pool.query("SELECT * FROM perfiles WHERE usuario_id = $1", [req.atletaId]),
            pool.query("SELECT codigo, detalle, severidad FROM condiciones WHERE usuario_id = $1 AND activa ORDER BY codigo",
                       [req.atletaId])
        ]);

        const codigos = condiciones.rows.map(c => c.codigo);
        res.json({
            perfil: perfil.rows[0] || null,
            condiciones: condiciones.rows,
            // Los límites que resultan de esas condiciones se devuelven
            // ya calculados: la persona tiene derecho a ver por qué su
            // rutina es más suave que la de otro.
            limites: restricciones(codigos)
        });
    } catch (err) {
        console.error("[PERFIL] leer:", err.message);
        res.status(500).json({ message: "No se pudo leer el perfil." });
    }
});

const OBJETIVOS_VALIDOS = ["perder_grasa", "ganar_musculo", "fuerza", "resistencia", "salud"];
const NIVELES_VALIDOS   = ["principiante", "intermedio", "avanzado"];
const LUGARES_VALIDOS   = ["gimnasio", "casa", "mixto"];
const EQUIPO_VALIDO     = ["peso_corporal", "mancuernas", "barra", "maquina", "banda", "kettlebell", "polea"];

router.put("/:id/perfil", exigirAccesoAtleta, async (req, res) => {
    const b = req.body || {};

    // Los valores se validan contra listas cerradas antes de tocar la
    // base: el motor de rutinas se ramifica según estos campos, y un
    // objetivo inventado lo dejaría cayendo siempre al caso por omisión
    // sin que nadie se entere.
    if (b.objetivo && !OBJETIVOS_VALIDOS.includes(b.objetivo)) {
        return res.status(400).json({ message: "Objetivo no reconocido." });
    }
    if (b.nivel && !NIVELES_VALIDOS.includes(b.nivel)) {
        return res.status(400).json({ message: "Nivel no reconocido." });
    }
    if (b.lugar && !LUGARES_VALIDOS.includes(b.lugar)) {
        return res.status(400).json({ message: "Lugar no reconocido." });
    }

    let equipo = Array.isArray(b.equipo) ? b.equipo.filter(e => EQUIPO_VALIDO.includes(e)) : null;
    if (equipo && equipo.length === 0) equipo = ["peso_corporal"];

    let equipoCasa = Array.isArray(b.equipo_casa)
        ? b.equipo_casa.filter(e => EQUIPO_VALIDO.includes(e)) : null;
    // Siempre queda al menos el peso corporal: es lo que hay en cualquier
    // casa, y sin nada marcado no se podría armar ninguna sesión.
    if (equipoCasa && equipoCasa.length === 0) equipoCasa = ["peso_corporal"];

    const dias = Number(b.dias_por_semana);
    if (b.dias_por_semana !== undefined && (!Number.isInteger(dias) || dias < 1 || dias > 7)) {
        return res.status(400).json({ message: "Los días por semana van de 1 a 7." });
    }

    const minutos = Number(b.minutos_sesion);
    if (b.minutos_sesion !== undefined && (!Number.isInteger(minutos) || minutos < 15 || minutos > 180)) {
        return res.status(400).json({ message: "La sesión debe durar entre 15 y 180 minutos." });
    }

    try {
        await pool.query(
            `INSERT INTO perfiles
               (usuario_id, fecha_nacimiento, sexo, altura_cm, objetivo, nivel,
                dias_por_semana, minutos_sesion, lugar, equipo, dias_disponibles,
                equipo_casa, actualizado_en)
             VALUES ($1,$2,$3,$4,
                     COALESCE($5,'salud'), COALESCE($6,'principiante'),
                     COALESCE($7,3), COALESCE($8,45), COALESCE($9,'gimnasio'),
                     COALESCE($10::jsonb,'["peso_corporal"]'::jsonb),
                     COALESCE($11::jsonb,'[1,3,5]'::jsonb),
                     COALESCE($12::jsonb,'["peso_corporal"]'::jsonb), NOW())
             ON CONFLICT (usuario_id) DO UPDATE SET
                fecha_nacimiento = COALESCE(EXCLUDED.fecha_nacimiento, perfiles.fecha_nacimiento),
                sexo             = COALESCE(EXCLUDED.sexo,             perfiles.sexo),
                altura_cm        = COALESCE(EXCLUDED.altura_cm,        perfiles.altura_cm),
                objetivo         = EXCLUDED.objetivo,
                nivel            = EXCLUDED.nivel,
                dias_por_semana  = EXCLUDED.dias_por_semana,
                minutos_sesion   = EXCLUDED.minutos_sesion,
                lugar            = EXCLUDED.lugar,
                equipo           = EXCLUDED.equipo,
                dias_disponibles = EXCLUDED.dias_disponibles,
                equipo_casa      = COALESCE(EXCLUDED.equipo_casa, perfiles.equipo_casa),
                actualizado_en   = NOW()`,
            [
                req.atletaId, b.fecha_nacimiento || null, b.sexo || null, b.altura_cm || null,
                b.objetivo || null, b.nivel || null,
                Number.isInteger(dias) ? dias : null,
                Number.isInteger(minutos) ? minutos : null,
                b.lugar || null,
                equipo ? JSON.stringify(equipo) : null,
                Array.isArray(b.dias_disponibles) ? JSON.stringify(b.dias_disponibles) : null,
                equipoCasa ? JSON.stringify(equipoCasa) : null
            ]
        );
        const rehechas = await descartarPlanFuturo(req.atletaId);
        res.json({
            ok: true,
            rutinas_rehechas: rehechas,
            ...(rehechas ? {
                mensaje: `Se rehará el plan de los próximos ${rehechas} día(s) con tus datos nuevos.`
            } : {})
        });
    } catch (err) {
        console.error("[PERFIL] guardar:", err.message);
        res.status(500).json({ message: "No se pudo guardar el perfil." });
    }
});

/* ── Condiciones de salud ─────────────────────────────────────────── */

router.put("/:id/condiciones", exigirAccesoAtleta, async (req, res) => {
    const lista = Array.isArray(req.body && req.body.condiciones) ? req.body.condiciones : [];
    const validos = catalogoCondiciones().map(c => c.codigo);

    const cliente = await pool.connect();
    try {
        await cliente.query("BEGIN");
        // Se reemplaza el conjunto entero dentro de una transacción: si
        // se borrara primero y fallara el alta, la persona quedaría sin
        // condiciones registradas y con una rutina que no le corresponde.
        await cliente.query("DELETE FROM condiciones WHERE usuario_id = $1", [req.atletaId]);

        for (const c of lista) {
            const codigo = typeof c === "string" ? c : c.codigo;
            if (!validos.includes(codigo)) continue;
            await cliente.query(
                `INSERT INTO condiciones (usuario_id, codigo, detalle, severidad)
                 VALUES ($1,$2,$3,$4) ON CONFLICT (usuario_id, codigo) DO NOTHING`,
                [req.atletaId, codigo, (c && c.detalle) || null, (c && c.severidad) || "moderada"]
            );
        }
        await cliente.query("COMMIT");

        // El plan futuro se rehace con las condiciones nuevas.
        const rehechas = await descartarPlanFuturo(req.atletaId);

        const activas = lista
            .map(c => (typeof c === "string" ? { codigo: c, severidad: "moderada" } : c))
            .filter(c => validos.includes(c.codigo));

        res.json({
            ok: true,
            limites: restricciones(activas),
            rutinas_rehechas: rehechas
        });
    } catch (err) {
        await cliente.query("ROLLBACK").catch(() => {});
        console.error("[CONDICIONES]", err.message);
        res.status(500).json({ message: "No se pudieron guardar las condiciones." });
    } finally {
        cliente.release();
    }
});

/* ── Mediciones corporales ────────────────────────────────────────── */

const CAMPOS_MEDIDA = [
    "peso_kg", "grasa_pct", "musculo_kg", "agua_pct",
    "cuello", "hombros", "pecho", "biceps_izq", "biceps_der",
    "antebrazo_izq", "antebrazo_der", "cintura", "abdomen", "cadera",
    "muslo_izq", "muslo_der", "pantorrilla_izq", "pantorrilla_der"
];

router.get("/:id/mediciones", exigirAccesoAtleta, async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT * FROM mediciones WHERE usuario_id = $1 ORDER BY fecha ASC`,
            [req.atletaId]
        );
        res.json(r.rows);
    } catch (err) {
        res.status(500).json({ message: "No se pudieron leer las mediciones." });
    }
});

router.post("/:id/mediciones", exigirAccesoAtleta, async (req, res) => {
    const b = req.body || {};

    const valores = {};
    for (const campo of CAMPOS_MEDIDA) {
        const v = b[campo];
        if (v === undefined || v === null || v === "") { valores[campo] = null; continue; }
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0 || n > 400) {
            return res.status(400).json({ message: `Valor fuera de rango en "${campo}".` });
        }
        valores[campo] = n;
    }

    if (CAMPOS_MEDIDA.every(c => valores[c] === null)) {
        return res.status(400).json({ message: "No se registró ninguna medida." });
    }

    const columnas = ["usuario_id", "fecha", ...CAMPOS_MEDIDA, "notas"];
    const params = [req.atletaId, b.fecha || new Date().toISOString().slice(0, 10),
                    ...CAMPOS_MEDIDA.map(c => valores[c]), b.notas || null];
    const marcas = params.map((_, i) => `$${i + 1}`);

    // Medirse dos veces el mismo día sobrescribe en vez de fallar: es lo
    // que la persona espera cuando corrige un número mal tecleado.
    const actualiza = [...CAMPOS_MEDIDA, "notas"]
        .map(c => `${c} = EXCLUDED.${c}`).join(", ");

    try {
        const r = await pool.query(
            `INSERT INTO mediciones (${columnas.join(",")}) VALUES (${marcas.join(",")})
             ON CONFLICT (usuario_id, fecha) DO UPDATE SET ${actualiza}
             RETURNING id, fecha`,
            params
        );

        // Registrar una medición suma puntos, una vez por fecha.
        await pool.query(
            `INSERT INTO puntos (usuario_id, tipo, puntos, detalle, referencia, fecha)
             VALUES ($1,'medicion',40,'Medición corporal registrada',$2,$3)
             ON CONFLICT (usuario_id, tipo, referencia) DO NOTHING`,
            [req.atletaId, `med-${r.rows[0].fecha.toISOString().slice(0, 10)}`, r.rows[0].fecha]
        ).catch(() => {});

        res.status(201).json(r.rows[0]);
    } catch (err) {
        console.error("[MEDICIONES]", err.message);
        res.status(500).json({ message: "No se pudo guardar la medición." });
    }
});

/**
 * Comparación entre dos mediciones.
 *
 * Es la pantalla por la que existe esta parte del sistema: te medís,
 * entrenás dos meses, te volvés a medir y querés ver la diferencia. Sin
 * esto, las medidas serían una lista de números sin significado.
 */
router.get("/:id/mediciones/comparar", exigirAccesoAtleta, async (req, res) => {
    try {
        const r = await pool.query(
            "SELECT * FROM mediciones WHERE usuario_id = $1 ORDER BY fecha ASC",
            [req.atletaId]
        );
        if (r.rowCount < 2) {
            return res.json({
                suficiente: false,
                mensaje: r.rowCount === 0
                    ? "Todavía no registraste ninguna medición."
                    : "Con una sola medición no hay nada que comparar. Volvé a medirte en cuatro a seis semanas."
            });
        }

        const desde = req.query.desde
            ? r.rows.find(m => m.fecha.toISOString().slice(0, 10) === req.query.desde) || r.rows[0]
            : r.rows[0];
        const hasta = req.query.hasta
            ? r.rows.find(m => m.fecha.toISOString().slice(0, 10) === req.query.hasta) || r.rows[r.rowCount - 1]
            : r.rows[r.rowCount - 1];

        const cambios = CAMPOS_MEDIDA.map(campo => {
            const a = desde[campo] === null ? null : Number(desde[campo]);
            const b = hasta[campo] === null ? null : Number(hasta[campo]);
            if (a === null || b === null) return null;
            const dif = b - a;
            return {
                campo,
                antes: a,
                ahora: b,
                diferencia: Math.round(dif * 10) / 10,
                porcentaje: a > 0 ? Math.round((dif / a) * 1000) / 10 : null
            };
        }).filter(Boolean);

        const dias = Math.round((hasta.fecha - desde.fecha) / 86400000);

        res.json({
            suficiente: true,
            desde: desde.fecha, hasta: hasta.fecha, dias,
            cambios,
            fechas: r.rows.map(m => m.fecha)
        });
    } catch (err) {
        console.error("[COMPARAR]", err.message);
        res.status(500).json({ message: "No se pudo comparar." });
    }
});

/* ── Mesociclos ───────────────────────────────────────────────────── */

/** Modelos de periodización disponibles. */
router.get("/periodizacion/modelos", (req, res) => res.json(catalogoModelos()));

/** Bloque activo, con la semana en la que cae hoy. */
router.get("/:id/mesociclo", exigirAccesoAtleta, async (req, res) => {
    try {
        const [meso, perfil] = await Promise.all([
            pool.query("SELECT * FROM mesociclos WHERE usuario_id = $1 AND activo LIMIT 1", [req.atletaId]),
            pool.query("SELECT objetivo, nivel FROM perfiles WHERE usuario_id = $1", [req.atletaId])
        ]);

        const p = perfil.rows[0] || {};
        const hoy = new Date().toISOString().slice(0, 10);

        res.json({
            mesociclo: meso.rows[0] || null,
            semana: meso.rows[0] ? semanaDe(meso.rows[0], hoy) : null,
            sugerido: modeloSugerido(p.objetivo, p.nivel),
            modelos: catalogoModelos()
        });
    } catch (err) {
        console.error("[MESOCICLO] leer:", err.message);
        res.status(500).json({ message: "No se pudo leer el bloque." });
    }
});

/**
 * Inicia un bloque nuevo.
 *
 * El anterior se archiva en vez de borrarse: forma parte del historial de
 * la persona, y saber qué modelo siguió cuando progresó es justamente lo
 * que permite repetirlo.
 */
router.post("/:id/mesociclo", exigirAccesoAtleta, async (req, res) => {
    const b = req.body || {};
    const modelo = String(b.modelo || "");

    if (!MODELOS[modelo]) {
        return res.status(400).json({
            message: `Modelo no reconocido. Opciones: ${Object.keys(MODELOS).join(", ")}.`
        });
    }

    const inicio = b.inicio && /^\d{4}-\d{2}-\d{2}$/.test(b.inicio)
        ? b.inicio : new Date().toISOString().slice(0, 10);

    const cliente = await pool.connect();
    try {
        await cliente.query("BEGIN");
        await cliente.query(
            "UPDATE mesociclos SET activo = FALSE WHERE usuario_id = $1 AND activo",
            [req.atletaId]
        );
        const r = await cliente.query(
            `INSERT INTO mesociclos (usuario_id, nombre, modelo, inicio)
             VALUES ($1,$2,$3,$4::date) RETURNING *`,
            [req.atletaId,
             (b.nombre || MODELOS[modelo].nombre).slice(0, 120),
             modelo, inicio]
        );
        await cliente.query("COMMIT");

        // El plan futuro se rehace: las semanas del bloque nuevo cambian
        // volumen e intensidad desde mañana.
        const rehechas = await descartarPlanFuturo(req.atletaId);

        res.status(201).json({
            mesociclo: r.rows[0],
            semana: semanaDe(r.rows[0], new Date().toISOString().slice(0, 10)),
            rutinas_rehechas: rehechas
        });
    } catch (err) {
        await cliente.query("ROLLBACK").catch(() => {});
        console.error("[MESOCICLO] crear:", err.message);
        res.status(500).json({ message: "No se pudo iniciar el bloque." });
    } finally {
        cliente.release();
    }
});

/** Cierra el bloque activo. */
router.delete("/:id/mesociclo", exigirAccesoAtleta, async (req, res) => {
    try {
        await pool.query(
            "UPDATE mesociclos SET activo = FALSE WHERE usuario_id = $1 AND activo",
            [req.atletaId]
        );
        const rehechas = await descartarPlanFuturo(req.atletaId);
        res.json({ ok: true, rutinas_rehechas: rehechas });
    } catch (err) {
        res.status(500).json({ message: "No se pudo cerrar el bloque." });
    }
});


/* ── Paleta de color ──────────────────────────────────────────────── */

// Los temas de pago se comprueban ACÁ. En el navegador se aplican sin
// preguntar —quien fuerce uno desde la consola se pinta su propia
// pantalla y no le quita nada a nadie— pero guardarlo, que es lo que lo
// hace permanente y lo lleva a sus otros dispositivos, requiere el plan.
const TEMAS_GRATIS = ["acero", "carbon"];
const TEMAS_PAGO = ["brasa", "selva", "vino", "indigo", "hielo", "arena"];

router.put("/tema", async (req, res) => {
    const tema = String((req.body || {}).tema || "").trim();
    if (!TEMAS_GRATIS.includes(tema) && !TEMAS_PAGO.includes(tema)) {
        return res.status(400).json({ message: "Ese tema no existe." });
    }

    try {
        if (TEMAS_PAGO.includes(tema)) {
            const u = await pool.query(
                `SELECT plan, plan_vence FROM usuarios WHERE id = $1`, [req.usuario.id]);
            const c = u.rows[0] || {};
            const alDia = c.plan && c.plan !== "gratis" &&
                          c.plan_vence && new Date(c.plan_vence) >= new Date(new Date().toDateString());
            if (!alDia) {
                return res.status(402).json({
                    message: "Esta paleta es parte del plan completo.",
                    requiere_plan: true
                });
            }
        }

        await pool.query(
            `INSERT INTO perfiles (usuario_id, tema) VALUES ($1,$2)
             ON CONFLICT (usuario_id) DO UPDATE SET tema = EXCLUDED.tema`,
            [req.usuario.id, tema]
        );
        res.json({ ok: true, tema });
    } catch (err) {
        console.error("[TEMA] guardar:", err.message);
        res.status(500).json({ message: "No se pudo guardar la paleta." });
    }
});

module.exports = router;
