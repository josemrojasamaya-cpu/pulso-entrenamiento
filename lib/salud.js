/**
 * lib/salud.js — adaptación del entrenamiento a las condiciones de salud.
 *
 * Este archivo es el motivo por el que la aplicación existe. Repartir
 * ejercicios al azar lo hace cualquiera; ajustarlos a una persona con
 * hipertensión, una hernia o una rodilla operada es el trabajo real, y
 * es donde una recomendación mal hecha puede lastimar a alguien.
 *
 * Tres decisiones que lo gobiernan:
 *
 * 1. Las reglas son DETERMINISTAS, no salen de un modelo de lenguaje.
 *    Una persona con cardiopatía no puede recibir una recomendación que
 *    cambia entre dos ejecuciones ni que depende de cómo se redactó la
 *    pregunta. Lo que sí puede hacer un modelo -y se usa como capa
 *    opcional en otro archivo- es explicar en prosa lo que estas reglas
 *    ya decidieron. Explicar, no decidir.
 *
 * 2. Ante varias condiciones se aplica SIEMPRE LA MÁS RESTRICTIVA. Si
 *    una permite llegar al 85% de la carga máxima y otra al 60%, manda
 *    el 60%. Promediar restricciones de seguridad no tiene sentido.
 *
 * 3. Nada de esto sustituye a un médico, y el sistema lo dice en
 *    pantalla en vez de esconderlo en unos términos que nadie lee.
 */

/**
 * Catálogo de condiciones.
 *
 *   intensidadMax  fracción de la carga máxima estimada que se permite
 *   repMin/repMax  rango de repeticiones al que se empuja la rutina
 *   descansoMin    descanso mínimo entre series, en segundos
 *   evitarPatrones patrones de movimiento que se descartan enteros
 *   evitarEquipo   equipo que se descarta
 *   sinImpacto     descarta saltos y carrera
 *   exigenciaMax   tope de exigencia sistémica por ejercicio (1 a 5)
 *   avisos         lo que la persona tiene que leer antes de entrenar
 */
