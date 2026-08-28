const express = require("express");
const pool = require("../config/db");
const { requiereSesion, puedeVerAtleta } = require("../middleware/auth");
const { generar, estimarMinutos } = require("../lib/motor-rutinas");
const { estimar1RM } = require("../lib/progresion");
const { restricciones, esApto } = require("../lib/salud");
const { semanaDe, aplicar: aplicarPeriodizacion } = require("../lib/periodizacion");
const { enlaceVideo } = require("../db/ejercicios");

const router = express.Router();
router.use(requiereSesion);

/* ── Utilidades ───────────────────────────────────────────────────── */

/**
 * Una fecha con forma correcta puede seguir sin existir: 2026-13-45
 * pasa la expresión regular y revienta la consulta. Se comprueba que el
 * calendario la acepte y que caiga en un rango con sentido.
 */
function fechaValida(texto) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
    const d = new Date(texto + "T00:00:00Z");
    if (isNaN(d.getTime())) return false;
    if (d.toISOString().slice(0, 10) !== texto) return false;   // 2026-02-31

    const anio = d.getUTCFullYear();
    return anio >= 2020 && anio <= 2100;
}

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
    const [perfil, condiciones, catalogo, recientes, sesiones, meso] = await Promise.all([
        pool.query("SELECT * FROM perfiles WHERE usuario_id = $1", [usuarioId]),
        pool.query("SELECT codigo, severidad FROM condiciones WHERE usuario_id = $1 AND activa", [usuarioId]),
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
        ),
        pool.query(
            "SELECT * FROM mesociclos WHERE usuario_id = $1 AND activo LIMIT 1",
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
        // Dos formas del mismo dato: `condiciones` son los códigos, que es
        // lo que compara esApto contra contraindicado_en; `severidades`
        // lleva además cuán grave es cada una, que es lo que escala los
        // límites.
        condiciones: condiciones.rows.map(c => c.codigo),
        severidades: condiciones.rows,
        catalogo: catalogo.rows,
        historial,
        ejerciciosRecientes: recientes.rows.map(r => r.ejercicio_id),
        sesionIndice: sesiones.rows[0].n,
        mesociclo: meso.rows[0] || null
    };
}

