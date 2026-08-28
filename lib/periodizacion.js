/**
 * lib/periodizacion.js — planificación en bloques de varias semanas.
 *
 * Entrenar siempre igual deja de funcionar. El cuerpo se adapta a lo que
 * se repite, y a partir de cierto punto la misma sesión cada semana ya no
 * produce ningún cambio. La respuesta no es entrenar más duro todos los
 * días —eso lleva al agotamiento, no al progreso— sino organizar el
 * esfuerzo en bloques que suben y después bajan.
 *
 * Un mesociclo es ese bloque: tres a cinco semanas de carga creciente y
 * una de descarga. La semana de descarga NO es tiempo perdido: es cuando
 * el cuerpo termina de asimilar lo anterior, y es lo primero que la gente
 * se salta y por lo que después se estanca.
 *
 * Este archivo decide, para una fecha dada, en qué semana del bloque está
 * la persona y cuánto hay que multiplicar el volumen y la intensidad.
 */

/**
 * Perfiles de progresión.
 *
 * `volumen` multiplica las series; `intensidad` multiplica el peso. Suben
 * de forma distinta a propósito: acumular volumen e intensidad a la vez
 * es la receta más rápida para lesionarse.
 */
const MODELOS = {
    /** Sube volumen manteniendo la carga. Lo habitual para ganar músculo. */
    volumen_creciente: {
        nombre: "Volumen creciente",
        descripcion: "Cada semana se agrega trabajo con el mismo peso. La adaptación viene de acumular más series bien hechas.",
        semanas: [
            { volumen: 1.00, intensidad: 1.00, nota: "Semana de entrada. Dejá dos o tres repeticiones en reserva." },
            { volumen: 1.15, intensidad: 1.00, nota: "Una serie más en los principales." },
            { volumen: 1.30, intensidad: 1.02, nota: "Semana más dura del bloque. Debería costar." },
            { volumen: 0.60, intensidad: 0.85, descarga: true,
              nota: "Descarga. Bajá el peso y las series: es cuando el cuerpo asimila lo anterior. Saltársela es la causa más común de estancarse." }
        ]
    },

    /** Sube carga manteniendo el volumen. Para fuerza. */
    intensidad_creciente: {
        nombre: "Intensidad creciente",
        descripcion: "Cada semana se agrega peso con las mismas series. La adaptación viene de manejar cargas mayores.",
        semanas: [
            { volumen: 1.00, intensidad: 1.00, nota: "Semana de entrada." },
            { volumen: 1.00, intensidad: 1.04, nota: "Un poco más de peso, mismas series." },
            { volumen: 0.90, intensidad: 1.08, nota: "Carga alta y menos volumen para sostenerla." },
            { volumen: 0.90, intensidad: 1.12, nota: "Semana más pesada del bloque." },
            { volumen: 0.55, intensidad: 0.80, descarga: true,
              nota: "Descarga. Sin esta semana, la siguiente empieza con fatiga acumulada." }
        ]
    },

    /** Alterna semanas duras y suaves. Más sostenible a largo plazo. */
    ondulante: {
        nombre: "Ondulante",
        descripcion: "Alterna semanas exigentes con semanas moderadas. Menos espectacular y más sostenible; buena si el descanso o la alimentación no son constantes.",
        semanas: [
            { volumen: 1.00, intensidad: 1.00, nota: "Semana moderada." },
            { volumen: 1.20, intensidad: 1.03, nota: "Semana exigente." },
            { volumen: 0.85, intensidad: 0.95, nota: "Semana suave: sostener, no forzar." },
            { volumen: 1.25, intensidad: 1.05, nota: "Semana exigente." },
            { volumen: 0.60, intensidad: 0.85, descarga: true, nota: "Descarga y cierre del bloque." }
        ]
    },

    /** Sin periodización: todas las semanas iguales. */
    plano: {
        nombre: "Sin periodización",
        descripcion: "Todas las semanas iguales. Sirve para empezar: un principiante progresa sin necesidad de planificar bloques, porque casi cualquier estímulo le produce adaptación.",
        semanas: [
            { volumen: 1.00, intensidad: 1.00, nota: "Sesión estándar." }
        ]
    }
};