const CONDICIONES = {
    hipertension: {
        nombre: "Hipertensión arterial",
        intensidadMax: 0.70,
        repMin: 10, repMax: 15,
        descansoMin: 90,
        exigenciaMax: 3,
        evitarPatrones: [],
        sinImpacto: false,
        avisos: [
            "No contengas la respiración al hacer fuerza. Exhalá al empujar y inhalá al bajar: aguantar el aire dispara la presión de golpe.",
            "Evitá las series al fallo y los ejercicios que dejan la cabeza por debajo del corazón.",
            "Si tenés tensiómetro, medite antes de entrenar. Con la máxima por encima de 160 o la mínima por encima de 100, esa sesión se cambia por caminata."
        ]
    },

    cardiopatia: {
        nombre: "Enfermedad cardíaca",
        intensidadMax: 0.60,
        repMin: 12, repMax: 20,
        descansoMin: 120,
        exigenciaMax: 2,
        evitarPatrones: [],
        sinImpacto: true,
        avisos: [
            "Entrená a una intensidad en la que puedas mantener una conversación.",
            "Pará de inmediato ante dolor en el pecho, falta de aire desproporcionada, mareo o palpitaciones.",
            "Esta rutina asume que tu cardiólogo ya autorizó que hagas ejercicio. Si no lo hizo, esa consulta va primero."
        ]
    },

    diabetes: {
        nombre: "Diabetes",
        intensidadMax: 0.80,
        repMin: 8, repMax: 15,
        descansoMin: 60,
        exigenciaMax: 4,
        evitarPatrones: [],
        sinImpacto: false,
        avisos: [
            "Llevá siempre algo de azúcar de absorción rápida a la sesión.",
            "No entrenes en ayuno prolongado ni con la glucosa por debajo de 100 mg/dL sin comer algo antes.",
            "Revisá tus pies después de entrenar: con neuropatía, una ampolla puede pasar desapercibida y complicarse."
        ]
    },

    lesion_lumbar: {
        nombre: "Lesión o dolor lumbar",
        intensidadMax: 0.65,
        repMin: 10, repMax: 15,
        descansoMin: 90,
        exigenciaMax: 3,
        evitarPatrones: ["dominante_cadera"],
        sinImpacto: true,
        avisos: [
            "Se sacaron los ejercicios con carga sobre la columna y los que flexionan la espalda con peso.",
            "El core se trabaja resistiendo el movimiento (plancha, dead bug, bird dog), no doblando la espalda.",
            "Molestia leve que cede al calentar es normal. Dolor que baja por la pierna, no: eso se consulta."
        ]
    },

    lesion_hombro: {
        nombre: "Lesión de hombro",
        intensidadMax: 0.65,
        repMin: 10, repMax: 15,
        descansoMin: 90,
        exigenciaMax: 3,
        evitarPatrones: ["empuje_vertical"],
        sinImpacto: false,
        avisos: [
            "Se quitaron los empujes por encima de la cabeza y los fondos profundos.",
            "Trabajá dentro del rango que no duele. Ganar diez centímetros de recorrido no vale una recaída.",
            "El face pull y el trabajo de deltoide posterior están incluidos a propósito: ayudan a estabilizar la articulación."
        ]
    },

    lesion_rodilla: {
        nombre: "Lesión de rodilla",
        intensidadMax: 0.65,
        repMin: 12, repMax: 18,
        descansoMin: 90,
        exigenciaMax: 3,
        evitarPatrones: [],
        sinImpacto: true,
        avisos: [
            "Sin saltos, sin carrera y sin flexión profunda con carga.",
            "Trabajá el rango que no duele, normalmente por encima de los 90 grados de flexión.",
            "Fortalecer glúteo y femoral descarga la rodilla: por eso el puente de glúteos aparece seguido."
        ]
    },

    hernia: {
        nombre: "Hernia abdominal o inguinal",
        intensidadMax: 0.60,
        repMin: 12, repMax: 18,
        descansoMin: 90,
        exigenciaMax: 2,
        evitarPatrones: ["dominante_cadera"],
        sinImpacto: true,
        avisos: [
            "Nada de aguantar la respiración haciendo fuerza: eso es exactamente lo que empuja la hernia.",
            "Se sacaron los abdominales de flexión y las cargas pesadas sobre el abdomen.",
            "Si notás un bulto nuevo o dolor al esfuerzo, pará y consultá."
        ]
    },

    asma: {
        nombre: "Asma",
        intensidadMax: 0.75,
        repMin: 10, repMax: 15,
        descansoMin: 90,
        exigenciaMax: 3,
        evitarPatrones: [],
        sinImpacto: false,
        avisos: [
            "Calentá al menos diez minutos: la entrada gradual reduce mucho el broncoespasmo por ejercicio.",
            "Tené el inhalador de rescate con vos, no en el bolso del vestuario.",
            "El aire frío y seco es el peor escenario. Si entrenás afuera con frío, cubrite la boca."
        ]
    },

    embarazo: {
        nombre: "Embarazo",
        intensidadMax: 0.60,
        repMin: 12, repMax: 20,
        descansoMin: 90,
        exigenciaMax: 2,
        evitarPatrones: [],
        sinImpacto: true,
        avisos: [
            "Se quitaron los ejercicios boca arriba, los de impacto y los abdominales de flexión.",
            "Nunca entrenes hasta el agotamiento, y mantené la intensidad en un nivel conversacional.",
            "Cada embarazo es distinto: esta rutina no reemplaza lo que te indique tu obstetra."
        ]
    },

    obesidad: {
        nombre: "Sobrepeso importante",
        intensidadMax: 0.75,
        repMin: 10, repMax: 18,
        descansoMin: 75,
        exigenciaMax: 3,
        evitarPatrones: [],
        sinImpacto: true,
        avisos: [
            "Sin saltos ni carrera al principio: las articulaciones cargan varias veces el peso corporal en cada impacto.",
            "Caminata, bicicleta y elíptica dan el mismo beneficio cardiovascular sin ese castigo.",
            "La constancia pesa más que la intensidad. Tres sesiones sostenidas por meses ganan a dos semanas brutales."
        ]
    },

    artritis: {
        nombre: "Artritis o artrosis",
        intensidadMax: 0.65,
        repMin: 12, repMax: 20,
        descansoMin: 90,
        exigenciaMax: 2,
        evitarPatrones: [],
        sinImpacto: true,
        avisos: [
            "Movete dentro del rango que no duele, y calentá más de lo habitual.",
            "Sin impacto: el agua y la bicicleta son tus mejores aliados para el trabajo cardiovascular.",
            "Después de entrenar la articulación puede estar algo rígida; si el dolor dura más de dos horas, bajá la carga."
        ]
    }
};

