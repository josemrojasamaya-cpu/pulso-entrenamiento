const express = require("express");
const pool = require("../config/db");
const { requiereSesion } = require("../middleware/auth");
const { leer } = require("../lib/importar");
const { planDe } = require("../lib/planes");
const { catalogo } = require("../lib/aplicaciones");

const router = express.Router();
router.use(requiereSesion);

async function cuentaDe(usuarioId) {
    const r = await pool.query(
        "SELECT id, plan, plan_vence FROM usuarios WHERE id = $1", [usuarioId]
    );
    return r.rows[0] || null;
}

/* ── Dispositivos ─────────────────────────────────────────────────── */

const TIPOS = ["banda_pecho", "pulsera", "reloj", "bascula", "tensiometro", "telefono", "otro"];
const VIAS  = ["bluetooth", "archivo", "manual"];

router.get("/dispositivos", async (req, res) => {
    try {
        const [d, ultimas] = await Promise.all([
            pool.query(
                `SELECT * FROM dispositivos WHERE usuario_id = $1 AND activo
                  ORDER BY vinculado_en DESC`, [req.usuario.id]),
            pool.query(
                `SELECT tipo, COUNT(*)::int n, MAX(medido_en) ultima
                   FROM biometria WHERE usuario_id = $1
                  GROUP BY tipo ORDER BY 1`, [req.usuario.id])
        ]);

        const cuenta = await cuentaDe(req.usuario.id);
        const plan = planDe(cuenta);

        res.json({
            dispositivos: d.rows,
            resumen: ultimas.rows,
            // La importación de archivos está en todos los planes a
            // propósito: son los datos de la persona, y cobrar por dejar
            // que los traiga sería mezquino.
            puede_conectar: plan.limites.dispositivos,
            plan: plan.nombre
        });
    } catch (err) {
        console.error("[DISPOSITIVOS] listar:", err.message);
        res.status(500).json({ message: "No se pudieron leer tus dispositivos." });
    }
});

