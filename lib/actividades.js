/**
 * lib/actividades.js — todo lo que se entrena fuera del gimnasio.
 *
 * Correr, caminar, bicicleta, natación, artes marciales, gimnasia,
 * spinning, remo. Dos formas de registrarlo:
 *
 *   CON GPS   correr, caminar, bicicleta, senderismo. El teléfono da la
 *             posición y de ahí salen distancia, ritmo y desnivel.
 *
 *   SIN GPS   natación, artes marciales, gimnasia, spinning, y todo lo
 *             bajo techo. El GPS no sirve adentro, y en una piscina
 *             directamente no existe. Se registra tiempo e intensidad.
 *
 * Lo que NO se hace acá, y por qué:
 *
 *   No se inventan calorías con precisión de laboratorio. Lo que se
 *   calcula es una estimación por MET —el índice estándar de gasto
 *   metabólico— y se dice en pantalla que es una estimación. Un reloj
 *   con pulsómetro estima mejor; si la persona trae ese dato importado,
 *   se usa el suyo y no el nuestro.
 */

/* ── Catálogo ─────────────────────────────────────────────────────── */

/**
 * Los MET vienen del Compendio de Actividades Físicas (Ainsworth et al.),
 * que es la referencia que usa todo el mundo, incluidos los relojes.
 *
 * Donde hay un rango por intensidad se guardan los tres valores: correr
 * a ritmo suave y correr a ritmo fuerte no gastan lo mismo, y usar un
 * único número le erraría por un tercio en los dos extremos.
 */
const DEPORTES = [
    { codigo: "correr",      nombre: "Correr",            gps: true,  icono: "correr",
      met: { suave: 7.0, medio: 9.8, fuerte: 12.8 }, ritmo: "min/km" },
    { codigo: "caminar",     nombre: "Caminar",           gps: true,  icono: "caminar",
      met: { suave: 2.8, medio: 3.5, fuerte: 5.0 },  ritmo: "min/km" },
    { codigo: "senderismo",  nombre: "Senderismo",        gps: true,  icono: "montana",
      met: { suave: 5.3, medio: 6.5, fuerte: 8.0 },  ritmo: "min/km" },
    { codigo: "bicicleta",   nombre: "Bicicleta",         gps: true,  icono: "bici",
      met: { suave: 5.8, medio: 8.0, fuerte: 12.0 }, ritmo: "km/h" },
    { codigo: "spinning",    nombre: "Spinning",          gps: false, icono: "bici",
      met: { suave: 6.8, medio: 8.5, fuerte: 11.0 } },
    { codigo: "natacion",    nombre: "Natación",          gps: false, icono: "agua",
      met: { suave: 5.3, medio: 7.0, fuerte: 9.8 } },
    { codigo: "remo",        nombre: "Remo",              gps: false, icono: "remo",
      met: { suave: 4.8, medio: 7.0, fuerte: 8.5 } },
    { codigo: "eliptica",    nombre: "Elíptica",          gps: false, icono: "correr",
      met: { suave: 4.6, medio: 5.5, fuerte: 7.5 } },
    { codigo: "marciales",   nombre: "Artes marciales",   gps: false, icono: "marcial",
      met: { suave: 5.3, medio: 8.0, fuerte: 10.3 } },
    { codigo: "boxeo",       nombre: "Boxeo",             gps: false, icono: "marcial",
      met: { suave: 5.5, medio: 7.8, fuerte: 12.8 } },
    { codigo: "gimnasia",    nombre: "Gimnasia",          gps: false, icono: "gimnasia",
      met: { suave: 3.8, medio: 5.3, fuerte: 7.0 } },
    { codigo: "baile",       nombre: "Baile",             gps: false, icono: "baile",
      met: { suave: 3.5, medio: 5.0, fuerte: 7.8 } },
    { codigo: "futbol",      nombre: "Fútbol",            gps: true,  icono: "pelota",
      met: { suave: 5.0, medio: 7.0, fuerte: 10.0 } },
    { codigo: "basquet",     nombre: "Básquetbol",        gps: false, icono: "pelota",
      met: { suave: 4.5, medio: 6.5, fuerte: 8.0 } },
    { codigo: "tenis",       nombre: "Tenis",             gps: false, icono: "pelota",
      met: { suave: 5.0, medio: 7.3, fuerte: 8.0 } },
    { codigo: "escalada",    nombre: "Escalada",          gps: false, icono: "montana",
      met: { suave: 5.8, medio: 8.0, fuerte: 11.0 } },
    { codigo: "yoga",        nombre: "Yoga",              gps: false, icono: "yoga",
      met: { suave: 2.3, medio: 3.0, fuerte: 4.0 } },
    { codigo: "otro",        nombre: "Otra actividad",    gps: false, icono: "otro",
      met: { suave: 3.5, medio: 5.0, fuerte: 7.0 } }
];

