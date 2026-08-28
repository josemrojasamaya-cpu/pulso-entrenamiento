/**
 * lib/cronometro.js — la lógica del cronómetro de sesión.
 *
 * Está separada de la pantalla a propósito: acá se puede probar, y en un
 * HTML lleno de eventos no.
 *
 * Lo que resuelve, y por qué importa:
 *
 *   Registrar "10 repeticiones con 40 kg" no dice si la persona mejoró.
 *   Diez repeticiones en minuto y medio y diez repeticiones en cuarenta
 *   segundos son la misma línea en el cuaderno y dos entrenamientos
 *   distintos. Cuando el mismo peso empieza a salir más rápido, hubo
 *   progreso — y es un progreso que el registro de kilos no ve.
 *
 *   Eso es lo que hace que alguien que lleva tres semanas estancado en
 *   el mismo peso siga entrenando en vez de abandonar: la aplicación le
 *   puede mostrar que sí mejoró, con un número.
 */

/* ── Descansos ────────────────────────────────────────────────────── */

/**
 * Cuánto descansar después de una serie.
 *
 * El descanso lo manda la rutina, no el cronómetro: si el motor pidió
 * 120 segundos para una serie pesada, cambiarlo acá sería desarmar la
 * rutina por debajo. Esta función sólo pone piso y techo, y ajusta
 * cuando el esfuerzo declarado dice algo que la rutina no sabía.
 */
function descansoSugerido(ejercicio, rpe) {
    let seg = Number(ejercicio && ejercicio.descanso_seg) || 60;

    // Un RPE de 9 o 10 significa que quedó al límite o llegó al fallo.
    // Mandarlo a la siguiente serie con el mismo descanso es la receta
    // para que la segunda mitad de la rutina se caiga.
    if (rpe >= 9.5) seg = Math.round(seg * 1.35);
    else if (rpe >= 8.5) seg = Math.round(seg * 1.15);
    // Y al revés: si le sobró, no tiene sentido tenerlo parado.
    else if (rpe > 0 && rpe <= 6) seg = Math.round(seg * 0.85);

    return Math.max(20, Math.min(300, seg));
}

/* ── Comparación con la vez anterior ──────────────────────────────── */

/**
 * Compara la serie recién hecha con el historial del mismo ejercicio.
 *
 * `previas` son series anteriores del MISMO ejercicio, cada una con
 * repeticiones, peso y segundos de trabajo. Devuelve null cuando no hay
 * con qué comparar, y eso es correcto: inventar una comparación con una
 * sola serie de referencia da mensajes que cambian de signo por ruido.
 */
function compararTiempo(serie, previas) {
    const trabajo = Number(serie && serie.segundos_trabajo);
    if (!Number.isFinite(trabajo) || trabajo <= 0) return null;

    // Sólo comparan series equivalentes. El tiempo de 10 repeticiones no
    // se compara con el de 5, y el de 40 kg no se compara con el de 60:
    // sería más rápido por hacer menos, no por estar mejor.
    const comparables = (previas || []).filter(p =>
        Number(p.repeticiones) === Number(serie.repeticiones) &&
        Math.abs(Number(p.peso_kg || 0) - Number(serie.peso_kg || 0)) < 0.51 &&
        Number(p.segundos_trabajo) > 0
    );

    if (comparables.length < 2) return null;

    // Mediana y no promedio: una serie en la que dejó el teléfono
    // corriendo dos minutos arrastra el promedio y no la mediana.
    const tiempos = comparables.map(p => Number(p.segundos_trabajo)).sort((a, b) => a - b);
    const medio = tiempos.length % 2
        ? tiempos[(tiempos.length - 1) / 2]
        : (tiempos[tiempos.length / 2 - 1] + tiempos[tiempos.length / 2]) / 2;

    const dif = trabajo - medio;
    const pct = medio > 0 ? (dif / medio) * 100 : 0;

    // Menos de un 8% es ruido: el pulgar tarda distinto cada día.
    if (Math.abs(pct) < 8) {
        return { estado: "igual", referencia: medio, diferencia: dif,
                 mensaje: `Mismo ritmo que siempre (${Math.round(medio)} s)`, muestra: comparables.length };
    }
    if (pct < 0) {
        return { estado: "mejor", referencia: medio, diferencia: dif,
                 mensaje: `${Math.abs(Math.round(dif))} s más rápido que tu ritmo habitual`,
                 muestra: comparables.length };
    }
    return { estado: "peor", referencia: medio, diferencia: dif,
             mensaje: `${Math.round(dif)} s más lento de lo habitual`, muestra: comparables.length };
}