router.post("/dispositivos", async (req, res) => {
    const b = req.body || {};
    const nombre = String(b.nombre || "").trim();
    const tipo = String(b.tipo || "otro");
    const via = String(b.via || "bluetooth");

    if (nombre.length < 2) return res.status(400).json({ message: "Falta el nombre del dispositivo." });
    if (!TIPOS.includes(tipo)) return res.status(400).json({ message: "Tipo de dispositivo no reconocido." });
    if (!VIAS.includes(via)) return res.status(400).json({ message: "Forma de conexión no reconocida." });

    try {
        const r = await pool.query(
            `INSERT INTO dispositivos (usuario_id, nombre, marca, tipo, via, identificador)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [req.usuario.id, nombre.slice(0, 120),
             b.marca ? String(b.marca).slice(0, 60) : null,
             tipo, via, b.identificador ? String(b.identificador).slice(0, 120) : null]
        );
        res.status(201).json({ dispositivo: r.rows[0] });
    } catch (err) {
        console.error("[DISPOSITIVOS] crear:", err.message);
        res.status(500).json({ message: "No se pudo guardar el dispositivo." });
    }
});

router.delete("/dispositivos/:id", async (req, res) => {
    try {
        await pool.query(
            "UPDATE dispositivos SET activo = FALSE WHERE id = $1 AND usuario_id = $2",
            [Number(req.params.id), req.usuario.id]
        );
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ message: "No se pudo quitar el dispositivo." });
    }
});

/**
 * Catálogo de aplicaciones que se pueden traer.
 *
 * No hace falta sesión de nadie más ni convenio con nadie: son los pasos
 * para que la persona baje SUS datos de donde ya los tiene. Si no usa
 * una plataforma, no va a ver nada de esa plataforma, y eso está bien.
 */
router.get("/aplicaciones", (_req, res) => {
    res.json({ aplicaciones: catalogo() });
});

/* ── Importación de archivos ──────────────────────────────────────── */

/**
 * Lee un archivo y devuelve lo que entendió, SIN guardar nada.
 *
 * La persona ve primero qué se va a importar y confirma. Importar a
 * ciegas datos de otra plataforma es la forma más rápida de ensuciar un
 * historial, y deshacerlo después es mucho más difícil que revisarlo
 * antes.
 */
router.post("/importar/revisar", async (req, res) => {
    const b = req.body || {};
    if (!b.contenido) return res.status(400).json({ message: "No llegó ningún archivo." });

    const resultado = leer(b.nombre, b.contenido);
    if (resultado.error) return res.status(400).json({ message: resultado.error });

    // Resumen por tipo, para que se vea de un vistazo qué trae.
    const porTipo = {};
    for (const l of resultado.lecturas) {
        const clave = l.campo || l.tipo;
        porTipo[clave] = porTipo[clave] || { n: 0, desde: null, hasta: null };
        porTipo[clave].n++;
        if (!porTipo[clave].desde || l.medido_en < porTipo[clave].desde) porTipo[clave].desde = l.medido_en;
        if (!porTipo[clave].hasta || l.medido_en > porTipo[clave].hasta) porTipo[clave].hasta = l.medido_en;
    }

    res.json({
        formato: resultado.formato,
        total: resultado.lecturas.length,
        actividades: (resultado.actividades || []).length,
        por_tipo: porTipo,
        columnas_reconocidas: resultado.columnas_reconocidas,
        columnas_ignoradas: resultado.columnas_ignoradas,
        // Se devuelven las lecturas para confirmarlas sin volver a subir
        // el archivo. Con un archivo grande esto pesa, así que se acota.
        lecturas: resultado.lecturas.slice(0, 5000)
    });
});

const TIPOS_BIO = ["pulso", "presion", "pasos", "calorias", "sueno_min", "spo2", "vo2max"];

/** Guarda lo que la persona confirmó. */
router.post("/importar/confirmar", async (req, res) => {
    const lecturas = Array.isArray(req.body && req.body.lecturas) ? req.body.lecturas : [];
    if (lecturas.length === 0) return res.status(400).json({ message: "No hay nada que importar." });
    if (lecturas.length > 5000) return res.status(400).json({ message: "Demasiadas lecturas de una sola vez." });

    let bio = 0, med = 0, saltadas = 0;
    const cliente = await pool.connect();
    try {
        await cliente.query("BEGIN");

        for (const l of lecturas) {
            const cuando = l.medido_en ? new Date(l.medido_en) : null;
            if (!cuando || isNaN(cuando.getTime())) { saltadas++; continue; }

            // Las mediciones corporales van a su propia tabla, no a
            // biometría: son el eje del seguimiento y ya tienen su
            // pantalla y sus comparaciones.
            if (l.tipo === "medicion") {
                const campo = l.campo === "grasa" ? "grasa_pct" : "peso_kg";
                const valor = Number(l.valor);
                if (!Number.isFinite(valor) || valor <= 0) { saltadas++; continue; }

                const r = await cliente.query(
                    `INSERT INTO mediciones (usuario_id, fecha, ${campo}, notas)
                     VALUES ($1,$2::date,$3,'Importado')
                     ON CONFLICT (usuario_id, fecha)
                     DO UPDATE SET ${campo} = COALESCE(mediciones.${campo}, EXCLUDED.${campo})
                     RETURNING id`,
                    [req.usuario.id, cuando.toISOString().slice(0, 10), valor]
                );
                if (r.rowCount) med++;
                continue;
            }

            if (!TIPOS_BIO.includes(l.tipo)) { saltadas++; continue; }
            const valor = Number(l.valor);
            if (!Number.isFinite(valor)) { saltadas++; continue; }

            const r = await cliente.query(
                `INSERT INTO biometria (usuario_id, tipo, valor, origen, medido_en)
                 VALUES ($1,$2,$3,'archivo',$4::timestamptz)
                 ON CONFLICT (usuario_id, tipo, medido_en) DO NOTHING`,
                [req.usuario.id, l.tipo, valor, cuando.toISOString()]
            );
            if (r.rowCount) bio++;
        }

        await cliente.query("COMMIT");
        res.status(201).json({ biometria: bio, mediciones: med, saltadas });
    } catch (err) {
        await cliente.query("ROLLBACK").catch(() => {});
        console.error("[IMPORTAR]", err.message);
        res.status(500).json({ message: "No se pudo importar el archivo." });
    } finally {
        cliente.release();
    }
});

/* ── Hidratación ──────────────────────────────────────────────────── */

router.get("/agua", async (req, res) => {
    try {
        const [hoy, semana, perfil] = await Promise.all([
            pool.query(
                `SELECT COALESCE(SUM(ml),0)::int total, COUNT(*)::int veces
                   FROM hidratacion WHERE usuario_id = $1 AND fecha = CURRENT_DATE`,
                [req.usuario.id]),
            pool.query(
                `SELECT fecha, SUM(ml)::int total FROM hidratacion
                  WHERE usuario_id = $1 AND fecha > CURRENT_DATE - 7
                  GROUP BY fecha ORDER BY fecha`, [req.usuario.id]),
            pool.query(
                `SELECT meta_agua_ml, vaso_ml, recordar_agua, recordar_cada_min
                   FROM perfiles WHERE usuario_id = $1`, [req.usuario.id])
        ]);

        const p = perfil.rows[0] || { meta_agua_ml: 2500, vaso_ml: 250, recordar_agua: false, recordar_cada_min: 90 };
        const total = hoy.rows[0].total;

        res.json({
            hoy: total,
            veces: hoy.rows[0].veces,
            meta: p.meta_agua_ml,
            vaso: p.vaso_ml,
            porcentaje: Math.min(100, Math.round((total / p.meta_agua_ml) * 100)),
            recordar: p.recordar_agua,
            cada_min: p.recordar_cada_min,
            semana: semana.rows
        });
    } catch (err) {
        console.error("[AGUA] leer:", err.message);
        res.status(500).json({ message: "No se pudo leer la hidratación." });
    }
});

router.post("/agua", async (req, res) => {
    const ml = Number((req.body && req.body.ml) || 0);
    // Tres litros de una sola vez no es un vaso: es un dedo que se
    // resbaló, y ensucia el promedio del día.
    if (!Number.isFinite(ml) || ml <= 0 || ml > 3000) {
        return res.status(400).json({ message: "Esa cantidad no parece real." });
    }
    try {
        await pool.query(
            "INSERT INTO hidratacion (usuario_id, ml) VALUES ($1,$2)",
            [req.usuario.id, Math.round(ml)]
        );
        const r = await pool.query(
            `SELECT COALESCE(SUM(ml),0)::int total FROM hidratacion
              WHERE usuario_id = $1 AND fecha = CURRENT_DATE`, [req.usuario.id]
        );
        const total = r.rows[0].total;

        // Los puntos se dan por CUMPLIR LA META DEL DIA, una sola vez, y
        // no por cada vaso registrado. Pagar por toque invita a tocar el
        // boton veinte veces sin tomar nada, y un ranking que se puede
        // inflar deja de significar algo a los tres dias.
        const perfil = await pool.query(
            "SELECT meta_agua_ml FROM perfiles WHERE usuario_id = $1", [req.usuario.id]
        );
        const meta = perfil.rowCount ? perfil.rows[0].meta_agua_ml : 2500;
        let gano = 0;

        if (total >= meta) {
            const hoy = new Date().toISOString().slice(0, 10);
            const p = await pool.query(
                `INSERT INTO puntos (usuario_id, tipo, puntos, detalle, referencia, fecha)
                 VALUES ($1,'hidratacion',20,'Meta de hidratación cumplida',$2,CURRENT_DATE)
                 ON CONFLICT (usuario_id, tipo, referencia) DO NOTHING
                 RETURNING id`,
                [req.usuario.id, `agua-${hoy}`]
            );
            if (p.rowCount) gano = 20;
        }

        res.status(201).json({ hoy: total, meta_cumplida: total >= meta, puntos_ganados: gano });
    } catch (err) {
        res.status(500).json({ message: "No se pudo registrar." });
    }
});

/** Deshace el último registro: el error más común es tocar de más. */
router.delete("/agua/ultimo", async (req, res) => {
    try {
        await pool.query(
            `DELETE FROM hidratacion WHERE id = (
                SELECT id FROM hidratacion
                 WHERE usuario_id = $1 AND fecha = CURRENT_DATE
                 ORDER BY registrado DESC LIMIT 1)`,
            [req.usuario.id]
        );
        const r = await pool.query(
            `SELECT COALESCE(SUM(ml),0)::int total FROM hidratacion
              WHERE usuario_id = $1 AND fecha = CURRENT_DATE`, [req.usuario.id]
        );
        res.json({ hoy: r.rows[0].total });
    } catch (err) {
        res.status(500).json({ message: "No se pudo deshacer." });
    }
});

router.put("/agua/preferencias", async (req, res) => {
    const b = req.body || {};
    const meta = Number(b.meta_agua_ml);
    const vaso = Number(b.vaso_ml);
    const cada = Number(b.recordar_cada_min);

    if (b.meta_agua_ml !== undefined && (!Number.isFinite(meta) || meta < 500 || meta > 8000)) {
        return res.status(400).json({ message: "La meta diaria va de 500 a 8000 ml." });
    }
    if (b.vaso_ml !== undefined && (!Number.isFinite(vaso) || vaso < 50 || vaso > 2000)) {
        return res.status(400).json({ message: "El vaso va de 50 a 2000 ml." });
    }
    if (b.recordar_cada_min !== undefined && (!Number.isFinite(cada) || cada < 15 || cada > 480)) {
        return res.status(400).json({ message: "El recordatorio va de 15 a 480 minutos." });
    }

    try {
        await pool.query(
            `UPDATE perfiles SET
                meta_agua_ml      = COALESCE($2, meta_agua_ml),
                vaso_ml           = COALESCE($3, vaso_ml),
                recordar_agua     = COALESCE($4, recordar_agua),
                recordar_cada_min = COALESCE($5, recordar_cada_min)
              WHERE usuario_id = $1`,
            [req.usuario.id,
             Number.isFinite(meta) ? Math.round(meta) : null,
             Number.isFinite(vaso) ? Math.round(vaso) : null,
             typeof b.recordar_agua === "boolean" ? b.recordar_agua : null,
             Number.isFinite(cada) ? Math.round(cada) : null]
        );
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ message: "No se pudieron guardar las preferencias." });
    }
});

/* ── Sueño ────────────────────────────────────────────────────────── */

router.get("/sueno", async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT medido_en::date fecha, valor minutos, origen
               FROM biometria
              WHERE usuario_id = $1 AND tipo = 'sueno_min'
                AND medido_en > NOW() - INTERVAL '30 days'
              ORDER BY medido_en`, [req.usuario.id]
        );

        const noches = r.rows.map(n => ({
            fecha: n.fecha,
            minutos: Number(n.minutos),
            horas: Math.round((Number(n.minutos) / 60) * 10) / 10,
            origen: n.origen
        }));

        const media = noches.length
            ? noches.reduce((s, n) => s + n.minutos, 0) / noches.length : null;

        res.json({
            noches,
            promedio_horas: media ? Math.round((media / 60) * 10) / 10 : null,
            // Siete horas es el piso que la mayoría de las guías marcan
            // para un adulto. No es una regla de la aplicación: es el
            // punto de referencia contra el que se compara.
            referencia_horas: 7,
            noches_cortas: noches.filter(n => n.minutos < 420).length
        });
    } catch (err) {
        res.status(500).json({ message: "No se pudo leer el sueño." });
    }
});

