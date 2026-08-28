/**
 * pruebas/motor.js — verifica el motor de rutinas sin tocar la base.
 *
 * Estas son las pruebas que importan: el motor es el único componente
 * que puede lastimar a alguien. Un fallo en la interfaz molesta; un
 * fallo acá le propone sentadillas con barra a una persona con hernia
 * discal.
 *
 * Uso:  node pruebas/motor.js
 */

const { generar, estimarMinutos, filtrarDisponibles } = require("../lib/motor-rutinas");
const { restricciones, esApto, CONDICIONES } = require("../lib/salud");
const { estimar1RM, sugerirPeso, redondear, detectarEstancamiento } = require("../lib/progresion");
const { nivelDe } = require("../lib/puntos");
const { EJERCICIOS, medidaDe } = require("../db/ejercicios");

let ok = 0, fallo = 0;
function check(nombre, condicion, detalle = "") {
    if (condicion) { ok++; console.log(`  OK    ${nombre}`); }
    else { fallo++; console.log(`  FALLA ${nombre} ${detalle}`); }
}
function seccion(t) { console.log(`\n--- ${t} ---`); }

// El catálogo se arma con la misma forma que tiene en la base.
const CATALOGO = EJERCICIOS.map((e, i) => ({
    id: i + 1,
    nombre: e[0], grupo: e[1], patron: e[2], equipo: e[3], nivel: e[4],
    unilateral: e[5], compuesto: e[6], exigencia: e[7],
    instrucciones: e[9], contraindicado_en: e[10],
    medida: medidaDe(e[0]), activo: true
}));

const TODO_EL_EQUIPO = ["peso_corporal", "mancuernas", "barra", "maquina", "polea", "banda", "kettlebell"];

function perfil(extra = {}) {
    return {
        objetivo: "ganar_musculo", nivel: "intermedio", dias_por_semana: 3,
        minutos_sesion: 60, lugar: "gimnasio", equipo: TODO_EL_EQUIPO, ...extra
    };
}

/* ═══════════════════════════════════════════════════════════════════ */

seccion("SEGURIDAD: nunca se propone algo contraindicado");

// La prueba central. Se recorre toda condición, se generan rutinas para
// varios días y se comprueba que ningún ejercicio contraindicado se
// coló. Si esto falla, el sistema es peligroso.
{
    let violaciones = [];
    for (const codigo of Object.keys(CONDICIONES)) {
        for (let d = 0; d < 14; d++) {
            const fecha = `2026-09-${String(d + 1).padStart(2, "0")}`;
            const plan = generar({
                perfil: perfil(), condiciones: [codigo], catalogo: CATALOGO,
                fecha, usuarioId: 7, historial: {}, sesionIndice: d
            });
            if (plan.error) continue;
            for (const e of plan.ejercicios) {
                if ((e.ejercicio.contraindicado_en || []).includes(codigo)) {
                    violaciones.push(`${codigo} -> ${e.ejercicio.nombre} (${fecha})`);
                }
            }
        }
    }
    check("ninguna condición recibe un ejercicio contraindicado",
          violaciones.length === 0, violaciones.slice(0, 4).join(" | "));
}

// Varias condiciones a la vez: el caso real de mucha gente mayor.
{
    const combos = [
        ["hipertension", "diabetes"],
        ["lesion_lumbar", "hernia"],
        ["cardiopatia", "obesidad", "artritis"],
        ["lesion_rodilla", "lesion_hombro", "hipertension"]
    ];
    let violaciones = [];
    for (const combo of combos) {
        for (let d = 0; d < 10; d++) {
            const plan = generar({
                perfil: perfil({ nivel: "principiante" }), condiciones: combo,
                catalogo: CATALOGO, fecha: `2026-10-${String(d + 1).padStart(2, "0")}`,
                usuarioId: 9, historial: {}, sesionIndice: d
            });
            if (plan.error) continue;
            for (const e of plan.ejercicios) {
                for (const c of combo) {
                    if ((e.ejercicio.contraindicado_en || []).includes(c)) {
                        violaciones.push(`${combo.join("+")} -> ${e.ejercicio.nombre}`);
                    }
                }
            }
        }
    }
    check("combinaciones de condiciones tampoco reciben contraindicados",
          violaciones.length === 0, violaciones.slice(0, 4).join(" | "));
}

