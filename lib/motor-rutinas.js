/**
 * lib/motor-rutinas.js — arma la rutina de un día concreto.
 *
 * Entradas: el perfil de la persona, sus condiciones de salud, el
 * catálogo de ejercicios disponibles y su historial reciente.
 * Salida: qué hacer hoy, con cuántas series, cuántas repeticiones y
 * cuánto peso, más el motivo de cada decisión.
 *
 * Dos propiedades que el generador tiene que cumplir sí o sí:
 *
 * 1. DETERMINISTA POR DÍA. La rutina del martes es siempre la misma
 *    aunque la pantalla se recargue diez veces, pero distinta a la del
 *    miércoles. Se consigue con un generador pseudoaleatorio sembrado
 *    con el usuario y la fecha, no con Math.random(): con Math.random()
 *    la persona vería una rutina diferente cada vez que se le va la
 *    señal y vuelve, y no podría confiar en la aplicación.
 *
 * 2. NUNCA PROPONE ALGO CONTRAINDICADO. El filtro de salud se aplica
 *    antes de elegir, no después. Filtrar al final deja la puerta
 *    abierta a que un caso raro -pocos ejercicios disponibles, por
 *    ejemplo- termine colando lo que había que excluir.
 */

const { restricciones, esApto } = require("./salud");
const { sugerirPeso, redondear } = require("./progresion");

/* ── Aleatoriedad reproducible ────────────────────────────────────── */

