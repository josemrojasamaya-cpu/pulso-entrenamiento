/**
 * lib/aplicaciones.js — catálogo de aplicaciones que se pueden traer.
 *
 * La idea, y por qué funciona sin pagarle a nadie:
 *
 *   Los datos son de la persona, no de la plataforma. Todas están
 *   obligadas a dejar que se los lleve, y todas tienen un botón de
 *   exportar aunque esté escondido en el tercer submenú. Lo que falta no
 *   es permiso: es que alguien le diga a la gente **dónde está ese
 *   botón**.
 *
 *   Eso es lo que hay acá: para cada aplicación, los pasos exactos, qué
 *   formato sale y qué se puede aprovechar. Sin API de por medio, sin
 *   cuentas de desarrollador y sin que nadie pueda cortarnos el acceso.
 *
 * Los pasos se revisan de vez en cuando: las aplicaciones mueven sus
 * menús. Si alguno queda viejo, la persona igual encuentra la opción
 * buscando "exportar" en los ajustes, y por eso cada ficha lleva también
 * el nombre de la sección, no sólo el camino.
 */

const APLICACIONES = [
    {
        codigo: "strava",
        nombre: "Strava",
        que_es: "Carrera, ciclismo y caminata. La más usada para actividades al aire libre.",
        trae: ["Recorridos", "Ritmo cardíaco", "Tiempo y distancia", "Calorías"],
        formato: "GPX o TCX por actividad",
        seccion: "Ajustes → Mi cuenta → Descargar o eliminar tu cuenta",
        pasos: [
            "Entrá a strava.com desde el navegador (en la app del teléfono no está la opción).",
            "Abrí una actividad y tocá los tres puntos, arriba a la derecha.",
            "Elegí «Exportar GPX» o «Exportar TCX original».",
            "Subí el archivo acá. El TCX trae ritmo cardíaco; el GPX no siempre."
        ],
        nota: "Para bajar todo tu historial de una vez: Ajustes → Mi cuenta → " +
              "Descargar tus datos. Llega por correo en unas horas.",
        enlace_android: "https://play.google.com/store/apps/details?id=com.strava",
        enlace_ios: "https://apps.apple.com/app/strava/id426826309",
        sitio: "https://www.strava.com"
    },
    {
        codigo: "garmin",
        nombre: "Garmin Connect",
        que_es: "Relojes y ciclocomputadoras Garmin. De lo más completo en datos.",
        trae: ["Ritmo cardíaco", "Sueño", "Pasos", "Recorridos", "VO₂ máx"],
        formato: "TCX o GPX por actividad",
        seccion: "connect.garmin.com → Actividades",
        pasos: [
            "Entrá a connect.garmin.com desde el navegador.",
            "Abrí la actividad que quieras y tocá el engranaje, arriba a la derecha.",
            "Elegí «Exportar a TCX» (trae más datos que el GPX).",
            "Subí el archivo acá."
        ],
        nota: "Garmin también exporta en FIT, que no se puede leer acá. Elegí TCX, " +
              "que tiene la misma información.",
        enlace_android: "https://play.google.com/store/apps/details?id=com.garmin.android.apps.connectmobile",
        enlace_ios: "https://apps.apple.com/app/garmin-connect/id583446403",
        sitio: "https://connect.garmin.com"
    },
    {
        codigo: "samsung_health",
        nombre: "Samsung Health",
        que_es: "Viene en los teléfonos Samsung y funciona con sus relojes.",
        trae: ["Pasos", "Ritmo cardíaco", "Sueño", "Peso"],
        formato: "CSV",
        seccion: "Ajustes → Descargar datos personales",
        pasos: [
            "Abrí Samsung Health y tocá el menú (tres líneas).",
            "Entrá a Ajustes → Descargar datos personales.",
            "Confirmá y esperá: se guarda un ZIP en la carpeta de descargas.",
            "Descomprimilo y subí acá los CSV que te interesen: pasos, pulso, sueño."
        ],
        nota: "El ZIP trae muchos archivos. Los útiles empiezan por " +
              "com.samsung.health.step_count, heart_rate y sleep.",
        enlace_android: "https://play.google.com/store/apps/details?id=com.sec.android.app.shealth",
        sitio: "https://www.samsung.com/es/apps/samsung-health/"
    },
    {
        codigo: "apple_salud",
        nombre: "Apple Salud",
        que_es: "Viene en todos los iPhone. Junta lo del teléfono, el Apple Watch y otras apps.",
        trae: ["Pasos", "Ritmo cardíaco", "Sueño", "Peso", "Entrenamientos"],
        formato: "XML dentro de un ZIP",
        seccion: "Tu foto de perfil → Exportar todos los datos de salud",
        pasos: [
            "Abrí Salud y tocá tu foto, arriba a la derecha.",
            "Bajá hasta «Exportar todos los datos de salud».",
            "Compartilo con vos mismo (por correo o guardándolo en Archivos).",
            "Descomprimí el ZIP: adentro hay un export.xml y una carpeta con los entrenamientos en GPX."
        ],
        nota: "El export.xml es enorme y no se lee acá. Los GPX de la carpeta " +
              "workout-routes sí, y traen los recorridos con pulso.",
        enlace_ios: "https://support.apple.com/es-es/guide/iphone/iph8ee54a20d/ios",
        sitio: "https://www.apple.com/es/ios/health/"
    },
    {
        codigo: "fitbit",
        nombre: "Fitbit",
        que_es: "Pulseras y relojes Fitbit, hoy de Google.",
        trae: ["Pasos", "Ritmo cardíaco", "Sueño", "Peso"],
        formato: "CSV",
        seccion: "fitbit.com → Ajustes → Exportación de datos",
        pasos: [
            "Entrá a fitbit.com desde el navegador y abrí tu cuenta.",
            "Andá a Ajustes → Exportación de datos.",
            "Elegí el rango de fechas y el formato CSV.",
            "Descargalo y subilo acá."
        ],
        nota: "Se puede pedir por mes. Rangos muy largos tardan o fallan.",
        enlace_android: "https://play.google.com/store/apps/details?id=com.fitbit.FitbitMobile",
        enlace_ios: "https://apps.apple.com/app/fitbit/id462638897",
        sitio: "https://www.fitbit.com"
    },
    {
        codigo: "polar",
        nombre: "Polar Flow",
        que_es: "Relojes y bandas de pecho Polar. Muy usados por su precisión de pulso.",
        trae: ["Ritmo cardíaco", "Entrenamientos", "Sueño", "Recorridos"],
        formato: "TCX o GPX",
        seccion: "flow.polar.com → Diario",
        pasos: [
            "Entrá a flow.polar.com desde el navegador.",
            "Abrí la sesión que quieras desde el Diario.",
            "Tocá «Exportar sesión» y elegí TCX.",
            "Subí el archivo acá."
        ],
        nota: "Las bandas de pecho Polar también se conectan directo por Bluetooth " +
              "desde la pestaña Dispositivos, sin exportar nada.",
        enlace_android: "https://play.google.com/store/apps/details?id=fi.polar.polarflow",
        enlace_ios: "https://apps.apple.com/app/polar-flow/id717204625",
        sitio: "https://flow.polar.com"
    },
    {
        codigo: "huawei_health",
        nombre: "Huawei Salud",
        que_es: "Relojes y pulseras Huawei y Honor.",
        trae: ["Pasos", "Ritmo cardíaco", "Sueño", "Entrenamientos"],
        formato: "GPX o TCX por actividad",
        seccion: "Yo → Ajustes de privacidad → Obtener una copia de tus datos",
        pasos: [
            "Abrí Huawei Salud y entrá a la pestaña «Yo».",
            "Ajustes de privacidad → Obtener una copia de tus datos.",
            "También podés exportar una actividad suelta: abrila y buscá el ícono de compartir.",
            "Subí acá los archivos GPX o TCX."
        ],
        enlace_android: "https://play.google.com/store/apps/details?id=com.huawei.health",
        sitio: "https://consumer.huawei.com"
    },
    {
        codigo: "zepp",
        nombre: "Zepp Life (Amazfit y Mi Band)",
        que_es: "Las pulseras Xiaomi Mi Band y los relojes Amazfit.",
        trae: ["Pasos", "Ritmo cardíaco", "Sueño"],
        formato: "CSV dentro de un ZIP",
        seccion: "Perfil → Ajustes → Exportar datos",
        pasos: [
            "Abrí Zepp Life y entrá a tu Perfil.",
            "Ajustes → Exportar datos.",
            "Pedí el archivo: llega por correo en unos minutos.",
            "Descomprimí y subí acá los CSV de ACTIVITY, HEARTRATE y SLEEP."
        ],
        nota: "Es de las que más datos exporta, y en CSV limpio.",
        enlace_android: "https://play.google.com/store/apps/details?id=com.xiaomi.hm.health",
        enlace_ios: "https://apps.apple.com/app/zepp-life/id938688461",
        sitio: "https://www.zepp.com"
    },
    {
        codigo: "adidas_running",
        nombre: "adidas Running (Runtastic)",
        que_es: "Carrera y caminata. De las más usadas en Latinoamérica.",
        trae: ["Recorridos", "Ritmo cardíaco", "Tiempo y distancia"],
        formato: "GPX",
        seccion: "Perfil → Ajustes → Exportar datos",
        pasos: [
            "Abrí la app y entrá a tu Perfil.",
            "Ajustes → Cuenta → Exportar datos.",
            "Vas a recibir un enlace por correo.",
            "Subí acá los GPX de las actividades."
        ],
        enlace_android: "https://play.google.com/store/apps/details?id=com.runtastic.android",
        enlace_ios: "https://apps.apple.com/app/adidas-running/id366626332",
        sitio: "https://www.runtastic.com"
    },
    {
        codigo: "komoot",
        nombre: "Komoot",
        que_es: "Ciclismo, senderismo y montaña.",
        trae: ["Recorridos", "Desnivel", "Tiempo"],
        formato: "GPX",
        seccion: "En cada tour → Exportar",
        pasos: [
            "Entrá a komoot.com desde el navegador.",
            "Abrí el tour que quieras.",
            "Tocá los tres puntos → Exportar como GPX.",
            "Subí el archivo acá."
        ],
        enlace_android: "https://play.google.com/store/apps/details?id=de.komoot.android",
        enlace_ios: "https://apps.apple.com/app/komoot/id447374873",
        sitio: "https://www.komoot.com"
    },
    {
        codigo: "wahoo",
        nombre: "Wahoo",
        que_es: "Ciclocomputadoras, rodillos y bandas de pecho TICKR.",
        trae: ["Ritmo cardíaco", "Potencia", "Recorridos"],
        formato: "FIT o TCX",
        seccion: "En cada sesión → Compartir",
        pasos: [
            "Abrí la app y entrá a la sesión.",
            "Tocá compartir y elegí TCX si está disponible.",
            "Subí el archivo acá."
        ],
        nota: "Las bandas TICKR se conectan directo por Bluetooth desde la pestaña " +
              "Dispositivos, sin exportar nada.",
        enlace_android: "https://play.google.com/store/apps/details?id=com.wahoofitness.fitness",
        enlace_ios: "https://apps.apple.com/app/wahoo-fitness/id391599899",
        sitio: "https://www.wahoofitness.com"
    },
    {
        codigo: "decathlon",
        nombre: "Decathlon (Kiprun / Coach)",
        que_es: "Carrera y entrenamiento. Sus bandas de pecho son de las más baratas.",
        trae: ["Recorridos", "Ritmo cardíaco"],
        formato: "GPX",
        seccion: "En cada sesión → Compartir → Exportar",
        pasos: [
            "Abrí la sesión en la app.",
            "Compartir → Exportar en GPX.",
            "Subí el archivo acá."
        ],
        nota: "Las bandas de pecho de Decathlon usan el estándar de Bluetooth y se " +
              "conectan directo desde Dispositivos.",
        enlace_android: "https://play.google.com/store/apps/details?id=com.decathlon.coach",
        sitio: "https://www.decathlon.com"
    }
];

/** Lo que se muestra en pantalla. */
function catalogo() {
    return APLICACIONES.map(a => ({
        codigo: a.codigo, nombre: a.nombre, que_es: a.que_es, trae: a.trae,
        formato: a.formato, seccion: a.seccion, pasos: a.pasos, nota: a.nota || null,
        enlace_android: a.enlace_android || null,
        enlace_ios: a.enlace_ios || null,
        sitio: a.sitio || null,
        // Algunas marcas se pueden conectar sin exportar nada, y eso es
        // mucho mejor experiencia: conviene que se vea.
        bluetooth: ["polar", "wahoo", "decathlon"].includes(a.codigo)
    }));
}

module.exports = { APLICACIONES, catalogo };