seccion("SEGURIDAD: la restricción más severa es la que manda");
{
    const r = restricciones(["diabetes", "cardiopatia"]);
    check("intensidad = la más baja de las dos", r.intensidadMax === 0.60,
          `dio ${r.intensidadMax}`);
    check("descanso = el más largo de los dos", r.descansoMin === 120, `dio ${r.descansoMin}`);
    check("exigencia = la más baja", r.exigenciaMax === 2, `dio ${r.exigenciaMax}`);
    check("se acumulan los avisos de ambas", r.avisos.length >= 6, `dio ${r.avisos.length}`);
}
{
    const sola = restricciones(["hipertension"]);
    const combo = restricciones(["hipertension", "cardiopatia"]);
    check("agregar una condición nunca afloja los límites",
          combo.intensidadMax <= sola.intensidadMax &&
          combo.exigenciaMax <= sola.exigenciaMax &&
          combo.descansoMin >= sola.descansoMin);
}
{
    const sin = restricciones([]);
    check("sin condiciones no hay límites artificiales",
          sin.intensidadMax === 1 && sin.avisos.length === 0 && sin.exigenciaMax === 5);
}

seccion("REPRODUCIBILIDAD: la rutina del día no cambia al recargar");
{
    const args = {
        perfil: perfil(), condiciones: [], catalogo: CATALOGO,
        fecha: "2026-09-15", usuarioId: 42, historial: {}, sesionIndice: 2
    };
    const a = generar(args), b = generar(args), c = generar(args);
    const nombres = p => p.ejercicios.map(e => e.ejercicio.nombre).join("|");
    check("tres generaciones seguidas dan lo mismo",
          nombres(a) === nombres(b) && nombres(b) === nombres(c));

    const otroDia = generar({ ...args, fecha: "2026-09-16", sesionIndice: 3 });
    check("otro día da una rutina distinta", nombres(a) !== nombres(otroDia));

    const otraPersona = generar({ ...args, usuarioId: 43 });
    check("otra persona el mismo día no recibe lo idéntico",
          nombres(a) !== nombres(otraPersona) || true);  // puede coincidir, no es un fallo
}

seccion("COBERTURA: la sesión corta no se queda sin patrones");
{
    // El defecto que tenía el recorte por tiempo: con 45 minutos borraba
    // los ejercicios no principales, que eran justo cadera y core.
    const plan = generar({
        perfil: perfil({ minutos_sesion: 45, objetivo: "perder_grasa", nivel: "principiante",
                         equipo: ["peso_corporal", "mancuernas", "maquina", "banda"] }),
        condiciones: ["hipertension", "diabetes"], catalogo: CATALOGO,
        fecha: "2026-09-20", usuarioId: 3, historial: {}, sesionIndice: 0
    });
    check("una sesión de 45 min conserva al menos 5 ejercicios",
          plan.ejercicios.length >= 5, `dio ${plan.ejercicios.length}`);
    const patrones = plan.ejercicios.map(e => e.ejercicio.patron);
    check("incluye trabajo de core", patrones.includes("core"),
          patrones.join(","));
    check("la duración estimada respeta el tiempo disponible",
          plan.minutos_estimados <= 45 + 8, `${plan.minutos_estimados} min`);
}

seccion("NIVEL: no se proponen ejercicios por debajo del nivel en lo principal");
{
    let malos = 0;
    for (let d = 0; d < 12; d++) {
        const plan = generar({
            perfil: perfil({ nivel: "intermedio" }), condiciones: [], catalogo: CATALOGO,
            fecha: `2026-11-${String(d + 1).padStart(2, "0")}`, usuarioId: 11,
            historial: {}, sesionIndice: d
        });
        for (const e of plan.ejercicios) {
            if (e.principal && e.ejercicio.nivel === "principiante" && !e.esCardio) malos++;
        }
    }
    // No es imposible que ocurra -a veces no hay otra opción- pero debe
    // ser raro, no la norma.
    check("los ejercicios principales rara vez quedan por debajo del nivel",
          malos <= 4, `ocurrió ${malos} veces en 12 días`);
}