const porCodigo = (c) => DEPORTES.find(d => d.codigo === c) || null;

/* ── Distancia ────────────────────────────────────────────────────── */

const RADIO_TIERRA = 6371000;   // metros
const rad = (g) => (g * Math.PI) / 180;

/** Distancia entre dos coordenadas, en metros (fórmula del semiverseno). */
function distancia(a, b) {
    const dLat = rad(b.lat - a.lat);
    const dLon = rad(b.lon - a.lon);
    const x = Math.sin(dLat / 2) ** 2 +
              Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * RADIO_TIERRA * Math.asin(Math.sqrt(x));
}

/**
 * Recorre los puntos y saca distancia, desnivel y velocidad máxima.
 *
 * Acá está la parte que más se equivoca en las aplicaciones caseras: el
 * GPS de un teléfono tiene ruido. Parado en un semáforo, la posición
 * salta unos metros para cualquier lado, y sumar esos saltos infla la
 * distancia. Una caminata de cinco kilómetros puede marcar seis.
 *
 * Tres filtros, y cada uno tapa un agujero distinto:
 *
 *   1. Se descartan los puntos con mala precisión declarada. El propio
 *      navegador dice cuánto se está equivocando; ignorarlo es tirar la
 *      información más útil que da.
 *
 *   2. Se ignoran los tramos más cortos que la precisión del punto. Si
 *      el teléfono dice "estoy a 20 m de precisión", un movimiento de 4 m
 *      no se distingue del ruido.
 *
 *   3. Se descartan los saltos imposibles. Un tramo de 300 m en un
 *      segundo no es correr: es el GPS reenganchando.
 */
function recorrer(puntos, velocidadMaxima) {
    const p = (puntos || []).filter(x =>
        Number.isFinite(x.lat) && Number.isFinite(x.lon) &&
        Math.abs(x.lat) <= 90 && Math.abs(x.lon) <= 180 &&
        // Precisión peor que 50 m no sirve para medir: es una manzana entera.
        (!Number.isFinite(x.precision) || x.precision <= 50));

    if (p.length < 2) {
        return { metros: 0, subida: 0, bajada: 0, velocidad_max: 0, puntos_usados: p.length,
                 puntos_descartados: (puntos || []).length - p.length };
    }

    const techo = velocidadMaxima || 30;   // m/s; 30 es más rápido que un ciclista en bajada
    let metros = 0, subida = 0, bajada = 0, vMax = 0, saltados = 0;

    // Referencia de altura para el desnivel. NO se compara cada punto con
    // el anterior: se compara con la última altura confirmada.
    //
    // La diferencia importa. La altitud del GPS oscila un par de metros
    // estando quieto, y comparando punto contra punto esa oscilación
    // suma sin parar: arriba, abajo, arriba, abajo, y al final del paseo
    // dice que subiste doscientos metros por una calle plana. Contra una
    // referencia fija, la oscilación no llega al umbral y no cuenta,
    // mientras que una subida de verdad —que se aleja y no vuelve— sí lo
    // supera y mueve la referencia.
    //
    // Es el mismo principio de un termostato con histéresis, y es lo que
    // hacen las aplicaciones de carrera que aciertan el desnivel.
    const UMBRAL_ALT = 5;      // metros; por debajo, el GPS no distingue
    // Arranca en el PRIMER punto, no en el segundo: si empezara en el
    // segundo se perdería el primer tramo de subida entero.
    let altRef = Number.isFinite(p[0].altitud) ? p[0].altitud : null;

    for (let i = 1; i < p.length; i++) {
        const d = distancia(p[i - 1], p[i]);
        const dt = (p[i].t - p[i - 1].t) / 1000;

        // Ruido: movimiento más chico que el propio error de medición.
        const ruido = Math.max(p[i].precision || 0, p[i - 1].precision || 0, 3);
        if (d < ruido) { saltados++; continue; }

        if (dt > 0) {
            const v = d / dt;
            if (v > techo) { saltados++; continue; }   // salto imposible
            if (v > vMax) vMax = v;
        }

        metros += d;

        const alt = p[i].altitud;
        if (Number.isFinite(alt)) {
            if (altRef === null) altRef = alt;
            const dAlt = alt - altRef;
            if (Math.abs(dAlt) >= UMBRAL_ALT) {
                if (dAlt > 0) subida += dAlt; else bajada += -dAlt;
                altRef = alt;
            }
        }
    }

    return {
        metros: Math.round(metros),
        subida: Math.round(subida),
        bajada: Math.round(bajada),
        velocidad_max: Number(vMax.toFixed(2)),
        puntos_usados: p.length,
        puntos_descartados: (puntos || []).length - p.length + saltados
    };
}

