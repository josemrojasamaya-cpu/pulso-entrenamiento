/**
 * lib/progresion.js — cuánto peso poner hoy.
 *
 * Es la pregunta que un entrenador responde mirando lo que hiciste la
 * semana pasada, y la que casi ninguna aplicación de gimnasio contesta:
 * la mayoría te deja anotar el peso, pero no te dice cuál.
 *
 * El camino es: series registradas → carga máxima estimada → peso para
 * el rango de repeticiones de hoy → ajuste por el esfuerzo que reportaste
 * → tope por condiciones de salud → redondeo a lo que existe en un
 * gimnasio real.
 */

/**
 * Carga máxima estimada a partir de una serie (fórmula de Epley).
 *
 * La estimación es buena hasta unas diez repeticiones y se degrada
 * rápido después: a veinte repeticiones lo que limita es la resistencia,
 * no la fuerza máxima. Por eso el resultado viene con su nivel de
 * confianza en vez de un número pelado que invita a creerle de más.
 */
function estimar1RM(pesoKg, repeticiones) {
    const peso = Number(pesoKg);
    const reps = Number(repeticiones);

    if (!(peso > 0) || !(reps > 0)) return null;
    if (reps === 1) return { valor: peso, confianza: "medido" };

    const valor = peso * (1 + reps / 30);
    const confianza = reps <= 6 ? "alta"
                    : reps <= 10 ? "buena"
                    : reps <= 15 ? "aproximada"
                    : "baja";

    return { valor: Math.round(valor * 10) / 10, confianza };
}

/** Peso teórico para un número de repeticiones, dado un 1RM. */
function pesoPara(unRM, repeticiones) {
    if (!(unRM > 0) || !(repeticiones > 0)) return null;
    return unRM / (1 + repeticiones / 30);
}

/**
 * Redondeo a lo que realmente existe.
 *
 * Sugerir 43,7 kg es inútil: no hay forma de armar ese peso. Las barras
 * suben de 2,5 en 2,5 (dos discos de 1,25), y las mancuernas de a 1 kg
 * en el rango bajo y de a 2 kg más arriba.
 */
function redondear(peso, equipo) {
    if (!(peso > 0)) return 0;

    if (equipo === "barra" || equipo === "maquina" || equipo === "polea") {
        return Math.round(peso / 2.5) * 2.5;
    }
    if (equipo === "mancuernas" || equipo === "kettlebell") {
        return peso < 12 ? Math.round(peso) : Math.round(peso / 2) * 2;
    }
    return Math.round(peso * 2) / 2;
}

/** Igual que redondear, pero nunca hacia arriba. Para respetar topes. */
function redondearAbajo(peso, equipo) {
    if (!(peso > 0)) return 0;
    if (equipo === "barra" || equipo === "maquina" || equipo === "polea") {
        return Math.floor(peso / 2.5) * 2.5;
    }
    if (equipo === "mancuernas" || equipo === "kettlebell") {
        return peso < 12 ? Math.floor(peso) : Math.floor(peso / 2) * 2;
    }
    return Math.floor(peso * 2) / 2;
}

/**
 * Ajuste por esfuerzo percibido (RPE, de 1 a 10).
 *
 * Si la última vez terminaste la serie con tres repeticiones de sobra,
 * el peso era liviano; si terminaste al límite, ya está bien. Este es el
 * ajuste que hace un entrenador mirándote la cara, y acá lo aporta el
 * número que reportás al cerrar la serie.
 */
function factorPorEsfuerzo(rpe) {
    if (rpe === null || rpe === undefined) return 1.00;
    const r = Number(rpe);
    if (!(r > 0)) return 1.00;

    if (r <= 5)  return 1.08;   // sobró mucho
    if (r <= 6.5) return 1.05;
    if (r <= 8)  return 1.025;  // punto justo: sube poco
    if (r <= 9)  return 1.00;   // sostener
    return 0.95;                // llegó al límite: bajar
}

/**
 * Peso sugerido para hoy.
 *
 * @param historial  series previas del ejercicio, la más reciente primero:
 *                   [{peso_kg, repeticiones, rpe, realizada_en}]
 * @param repObjetivo repeticiones a las que se va a trabajar hoy
 * @param equipo      para redondear a incrementos que existen
 * @param intensidadMax tope impuesto por las condiciones de salud (0 a 1)
 */