router.post("/sueno", async (req, res) => {
    const horas = Number((req.body && req.body.horas) || 0);
    if (!Number.isFinite(horas) || horas <= 0 || horas > 20) {
        return res.status(400).json({ message: "Las horas de sueño van de 0 a 20." });
    }
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(req.body.fecha)
        ? req.body.fecha : new Date().toISOString().slice(0, 10);

    try {
        await pool.query(
            `INSERT INTO biometria (usuario_id, tipo, valor, origen, medido_en)
             VALUES ($1,'sueno_min',$2,'manual',$3::date + TIME '08:00')
             ON CONFLICT (usuario_id, tipo, medido_en)
             DO UPDATE SET valor = EXCLUDED.valor`,
            [req.usuario.id, Math.round(horas * 60), fecha]
        );
        res.status(201).json({ ok: true });
    } catch (err) {
        res.status(500).json({ message: "No se pudo registrar el sueño." });
    }
});

/* ── Galería de evolución ─────────────────────────────────────────── */

router.get("/fotos", async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT id, fecha, angulo, imagen, peso_kg, nota
               FROM fotos WHERE usuario_id = $1 ORDER BY fecha DESC, id DESC LIMIT 100`,
            [req.usuario.id]
        );
        res.json(r.rows);
    } catch (err) {
        res.status(500).json({ message: "No se pudo leer la galería." });
    }
});

router.post("/fotos", async (req, res) => {
    const b = req.body || {};
    const imagen = String(b.imagen || "");

    if (!/^data:image\/(jpeg|png|webp);base64,/.test(imagen)) {
        return res.status(400).json({ message: "La imagen no tiene un formato válido." });
    }
    // 1,4 MB de data URI son cerca de 1 MB de imagen. El navegador ya la
    // reduce antes de enviarla; este tope es la red de contención.
    if (imagen.length > 1_400_000) {
        return res.status(413).json({ message: "La foto pesa demasiado. Probá con una más chica." });
    }

    const angulo = ["frente", "perfil", "espalda"].includes(b.angulo) ? b.angulo : "frente";
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(b.fecha) ? b.fecha : new Date().toISOString().slice(0, 10);

    try {
        // El peso del día se toma de la última medición: así la foto
        // queda atada a un número y no sólo a una impresión.
        const peso = await pool.query(
            `SELECT peso_kg FROM mediciones
              WHERE usuario_id = $1 AND peso_kg IS NOT NULL AND fecha <= $2::date
              ORDER BY fecha DESC LIMIT 1`, [req.usuario.id, fecha]
        );

        const r = await pool.query(
            `INSERT INTO fotos (usuario_id, fecha, angulo, imagen, peso_kg, nota)
             VALUES ($1,$2::date,$3,$4,$5,$6) RETURNING id, fecha, angulo, peso_kg, nota`,
            [req.usuario.id, fecha, angulo, imagen,
             peso.rowCount ? peso.rows[0].peso_kg : null,
             b.nota ? String(b.nota).slice(0, 200) : null]
        );

        await pool.query(
            `INSERT INTO puntos (usuario_id, tipo, puntos, detalle, referencia, fecha)
             VALUES ($1,'medicion',25,'Foto de evolución',$2,$3::date)
             ON CONFLICT (usuario_id, tipo, referencia) DO NOTHING`,
            [req.usuario.id, `foto-${fecha}-${angulo}`, fecha]
        ).catch(() => {});

        res.status(201).json({ foto: r.rows[0] });
    } catch (err) {
        console.error("[FOTOS] subir:", err.message);
        res.status(500).json({ message: "No se pudo guardar la foto." });
    }
});

router.delete("/fotos/:id", async (req, res) => {
    try {
        await pool.query("DELETE FROM fotos WHERE id = $1 AND usuario_id = $2",
                         [Number(req.params.id), req.usuario.id]);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ message: "No se pudo borrar la foto." });
    }
});

module.exports = router;
