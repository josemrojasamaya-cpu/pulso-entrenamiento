/**
 * lib/importar.js — lectura de archivos exportados de otras aplicaciones.
 *
 * Por qué esta es la vía principal y no las APIs de cada marca:
 *
 *   Strava pasó a exigir una suscripción de pago del desarrollador y
 *   limita el tier básico a diez usuarios. La API de Fitbit se retira en
 *   septiembre de 2026. Garmin y Suunto exigen aprobación manual. Google
 *   Fit está discontinuado. Cada una de esas puertas se puede cerrar sin
 *   avisar, y el día que se cierra la aplicación deja de funcionar.
 *
 *   Exportar los propios datos, en cambio, es un derecho que todas las
 *   plataformas respetan porque la ley las obliga. Un archivo exportado
 *   no caduca, no cuesta y no depende de que nadie apruebe nada.
 *
 * Formatos que se leen acá:
 *   GPX  estándar abierto, lo exporta casi todo
 *   TCX  de Garmin, con pulso y calorías además del recorrido
 *   CSV  el que sale de Samsung Health, Fitbit y las básculas
 *
 * FIT queda fuera a propósito: es binario, propietario y su lectura
 * correcta necesita una librería entera. Todas las plataformas que
 * exportan FIT exportan también TCX o GPX.
 */

/** Quita espacios y comillas de un valor de CSV. */
const limpio = (v) => String(v == null ? "" : v).trim().replace(/^["']|["']$/g, "");

/** Fecha en ISO, o null si no se entiende. */
function aFecha(texto) {
    if (!texto) return null;
    const t = limpio(texto);

    // Marca de tiempo Unix, en segundos o milisegundos
    if (/^\d{10}$/.test(t)) return new Date(Number(t) * 1000).toISOString();
    if (/^\d{13}$/.test(t)) return new Date(Number(t)).toISOString();

    const d = new Date(t);
    if (!isNaN(d.getTime())) return d.toISOString();

    // Formato día/mes/año, común en exportaciones en español
    const m = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (m) {
        const f = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
        if (!isNaN(f.getTime())) return f.toISOString();
    }
    return null;
}

/* ── GPX y TCX ────────────────────────────────────────────────────── */

/**
 * Extrae etiquetas de XML sin analizador.
 *
 * Un analizador completo es innecesario acá: estos archivos tienen una
 * estructura fija y sólo hacen falta unos pocos campos. Lo que sí se
 * hace es acotar el tamaño, para que un archivo enorme no bloquee el
 * proceso.
 */
function etiquetas(xml, nombre) {
    const re = new RegExp(`<${nombre}[^>]*>([\\s\\S]*?)<\\/${nombre}>`, "gi");
    const out = [];
    let m;
    while ((m = re.exec(xml)) !== null && out.length < 50000) out.push(m[1]);
    return out;
}

function unaEtiqueta(xml, nombre) {
    const m = new RegExp(`<${nombre}[^>]*>([\\s\\S]*?)<\\/${nombre}>`, "i").exec(xml);
    return m ? m[1].trim() : null;
}

function leerTCX(texto) {
    const lecturas = [];
    const actividades = [];

    for (const vuelta of etiquetas(texto, "Lap")) {
        const inicio = /StartTime="([^"]+)"/.exec(vuelta);
        actividades.push({
            inicio: inicio ? aFecha(inicio[1]) : null,
            segundos: Number(unaEtiqueta(vuelta, "TotalTimeSeconds")) || null,
            metros: Number(unaEtiqueta(vuelta, "DistanceMeters")) || null,
            calorias: Number(unaEtiqueta(vuelta, "Calories")) || null,
            pulso_medio: Number(unaEtiqueta(unaEtiqueta(vuelta, "AverageHeartRateBpm") || "", "Value")) || null,
            pulso_max: Number(unaEtiqueta(unaEtiqueta(vuelta, "MaximumHeartRateBpm") || "", "Value")) || null
        });
    }

    // Punto a punto: pulso por instante
    for (const punto of etiquetas(texto, "Trackpoint")) {
        const cuando = aFecha(unaEtiqueta(punto, "Time"));
        if (!cuando) continue;
        const hr = unaEtiqueta(punto, "HeartRateBpm");
        const bpm = hr ? Number(unaEtiqueta(hr, "Value")) : null;
        if (bpm > 0) lecturas.push({ tipo: "pulso", valor: bpm, medido_en: cuando });
    }

    return { formato: "TCX", actividades, lecturas };
}

function leerGPX(texto) {
    const lecturas = [];
    const nombre = unaEtiqueta(texto, "name");

    for (const punto of etiquetas(texto, "trkpt")) {
        const cuando = aFecha(unaEtiqueta(punto, "time"));
        if (!cuando) continue;
        // El pulso viaja en la extensión de Garmin, que casi todos copian.
        const bpm = Number(unaEtiqueta(punto, "gpxtpx:hr") || unaEtiqueta(punto, "hr"));
        if (bpm > 0) lecturas.push({ tipo: "pulso", valor: bpm, medido_en: cuando });
    }

    const tiempos = etiquetas(texto, "time").map(aFecha).filter(Boolean).sort();
    const actividades = tiempos.length ? [{
        nombre: nombre || "Actividad importada",
        inicio: tiempos[0],
        segundos: Math.round((new Date(tiempos[tiempos.length - 1]) - new Date(tiempos[0])) / 1000) || null
    }] : [];

    return { formato: "GPX", actividades, lecturas };
}

/* ── CSV ──────────────────────────────────────────────────────────── */