/**
 * Combina todas las condiciones activas en un solo conjunto de límites,
 * quedándose siempre con la restricción más severa de cada dimensión.
 *
 * @param {string[]} codigos  condiciones activas de la persona
 */
function restricciones(codigos = []) {
    const activas = codigos
        .map(c => CONDICIONES[c] ? { codigo: c, ...CONDICIONES[c] } : null)
        .filter(Boolean);

    const base = {
        intensidadMax: 1.0,
        repMin: 6,
        repMax: 12,
        descansoMin: 60,
        exigenciaMax: 5,
        evitarPatrones: [],
        evitarEjercicios: [],
        sinImpacto: false,
        avisos: [],
        condiciones: activas.map(a => ({ codigo: a.codigo, nombre: a.nombre }))
    };

    for (const c of activas) {
        base.intensidadMax = Math.min(base.intensidadMax, c.intensidadMax);
        base.exigenciaMax  = Math.min(base.exigenciaMax, c.exigenciaMax);
        base.descansoMin   = Math.max(base.descansoMin, c.descansoMin);

        // El rango de repeticiones se corre hacia arriba: más repeticiones
        // significan menos carga por repetición, que es lo que casi todas
        // estas condiciones necesitan.
        base.repMin = Math.max(base.repMin, c.repMin);
        base.repMax = Math.max(base.repMax, c.repMax);

        base.sinImpacto = base.sinImpacto || c.sinImpacto;
        base.evitarPatrones.push(...c.evitarPatrones);
        base.avisos.push(...c.avisos.map(t => ({ condicion: c.nombre, texto: t })));
    }

    base.evitarPatrones = [...new Set(base.evitarPatrones)];
    return base;
}

/**
 * ¿Este ejercicio es apto para esta persona?
 *
 * Devuelve el motivo del rechazo en vez de un booleano pelado: cuando el
 * motor descarta media biblioteca, hay que poder explicar por qué, tanto
 * a la persona como a quien depura el sistema.
 */
function esApto(ejercicio, codigosCondicion, limites) {
    const contra = ejercicio.contraindicado_en || [];

    for (const codigo of codigosCondicion) {
        if (contra.includes(codigo)) {
            const nombre = CONDICIONES[codigo] ? CONDICIONES[codigo].nombre : codigo;
            return { apto: false, motivo: `contraindicado con ${nombre}` };
        }
    }

    if (limites.evitarPatrones.includes(ejercicio.patron)) {
        return { apto: false, motivo: `patrón "${ejercicio.patron}" desaconsejado por tus condiciones` };
    }

    if (ejercicio.exigencia > limites.exigenciaMax) {
        return { apto: false, motivo: "demasiado exigente para tus condiciones actuales" };
    }

    return { apto: true };
}

/** Lista para el formulario de perfil. */
function catalogoCondiciones() {
    return Object.entries(CONDICIONES).map(([codigo, c]) => ({
        codigo, nombre: c.nombre
    }));
}

module.exports = { CONDICIONES, restricciones, esApto, catalogoCondiciones };