/* ── Ritmo y velocidad ────────────────────────────────────────────── */

/** Ritmo en minutos por kilómetro, como texto ("5:30"). */
function ritmo(metros, segundos) {
    if (!(metros > 0) || !(segundos > 0)) return null;
    const minPorKm = (segundos / 60) / (metros / 1000);
    if (!Number.isFinite(minPorKm) || minPorKm > 99) return null;
    const m = Math.floor(minPorKm);
    const s = Math.round((minPorKm - m) * 60);
    return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, "0")}`;
}

/** Velocidad media en km/h. */
function velocidad(metros, segundos) {
    if (!(metros > 0) || !(segundos > 0)) return 0;
    return Number(((metros / 1000) / (segundos / 3600)).toFixed(2));
}

/* ── Calorías ─────────────────────────────────────────────────────── */

/**
 * Estimación de gasto por MET.
 *
 *   kcal = MET × peso(kg) × horas
 *
 * Es la fórmula estándar y es una estimación, no una medición. Se
 * devuelve junto con `estimada: true` para que la pantalla no la muestre
 * como si fuera un dato del laboratorio.
 *
 * Si la persona trae calorías de su propio reloj —que sí mide pulso—,
 * ese dato manda. Un pulsómetro estima mejor que una tabla.
 */
function calorias(codigoDeporte, minutos, pesoKg, intensidad) {
    const d = porCodigo(codigoDeporte);
    if (!d || !(minutos > 0)) return null;

    const peso = Number(pesoKg);
    // Sin el peso no se puede estimar. Inventar 70 kg le erraría un 40% a
    // alguien de 100 kg, y ese número aparecería como si fuera suyo.
    if (!Number.isFinite(peso) || peso <= 20 || peso > 400) return null;

    const met = d.met[intensidad] || d.met.medio;
    return { kcal: Math.round(met * peso * (minutos / 60)), met, estimada: true };
}

/* ── Validación ───────────────────────────────────────────────────── */

/**
 * Comprueba que una actividad sea posible antes de guardarla.
 *
 * Sin esto, una actividad con el cronómetro olvidado o con la distancia
 * mal tecleada entra al historial y contamina los promedios y el
 * ranking para siempre.
 */
function validar(a) {
    const d = porCodigo(a && a.deporte);
    if (!d) return "Ese deporte no está en la lista.";

    const seg = Number(a.segundos);
    if (!Number.isFinite(seg) || seg <= 0) return "Falta cuánto duró.";
    if (seg > 24 * 3600) return "Más de 24 horas no es una sesión: revisá el tiempo.";
    if (seg < 30) return "Menos de medio minuto no llega a ser una sesión.";

    const m = Number(a.metros || 0);
    if (m < 0) return "La distancia no puede ser negativa.";
    if (m > 500000) return "Más de 500 km en una sesión no es posible.";

    // Coherencia entre distancia y tiempo. Este es el filtro que atrapa
    // el error real: tocar "guardar" con el cronómetro parado y la
    // distancia puesta a mano, que da velocidades de avión.
    if (m > 0 && seg > 0) {
        const kmh = (m / 1000) / (seg / 3600);
        const techo = a.deporte === "bicicleta" ? 90 : 45;
        if (kmh > techo) {
            return `${kmh.toFixed(0)} km/h de promedio no es posible en ${d.nombre.toLowerCase()}. Revisá la distancia o el tiempo.`;
        }
    }

    const pulso = Number(a.pulso_medio || 0);
    if (pulso && (pulso < 30 || pulso > 230)) return "Ese pulso medio no es posible.";

    return null;
}

/* ── Puntos ───────────────────────────────────────────────────────── */

/**
 * Puntos por una actividad.
 *
 * Se paga por TIEMPO y no por distancia. Es la decisión importante:
 * pagar por kilómetros premia a quien corre rápido y castiga a quien
 * camina, a quien está empezando y a quien pesa más — justo las personas
 * a las que hay que sostener. Media hora de esfuerzo es media hora de
 * esfuerzo, corra o camine.
 *
 * Y hay techo: una sesión de tres horas no puede valer diez veces una de
 * treinta minutos, o el ranking lo gana quien tiene más tiempo libre.
 */
function puntosDeActividad(a) {
    const seg = Number(a && a.segundos);
    if (!Number.isFinite(seg) || seg < 300) return 0;   // menos de 5 min no cuenta

    const minutos = Math.min(seg / 60, 120);            // el techo son 2 horas
    return Math.round(10 + minutos * 0.4);              // 30 min ≈ 22 pts, 2 h ≈ 58
}

module.exports = {
    DEPORTES, porCodigo, distancia, recorrer, ritmo, velocidad,
    calorias, validar, puntosDeActividad
};
