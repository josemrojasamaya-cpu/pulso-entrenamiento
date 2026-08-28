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

    // Punto de partida conocido.
    //
    // Sin esto, la suite dependía de lo que hubiera dejado la corrida
    // anterior: fallaba la primera vez y pasaba la segunda. Una prueba
    // que depende de su propio historial no sirve para decidir nada.
    await pedir(`/api/atleta/${id}/mesociclo`, token, { method: "DELETE" });
    await pedir(`/api/atleta/${id}/condiciones`, token, { method: "PUT", body: { condiciones: [] } });

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

                    // Una sesión ya empezada o completada es historia: se
                    // generó bajo las condiciones de entonces y no se
                    // puede reescribir sin borrar trabajo real. La
                    // invariante vale sobre lo que todavía se puede
                    // cambiar.
                    const yaVivida = r.d.rutina.estado === "completada" ||
                        r.d.rutina.ejercicios.some(e => (e.realizadas || []).length > 0);
                    if (yaVivida) continue;

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
        // Ver arriba: lo ya entrenado no se reescribe.
        if (r.d.rutina.estado === "completada" ||
            r.d.rutina.ejercicios.some(e => (e.realizadas || []).length > 0)) continue;
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

    seccion("ENTRENAR EN CASA");

    {
        await ponerPerfil({
            nivel: "intermedio", objetivo: "ganar_musculo",
            equipo: ["peso_corporal", "mancuernas", "barra", "maquina", "polea"],
            equipo_casa: ["peso_corporal"]
        });

        // Se pasa por casa y se vuelve, para forzar que la sesión se
        // rehaga: pedir el mismo lugar que ya tiene no regenera nada, y
        // sin regenerar la prueba estaría mirando una rutina vieja.
        await pedir(`/api/entrenamiento/dia/${dia(1)}?lugar=casa`, token);
        const gim = await pedir(`/api/entrenamiento/dia/${dia(1)}?lugar=gimnasio`, token);
        check("en el gimnasio sí se propone equipo",
              gim.status === 200 &&
              gim.d.rutina.ejercicios.some(e => e.equipo !== "peso_corporal"),
              gim.d.rutina ? gim.d.rutina.ejercicios.map(e => e.equipo).join(",") : "");

        const casa = await pedir(`/api/entrenamiento/dia/${dia(1)}?lugar=casa`, token);
        check("cambiar a casa rehace la sesión",
              casa.status === 200 && casa.d.rutina.lugar === "casa",
              `lugar: ${casa.d.rutina && casa.d.rutina.lugar}`);

        const conEquipo = (casa.d.rutina.ejercicios || []).filter(e => e.equipo !== "peso_corporal");
        check("en casa no se propone equipo que no está ahí",
              conEquipo.length === 0,
              conEquipo.map(e => `${e.nombre} (${e.equipo})`).join(", "));

        check("la sesión de casa igual queda completa",
              casa.d.rutina.ejercicios.length >= 4, `${casa.d.rutina.ejercicios.length} ejercicios`);

        // Y sobre HOY se comprueba lo contrario: con la sesión empezada
        // el sistema se niega a rehacerla, porque hay trabajo registrado
        // que se perdería.
        const hoyCasa = await pedir(`/api/entrenamiento/dia/${dia(0)}?lugar=casa`, token);
        const primero = (hoyCasa.d.rutina || casa.d.rutina).ejercicios[0];
        await pedir("/api/entrenamiento/series", token, {
            method: "POST",
            body: { id_local: `casa-${Date.now()}`, ejercicio_id: primero.ejercicio_id,
                    rutina_ejercicio_id: primero.id, serie_num: 1, repeticiones: 10, peso_kg: 0 }
        });
        const traba = await pedir(`/api/entrenamiento/dia/${dia(0)}?lugar=gimnasio`, token);
        check("con la sesión empezada no se puede cambiar de lugar",
              traba.status === 409 && traba.d.ya_empezada === true, `dio ${traba.status}`);
    }

    seccion("REGISTRO");

    {
        const marca = Date.now();
        const base = {
            nombre: "Persona De Prueba", email: `p${marca}@ejemplo.com`,
            username: `p${marca}`, password: "unaClaveLarga1", acepta_terminos: true
        };
        const crear = (extra) => fetch(B + "/api/registro", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...base, ...extra })
        }).then(async r => ({ status: r.status, d: await r.json().catch(() => ({})) }));

        const ok = await crear({ altura_cm: 170, peso_kg: 68 });
        check("se crea la cuenta", ok.status === 201 && Boolean(ok.d.token), ok.d.message || "");
        check("viene con código de invitación", Boolean(ok.d.usuario && ok.d.usuario.codigo_invitacion));
        check("empieza en el plan gratuito", ok.d.usuario && ok.d.usuario.plan === "gratis");

        const repetido = await crear({ username: `otro${marca}` });
        check("no deja repetir el correo", repetido.status === 409, `dio ${repetido.status}`);

        const sinTerminos = await crear({
            email: `x${marca}@e.com`, username: `x${marca}`, acepta_terminos: false });
        check("sin aceptar los términos no se crea", sinTerminos.status === 400);

        const claveCorta = await crear({
            email: `y${marca}@e.com`, username: `y${marca}`, password: "corta" });
        check("rechaza una contraseña de menos de ocho", claveCorta.status === 400);

        // El peso del registro tiene que quedar como primera medición: es
        // el punto de partida contra el que se compara todo lo demás.
        const nuevo = await pedir(`/api/atleta/${ok.d.usuario.id}/mediciones`, ok.d.token);
        check("el peso del registro queda como primera medición",
              nuevo.status === 200 && nuevo.d.length === 1 && Number(nuevo.d[0].peso_kg) === 68,
              JSON.stringify(nuevo.d).slice(0, 90));

        const porCorreo = await fetch(B + "/api/login", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: base.email, password: base.password })
        }).then(r => r.json());
        check("se puede entrar con el correo", Boolean(porCorreo.token));
    }

    seccion("CICLO DE UNA SESIÓN");

    // Esta sección existe porque el botón "Terminar sesión" nunca
    // funcionó: la consulta usaba el mismo parámetro en tres contextos y
    // PostgreSQL la rechazaba entera con un 500. Dos auditorías lo
    // pasaron por alto porque las dos probaron esa ruta con la red
    // caída, y ninguna suite recorría el ciclo completo.
    {
        const hoy = await pedir(`/api/entrenamiento/dia/${dia(0)}`, token);
        const rutinaId = hoy.d.rutina && hoy.d.rutina.id;
        check("hay una rutina para hoy", Boolean(rutinaId));

        for (const estado of ["en_curso", "completada"]) {
            const r = await pedir(`/api/entrenamiento/rutina/${rutinaId}/estado`, token, {
                method: "POST", body: { estado }
            });
            check(`marcar la sesión como "${estado}" responde 200`,
                  r.status === 200, `dio ${r.status}: ${r.d.message || ""}`);
        }

        const tras = await pedir(`/api/entrenamiento/dia/${dia(0)}`, token);
        check("el estado quedó guardado como completada",
              tras.d.rutina.estado === "completada", `quedó "${tras.d.rutina.estado}"`);
        check("y se registró la hora de cierre", Boolean(tras.d.rutina.terminada_en));

        const invalido = await pedir(`/api/entrenamiento/rutina/${rutinaId}/estado`, token, {
            method: "POST", body: { estado: "inventado" }
        });
        check("un estado inventado se rechaza", invalido.status === 400, `dio ${invalido.status}`);

        const ajeno = await pedir(`/api/entrenamiento/rutina/999999/estado`, token, {
            method: "POST", body: { estado: "completada" } });
        check("una rutina inexistente responde 404", ajeno.status === 404, `dio ${ajeno.status}`);

        // Volver a marcarla completada no debe otorgar puntos otra vez.
        const antes = (await pedir(`/api/progreso/${id}/resumen`, token)).d.nivel.puntos;
        await pedir(`/api/entrenamiento/rutina/${rutinaId}/estado`, token, {
            method: "POST", body: { estado: "completada" } });
        const despues = (await pedir(`/api/progreso/${id}/resumen`, token)).d.nivel.puntos;
        check("completar dos veces no duplica los puntos",
              antes === despues, `${antes} → ${despues}`);
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
