/**
 * lib/planes.js — qué incluye cada plan.
 *
 * Los límites viven acá y en un solo lugar. Repartidos por las rutas,
 * tarde o temprano una comprueba tres miembros y otra cinco, y nadie
 * sabe cuál es el número de verdad.
 *
 * El criterio para decidir qué va en el plan gratuito: **entrenar tiene
 * que funcionar entero sin pagar**. Rutinas adaptadas, registro, medidas
 * y progreso son la aplicación, no el señuelo. Lo que se cobra es lo
 * social sin límite, los dispositivos y el análisis fino.
 */

const PLANES = {
    gratis: {
        codigo: "gratis",
        nombre: "Gratuito",
        precio_usd: 0,
        periodo: null,
        descripcion: "Todo lo necesario para entrenar bien, sin fecha de vencimiento.",
        limites: {
            grupos: 1,
            miembros_por_grupo: 3,
            retos_activos: 1,
            dispositivos: false,
            // Traer datos de otras plataformas pasa al plan de pago.
            //
            // Estaba en el gratuito con el argumento de que son los datos
            // de la persona y cobrar por dejarla traerlos sería mezquino.
            // El argumento sigue siendo cierto sobre el DERECHO a los
            // datos, y no sobre el trabajo de leerlos: interpretar lo que
            // exporta cada plataforma, unificar formatos que no se
            // parecen y encajarlo en el historial es la parte cara, y es
            // la que se cobra. Quien no paga puede seguir anotando a mano
            // todo lo que quiera, que es lo que importa.
            importar: false,
            galeria: false,
            lectura_estudios: false,
            reconocer_maquinas: false,
            analisis_carga: false
        },
        incluye: [
            "Rutinas adaptadas a tus condiciones de salud",
            "Registro de entrenamientos y medidas corporales",
            "Peso sugerido calculado desde tu historial",
            "Entrenamiento en casa y calistenia",
            "Funciona sin conexión",
            "Un grupo de hasta 3 personas"
        ]
    },

    mensual: {
        codigo: "mensual",
        nombre: "Mensual",
        precio_usd: 5,
        periodo: "mes",
        dias: 30,
        descripcion: "Para quien ya entrena en serio y quiere medirlo todo.",
        limites: {
            grupos: 10,
            miembros_por_grupo: 30,
            retos_activos: 5,
            dispositivos: true,
            importar: true,
            galeria: true,
            lectura_estudios: false,
            reconocer_maquinas: false,
            analisis_carga: true
        },
        incluye: [
            "Todo lo del plan gratuito",
            "Reloj, pulsera y banda de pecho conectados",
            "Ritmo cardíaco, sueño y pasos",
            "Importar tu historial de Strava, Garmin, Fitbit y 9 más",
            "Grupos sin límite práctico y retos personalizados",
            "Galería de evolución con fotos fechadas",
            "Análisis de carga y aviso de riesgo de lesión"
        ]
    },

    trimestral: {
        codigo: "anual",
        nombre: "Anual",
        precio_usd: 40,
        periodo: "año",
        dias: 365,
        // 40 y no 60: dos meses de regalo. El anual importa más que el
        // descuento — cobra por adelantado y las bajas caen a la mitad.
        descripcion: "El mensual con descuento, más las funciones que usan los equipos.",
        limites: {
            grupos: 30,
            miembros_por_grupo: 60,
            retos_activos: 15,
            dispositivos: true,
            importar: true,
            galeria: true,
            lectura_estudios: true,
            reconocer_maquinas: true,
            analisis_carga: true
        },
        incluye: [
            "Todo lo del plan mensual",
            "Lectura de estudios clínicos por foto",
            "Reconocimiento de máquinas del gimnasio",
            "Exportación completa de tus datos"
        ]
    }
};

/** El plan de una cuenta, contemplando que haya vencido. */
function planDe(usuario) {
    if (!usuario) return PLANES.gratis;

    const codigo = usuario.plan || "gratis";
    const plan = PLANES[codigo] || PLANES.gratis;

    // Una suscripción vencida vuelve al plan gratuito, pero **no borra
    // nada**: el historial sigue completo y se recupera al renovar.
    if (plan.codigo !== "gratis" && usuario.plan_vence) {
        const vence = new Date(usuario.plan_vence);
        if (!isNaN(vence) && vence < new Date()) return PLANES.gratis;
    }
    return plan;
}

function limite(usuario, cual) {
    return planDe(usuario).limites[cual];
}

/** Catálogo para la pantalla de planes. */
function catalogo() {
    return Object.values(PLANES).map(p => ({
        codigo: p.codigo, nombre: p.nombre, precio_usd: p.precio_usd,
        periodo: p.periodo, descripcion: p.descripcion,
        incluye: p.incluye, limites: p.limites
    }));
}

module.exports = { PLANES, planDe, limite, catalogo };