/** Divide una línea de CSV respetando las comillas. */
function partirLinea(linea, sep) {
    const campos = [];
    let actual = "", dentro = false;

    for (let i = 0; i < linea.length; i++) {
        const c = linea[i];
        if (c === '"') {
            // Dos comillas seguidas dentro de un campo son una comilla real.
            if (dentro && linea[i + 1] === '"') { actual += '"'; i++; }
            else dentro = !dentro;
        } else if (c === sep && !dentro) {
            campos.push(actual); actual = "";
        } else actual += c;
    }
    campos.push(actual);
    return campos;
}

/**
 * Nombres de columna que usa cada plataforma para lo mismo.
 *
 * No hay un estándar: Samsung escribe "com.samsung.health.step_count",
 * Fitbit escribe "Steps" y una báscula china escribe "Peso (kg)". El
 * mapa se compara en minúsculas y sin acentos.
 */
const COLUMNAS = {
    pasos:     ["pasos", "steps", "step_count", "stepcount", "total steps", "daily steps"],
    pulso:     ["pulso", "heart rate", "heartrate", "heart_rate", "bpm", "frecuencia cardiaca", "hr"],
    peso:      ["peso", "weight", "peso (kg)", "weight (kg)", "body weight", "masa"],
    grasa:     ["grasa", "body fat", "fat", "body_fat", "grasa corporal", "fat (%)"],
    sueno_min: ["sueno", "sleep", "sleep duration", "minutes asleep", "sleep_duration",
                "tiempo de sueno", "asleep"],
    calorias:  ["calorias", "calories", "calories burned", "energy", "kcal"],
    spo2:      ["spo2", "oxygen saturation", "oxigeno", "saturacion"],
    presion:   ["presion", "systolic", "sistolica", "blood pressure"],
    fecha:     ["fecha", "date", "day", "start time", "starttime", "timestamp",
                "datetime", "dia", "time"]
};

const sinAcentos = (s) => String(s).toLowerCase().trim()
    .normalize("NFD").replace(/[̀-ͯ]/g, "");

function columnaPara(encabezado) {
    const h = sinAcentos(encabezado);
    for (const [clave, alias] of Object.entries(COLUMNAS)) {
        if (alias.some(a => h === a || h.includes(a))) return clave;
    }
    return null;
}

function leerCSV(texto) {
    const lineas = texto.split(/\r?\n/).filter(l => l.trim());
    if (lineas.length < 2) return { formato: "CSV", lecturas: [], actividades: [], aviso: "El archivo no tiene datos." };

    // Separador: el que más aparece en el encabezado.
    const sep = [",", ";", "\t"]
        .map(s => ({ s, n: (lineas[0].match(new RegExp(`\\${s}`, "g")) || []).length }))
        .sort((a, b) => b.n - a.n)[0].s;

    const encabezado = partirLinea(lineas[0], sep).map(limpio);
    const mapa = encabezado.map(columnaPara);

    const iFecha = mapa.indexOf("fecha");
    const lecturas = [];
    const sinReconocer = encabezado.filter((_, i) => mapa[i] === null);

    for (let l = 1; l < lineas.length && lecturas.length < 20000; l++) {
        const campos = partirLinea(lineas[l], sep);
        const cuando = iFecha >= 0 ? aFecha(campos[iFecha]) : null;
        if (!cuando) continue;

        for (let c = 0; c < mapa.length; c++) {
            const tipo = mapa[c];
            if (!tipo || tipo === "fecha") continue;

            const bruto = limpio(campos[c]).replace(",", ".");
            const valor = Number(bruto);
            if (!Number.isFinite(valor) || valor === 0) continue;

            if (tipo === "peso" || tipo === "grasa") {
                lecturas.push({ tipo: "medicion", campo: tipo, valor, medido_en: cuando });
            } else {
                lecturas.push({ tipo, valor, medido_en: cuando });
            }
        }
    }

    return {
        formato: "CSV",
        lecturas,
        actividades: [],
        columnas_reconocidas: encabezado.filter((_, i) => mapa[i] !== null),
        columnas_ignoradas: sinReconocer.slice(0, 12)
    };
}

/* ── Entrada ──────────────────────────────────────────────────────── */

/**
 * Lee un archivo exportado y devuelve lo que se entendió.
 *
 * NO escribe nada: sólo interpreta. Quien llama decide qué guardar, y la
 * persona ve antes lo que se va a importar. Importar a ciegas datos de
 * otra plataforma es la forma más rápida de ensuciar un historial.
 */
function leer(nombreArchivo, contenido) {
    const n = String(nombreArchivo || "").toLowerCase();
    const texto = String(contenido || "");

    if (texto.length > 12 * 1024 * 1024) {
        return { error: "El archivo pesa más de 12 MB. Exportá un rango de fechas más corto." };
    }

    try {
        if (n.endsWith(".tcx") || /<TrainingCenterDatabase/i.test(texto)) return leerTCX(texto);
        if (n.endsWith(".gpx") || /<gpx/i.test(texto)) return leerGPX(texto);
        if (n.endsWith(".csv") || n.endsWith(".txt")) return leerCSV(texto);
        if (n.endsWith(".fit")) {
            return {
                error: "Los archivos FIT son binarios y no se pueden leer acá. " +
                       "Desde la misma pantalla de tu reloj podés exportar en TCX o GPX, " +
                       "que traen la misma información."
            };
        }
        // Último intento: si parece CSV, se trata como tal.
        if (texto.includes(",") || texto.includes(";")) return leerCSV(texto);

        return { error: "No se reconoce el formato. Se aceptan GPX, TCX y CSV." };
    } catch (err) {
        return { error: "El archivo está dañado o tiene un formato inesperado." };
    }
}

module.exports = { leer, leerGPX, leerTCX, leerCSV, COLUMNAS };
