/**
 * pruebas/api.js — verifica el sistema montado, contra el servidor vivo.
 *
 * Existe porque una auditoría externa encontró tres fugas de seguridad
 * clínica que `pruebas/motor.js` no podía ver, y el motivo vale la pena
 * escribirlo:
 *
 * La prueba central de motor.js comprueba que ningún ejercicio cuyo
 * `contraindicado_en` incluya el código sea propuesto. Ese es EXACTAMENTE
 * el predicado que implementa el filtro, así que pasa por construcción:
 * es tautológica. Era ciega a `sinImpacto` (que se calculaba y nunca se
 * aplicaba), al descanso mínimo (que el multiplicador de accesorios
 * pisaba) y a las rutinas ya guardadas antes de declarar una condición.
 *
 * La prueba que sí sirve es una INVARIANTE, evaluada sobre lo que la API
 * realmente devuelve y contra TODAS las dimensiones de `restricciones()`,
 * no sólo la tabla de contraindicaciones:
 *
 *   Para toda condición, todo perfil y todo día, ningún ejercicio de la
 *   rutina servida viola ninguna restricción vigente.
 *
 * Uso:
 *   node app.js                        (en otra terminal)
 *   URL_BASE=http://localhost:3000 node pruebas/api.js
 */

const B = process.env.URL_BASE || "http://localhost:3000";
const CLAVE = process.env.CLAVE_DEMO || "demo1234";

let ok = 0, fallo = 0;
const check = (n, c, d = "") =>
    c ? (ok++, console.log(`  OK    ${n}`)) : (fallo++, console.log(`  FALLA ${n} ${d}`));
const seccion = t => console.log(`\n--- ${t} ---`);

async function login(u) {
    const r = await fetch(B + "/api/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u, password: CLAVE })
    });
    const d = await r.json();
    if (!d.token) throw new Error(`No se pudo entrar como "${u}": ${d.message || r.status}`);
    return d.token;
}

async function pedir(ruta, token, o = {}) {
    const r = await fetch(B + ruta, {
        method: o.method || "GET",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: o.body ? JSON.stringify(o.body) : undefined
    });
    return { status: r.status, d: await r.json().catch(() => ({})) };
}

const dia = (n = 0) => {
    const d = new Date(); d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
};

// Se importan las reglas para comprobar la rutina servida contra ellas.
const { restricciones, esApto, CONDICIONES } = require("../lib/salud");