/** Guarda una rutina generada y devuelve la versión completa. */
async function persistir(usuarioId, fecha, plan) {
    const cliente = await pool.connect();
    try {
        await cliente.query("BEGIN");

        const r = await cliente.query(
            `INSERT INTO rutinas (usuario_id, fecha, nombre, enfoque, minutos_estimados, justificacion, lugar)
             VALUES ($1,$2::date,$3,$4,$5,$6::jsonb,$7)
             ON CONFLICT (usuario_id, fecha) DO NOTHING
             RETURNING id`,
            [usuarioId, fecha, plan.nombre, plan.enfoque, plan.minutos_estimados,
             JSON.stringify(plan.justificacion),
             (plan.justificacion && plan.justificacion.lugar) || "gimnasio"]
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
                    peso_sugerido_kg, descanso_seg, nota, medida)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
                [rutinaId, e.ejercicio.id, orden++, e.series, e.rep_min, e.rep_max,
                 e.peso_sugerido_kg, e.descanso_seg, e.nota,
                 e.medida || e.ejercicio.medida || "repeticiones"]
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

/**
 * ¿La rutina guardada sigue siendo segura para esta persona?
 *
 * Las rutinas se generan hasta con siete días de anticipación y quedan
 * guardadas. Si alguien declara un embarazo o una hernia después de esa
 * generación, las rutinas ya escritas seguían sirviéndose tal cual: la
 * persona recibía sentadilla con barra y peso muerto el día siguiente a
 * haber declarado su condición.
 *
 * Committear la condición no basta: hay que revisar lo ya escrito.
 */
async function revalidar(usuarioId, rutina) {
    const cond = await pool.query(
        "SELECT codigo, severidad FROM condiciones WHERE usuario_id = $1 AND activa", [usuarioId]
    );
    const codigos = cond.rows.map(c => c.codigo);
    const limites = restricciones(cond.rows);

    const inapto = rutina.ejercicios.filter(e => !esApto(e, codigos, limites).apto);

    // No alcanza con revisar QUÉ ejercicios tiene: hay que revisar CON QUÉ
    // PARÁMETROS. Si alguien pasa de una condición leve a una severa, los
    // ejercicios pueden seguir siendo aptos y aun así el descanso guardado
    // quedar por debajo del mínimo que ahora le corresponde.
    const descansoCorto = rutina.ejercicios.filter(
        e => e.descanso_seg > 0 && e.descanso_seg < limites.descansoMin
    );

    // El rango de repeticiones también se corre hacia arriba con las
    // condiciones: menos carga por repetición. Una rutina guardada antes
    // de declararlas conserva el rango viejo.
    const repsBajas = rutina.ejercicios.filter(
        e => e.medida === "repeticiones" && e.rep_min < limites.repMin
    );

    return {
        valida: inapto.length === 0 && descansoCorto.length === 0 && repsBajas.length === 0,
        inapto, descansoCorto, repsBajas, codigos, limites
    };
}

/**
 * Arma el plan del día y le aplica la periodización del bloque activo.
 *
 * Va en una función porque lo usan la ruta del día y la del paquete: si
 * cada una lo hiciera por su cuenta, la rutina descargada por
 * adelantado podría no coincidir con la que se sirve al abrirla.
 */
function planDelDia(ctx, fecha, usuarioId, sesionIndice, lugar = null) {
    const plan = generar({
        lugar,
        perfil: ctx.perfil,
        condiciones: ctx.condiciones,
        severidades: ctx.severidades,
        catalogo: ctx.catalogo,
        fecha,
        usuarioId,
        historial: ctx.historial,
        sesionIndice,
        ejerciciosRecientes: ctx.ejerciciosRecientes
    });

    if (plan.error) return plan;

    const semana = ctx.mesociclo ? semanaDe(ctx.mesociclo, fecha) : null;
    if (!semana) return plan;

    const limites = restricciones(ctx.severidades && ctx.severidades.length
        ? ctx.severidades : ctx.condiciones);

    const periodizado = aplicarPeriodizacion(plan, semana, limites.intensidadMax);

    // La periodización no puede pasar por encima del tope de salud: sube
    // el peso un porcentaje, y ese porcentaje podría superar el máximo
    // que las condiciones de la persona permiten.
    for (const e of periodizado.ejercicios) {
        if (!e.peso_sugerido_kg || !e.confianzaRM) continue;
        const tope = e.confianzaRM * limites.intensidadMax;
        if (e.peso_sugerido_kg > tope) e.peso_sugerido_kg = Math.floor(tope * 2) / 2;
    }

    periodizado.minutos_estimados = estimarMinutos(periodizado.ejercicios);
    periodizado.justificacion = {
        ...periodizado.justificacion,
        periodizacion: periodizado.periodizacion
    };
    return periodizado;
}

/** Borra una rutina para que se vuelva a generar con los datos de hoy. */
async function descartarRutina(rutinaId) {
    await pool.query("DELETE FROM rutinas WHERE id = $1", [rutinaId]);
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
        // Se traen también contraindicado_en, impacto y supino: son los
        // campos con los que `revalidar` comprueba que una rutina guardada
        // hace días sigue siendo segura hoy.
        // `re.*` trae la medida decidida al armar la sesión. No se
        // selecciona e.medida: pisaría a la de la rutina, que es la que
        // vale.
        `SELECT re.*, e.nombre, e.grupo, e.patron, e.equipo, e.unilateral,
                e.instrucciones, e.video_url, e.nivel,
                e.contraindicado_en, e.impacto, e.supino, e.exigencia
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
    if (!fechaValida(req.params.fecha)) {
        return res.status(400).json({
            message: "Fecha inválida. Se espera el formato AAAA-MM-DD dentro de un rango razonable."
        });
    }
    const fecha = req.params.fecha;
    const usuarioId = Number(req.query.atleta_id) || req.usuario.id;

    const LUGARES = ["gimnasio", "casa", "mixto"];
    const lugarPedido = LUGARES.includes(req.query.lugar) ? req.query.lugar : null;

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
    // Hacia atrás se consultan rutinas ya vividas, pero no se generan:
    // pedir el 31 de diciembre de 1999 creaba una fila con esa fecha.
    if (diasAdelante < -365) {
        return res.status(400).json({ message: "Esa fecha queda fuera del historial." });
    }

    try {
        let rutina = await leerRutina(usuarioId, fecha);
        let regenerada = false;

        // Pedir otro lugar rehace la sesión, siempre que no se haya
        // empezado: ahí ya hay trabajo registrado que no se puede perder.
        if (rutina && lugarPedido && rutina.lugar !== lugarPedido) {
            const empezada = rutina.ejercicios.some(e => (e.realizadas || []).length > 0);
            if (empezada) {
                return res.status(409).json({
                    message: "Esta sesión ya está empezada. Terminala o salteala, y mañana elegís dónde entrenar.",
                    ya_empezada: true
                });
            }
            await descartarRutina(rutina.id);
            rutina = null;
        }

        if (rutina) {
            const control = await revalidar(usuarioId, rutina);

            if (control.valida) {
                // Los avisos de seguridad se recalculan y se devuelven
                // SIEMPRE, no sólo al generar. Antes desaparecían a partir
                // de la segunda vez que se abría la aplicación en el día:
                // quien tiene hipertensión dejaba de ver justo la
                // advertencia sobre no contener la respiración.
                return res.json({
                    rutina, generada: false,
                    avisos: control.limites.avisos
                });
            }

            // Quedó desactualizada respecto de las condiciones actuales.
            // Si ya se registraron series contra ella no se puede borrar
            // sin perder el entrenamiento; en ese caso se avisa y se
            // marcan los ejercicios afectados.
            const yaEntrenada = rutina.ejercicios.some(e => (e.realizadas || []).length > 0);

            // Con la sesión ya empezada no se puede rehacer sin perder lo
            // registrado. Si sólo hay que alargar descansos, se corrige en
            // el lugar; si hay ejercicios inseguros, se avisa.
            if (yaEntrenada && control.inapto.length === 0) {
                await pool.query(
                    `UPDATE rutina_ejercicios SET descanso_seg = $1
                      WHERE rutina_id = $2 AND descanso_seg > 0 AND descanso_seg < $1`,
                    [control.limites.descansoMin, rutina.id]
                );
                await pool.query(
                    `UPDATE rutina_ejercicios re SET rep_min = $1,
                            rep_max = GREATEST(re.rep_max, $2)
                       FROM ejercicios e
                      WHERE e.id = re.ejercicio_id AND re.rutina_id = $3
                        AND e.medida = 'repeticiones' AND re.rep_min < $1`,
                    [control.limites.repMin, control.limites.repMax, rutina.id]
                );
                rutina = await leerRutina(usuarioId, fecha);
                return res.json({
                    rutina, generada: false,
                    avisos: control.limites.avisos,
                    ajustada: true,
                    mensaje: "Se alargaron los descansos para respetar tus condiciones actuales."
                });
            }

            if (yaEntrenada) {
                return res.json({
                    rutina, generada: false,
                    avisos: control.limites.avisos,
                    desactualizada: true,
                    inseguros: control.inapto.map(e => ({
                        id: e.id, nombre: e.nombre,
                        motivo: esApto(e, control.codigos, control.limites).motivo
                    })),
                    mensaje: "Esta sesión se armó antes de que registraras tus condiciones actuales. " +
                             "Los ejercicios marcados ya no son recomendables para vos: salteálos."
                });
            }

            await descartarRutina(rutina.id);
            regenerada = true;
        }

        const ctx = await reunirContexto(usuarioId);
        if (!ctx.perfil) {
            return res.status(409).json({
                message: "Falta completar tu perfil de entrenamiento.",
                falta_perfil: true
            });
        }

        const plan = planDelDia(ctx, fecha, usuarioId, ctx.sesionIndice, lugarPedido);
        if (plan.error) return res.status(409).json(plan);

        await persistir(usuarioId, fecha, plan);
        rutina = await leerRutina(usuarioId, fecha);

        res.json({
            rutina,
            generada: true,
            regenerada,
            avisos: plan.avisos,
            ...(regenerada ? {
                mensaje: "Tu rutina se volvió a armar porque cambiaron tus condiciones de salud."
            } : {})
        });
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
                const plan = planDelDia(ctx, fecha, usuarioId, ctx.sesionIndice + i);
                if (plan.error) continue;
                await persistir(usuarioId, fecha, plan);
                r = await leerRutina(usuarioId, fecha);
            }
            if (r) rutinas.push(r);
        }

        res.json({
            generado_en: new Date().toISOString(),
            usuario: { id: usuarioId, nombre: req.usuario.nombre },
            avisos: restricciones(ctx.severidades).avisos,
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

    /**
     * Valida una serie por completo antes de tocar la base.
     *
     * Antes sólo se comprobaban cuatro campos, y `id_local`, `serie_num`
     * y `realizada_en` llegaban sin revisar al INSERT. Un solo valor malo
     * reventaba la transacción entera y se perdían las series buenas del
     * mismo envío — justo en la ruta que existe para recibir el
     * entrenamiento que alguien hizo sin señal. Peor todavía: como
     * respondía 500, el teléfono reintentaba el mismo lote envenenado
     * para siempre.
     */
    function validar(s) {
        const ejercicioId = Number(s.ejercicio_id);
        if (!Number.isInteger(ejercicioId) || ejercicioId <= 0) return "ejercicio inválido";

        const peso = s.peso_kg === null || s.peso_kg === undefined ? 0 : Number(s.peso_kg);
        if (!Number.isFinite(peso) || peso < 0 || peso > 600) return "peso fuera de rango";

        // El techo de repeticiones depende de si hay carga. Sin peso, 150
        // repeticiones o 150 segundos de plancha son creíbles. CON carga,
        // pasar de 50 es casi siempre un cero de más al teclear, y ese
        // número distorsiona el peso sugerido de las sesiones siguientes.
        const reps = Number(s.repeticiones);
        const techo = peso > 0 ? 50 : 200;
        if (!Number.isInteger(reps) || reps < 1 || reps > techo) {
            return peso > 0
                ? `repeticiones fuera de rango (con ${peso} kg el máximo aceptado es ${techo})`
                : "repeticiones fuera de rango";
        }

        const rpe = s.rpe === null || s.rpe === undefined || s.rpe === "" ? null : Number(s.rpe);
        if (rpe !== null && (!Number.isFinite(rpe) || rpe < 1 || rpe > 10)) {
            return "esfuerzo fuera de la escala de 1 a 10";
        }

        const num = Number(s.serie_num);
        if (s.serie_num !== undefined && (!Number.isInteger(num) || num < 1 || num > 50)) {
            return "número de serie inválido";
        }

        // La columna es VARCHAR(60): un identificador más largo tira la
        // transacción en vez de rechazar sólo esta fila.
        if (s.id_local !== undefined && s.id_local !== null) {
            if (typeof s.id_local !== "string" || s.id_local.length > 60) {
                return "identificador local inválido";
            }
        }

        if (s.realizada_en) {
            const f = new Date(s.realizada_en);
            if (isNaN(f.getTime())) return "fecha inválida";
            // Una fecha futura no puede ser un entrenamiento hecho.
            if (f.getTime() > Date.now() + 86400000) return "fecha en el futuro";
        }

        const re = s.rutina_ejercicio_id;
        if (re !== undefined && re !== null && !Number.isInteger(Number(re))) {
            return "referencia de rutina inválida";
        }

        return null;
    }

    // Se filtra ANTES de abrir la transacción, y cada serie se inserta en
    // su propia subtransacción: un fallo inesperado descarta esa fila y
    // no las demás.
    const validas = [];
    for (const s of lote) {
        const error = validar(s);
        if (error) rechazadas.push({ id_local: s.id_local || null, motivo: error });
        else validas.push(s);
    }

    // Sólo se aceptan referencias a rutinas propias: colgar una serie de
    // la rutina de otra persona no expone nada, pero ensucia sus datos.
    const refs = [...new Set(validas.map(s => s.rutina_ejercicio_id).filter(Number.isInteger))];
    let propias = new Set();
    if (refs.length) {
        const r = await pool.query(
            `SELECT re.id FROM rutina_ejercicios re
               JOIN rutinas ru ON ru.id = re.rutina_id
              WHERE re.id = ANY($1::int[]) AND ru.usuario_id = $2`,
            [refs, usuarioId]
        );
        propias = new Set(r.rows.map(x => x.id));
    }

    const cliente = await pool.connect();
    try {
        await cliente.query("BEGIN");

        for (const s of validas) {
            const ref = Number.isInteger(s.rutina_ejercicio_id) && propias.has(s.rutina_ejercicio_id)
                ? s.rutina_ejercicio_id : null;

            try {
                await cliente.query("SAVEPOINT una_serie");
                const r = await cliente.query(
                    `INSERT INTO series
                       (id_local, usuario_id, rutina_ejercicio_id, ejercicio_id,
                        serie_num, repeticiones, peso_kg, rpe, realizada_en)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, COALESCE($9::timestamptz, NOW()))
                     ON CONFLICT (usuario_id, id_local) DO NOTHING
                     RETURNING id`,
                    [s.id_local || null, usuarioId, ref, Number(s.ejercicio_id),
                     Number(s.serie_num) || 1, Number(s.repeticiones),
                     s.peso_kg === null || s.peso_kg === undefined ? 0 : Number(s.peso_kg),
                     s.rpe === null || s.rpe === undefined || s.rpe === "" ? null : Number(s.rpe),
                     s.realizada_en || null]
                );
                await cliente.query("RELEASE SAVEPOINT una_serie");

                guardadas.push({
                    id_local: s.id_local || null,
                    id: r.rowCount ? r.rows[0].id : null,
                    duplicada: r.rowCount === 0
                });
            } catch (err) {
                await cliente.query("ROLLBACK TO SAVEPOINT una_serie");
                rechazadas.push({ id_local: s.id_local || null, motivo: "no se pudo guardar" });
                console.error("[SERIES] fila descartada:", err.message);
            }
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

        // Los `::varchar` no son decoración: el mismo parámetro se usa en
        // tres contextos distintos y PostgreSQL no logra deducir un tipo
        // único, así que rechazaba la consulta entera con "se dedujeron
        // tipos de dato inconsistentes". Marcar una sesión como completada
        // devolvía 500 SIEMPRE, y con ella se perdían los puntos, la racha
        // y la constancia — las tres cosas sobre las que se construye el
        // ranking. Ninguna de las dos auditorías lo vio porque las dos
        // probaron esta ruta con la red caída.
        await pool.query(
            `UPDATE rutinas SET estado = $1::varchar,
                    iniciada_en  = COALESCE(iniciada_en,
                                     CASE WHEN $1::varchar = 'en_curso' THEN NOW() END),
                    terminada_en = CASE WHEN $1::varchar = 'completada' THEN NOW()
                                        ELSE terminada_en END
              WHERE id = $2::int`,
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