function sugerirPeso(historial, repObjetivo, equipo, intensidadMax = 1.0) {
    if (!Array.isArray(historial) || historial.length === 0) {
        return {
            peso: null,
            motivo: "Primera vez con este ejercicio: empezá liviano y quedate dos repeticiones antes del fallo. El peso de la próxima sesión sale de lo que registres hoy.",
            confianza: "sin datos"
        };
    }

    // Se usa una serie REPRESENTATIVA, no la mejor de todas.
    //
    // Antes se tomaba el máximo, y eso hacía que una sola errata de
    // tipeo contaminara todas las sugerencias siguientes: escribir 100
    // repeticiones en vez de 10 con 60 kg da una carga máxima estimada
    // de 260 kg, y a partir de ahí el sistema proponía más del triple
    // del peso real, con el sello de que ya estaba topado por seguridad.
    //
    // Con la mediana de la mitad superior se conserva la intención
    // -mirar las buenas series, no las de descarga- sin que un valor
    // aislado mande.
    const recientes = historial.slice(0, 8);
    const estimadas = recientes
        .map(s => {
            const e = estimar1RM(s.peso_kg, s.repeticiones);
            return e ? { rm: e.valor, confianza: e.confianza, serie: s } : null;
        })
        .filter(Boolean)
        .sort((a, b) => b.rm - a.rm);

    if (estimadas.length === 0 || !(estimadas[0].rm > 0)) {
        return {
            peso: null,
            motivo: "El historial no tiene series con carga registrada.",
            confianza: "sin datos"
        };
    }

    // Mediana de la mitad superior. Con una o dos series no hay de dónde
    // sacar consenso y se usa la mejor, que es lo único que hay.
    const mitadBuena = estimadas.slice(0, Math.max(1, Math.ceil(estimadas.length / 2)));
    const mejor = mitadBuena[Math.floor(mitadBuena.length / 2)];

    // Un valor que se despega del resto es casi siempre un error de
    // tecleo. Se avisa en vez de silenciarlo: el dato es de la persona y
    // puede corregirlo.
    const sospechoso = estimadas[0].rm > mejor.rm * 1.6 ? estimadas[0] : null;

    const teorico = pesoPara(mejor.rm, repObjetivo);
    const ajustado = teorico * factorPorEsfuerzo(mejor.serie.rpe);

    // El tope de las condiciones de salud manda sobre el cálculo: es una
    // restricción de seguridad, no una preferencia.
    const tope = mejor.rm * intensidadMax;
    const conTope = Math.min(ajustado, tope);
    const limitado = conTope < ajustado - 0.01;

    // Cuando hay tope se redondea SIEMPRE hacia abajo. Redondear al más
    // cercano lo superaba por hasta 1,25 kg, y un tope que se puede
    // superar no es un tope.
    let peso = redondear(conTope, equipo);
    if (limitado && peso > conTope) {
        peso = redondearAbajo(conTope, equipo);
    }

    let motivo = `Basado en tu mejor serie: ${mejor.serie.peso_kg} kg × ${mejor.serie.repeticiones} repeticiones.`;
    if (mejor.serie.rpe !== null && mejor.serie.rpe !== undefined) {
        const f = factorPorEsfuerzo(mejor.serie.rpe);
        if (f > 1.001)      motivo += ` Reportaste esfuerzo ${mejor.serie.rpe}/10, así que subimos.`;
        else if (f < 0.999) motivo += ` Reportaste esfuerzo ${mejor.serie.rpe}/10, así que bajamos un poco.`;
        else                motivo += ` Con esfuerzo ${mejor.serie.rpe}/10 se sostiene la carga.`;
    }
    if (limitado) motivo += " El peso quedó topado por tus condiciones de salud.";
    if (sospechoso) {
        motivo += ` Hay una serie registrada de ${sospechoso.serie.peso_kg} kg × ` +
                  `${sospechoso.serie.repeticiones} repeticiones que se sale mucho del resto; ` +
                  "si fue un error de tecleo, conviene corregirla.";
    }

    return {
        peso,
        motivo,
        confianza: mejor.confianza,
        unRM: Math.round(mejor.rm * 10) / 10,
        topadoPorSalud: limitado,
        datoSospechoso: sospechoso ? {
            peso_kg: sospechoso.serie.peso_kg,
            repeticiones: sospechoso.serie.repeticiones
        } : null
    };
}

/**
 * ¿Está estancado en este ejercicio?
 *
 * Se compara la mejor carga estimada de las últimas sesiones contra la
 * de las anteriores. Sin esto, alguien puede repetir el mismo peso
 * durante dos meses sin que nada se lo señale — que es la forma más
 * común de perder tiempo en un gimnasio.
 */
function detectarEstancamiento(historial, minimoSesiones = 6) {
    if (!Array.isArray(historial) || historial.length < minimoSesiones) {
        return { estancado: false, motivo: "Todavía no hay historial suficiente para juzgarlo." };
    }

    const rm = historial
        .map(s => {
            const e = estimar1RM(s.peso_kg, s.repeticiones);
            return e ? { valor: e.valor, fecha: s.realizada_en } : null;
        })
        .filter(Boolean);

    if (rm.length < minimoSesiones) {
        return { estancado: false, motivo: "Series sin carga registrada." };
    }

    const mitad = Math.floor(rm.length / 2);
    const recientes = rm.slice(0, mitad);          // el historial viene del más nuevo al más viejo
    const anteriores = rm.slice(mitad);

    const maxRec = Math.max(...recientes.map(r => r.valor));
    const maxAnt = Math.max(...anteriores.map(r => r.valor));
    const cambio = ((maxRec - maxAnt) / maxAnt) * 100;

    if (cambio < 1.5) {
        return {
            estancado: true,
            cambioPct: Math.round(cambio * 10) / 10,
            motivo: cambio < -1
                ? "Tu carga viene bajando. Puede ser fatiga acumulada, sueño o alimentación, no necesariamente el entrenamiento."
                : "Llevás varias sesiones sin avanzar en este ejercicio.",
            sugerencia: "Probá una semana de descarga con el 60% del peso habitual, o cambiá a una variante del mismo patrón durante tres semanas."
        };
    }

    return {
        estancado: false,
        cambioPct: Math.round(cambio * 10) / 10,
        motivo: `Progresando: subiste ${cambio.toFixed(1)}% respecto a tus sesiones anteriores.`
    };
}

/**
 * Volumen de una sesión: series × repeticiones × peso.
 *
 * Es la medida más honesta de cuánto trabajo se hizo. Sirve para
 * comparar semanas entre sí, cosa que el peso máximo solo no permite.
 */
function volumen(series) {
    if (!Array.isArray(series)) return 0;
    return series.reduce((t, s) => t + (Number(s.peso_kg) || 0) * (Number(s.repeticiones) || 0), 0);
}

module.exports = {
    estimar1RM, pesoPara, redondear, redondearAbajo, factorPorEsfuerzo,
    sugerirPeso, detectarEstancamiento, volumen
};