/** Convierte un texto en un entero de 32 bits. */
function semillaDe(texto) {
    let h = 2166136261;
    for (let i = 0; i < texto.length; i++) {
        h ^= texto.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/** Generador sembrado (mulberry32): misma semilla, misma secuencia. */
function generador(semilla) {
    let a = semilla;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function mezclar(lista, azar) {
    const l = lista.slice();
    for (let i = l.length - 1; i > 0; i--) {
        const j = Math.floor(azar() * (i + 1));
        [l[i], l[j]] = [l[j], l[i]];
    }
    return l;
}

/* ── Estructura semanal ───────────────────────────────────────────── */

/**
 * Qué se entrena cada día según cuántos días por semana se entrena.
 *
 * Con pocos días conviene cuerpo completo: cada músculo se estimula más
 * veces por semana. Con muchos días conviene repartir, porque si no la
 * sesión se hace eterna y la calidad del final se cae.
 */
const CICLOS = {
    1: ["completo_a"],
    2: ["completo_a", "completo_b"],
    3: ["completo_a", "completo_b", "completo_c"],
    4: ["empuje", "pierna", "traccion", "completo_b"],
    5: ["empuje", "traccion", "pierna", "torso", "pierna_posterior"],
    6: ["empuje", "traccion", "pierna", "empuje", "traccion", "pierna"],
    7: ["empuje", "traccion", "pierna", "empuje", "traccion", "pierna", "movilidad"]
};

/**
 * Plantillas: qué ranuras llenar en cada tipo de sesión.
 *
 * Cada ranura pide un patrón de movimiento o un grupo muscular. Se
 * piden patrones y no ejercicios concretos justamente para que la
 * rutina pueda variar todos los días sin dejar de ser coherente.
 */
const PLANTILLAS = {
    completo_a: {
        nombre: "Cuerpo completo · A",
        ranuras: [
            { patron: "dominante_rodilla", principal: true },
            { patron: "empuje_horizontal",  principal: true },
            { patron: "traccion_horizontal", principal: true },
            { patron: "dominante_cadera" },
            { grupo: "core" }
        ]
    },
    completo_b: {
        nombre: "Cuerpo completo · B",
        ranuras: [
            { patron: "dominante_cadera",   principal: true },
            { patron: "traccion_vertical",  principal: true },
            { patron: "empuje_vertical",    principal: true },
            { patron: "dominante_rodilla" },
            { grupo: "core" }
        ]
    },
    completo_c: {
        nombre: "Cuerpo completo · C",
        ranuras: [
            { patron: "dominante_rodilla", principal: true },
            { patron: "empuje_horizontal", principal: true },
            { patron: "traccion_vertical", principal: true },
            { grupo: "gluteos" },
            { grupo: "core" }
        ]
    },
    empuje: {
        nombre: "Empuje · pecho, hombro y tríceps",
        ranuras: [
            { patron: "empuje_horizontal", principal: true },
            { patron: "empuje_vertical",   principal: true },
            { grupo: "pecho" },
            { grupo: "hombros" },
            { grupo: "triceps" },
            { grupo: "core" }
        ]
    },
    traccion: {
        nombre: "Tracción · espalda y bíceps",
        ranuras: [
            { patron: "traccion_vertical",   principal: true },
            { patron: "traccion_horizontal", principal: true },
            { grupo: "espalda" },
            { grupo: "hombros" },
            { grupo: "biceps" },
            { grupo: "core" }
        ]
    },
    pierna: {
        nombre: "Pierna completa",
        ranuras: [
            { patron: "dominante_rodilla", principal: true },
            { patron: "dominante_cadera",  principal: true },
            { grupo: "cuadriceps" },
            { grupo: "femoral" },
            { grupo: "pantorrilla" },
            { grupo: "core" }
        ]
    },
    pierna_posterior: {
        nombre: "Cadena posterior y glúteo",
        ranuras: [
            { patron: "dominante_cadera", principal: true },
            { grupo: "gluteos", principal: true },
            { grupo: "femoral" },
            { grupo: "pantorrilla" },
            { grupo: "core" }
        ]
    },
    torso: {
        nombre: "Torso completo",
        ranuras: [
            { patron: "empuje_horizontal",   principal: true },
            { patron: "traccion_horizontal", principal: true },
            { grupo: "hombros" },
            { grupo: "biceps" },
            { grupo: "triceps" }
        ]
    },
    movilidad: {
        nombre: "Movilidad y recuperación",
        ranuras: [
            { grupo: "cuerpo_completo" },
            { grupo: "core" },
            { grupo: "cardio" }
        ]
    }
};

/* ── Parámetros por objetivo ──────────────────────────────────────── */

const OBJETIVOS = {
    fuerza: {
        nombre: "Fuerza",
        series: 4, repMin: 4,  repMax: 6,  descanso: 180,
        seriesAccesorio: 3, cardioMin: 0,
        nota: "Cargas altas y pocas repeticiones, con descansos largos para recuperar entre series."
    },
    ganar_musculo: {
        nombre: "Ganar masa muscular",
        series: 4, repMin: 8,  repMax: 12, descanso: 90,
        seriesAccesorio: 3, cardioMin: 5,
        nota: "El rango clásico de hipertrofia: suficiente carga y suficiente volumen."
    },
    perder_grasa: {
        nombre: "Perder grasa",
        series: 3, repMin: 12, repMax: 15, descanso: 60,
        seriesAccesorio: 3, cardioMin: 15,
        nota: "Descansos cortos para sostener el gasto, más trabajo cardiovascular al final."
    },
    resistencia: {
        nombre: "Resistencia muscular",
        series: 3, repMin: 15, repMax: 20, descanso: 45,
        seriesAccesorio: 2, cardioMin: 20,
        nota: "Muchas repeticiones con poco descanso."
    },
    salud: {
        nombre: "Salud general",
        series: 3, repMin: 10, repMax: 15, descanso: 75,
        seriesAccesorio: 2, cardioMin: 10,
        nota: "Carga moderada, técnica por encima del peso, y trabajo cardiovascular constante."
    }
};

const NIVEL_ORDEN = { principiante: 1, intermedio: 2, avanzado: 3 };

/* ── Selección de ejercicios ──────────────────────────────────────── */

/**
 * Deja sólo los ejercicios que esta persona puede hacer hoy.
 * Devuelve también los descartados con su motivo: sin eso, un catálogo
 * que se vacía es imposible de depurar.
 */
function filtrarDisponibles(catalogo, perfil, condiciones, limites) {
    const equipo = new Set(perfil.equipo || ["peso_corporal"]);
    const nivelMax = NIVEL_ORDEN[perfil.nivel] || 1;

    const aptos = [];
    const descartados = [];

    for (const ej of catalogo) {
        if (!ej.activo) continue;

        if (!equipo.has(ej.equipo)) {
            descartados.push({ nombre: ej.nombre, motivo: `no tenés ${ej.equipo}` });
            continue;
        }

        // Se permite un escalón por encima del nivel declarado: si no, un
        // principiante nunca progresaría a nada.
        if ((NIVEL_ORDEN[ej.nivel] || 1) > nivelMax + 1) {
            descartados.push({ nombre: ej.nombre, motivo: "todavía muy avanzado para tu nivel" });
            continue;
        }

        const veredicto = esApto(ej, condiciones, limites);
        if (!veredicto.apto) {
            descartados.push({ nombre: ej.nombre, motivo: veredicto.motivo });
            continue;
        }

        aptos.push(ej);
    }

    return { aptos, descartados };
}

/** Ejercicios que encajan en una ranura. */
function candidatos(aptos, ranura) {
    return aptos.filter(ej => {
        if (ranura.patron && ej.patron !== ranura.patron) return false;
        if (ranura.grupo  && ej.grupo  !== ranura.grupo)  return false;
        return true;
    });
}

/**
 * Qué tan buen encaje es este ejercicio para esta ranura y esta persona.
 *
 * Elegir al azar entre todos los candidatos parece dar variedad, pero
 * produce disparates: a alguien de nivel intermedio con barra y
 * mancuernas le tocaban flexiones inclinadas -un ejercicio de entrada
 * para quien todavía no puede con su propio peso- como movimiento
 * principal del día.
 *
 * La puntuación ordena; el azar sigue eligiendo, pero sólo entre los
 * mejores. Así la rutina cambia todos los días sin dejar de tener
 * sentido.
 */
function puntuarEncaje(ej, ranura, perfil, historial, recientes) {
    let p = 0;

    const nivelAtleta = NIVEL_ORDEN[perfil.nivel] || 1;
    const nivelEj = NIVEL_ORDEN[ej.nivel] || 1;

    if (nivelEj === nivelAtleta) p += 3;
    else if (nivelEj === nivelAtleta + 1) p += 1;   // un escalón de desafío
    else if (nivelEj < nivelAtleta) {
        // Quedarse corto es peor en el movimiento principal del día que
        // en un accesorio del final.
        p -= ranura.principal ? 3 : 1;
    }

    if (ranura.principal && ej.compuesto) p += 3;
    if (!ranura.principal && !ej.compuesto) p += 1;

    // Con historial se puede sugerir un peso concreto y medir progreso;
    // sin él, la primera serie es a ciegas.
    const tieneHistorial = (historial[ej.id] || []).length > 0;
    if (tieneHistorial) p += 2;

    // Variedad: lo hecho en los últimos días pierde puntos, pero no
    // queda descartado. Que la rutina sea variada no puede costar que
    // quede incompleta.
    if (recientes.includes(ej.id)) p -= 4;

    return p;
}

/* ── Generación ───────────────────────────────────────────────────── */

/**
 * Arma la rutina del día.
 *
 * @param {object}   opciones
 * @param {object}   opciones.perfil        perfil de entrenamiento
 * @param {string[]} opciones.condiciones   códigos de condición activos
 * @param {object[]} opciones.catalogo      ejercicios disponibles
 * @param {string}   opciones.fecha         'YYYY-MM-DD'
 * @param {number}   opciones.usuarioId
 * @param {object}   opciones.historial     { [ejercicioId]: [series recientes] }
 * @param {number}   opciones.sesionIndice  cuántas sesiones lleva hechas (rota el ciclo)
 * @param {number[]} opciones.gruposRecientes grupos trabajados en las últimas 48 h
 */
function generar({ perfil, condiciones = [], severidades = null, catalogo, fecha, usuarioId,
                   historial = {}, sesionIndice = 0, ejerciciosRecientes = [],
                   lugar = null }) {

    // Se puede entrenar en otro lado por un día sin tocar el perfil: la
    // razón más común para abandonar no es la falta de ganas, es no
    // poder ir al gimnasio ese día y no tener alternativa a mano.
    if (lugar && lugar !== "gimnasio" && Array.isArray(perfil.equipo_casa)) {
        perfil = { ...perfil, equipo: perfil.equipo_casa, lugar };
    } else if (lugar) {
        perfil = { ...perfil, lugar };
    }

    // `severidades` lleva cuán grave es cada condición y escala los
    // límites; si no viene, se usan los códigos con severidad moderada.
    const limites = restricciones(severidades && severidades.length ? severidades : condiciones);
    const objetivo = OBJETIVOS[perfil.objetivo] || OBJETIVOS.salud;
    const azar = generador(semillaDe(`${usuarioId}|${fecha}`));

    // ── 1. Qué se entrena hoy
    const dias = Math.min(Math.max(perfil.dias_por_semana || 3, 1), 7);
    const ciclo = CICLOS[dias];
    let clave = ciclo[sesionIndice % ciclo.length];

    // Un principiante entrena mejor cuerpo completo aunque venga muchos
    // días: repartir por grupos exige un volumen que todavía no tolera.
    if (perfil.nivel === "principiante" && !clave.startsWith("completo") && clave !== "movilidad") {
        clave = ["completo_a", "completo_b", "completo_c"][sesionIndice % 3];
    }

    const plantilla = PLANTILLAS[clave] || PLANTILLAS.completo_a;

    // ── 2. Qué puede hacer
    const { aptos, descartados } = filtrarDisponibles(catalogo, perfil, condiciones, limites);

    if (aptos.length === 0) {
        return {
            error: "No hay ningún ejercicio compatible con tu equipo y tus condiciones de salud.",
            sugerencia: "Revisá el equipo marcado en tu perfil: con sólo peso corporal ya hay opciones suficientes.",
            descartados: descartados.slice(0, 12)
        };
    }

    // ── 3. Rango de repeticiones: la salud manda sobre el objetivo
    const repMin = Math.max(objetivo.repMin, limites.repMin);
    const repMax = Math.max(objetivo.repMax, limites.repMax);
    const descanso = Math.max(objetivo.descanso, limites.descansoMin);
    const topadoPorSalud = repMin > objetivo.repMin || descanso > objetivo.descanso;

    // ── 4. Llenar las ranuras
    const elegidos = [];
    const yaUsados = new Set();
    const sinCubrir = [];

    for (const ranura of plantilla.ranuras) {
        let opciones = candidatos(aptos, ranura).filter(e => !yaUsados.has(e.id));

        if (opciones.length === 0) {
            sinCubrir.push(ranura.patron || ranura.grupo);
            continue;
        }

        // Se puntúa cada candidato y se sortea entre los mejores. El
        // azar da la variedad diaria; la puntuación evita que esa
        // variedad produzca elecciones sin sentido.
        const puntuados = opciones
            .map(e => ({ ej: e, p: puntuarEncaje(e, ranura, perfil, historial, ejerciciosRecientes) }))
            .sort((a, b) => b.p - a.p);

        const mejorPuntaje = puntuados[0].p;
        const finalistas = puntuados
            .filter(x => x.p >= mejorPuntaje - 1)   // empates y casi empates
            .map(x => x.ej);

        const elegido = mezclar(finalistas, azar)[0];
        yaUsados.add(elegido.id);

        const series = ranura.principal ? objetivo.series : objetivo.seriesAccesorio;
        const hist = historial[elegido.id] || [];
        const repObjetivo = Math.round((repMin + repMax) / 2);
        const sug = sugerirPeso(hist, repObjetivo, elegido.equipo, limites.intensidadMax);

        // Un isométrico se sostiene y no se repite. El rango se traduce a
        // segundos escalado por el nivel: un principiante sostiene menos.
        const medida = elegido.medida || "repeticiones";
        let min = repMin, max = repMax, nota = sug.motivo, peso = sug.peso;

        if (medida === "segundos") {
            // Redondeado a múltiplos de cinco: "de 30 a 53 segundos" es un
            // número que nadie cronometra, y delata que salió de una
            // multiplicación en vez de una decisión.
            const escala = { principiante: 1, intermedio: 1.5, avanzado: 2 }[perfil.nivel] || 1;
            const aCinco = v => Math.round(v / 5) * 5;
            min = aCinco(20 * escala);
            max = aCinco(35 * escala);
            peso = null;
            nota = `Sostené la posición ${min} a ${max} segundos. Cortá la serie en cuanto pierdas la forma.`;
        } else if (medida === "minutos") {
            min = max = Math.max(objetivo.cardioMin || 10, 8);
            peso = null;
            nota = `${min} minutos a ritmo en el que puedas hablar sin quedarte sin aire.`;
        }

        elegidos.push({
            ejercicio: elegido,
            principal: Boolean(ranura.principal),
            series,
            rep_min: min,
            rep_max: max,
            medida,
            // Los accesorios descansan menos que los básicos, pero nunca
            // por debajo del piso que fijan las condiciones de salud. El
            // 0,7 se aplicaba después de ese piso y lo pisaba: alguien con
            // cardiopatía, que necesita 120 segundos, recibía 84 en todos
            // sus accesorios.
            descanso_seg: ranura.principal
                ? descanso
                : Math.max(limites.descansoMin, 45, Math.round(descanso * 0.7)),
            peso_sugerido_kg: peso,
            nota,
            confianza: sug.confianza
        });
    }

    // ── 5. Cardio al final, si el objetivo lo pide
    if (objetivo.cardioMin > 0) {
        const cardios = aptos.filter(e =>
            e.grupo === "cardio" &&
            !yaUsados.has(e.id) &&
            !(limites.sinImpacto && /salt|cuerda|burpee|correr/i.test(e.nombre))
        );
        if (cardios.length > 0) {
            const c = mezclar(cardios, azar)[0];
            elegidos.push({
                ejercicio: c,
                principal: false,
                series: 1,
                rep_min: objetivo.cardioMin,
                rep_max: objetivo.cardioMin,
                medida: "minutos",
                descanso_seg: 0,
                peso_sugerido_kg: null,
                nota: `${objetivo.cardioMin} minutos a ritmo en el que puedas hablar.`,
                confianza: "no aplica",
                esCardio: true
            });
        }
    }

    // ── 6. Ajuste al tiempo disponible
    //
    // El orden importa mucho más de lo que parece. La versión anterior
    // borraba ejercicios enteros y, como los accesorios están al final,
    // se comía justo la cadera y el core: una sesión de "cuerpo
    // completo" que no cubría ni la cadera ni el core.
    //
    // Recortar series es casi siempre mejor que recortar ejercicios.
    // Cinco ejercicios a dos series entrenan más patrones que tres a
    // cuatro series, y en una sesión corta cubrir los patrones es lo que
    // cuenta. Eliminar queda como último recurso.
    const minutosDisponibles = perfil.minutos_sesion || 45;
    const recortados = [];
    const seriesReducidas = [];
    let estimados = estimarMinutos(elegidos);

    // Paso 1: bajar las series de los accesorios, hasta un mínimo de dos.
    for (const e of elegidos) {
        if (estimados <= minutosDisponibles + 5) break;
        if (e.principal || e.esCardio || e.series <= 2) continue;
        e.series -= 1;
        seriesReducidas.push(e.ejercicio.nombre);
        estimados = estimarMinutos(elegidos);
    }

    // Paso 2: bajar las series de los principales, sin bajar de tres.
    for (const e of elegidos) {
        if (estimados <= minutosDisponibles + 5) break;
        if (!e.principal || e.series <= 3) continue;
        e.series -= 1;
        seriesReducidas.push(e.ejercicio.nombre);
        estimados = estimarMinutos(elegidos);
    }

    // Paso 3: acortar el cardio antes que sacrificar trabajo de fuerza.
    const cardio = elegidos.find(e => e.esCardio);
    if (cardio && estimados > minutosDisponibles + 5) {
        const sobra = estimados - minutosDisponibles;
        const nuevo = Math.max(5, cardio.rep_min - Math.ceil(sobra));
        if (nuevo < cardio.rep_min) {
            cardio.rep_min = cardio.rep_max = nuevo;
            cardio.nota = `${nuevo} minutos a ritmo en el que puedas hablar. Se acortó para que la sesión entre en tu tiempo.`;
            estimados = estimarMinutos(elegidos);
        }
    }

    // Paso 4: recién ahora, eliminar. Se saca siempre el accesorio de
    // menor valor -aislamiento antes que compuesto- y nunca se baja de
    // cuatro ejercicios.
    while (estimados > minutosDisponibles + 8 && elegidos.length > 4) {
        const candidatosASacar = elegidos.filter(e => !e.principal && !e.esCardio);
        if (candidatosASacar.length === 0) break;
        const fuera = candidatosASacar
            .sort((a, b) => (a.ejercicio.compuesto ? 1 : 0) - (b.ejercicio.compuesto ? 1 : 0))[0];
        elegidos.splice(elegidos.indexOf(fuera), 1);
        recortados.push(fuera.ejercicio.nombre);
        estimados = estimarMinutos(elegidos);
    }

    // ── 7. Por qué quedó así
    const justificacion = {
        enfoque: plantilla.nombre,
        lugar: perfil.lugar || "gimnasio",
        objetivo: objetivo.nombre,
        razon_objetivo: objetivo.nota,
        nivel: perfil.nivel,
        repeticiones: `${repMin} a ${repMax}`,
        descanso_seg: descanso,
        intensidad_max_pct: Math.round(limites.intensidadMax * 100),
        condiciones: limites.condiciones,
        ajustado_por_salud: topadoPorSalud || limites.condiciones.length > 0,
        ejercicios_descartados: descartados.length,
        descartados_muestra: descartados.slice(0, 8),
        ranuras_sin_cubrir: sinCubrir,
        recortados_por_tiempo: recortados
    };

    return {
        nombre: plantilla.nombre,
        enfoque: clave,
        minutos_estimados: estimados,
        ejercicios: elegidos,
        avisos: limites.avisos,
        justificacion
    };
}

/**
 * Duración estimada.
 *
 * Cada serie son unos 45 segundos de trabajo más su descanso, más el
 * tiempo de montar el ejercicio. Ese montaje depende del equipo y no es
 * un valor fijo: tirarse al piso a hacer una plancha es inmediato,
 * mientras que cargar una barra o esperar que se desocupe una máquina
 * puede llevar varios minutos. Tratarlos igual inflaba la estimación y
 * hacía que el ajuste por tiempo recortara sesiones que sí entraban.
 */
const MONTAJE_SEG = {
    peso_corporal: 45,
    banda: 60,
    mancuernas: 105,
    kettlebell: 105,
    polea: 150,
    maquina: 165,
    barra: 195
};

function estimarMinutos(ejercicios) {
    let seg = 0;
    for (const e of ejercicios) {
        if (e.esCardio) { seg += e.rep_min * 60; continue; }
        const montaje = MONTAJE_SEG[e.ejercicio && e.ejercicio.equipo] ?? 120;
        seg += e.series * (45 + e.descanso_seg) + montaje;
    }
    return Math.round(seg / 60);
}

module.exports = {
    generar, estimarMinutos, OBJETIVOS, PLANTILLAS, CICLOS,
    semillaDe, generador, mezclar, filtrarDisponibles
};