/** Qué modelo conviene según objetivo y nivel. */
function modeloSugerido(objetivo, nivel) {
    // Un principiante progresa sesión a sesión y no necesita bloques; la
    // periodización resuelve un problema que todavía no tiene.
    if (nivel === "principiante") return "plano";

    if (objetivo === "fuerza") return "intensidad_creciente";
    if (objetivo === "ganar_musculo") return "volumen_creciente";
    if (nivel === "avanzado") return "ondulante";
    return "volumen_creciente";
}

/**
 * Normaliza una fecha a medianoche UTC, venga como texto o como Date.
 *
 * node-postgres devuelve las columnas DATE como objetos Date, no como
 * texto. Aplicarles `String(...).slice(0, 10)` produce "Thu Aug 13" —una
 * fecha que no se puede interpretar— y el cálculo de la semana devolvía
 * null en silencio: la periodización simplemente no se aplicaba, sin
 * ningún error visible.
 */
function aMediaNocheUTC(valor) {
    if (!valor) return null;

    if (valor instanceof Date) {
        if (isNaN(valor.getTime())) return null;
        return new Date(Date.UTC(
            valor.getFullYear(), valor.getMonth(), valor.getDate()
        ));
    }

    const m = String(valor).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return isNaN(d.getTime()) ? null : d;
}

/**
 * En qué semana del bloque cae una fecha.
 *
 * @param {object} meso  { inicio, modelo }
 * @param {string|Date} fecha
 */
function semanaDe(meso, fecha) {
    if (!meso || !meso.inicio) return null;

    const modelo = MODELOS[meso.modelo] || MODELOS.plano;
    const total = modelo.semanas.length;

    const inicio = aMediaNocheUTC(meso.inicio);
    const hoy = aMediaNocheUTC(fecha);
    if (!inicio || !hoy) return null;

    const dias = Math.floor((hoy - inicio) / 86400000);
    if (dias < 0) return null;   // el bloque todavía no empezó

    const semanaAbsoluta = Math.floor(dias / 7);

    // El bloque se repite: al terminar la descarga, vuelve a empezar. Es
    // lo que hace un entrenador de verdad — encadenar bloques — en vez de
    // dejar a la persona sin plan al cabo de un mes.
    const indice = semanaAbsoluta % total;
    const ciclo = Math.floor(semanaAbsoluta / total) + 1;

    return {
        numero: indice + 1,
        de: total,
        ciclo,
        ...modelo.semanas[indice],
        modelo: modelo.nombre,
        esUltima: indice === total - 1
    };
}

/**
 * Aplica la semana al plan del día.
 *
 * Devuelve un objeto NUEVO, sin tocar el original: el motor arma la
 * sesión base y la periodización la modula, y conviene que esas dos
 * responsabilidades no se pisen.
 *
 * Dos cuidados importantes:
 *  - las series nunca bajan de una ni suben de seis;
 *  - la intensidad nunca supera el tope de las condiciones de salud, que
 *    es una restricción y no una preferencia.
 */
function aplicar(plan, semana, intensidadMaxSalud = 1.0) {
    if (!semana || !plan || !Array.isArray(plan.ejercicios)) return plan;

    const ejercicios = plan.ejercicios.map(e => {
        const series = Math.max(1, Math.min(6, Math.round(e.series * semana.volumen)));

        let peso = e.peso_sugerido_kg;
        if (peso && semana.intensidad !== 1) {
            peso = Math.round(peso * semana.intensidad * 2) / 2;
        }

        return { ...e, series, peso_sugerido_kg: peso };
    });

    return {
        ...plan,
        ejercicios,
        periodizacion: {
            semana: semana.numero,
            de: semana.de,
            ciclo: semana.ciclo,
            modelo: semana.modelo,
            descarga: Boolean(semana.descarga),
            volumen_pct: Math.round(semana.volumen * 100),
            intensidad_pct: Math.round(semana.intensidad * 100),
            nota: semana.nota
        }
    };
}

function catalogoModelos() {
    return Object.entries(MODELOS).map(([codigo, m]) => ({
        codigo,
        nombre: m.nombre,
        descripcion: m.descripcion,
        semanas: m.semanas.length,
        tiene_descarga: m.semanas.some(s => s.descarga)
    }));
}

module.exports = { MODELOS, modeloSugerido, semanaDe, aplicar, catalogoModelos };