/* ── Puntos ───────────────────────────────────────────────────────── */

/**
 * Puntos por la sesión cronometrada.
 *
 * Regla de fondo: se premia lo que la persona no puede fingir sin
 * entrenar. Tocar un botón muchas veces no da puntos; sostener el
 * descanso que pide la rutina, sí, porque implica quedarse.
 *
 * Los tres conceptos se pagan una sola vez por sesión, no por serie: un
 * marcador que sube sin parar deja de significar algo a la semana.
 */
function puntosDeSesion(sesion) {
    const series = (sesion && sesion.series) || [];
    if (series.length === 0) return { total: 0, detalle: [] };

    const detalle = [];

    // 1. Terminarla. Es la mayor parte, porque es lo que cuesta.
    detalle.push({ concepto: "Sesión completada", puntos: 30 });

    // 2. Respetar los descansos. Se mide contra lo que pidió la rutina,
    //    con tolerancia: nadie clava el segundo exacto ni hace falta.
    const conPauta = series.filter(s => s.descanso_objetivo > 0 && s.segundos_descanso >= 0);
    if (conPauta.length >= 3) {
        const cumplidas = conPauta.filter(s =>
            s.segundos_descanso >= s.descanso_objetivo * 0.8).length;
        const proporcion = cumplidas / conPauta.length;
        if (proporcion >= 0.8) detalle.push({ concepto: "Descansos respetados", puntos: 15 });
        else if (proporcion >= 0.6) detalle.push({ concepto: "Descansos casi siempre respetados", puntos: 7 });
    }

    // 3. Haber ido más rápido que de costumbre en algo. Es el punto de
    //    la función entera: da una forma de mejorar que no es subir peso.
    const masRapidas = series.filter(s => s.comparacion && s.comparacion.estado === "mejor").length;
    if (masRapidas >= 2) detalle.push({ concepto: `Más rápido en ${masRapidas} series`, puntos: 10 });

    return { total: detalle.reduce((a, d) => a + d.puntos, 0), detalle };
}

/* ── Cordura de los tiempos ───────────────────────────────────────── */

/**
 * Decide si un tiempo medido se guarda.
 *
 * El caso real: la persona toca "terminé", se distrae, y el cronómetro
 * cuenta veinte minutos. Ese número guardado envenena la mediana de ese
 * ejercicio durante meses. Se descarta antes de escribirlo, y se avisa
 * en pantalla para que no parezca que se perdió.
 */
function tiempoCreible(segundos, repeticiones) {
    const s = Number(segundos);
    if (!Number.isFinite(s) || s < 0) return { ok: false, motivo: "El tiempo no es un número válido." };
    if (s === 0) return { ok: true, guardar: false };

    if (s > 900) {
        return { ok: false, motivo: "Más de 15 minutos en una serie: el cronómetro quedó corriendo." };
    }

    // Menos de un segundo por repetición no lo hace nadie: es un doble
    // toque en el botón, no una serie.
    const reps = Number(repeticiones) || 1;
    if (reps > 1 && s < reps * 0.8) {
        return { ok: false, motivo: "Demasiado rápido para esas repeticiones: parece un toque doble." };
    }

    return { ok: true, guardar: true };
}

module.exports = { descansoSugerido, compararTiempo, puntosDeSesion, tiempoCreible };