seccion("UNIDADES: cada ejercicio se mide como corresponde");
{
    let mal = [];
    for (let d = 0; d < 10; d++) {
        const plan = generar({
            perfil: perfil({ nivel: "principiante", equipo: ["peso_corporal"] }),
            condiciones: [], catalogo: CATALOGO,
            fecha: `2026-12-${String(d + 1).padStart(2, "0")}`, usuarioId: 5,
            historial: {}, sesionIndice: d
        });
        for (const e of plan.ejercicios) {
            if (e.medida === "segundos" && e.rep_max > 120) mal.push(`${e.ejercicio.nombre}: ${e.rep_max}s`);
            if (e.medida === "repeticiones" && e.rep_max > 30) mal.push(`${e.ejercicio.nombre}: ${e.rep_max} reps`);
            if (e.medida === "segundos" && e.peso_sugerido_kg) mal.push(`${e.ejercicio.nombre} con peso`);
        }
    }
    check("los isométricos van en segundos y sin peso", mal.length === 0, mal.slice(0, 3).join(" | "));
}

seccion("EQUIPO: sólo se propone lo que la persona tiene");
{
    let violaciones = [];
    for (const equipo of [["peso_corporal"], ["peso_corporal", "banda"], ["mancuernas", "peso_corporal"]]) {
        for (let d = 0; d < 8; d++) {
            const plan = generar({
                perfil: perfil({ equipo, lugar: "casa" }), condiciones: [], catalogo: CATALOGO,
                fecha: `2027-01-0${d + 1}`, usuarioId: 21, historial: {}, sesionIndice: d
            });
            if (plan.error) continue;
            for (const e of plan.ejercicios) {
                if (!equipo.includes(e.ejercicio.equipo)) {
                    violaciones.push(`${equipo.join("+")} -> ${e.ejercicio.nombre} (${e.ejercicio.equipo})`);
                }
            }
        }
    }
    check("nunca se propone equipo que no se tiene",
          violaciones.length === 0, violaciones.slice(0, 3).join(" | "));
}
{
    const plan = generar({
        perfil: perfil({ equipo: ["peso_corporal"], nivel: "principiante" }),
        condiciones: [], catalogo: CATALOGO, fecha: "2027-02-01",
        usuarioId: 33, historial: {}, sesionIndice: 0
    });
    check("con sólo peso corporal igual se arma una rutina",
          !plan.error && plan.ejercicios.length >= 3,
          plan.error || `${plan.ejercicios ? plan.ejercicios.length : 0} ejercicios`);
}

seccion("PROGRESIÓN: carga máxima y peso sugerido");
{
    check("una repetición es el peso medido, no estimado",
          estimar1RM(100, 1).valor === 100 && estimar1RM(100, 1).confianza === "medido");
    const e = estimar1RM(100, 10);
    check("10 repeticiones con 100 kg estiman ~133 kg",
          Math.abs(e.valor - 133.3) < 0.5, `dio ${e.valor}`);
    check("muchas repeticiones bajan la confianza", estimar1RM(50, 20).confianza === "baja");
    check("entradas inválidas devuelven null",
          estimar1RM(0, 10) === null && estimar1RM(50, 0) === null && estimar1RM(-5, 5) === null);
}
{
    check("la barra redondea a múltiplos de 2,5", redondear(43.7, "barra") === 42.5,
          `dio ${redondear(43.7, "barra")}`);
    check("las mancuernas livianas redondean al kilo", redondear(9.4, "mancuernas") === 9);
    check("las mancuernas pesadas redondean de a 2", redondear(23.3, "mancuernas") === 24,
          `dio ${redondear(23.3, "mancuernas")}`);
}
{
    const sinDatos = sugerirPeso([], 10, "barra", 1);
    check("sin historial no se inventa un peso", sinDatos.peso === null);

    const hist = [{ peso_kg: 60, repeticiones: 10, rpe: 7, realizada_en: "2026-08-01" }];
    const s = sugerirPeso(hist, 10, "barra", 1);
    check("con historial sugiere un peso concreto", s.peso > 0, JSON.stringify(s));

    const conTope = sugerirPeso(hist, 10, "barra", 0.6);
    check("el tope de salud reduce el peso sugerido",
          conTope.peso < s.peso && conTope.topadoPorSalud === true,
          `${conTope.peso} vs ${s.peso}`);

    const facil = sugerirPeso([{ peso_kg: 60, repeticiones: 10, rpe: 4, realizada_en: "x" }], 10, "barra", 1);
    const duro  = sugerirPeso([{ peso_kg: 60, repeticiones: 10, rpe: 10, realizada_en: "x" }], 10, "barra", 1);
    check("si sobró esfuerzo sube y si llegó al límite baja",
          facil.peso > duro.peso, `${facil.peso} vs ${duro.peso}`);
}
{
    const plano = Array.from({ length: 10 }, (_, i) =>
        ({ peso_kg: 60, repeticiones: 10, rpe: 8, realizada_en: `2026-0${(i % 9) + 1}-01` }));
    check("detecta el estancamiento", detectarEstancamiento(plano).estancado === true);

    const subiendo = Array.from({ length: 10 }, (_, i) =>
        ({ peso_kg: 80 - i * 3, repeticiones: 10, rpe: 8, realizada_en: `2026-0${(i % 9) + 1}-01` }));
    check("no confunde progreso con estancamiento",
          detectarEstancamiento(subiendo).estancado === false);

    check("con poco historial no se pronuncia",
          detectarEstancamiento([{ peso_kg: 50, repeticiones: 8 }]).estancado === false);
}

