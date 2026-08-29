/**
 * lib/rangos.js — rangos por constancia, estilo competitivo.
 *
 * Bronce, Plata, Oro, Platino, Diamante y Legendario, cada uno con tres
 * divisiones salvo el último. Es la escala que reconoce cualquiera que
 * haya jugado algo en línea, y esa familiaridad vale: no hay que
 * explicar qué significa "Plata II".
 *
 * DE QUÉ DEPENDE EL RANGO, Y POR QUÉ
 *
 * De los puntos acumulados, y los puntos se ganan por CONSTANCIA: por
 * terminar sesiones, por sostener la racha, por cumplir la meta de agua,
 * por registrar actividades.
 *
 * No por cuánto levanta la persona. Un ranking por kilos lo gana siempre
 * el más fuerte y el resto no compite nunca; uno por constancia lo puede
 * ganar quien empezó hace tres meses, y esa es justamente la gente que
 * hay que sostener. Alguien de 55 kg que no falla un día merece estar
 * arriba de alguien de 110 que va cuando se acuerda.
 *
 * EL PLAN NO MULTIPLICA PUNTOS
 *
 * Se consideró dar más puntos por punto a quien paga. No se hizo, y es
 * deliberado:
 *
 *   Si el plan de pago multiplicara los puntos, el ranking dejaría de
 *   medir constancia y pasaría a medir quién pagó. Quien no paga sabe de
 *   entrada que no puede ganar y deja de mirarlo; quien paga sabe que su
 *   puesto está comprado y tampoco significa nada. El ranking se muere
 *   para los dos lados, y con él la razón de competir.
 *
 *   Lo que sí hace el plan es abrir más FORMAS de sumar: dispositivos
 *   conectados, más actividades registrables, grupos sin límite. Quien
 *   paga tiene más terreno donde ganar puntos, pero cada punto vale lo
 *   mismo para todos. Eso vende igual y no rompe nada.
 */

const RANGOS = [
    { codigo: "bronce",     nombre: "Bronce",     color: "#b0733d", divisiones: 3, desde: 0 },
    { codigo: "plata",      nombre: "Plata",      color: "#a8b3bd", divisiones: 3, desde: 600 },
    { codigo: "oro",        nombre: "Oro",        color: "#d8a63c", divisiones: 3, desde: 1800 },
    { codigo: "platino",    nombre: "Platino",    color: "#5ec4c4", divisiones: 3, desde: 4000 },
    { codigo: "diamante",   nombre: "Diamante",   color: "#6ea8f0", divisiones: 3, desde: 8000 },
    { codigo: "legendario", nombre: "Legendario", color: "#c15fd8", divisiones: 1, desde: 16000 }
];

/**
 * Los umbrales crecen de forma acelerada a propósito.
 *
 * Con umbrales parejos, el que lleva dos años estaría a una distancia
 * inalcanzable y el que empieza no vería avance. Así, las primeras
 * divisiones caen rápido —Bronce I a II en pocos días— y el ascenso se
 * pone serio arriba. Quien empieza siente progreso desde la semana uno;
 * llegar a Legendario cuesta cerca de un año de constancia real.
 *
 * Las divisiones se numeran de la III a la I, de peor a mejor, como en
 * los juegos: Bronce III es donde se entra y Bronce I es lo mejor de
 * Bronce. Al revés confundiría a todo el que ya conoce la convención.
 */
function rangoDe(puntos) {
    const p = Math.max(0, Number(puntos) || 0);

    let i = 0;
    for (let k = RANGOS.length - 1; k >= 0; k--) {
        if (p >= RANGOS[k].desde) { i = k; break; }
    }

    const r = RANGOS[i];
    const siguiente = RANGOS[i + 1] || null;
    const techo = siguiente ? siguiente.desde : null;

    // Dentro del rango, en qué división cae.
    let division = 1, dentroDesde = r.desde, dentroHasta = techo;
    if (r.divisiones > 1 && techo !== null) {
        const paso = (techo - r.desde) / r.divisiones;
        const n = Math.min(r.divisiones - 1, Math.floor((p - r.desde) / paso));
        division = r.divisiones - n;             // III → II → I
        dentroDesde = r.desde + n * paso;
        dentroHasta = r.desde + (n + 1) * paso;
    }

    const romano = { 1: "I", 2: "II", 3: "III" }[division] || "";
    const nombre = r.divisiones > 1 ? `${r.nombre} ${romano}` : r.nombre;

    const falta = dentroHasta === null ? 0 : Math.max(0, Math.ceil(dentroHasta - p));
    const avance = dentroHasta === null ? 100
        : Math.max(0, Math.min(100, Math.round(((p - dentroDesde) / (dentroHasta - dentroDesde)) * 100)));

    return {
        codigo: r.codigo, nombre, base: r.nombre, division, color: r.color,
        puntos: p, avance, falta,
        // Lo que sigue, para poder decir "te faltan 40 para Plata III".
        siguiente: dentroHasta === null ? null
            : (division > 1 ? `${r.nombre} ${{2:"II",1:"I"}[division-1]}`
                            : (siguiente ? `${siguiente.nombre} III` : null)),
        max: dentroHasta === null
    };
}

/**
 * Cuánta ventaja lleva alguien sobre otro, en divisiones.
 *
 * Sirve para el mensaje del ranking: "estás a dos divisiones del
 * primero" dice mucho más que "estás 340 puntos abajo", porque nadie
 * tiene idea de cuánto son 340 puntos.
 */
function distancia(puntosA, puntosB) {
    const orden = (p) => {
        const r = rangoDe(p);
        const i = RANGOS.findIndex(x => x.codigo === r.codigo);
        return i * 3 + (3 - r.division);
    };
    return Math.abs(orden(puntosA) - orden(puntosB));
}

/**
 * Rangos que se pierden si se abandona.
 *
 * Un rango que sólo sube deja de significar nada: al año, todo el que se
 * inscribió alguna vez es Oro, incluidos los que no entran hace meses, y
 * el que entrena todos los días está mezclado con ellos.
 *
 * Pero bajar de rango a quien tuvo una mala semana es la forma más
 * rápida de que no vuelva. El punto medio: no se baja de rango base
 * —quien llegó a Oro no vuelve a Plata nunca— y sí se pierden puntos
 * dentro del rango tras un mes entero sin aparecer.
 *
 * Un mes, y no una semana: la gente se enferma, viaja y tiene hijos.
 */
function decaimiento(puntos, diasSinEntrenar) {
    const d = Number(diasSinEntrenar) || 0;
    if (d <= 30) return { puntos, perdidos: 0 };

    const r = rangoDe(puntos);
    const piso = RANGOS.find(x => x.codigo === r.codigo).desde;

    // 1% por semana pasada el primer mes, y nunca por debajo del piso
    // del rango que ya alcanzó.
    const semanas = Math.floor((d - 30) / 7);
    const restan = Math.round(puntos * Math.pow(0.99, semanas));
    const final = Math.max(piso, restan);

    return { puntos: final, perdidos: puntos - final };
}

module.exports = { RANGOS, rangoDe, distancia, decaimiento };