(async () => {
    const token = await login("atleta");
    const id = (await pedir("/api/yo", token)).d.usuario.id;

    const ponerCondiciones = async (lista) => {
        await pedir(`/api/atleta/${id}/condiciones`, token, {
            method: "PUT", body: { condiciones: lista }
        });
        // Se pide el día de hoy para forzar la revalidación de lo guardado.
        await pedir(`/api/entrenamiento/dia/${dia(0)}`, token);
    };

    const ponerPerfil = async (extra) => {
        await pedir(`/api/atleta/${id}/perfil`, token, {
            method: "PUT",
            body: {
                objetivo: "ganar_musculo", nivel: "intermedio",
                dias_por_semana: 4, minutos_sesion: 60,
                equipo: ["peso_corporal", "mancuernas", "barra", "maquina", "polea", "banda", "kettlebell"],
                ...extra
            }
        });
    };

    /* ═══════════════════════════════════════════════════════════════ */
    seccion("INVARIANTE: la rutina SERVIDA nunca viola ninguna restricción");

    const codigos = Object.keys(CONDICIONES);
    const perfiles = [
        { nivel: "principiante", objetivo: "salud",         dias_por_semana: 3, minutos_sesion: 45 },
        { nivel: "intermedio",   objetivo: "ganar_musculo", dias_por_semana: 4, minutos_sesion: 60 },
        { nivel: "avanzado",     objetivo: "fuerza",        dias_por_semana: 5, minutos_sesion: 75 },
        { nivel: "principiante", objetivo: "perder_grasa",  dias_por_semana: 7, minutos_sesion: 30 }
    ];

    const violaciones = [];
    let rutinasRevisadas = 0;

    for (const perfil of perfiles) {
        await ponerPerfil(perfil);

        for (const codigo of codigos) {
            for (const severidad of ["leve", "alta"]) {
                await ponerCondiciones([{ codigo, severidad }]);
                const limites = restricciones([{ codigo, severidad }]);

                for (let d = 0; d < 4; d++) {
                    const r = await pedir(`/api/entrenamiento/dia/${dia(d)}`, token);
                    if (r.status !== 200 || !r.d.rutina) continue;
                    rutinasRevisadas++;

                    for (const e of r.d.rutina.ejercicios) {
                        const contexto = `${codigo}/${severidad} ${perfil.nivel} d${d} → ${e.nombre}`;

                        // 1. contraindicación declarada
                        if ((e.contraindicado_en || []).includes(codigo)) {
                            violaciones.push(`${contexto}: contraindicado`);
                        }
                        // 2. impacto
                        if (limites.sinImpacto && e.impacto) {
                            violaciones.push(`${contexto}: de impacto`);
                        }
                        // 3. boca arriba
                        if (limites.evitarSupino && e.supino) {
                            violaciones.push(`${contexto}: boca arriba`);
                        }
                        // 4. patrón excluido
                        if (limites.evitarPatrones.includes(e.patron)) {
                            violaciones.push(`${contexto}: patrón ${e.patron}`);
                        }
                        // 5. exigencia sistémica
                        if (e.exigencia > limites.exigenciaMax) {
                            violaciones.push(`${contexto}: exigencia ${e.exigencia} > ${limites.exigenciaMax}`);
                        }
                        // 6. descanso mínimo
                        if (e.descanso_seg > 0 && e.descanso_seg < limites.descansoMin) {
                            violaciones.push(`${contexto}: descanso ${e.descanso_seg}s < ${limites.descansoMin}s`);
                        }
                        // 7. rango de repeticiones (sólo donde aplica)
                        if (e.medida === "repeticiones" && e.rep_min < limites.repMin) {
                            violaciones.push(`${contexto}: ${e.rep_min} reps < ${limites.repMin}`);
                        }
                        // 8. coherencia con el veredicto de esApto
                        if (!esApto(e, [codigo], limites).apto) {
                            violaciones.push(`${contexto}: esApto lo rechaza`);
                        }
                    }
                }
            }
        }
    }

    check(`ninguna de las ${rutinasRevisadas} rutinas servidas viola una restricción`,
          violaciones.length === 0,
          "\n     " + violaciones.slice(0, 8).join("\n     ") +
          (violaciones.length > 8 ? `\n     …y ${violaciones.length - 8} más` : ""));

    /* ═══════════════════════════════════════════════════════════════ */
    seccion("REVALIDACIÓN: declarar una condición corrige lo ya guardado");

    await ponerPerfil({ nivel: "intermedio", objetivo: "ganar_musculo" });
    await ponerCondiciones([]);
    await pedir("/api/entrenamiento/paquete?dias=7", token);   // genera y guarda 7 días

    await ponerCondiciones([
        { codigo: "embarazo", severidad: "moderada" },
        { codigo: "lesion_lumbar", severidad: "alta" }
    ]);

    const limitesTras = restricciones([
        { codigo: "embarazo", severidad: "moderada" },
        { codigo: "lesion_lumbar", severidad: "alta" }
    ]);
    const tras = [];
    for (let d = 0; d < 7; d++) {
        const r = await pedir(`/api/entrenamiento/dia/${dia(d)}`, token);
        if (!r.d.rutina) continue;
        for (const e of r.d.rutina.ejercicios) {
            if (!esApto(e, ["embarazo", "lesion_lumbar"], limitesTras).apto) {
                tras.push(`${dia(d)} ${e.nombre}`);
            }
        }
    }
    check("las 7 rutinas ya guardadas dejan de servir ejercicios contraindicados",
          tras.length === 0, tras.slice(0, 5).join(" | "));

    /* ═══════════════════════════════════════════════════════════════ */
    seccion("AVISOS: llegan siempre, no sólo al generar");

    await ponerCondiciones([{ codigo: "hipertension", severidad: "moderada" }]);
    const a1 = await pedir(`/api/entrenamiento/dia/${dia(0)}`, token);
    const a2 = await pedir(`/api/entrenamiento/dia/${dia(0)}`, token);
    check("primera consulta trae avisos", (a1.d.avisos || []).length > 0);
    check("segunda consulta del mismo día también",
          (a2.d.avisos || []).length > 0, `trajo ${(a2.d.avisos || []).length}`);

    /* ═══════════════════════════════════════════════════════════════ */
    seccion("SINCRONIZACIÓN: un registro malo no arrastra a los buenos");

    await ponerCondiciones([]);
    const marca = Date.now();
    const lote = await pedir("/api/entrenamiento/series", token, {
        method: "POST", body: { series: [
            { id_local: `p-a-${marca}`, ejercicio_id: 1, serie_num: 1, repeticiones: 10, peso_kg: 50, rpe: 8 },
            { id_local: `p-b-${marca}`, ejercicio_id: 1, serie_num: 2, repeticiones: 10, peso_kg: 50, rpe: 8 },
            { id_local: `p-c-${marca}`, ejercicio_id: 1, serie_num: 1e30, repeticiones: 10, peso_kg: 50 },
            { id_local: "x".repeat(300), ejercicio_id: 1, serie_num: 1, repeticiones: 8, peso_kg: 40 },
            { id_local: `p-d-${marca}`, ejercicio_id: 1, serie_num: 3, repeticiones: 10, peso_kg: 50, realizada_en: "ayer" }
        ] }
    });
    check("responde 201, no 500", lote.status === 201, `dio ${lote.status}`);
    check("guarda las 2 válidas y rechaza las 3 malas",
          lote.d.guardadas === 2 && lote.d.rechazadas.length === 3,
          JSON.stringify({ guardadas: lote.d.guardadas, rechazadas: lote.d.rechazadas.length }));

    const repetido = await pedir("/api/entrenamiento/series", token, {
        method: "POST", body: { series: [
            { id_local: `p-a-${marca}`, ejercicio_id: 1, serie_num: 1, repeticiones: 10, peso_kg: 50, rpe: 8 }
        ] }
    });
    check("reenviar lo mismo no duplica", repetido.d.duplicadas === 1, JSON.stringify(repetido.d));

    seccion("VALIDACIÓN DE ENTRADA");

    const errata = await pedir("/api/entrenamiento/series", token, {
        method: "POST",
        body: { id_local: `e-${marca}`, ejercicio_id: 1, serie_num: 1, repeticiones: 100, peso_kg: 60 }
    });
    check("100 repeticiones con 60 kg se rechaza (cero de más al teclear)",
          (errata.d.rechazadas || []).length === 1);

    const sinPeso = await pedir("/api/entrenamiento/series", token, {
        method: "POST",
        body: { id_local: `s-${marca}`, ejercicio_id: 44, serie_num: 1, repeticiones: 100, peso_kg: 0 }
    });
    check("100 repeticiones SIN peso sí se acepta",
          sinPeso.d.guardadas === 1 || sinPeso.d.duplicadas === 1,
          JSON.stringify(sinPeso.d).slice(0, 100));

    for (const [f, esperado] of [["2026-13-45", 400], ["1999-12-31", 400], ["no-es-fecha", 400]]) {
        const r = await pedir(`/api/entrenamiento/dia/${f}`, token);
        check(`fecha "${f}" responde ${esperado}`, r.status === esperado, `dio ${r.status}`);
    }

    seccion("PERMISOS");

    const otro = await login("hipertenso");
    const otroId = (await pedir("/api/yo", otro)).d.usuario.id;

    for (const ruta of [
        `/api/atleta/${otroId}/perfil`,
        `/api/atleta/${otroId}/mediciones`,
        `/api/progreso/${otroId}/resumen`,
        `/api/entrenamiento/dia/${dia(0)}?atleta_id=${otroId}`
    ]) {
        const r = await pedir(ruta, token);
        check(`sin permiso: ${ruta.replace(/\/api/, "")} → 404`, r.status === 404, `dio ${r.status}`);
    }

    const ranking = await pedir("/api/progreso/mis-atletas", token);
    check("un atleta no lista atletas ajenos", ranking.status === 403, `dio ${ranking.status}`);

    // Se deja la cuenta como estaba.
    await ponerCondiciones([]);
    await ponerPerfil({ nivel: "intermedio", objetivo: "ganar_musculo" });

    console.log(`\n=================================`);
    console.log(`  ${ok} pasaron · ${fallo} fallaron`);
    console.log(`=================================`);
    process.exit(fallo ? 1 : 0);
})().catch(e => {
    console.error("\nNo se pudieron correr las pruebas:", e.message);
    console.error(`¿Está el servidor levantado en ${B}?`);
    process.exit(1);
});