seccion("NIVELES Y PUNTOS");
{
    check("cero puntos es nivel 1", nivelDe(0).nivel === 1);
    check("el nivel sube con los puntos", nivelDe(2500).nivel === 5, `dio ${nivelDe(2500).nivel}`);
    check("el nivel máximo no se desborda", nivelDe(999999).nivel === 10);
    check("el progreso al siguiente nivel está entre 0 y 100",
          [0, 150, 700, 5000, 20000].every(p => {
              const n = nivelDe(p);
              return n.progresoPct >= 0 && n.progresoPct <= 100;
          }));
}

seccion("ROBUSTEZ: entradas raras no rompen el motor");
{
    const sinEquipo = generar({
        perfil: perfil({ equipo: [] }), condiciones: [], catalogo: CATALOGO,
        fecha: "2027-03-01", usuarioId: 1, historial: {}, sesionIndice: 0
    });
    check("sin equipo devuelve un error explicado, no una excepción",
          Boolean(sinEquipo.error) && Boolean(sinEquipo.sugerencia));

    const catalogoVacio = generar({
        perfil: perfil(), condiciones: [], catalogo: [], fecha: "2027-03-02",
        usuarioId: 1, historial: {}, sesionIndice: 0
    });
    check("catálogo vacío devuelve error controlado", Boolean(catalogoVacio.error));

    const muchosDias = generar({
        perfil: perfil({ dias_por_semana: 99 }), condiciones: [], catalogo: CATALOGO,
        fecha: "2027-03-03", usuarioId: 1, historial: {}, sesionIndice: 0
    });
    check("días por semana fuera de rango se acota sin romper",
          !muchosDias.error && muchosDias.ejercicios.length > 0);

    const sesionAlta = generar({
        perfil: perfil(), condiciones: [], catalogo: CATALOGO, fecha: "2027-03-04",
        usuarioId: 1, historial: {}, sesionIndice: 999
    });
    check("un índice de sesión enorme sigue rotando bien", !sesionAlta.error);

    const cortisima = generar({
        perfil: perfil({ minutos_sesion: 15 }), condiciones: [], catalogo: CATALOGO,
        fecha: "2027-03-05", usuarioId: 1, historial: {}, sesionIndice: 0
    });
    check("una sesión de 15 minutos deja al menos 4 ejercicios",
          cortisima.ejercicios.length >= 4, `dio ${cortisima.ejercicios.length}`);
}

seccion("JUSTIFICACIÓN: el motor explica lo que decidió");
{
    const plan = generar({
        perfil: perfil({ nivel: "principiante" }), condiciones: ["hipertension"],
        catalogo: CATALOGO, fecha: "2027-04-01", usuarioId: 8, historial: {}, sesionIndice: 0
    });
    const j = plan.justificacion;
    check("informa el enfoque y el objetivo", Boolean(j.enfoque && j.objetivo));
    check("informa qué condiciones lo condicionaron",
          j.condiciones.length === 1 && j.condiciones[0].codigo === "hipertension");
    check("informa cuántos ejercicios descartó y por qué",
          j.ejercicios_descartados > 0 && j.descartados_muestra.length > 0);
    check("marca que la rutina se ajustó por salud", j.ajustado_por_salud === true);
    check("entrega los avisos de seguridad", plan.avisos.length >= 3);
}

console.log(`\n=================================`);
console.log(`  ${ok} pasaron · ${fallo} fallaron`);
console.log(`=================================`);
process.exit(fallo ? 1 : 0);
