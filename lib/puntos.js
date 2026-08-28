/**
 * lib/puntos.js — puntaje y niveles.
 *
 * La gamificación acá premia lo que la persona controla: aparecer,
 * sostener la racha, medirse. No premia el peso levantado en bruto,
 * porque eso convertiría el ranking en una tabla ordenada por genética y
 * por años de entrenamiento previo, donde quien recién empieza no tiene
 * ninguna posibilidad y abandona en la primera semana.
 *
 * Por la misma razón el ranking es por CONSTANCIA y por progreso propio,
 * no por cifras absolutas: cada quien compite contra su punto de partida.
 */

const REGLAS = {
    sesion_completada: { puntos: 50,  detalle: "Sesión completada" },
    sesion_parcial:    { puntos: 20,  detalle: "Sesión a medias, pero apareciste" },
    racha_semana:      { puntos: 100, detalle: "Semana completa según tu plan" },
    marca_personal:    { puntos: 75,  detalle: "Marca personal nueva" },
    medicion:          { puntos: 40,  detalle: "Medición corporal registrada" },
    primer_registro:   { puntos: 25,  detalle: "Primer entrenamiento registrado" },
    constancia_mes:    { puntos: 250, detalle: "Un mes sin faltar a tu plan" }
};

/**
 * Niveles.
 *
 * El salto entre niveles crece, pero no de forma exponencial: si el
 * nivel 10 exigiera cien sesiones más que el 9, deja de motivar y pasa a
 * frustrar.
 */
const NIVELES = [
    { nivel: 1,  desde: 0,     titulo: "Primer día" },
    { nivel: 2,  desde: 200,   titulo: "Constante" },
    { nivel: 3,  desde: 600,   titulo: "En marcha" },
    { nivel: 4,  desde: 1200,  titulo: "Comprometido" },
    { nivel: 5,  desde: 2200,  titulo: "Disciplinado" },
    { nivel: 6,  desde: 3600,  titulo: "Sólido" },
    { nivel: 7,  desde: 5500,  titulo: "Veterano" },
    { nivel: 8,  desde: 8000,  titulo: "Referente" },
    { nivel: 9,  desde: 11500, titulo: "Inquebrantable" },
    { nivel: 10, desde: 16000, titulo: "Forjado" }
];

function nivelDe(totalPuntos) {
    const p = Number(totalPuntos) || 0;
    let actual = NIVELES[0];
    for (const n of NIVELES) if (p >= n.desde) actual = n;

    const siguiente = NIVELES.find(n => n.desde > p) || null;
    const base = actual.desde;
    const techo = siguiente ? siguiente.desde : actual.desde;

    return {
        nivel: actual.nivel,
        titulo: actual.titulo,
        puntos: p,
        siguiente: siguiente ? siguiente.nivel : null,
        faltan: siguiente ? siguiente.desde - p : 0,
        progresoPct: siguiente ? Math.round(((p - base) / (techo - base)) * 100) : 100
    };
}

/**
 * Calorías estimadas de una sesión.
 *
 * Es una estimación gruesa por MET y se presenta como tal. Dar un número
 * con decimales sobre algo que depende del metabolismo de cada persona
 * sería fingir una precisión que no existe.
 */
function caloriasEstimadas(minutos, pesoKg, intensidad = "moderada") {
    const MET = { suave: 3.0, moderada: 5.0, alta: 7.5 }[intensidad] || 5.0;
    const peso = Number(pesoKg) || 70;
    const min = Number(minutos) || 0;
    return Math.round(MET * 3.5 * peso / 200 * min);
}

module.exports = { REGLAS, NIVELES, nivelDe, caloriasEstimadas };
