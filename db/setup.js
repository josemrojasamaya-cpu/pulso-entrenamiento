/**
 * db/setup.js — deja la base lista y con un gimnasio de ejemplo dentro.
 *
 * Los datos de ejemplo no son adorno: sin meses de historial no se puede
 * mostrar una curva de progreso, ni comparar medidas corporales, ni
 * sugerir un peso —que se calcula justamente a partir de lo registrado
 * antes—. Una base vacía haría parecer que el sistema no hace nada.
 *
 * Idempotente: correrlo dos veces no duplica nada.
 */

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const pool = require("../config/db");
const { EJERCICIOS, enlaceVideo, medidaDe, POR_TIEMPO, POR_MINUTOS,
        DE_IMPACTO, EN_SUPINO } = require("./ejercicios");
const { estimar1RM } = require("../lib/progresion");

// Cuentas de demostración: se muestran en la pantalla de acceso a
// propósito, para que cualquiera pueda recorrer el sistema. Cada una
// existe para enseñar algo distinto.
const CUENTAS = [
    { u: "demo",      c: "demo1234", rol: "entrenador", nombre: "Marco Herrera",
      nota: "Entrenador: ve a todos sus atletas" },
    { u: "atleta",    c: "demo1234", rol: "atleta", nombre: "Kevin Solano",
      nota: "Sin condiciones: progresión normal" },
    { u: "hipertenso", c: "demo1234", rol: "atleta", nombre: "Rosa Jiménez",
      nota: "Hipertensión y diabetes: rutina adaptada" },
    { u: "lesionado", c: "demo1234", rol: "atleta", nombre: "Diego Fallas",
      nota: "Lesión lumbar: sin carga sobre la columna" }
];

const PERFILES = {
    "Kevin Solano": {
        nac: "1997-05-14", sexo: "Masculino", altura: 176,
        objetivo: "ganar_musculo", nivel: "intermedio", dias: 4, minutos: 60,
        lugar: "gimnasio",
        equipo: ["peso_corporal", "mancuernas", "barra", "maquina", "polea", "banda"],
        condiciones: []
    },
    "Rosa Jiménez": {
        nac: "1971-09-02", sexo: "Femenino", altura: 162,
        objetivo: "perder_grasa", nivel: "principiante", dias: 3, minutos: 45,
        lugar: "gimnasio",
        equipo: ["peso_corporal", "mancuernas", "maquina", "banda"],
        condiciones: [
            { codigo: "hipertension", detalle: "Diagnosticada en 2022, en tratamiento.", severidad: "moderada" },
            { codigo: "diabetes",     detalle: "Tipo 2, controlada con metformina.",     severidad: "moderada" }
        ]
    },
    "Diego Fallas": {
        nac: "1989-01-23", sexo: "Masculino", altura: 181,
        objetivo: "salud", nivel: "intermedio", dias: 3, minutos: 50,
        lugar: "mixto",
        equipo: ["peso_corporal", "mancuernas", "banda", "maquina"],
        condiciones: [
            { codigo: "lesion_lumbar", detalle: "Hernia L4-L5 en 2024, sin cirugía.", severidad: "alta" }
        ]
    },
    "Marco Herrera": {
        nac: "1985-03-30", sexo: "Masculino", altura: 178,
        objetivo: "fuerza", nivel: "avanzado", dias: 5, minutos: 75,
        lugar: "gimnasio",
        equipo: ["peso_corporal", "mancuernas", "barra", "maquina", "polea", "kettlebell", "banda"],
        condiciones: []
    }
};

/**
 * Mediciones de ejemplo: cuatro tomas a lo largo de cinco meses.
 * `dias` es cuántos días atrás, para que el historial no envejezca.
 */
const MEDICIONES = {
    "Kevin Solano": [
        { dias: 150, peso: 71.2, grasa: 18.4, musculo: 32.1, cuello: 37.0, hombros: 112, pecho: 96,
          bi: 32.0, bd: 32.4, ai: 27.0, ad: 27.2, cintura: 81, abdomen: 84, cadera: 94,
          mi: 54.0, md: 54.5, pi: 36.0, pd: 36.2 },
        { dias: 105, peso: 72.6, grasa: 17.1, musculo: 33.4, cuello: 37.5, hombros: 114, pecho: 98,
          bi: 33.1, bd: 33.4, ai: 27.6, ad: 27.8, cintura: 80, abdomen: 83, cadera: 94,
          mi: 55.2, md: 55.6, pi: 36.5, pd: 36.6 },
        { dias: 58,  peso: 74.1, grasa: 16.2, musculo: 34.6, cuello: 38.0, hombros: 116, pecho: 100,
          bi: 34.0, bd: 34.2, ai: 28.1, ad: 28.3, cintura: 79, abdomen: 82, cadera: 95,
          mi: 56.4, md: 56.7, pi: 37.0, pd: 37.1 },
        { dias: 12,  peso: 75.3, grasa: 15.4, musculo: 35.8, cuello: 38.4, hombros: 118, pecho: 102,
          bi: 34.8, bd: 35.0, ai: 28.6, ad: 28.7, cintura: 78, abdomen: 81, cadera: 95,
          mi: 57.3, md: 57.5, pi: 37.4, pd: 37.5 }
    ],
    "Rosa Jiménez": [
        { dias: 120, peso: 84.6, grasa: 38.2, musculo: 24.1, cuello: 35.0, hombros: 106, pecho: 102,
          bi: 30.5, bd: 30.7, ai: 25.0, ad: 25.1, cintura: 96, abdomen: 101, cadera: 112,
          mi: 60.0, md: 60.3, pi: 37.0, pd: 37.1 },
        { dias: 75,  peso: 82.1, grasa: 36.4, musculo: 24.4, cuello: 34.6, hombros: 105, pecho: 100,
          bi: 30.3, bd: 30.5, ai: 24.9, ad: 25.0, cintura: 93, abdomen: 98, cadera: 110,
          mi: 59.2, md: 59.4, pi: 36.8, pd: 36.9 },
        { dias: 30,  peso: 79.4, grasa: 34.1, musculo: 24.8, cuello: 34.2, hombros: 104, pecho: 98,
          bi: 30.2, bd: 30.4, ai: 24.8, ad: 24.9, cintura: 89, abdomen: 94, cadera: 107,
          mi: 58.1, md: 58.3, pi: 36.5, pd: 36.6 },
        { dias: 5,   peso: 78.0, grasa: 32.8, musculo: 25.1, cuello: 34.0, hombros: 104, pecho: 97,
          bi: 30.2, bd: 30.3, ai: 24.8, ad: 24.9, cintura: 87, abdomen: 92, cadera: 106,
          mi: 57.6, md: 57.8, pi: 36.4, pd: 36.5 }
    ],
    "Diego Fallas": [
        { dias: 90, peso: 88.4, grasa: 24.0, musculo: 36.0, cuello: 40.0, hombros: 120, pecho: 106,
          bi: 35.0, bd: 35.4, ai: 29.0, ad: 29.2, cintura: 92, abdomen: 96, cadera: 101,
          mi: 60.0, md: 59.0, pi: 39.0, pd: 38.6 },
        { dias: 40, peso: 87.1, grasa: 22.8, musculo: 36.6, cuello: 40.0, hombros: 121, pecho: 107,
          bi: 35.4, bd: 35.6, ai: 29.2, ad: 29.3, cintura: 90, abdomen: 94, cadera: 101,
          mi: 60.4, md: 60.0, pi: 39.2, pd: 39.0 },
        { dias: 8,  peso: 86.2, grasa: 21.9, musculo: 37.1, cuello: 40.2, hombros: 122, pecho: 108,
          bi: 35.7, bd: 35.8, ai: 29.4, ad: 29.4, cintura: 89, abdomen: 92, cadera: 100,
          mi: 60.8, md: 60.6, pi: 39.4, pd: 39.3 }
    ]
};

/**
 * Historial de entrenamiento.
 *
 * Se generan series reales con progresión creciente para que el motor
 * tenga de dónde calcular el peso sugerido y las curvas tengan forma.
 * Los pesos suben con un poco de ruido, porque una progresión
 * perfectamente lineal se ve falsa y además nunca ocurre.
 */
const PROGRESIONES = {
    "Kevin Solano": [
        { ejercicio: "Press de banca con barra",     inicio: 50, incremento: 0.55, reps: [10, 8, 8] },
        { ejercicio: "Remo con barra",               inicio: 45, incremento: 0.50, reps: [10, 10, 8] },
        { ejercicio: "Sentadilla goblet",            inicio: 20, incremento: 0.35, reps: [12, 12, 10] },
        { ejercicio: "Press de hombros con mancuernas", inicio: 14, incremento: 0.22, reps: [10, 10, 8] },
        { ejercicio: "Curl con mancuernas",          inicio: 10, incremento: 0.16, reps: [12, 12, 10] },
        { ejercicio: "Jalón al pecho en polea",      inicio: 40, incremento: 0.45, reps: [12, 10, 10] }
    ],
    "Rosa Jiménez": [
        { ejercicio: "Press en máquina de pecho",    inicio: 15, incremento: 0.22, reps: [15, 14, 12] },
        { ejercicio: "Remo en máquina sentado",      inicio: 18, incremento: 0.25, reps: [15, 14, 12] },
        { ejercicio: "Sentadilla goblet",            inicio: 6,  incremento: 0.14, reps: [15, 15, 12] },
        { ejercicio: "Elevaciones laterales",        inicio: 3,  incremento: 0.06, reps: [15, 15, 15] },
        { ejercicio: "Puente de glúteos",            inicio: 0,  incremento: 0,    reps: [15, 15, 15] }
    ],
    "Diego Fallas": [
        { ejercicio: "Press de banca con mancuernas", inicio: 20, incremento: 0.30, reps: [12, 12, 10] },
        { ejercicio: "Remo con mancuerna a una mano", inicio: 22, incremento: 0.32, reps: [12, 12, 10] },
        { ejercicio: "Sentadilla goblet",             inicio: 14, incremento: 0.25, reps: [12, 12, 12] },
        { ejercicio: "Plancha abdominal",             inicio: 0,  incremento: 0,    reps: [45, 45, 40] },
        { ejercicio: "Bird dog",                      inicio: 0,  incremento: 0,    reps: [12, 12, 12] }
    ]
};


async function main({ cerrarPool = true, silencioso = false } = {}) {
    const log = silencioso ? () => {} : console.log;

    try {
        // ── 1. Esquema ────────────────────────────────────────────
        const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
        await pool.query(sql);
        log("  esquema aplicado");

        // Deja el search_path grabado en la base, para que valga incluso
        // si la conexión llega por un intermediario que descarta los
        // parámetros del saludo inicial.
        if (await pool.fijarEsquemaEnLaBase()) log("  esquema fijado en la base");

        // ── 2. Catálogo de ejercicios ─────────────────────────────
        let nuevosEj = 0;
        for (const e of EJERCICIOS) {
            const [nombre, grupo, patron, equipo, nivel, unilateral, compuesto,
                   exigencia, termino, instrucciones, contra] = e;
            const r = await pool.query(
                `INSERT INTO ejercicios
                   (nombre, grupo, patron, equipo, nivel, unilateral, compuesto,
                    exigencia, video_url, instrucciones, contraindicado_en, medida)
                 SELECT $1::varchar,$2::varchar,$3::varchar,$4::varchar,$5::varchar,
                        $6::boolean,$7::boolean,$8::int,$9::varchar,$10::text,$11::jsonb,$12::varchar
                 WHERE NOT EXISTS (SELECT 1 FROM ejercicios WHERE nombre = $1::varchar)
                 RETURNING id`,
                [nombre, grupo, patron, equipo, nivel, unilateral, compuesto,
                 exigencia, enlaceVideo(termino), instrucciones, JSON.stringify(contra),
                 medidaDe(nombre)]
            );
            if (r.rowCount) nuevosEj++;
        }

        // Estas marcas se aplican también sobre bases ya instaladas, donde
        // las columnas nacieron con su valor por omisión. Corren siempre:
        // son la fuente de verdad del catálogo.
        await pool.query(
            "UPDATE ejercicios SET medida = 'segundos' WHERE nombre = ANY($1::varchar[]) AND medida <> 'segundos'",
            [[...POR_TIEMPO]]
        );
        await pool.query(
            "UPDATE ejercicios SET medida = 'minutos' WHERE nombre = ANY($1::varchar[]) AND medida <> 'minutos'",
            [[...POR_MINUTOS]]
        );
        await pool.query("UPDATE ejercicios SET impacto = (nombre = ANY($1::varchar[]))", [[...DE_IMPACTO]]);
        await pool.query("UPDATE ejercicios SET supino  = (nombre = ANY($1::varchar[]))", [[...EN_SUPINO]]);

        // Las contraindicaciones y la clasificación del catálogo se
        // reescriben en cada instalación: una revisión del catálogo tiene
        // que llegar a las bases que ya existen, no sólo a las nuevas.
        for (const e of EJERCICIOS) {
            await pool.query(
                `UPDATE ejercicios
                    SET contraindicado_en = $2::jsonb, grupo = $3, patron = $4, exigencia = $5
                  WHERE nombre = $1::varchar`,
                [e[0], JSON.stringify(e[10]), e[1], e[2], e[7]]
            );
        }
        log(`  ejercicios: ${nuevosEj} nuevos (${EJERCICIOS.length} en el catálogo)`);

        // ── 3. Cuentas ────────────────────────────────────────────
        const idUsr = {};
        for (const c of CUENTAS) {
            const existe = await pool.query(
                "SELECT id FROM usuarios WHERE LOWER(username) = LOWER($1)", [c.u]
            );
            if (existe.rowCount) { idUsr[c.nombre] = existe.rows[0].id; continue; }

            const r = await pool.query(
                `INSERT INTO usuarios (username, password_hash, rol, nombre)
                 VALUES ($1,$2,$3,$4) RETURNING id`,
                [c.u, await bcrypt.hash(c.c, 10), c.rol, c.nombre]
            );
            idUsr[c.nombre] = r.rows[0].id;
        }

        // Los atletas quedan a cargo del entrenador de demostración.
        const entrenadorId = idUsr["Marco Herrera"];
        await pool.query(
            "UPDATE usuarios SET entrenador_id = $1 WHERE rol = 'atleta' AND entrenador_id IS NULL",
            [entrenadorId]
        );
        log(`  cuentas: ${Object.keys(idUsr).length}`);

        // ── 4. Perfiles y condiciones ─────────────────────────────
        for (const [nombre, p] of Object.entries(PERFILES)) {
            const id = idUsr[nombre];
            if (!id) continue;

            await pool.query(
                `INSERT INTO perfiles
                   (usuario_id, fecha_nacimiento, sexo, altura_cm, objetivo, nivel,
                    dias_por_semana, minutos_sesion, lugar, equipo)
                 VALUES ($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
                 ON CONFLICT (usuario_id) DO NOTHING`,
                [id, p.nac, p.sexo, p.altura, p.objetivo, p.nivel,
                 p.dias, p.minutos, p.lugar, JSON.stringify(p.equipo)]
            );

            for (const c of p.condiciones) {
                await pool.query(
                    `INSERT INTO condiciones (usuario_id, codigo, detalle, severidad)
                     VALUES ($1,$2,$3,$4) ON CONFLICT (usuario_id, codigo) DO NOTHING`,
                    [id, c.codigo, c.detalle, c.severidad]
                );
            }
        }
        log("  perfiles y condiciones cargados");

        // ── 5. Mediciones ─────────────────────────────────────────
        const yaMedido = await pool.query("SELECT COUNT(*)::int n FROM mediciones");
        if (yaMedido.rows[0].n === 0) {
            let nMed = 0;
            for (const [nombre, tomas] of Object.entries(MEDICIONES)) {
                const id = idUsr[nombre];
                if (!id) continue;
                for (const m of tomas) {
                    await pool.query(
                        `INSERT INTO mediciones
                           (usuario_id, fecha, peso_kg, grasa_pct, musculo_kg,
                            cuello, hombros, pecho, biceps_izq, biceps_der,
                            antebrazo_izq, antebrazo_der, cintura, abdomen, cadera,
                            muslo_izq, muslo_der, pantorrilla_izq, pantorrilla_der)
                         VALUES ($1, CURRENT_DATE - $2::int, $3,$4,$5,$6,$7,$8,$9,$10,
                                 $11,$12,$13,$14,$15,$16,$17,$18,$19)
                         ON CONFLICT (usuario_id, fecha) DO NOTHING`,
                        [id, m.dias, m.peso, m.grasa, m.musculo, m.cuello, m.hombros, m.pecho,
                         m.bi, m.bd, m.ai, m.ad, m.cintura, m.abdomen, m.cadera,
                         m.mi, m.md, m.pi, m.pd]
                    );
                    nMed++;
                }
            }
            log(`  mediciones: ${nMed}`);
        }

        // ── 6. Historial de entrenamiento ─────────────────────────
        const yaSeries = await pool.query("SELECT COUNT(*)::int n FROM series");
        if (yaSeries.rows[0].n === 0) {
            const ejIds = {};
            const todos = await pool.query("SELECT id, nombre, equipo FROM ejercicios");
            todos.rows.forEach(e => { ejIds[e.nombre] = e; });

            // Ruido reproducible: sin él la progresión sale una recta
            // perfecta, que no se parece a ningún entrenamiento real.
            let semilla = 12345;
            const azar = () => {
                semilla = (semilla * 1103515245 + 12345) & 0x7fffffff;
                return semilla / 0x7fffffff;
            };

            let nSeries = 0;
            const SESIONES = 16;   // unas 5 semanas de historial

            for (const [nombre, plan] of Object.entries(PROGRESIONES)) {
                const usuarioId = idUsr[nombre];
                if (!usuarioId) continue;

                for (let sesion = 0; sesion < SESIONES; sesion++) {
                    // Una sesión cada dos o tres días, hacia atrás.
                    const diasAtras = (SESIONES - sesion) * 3 - 1;

                    for (const p of plan) {
                        const ej = ejIds[p.ejercicio];
                        if (!ej) continue;

                        const base = p.inicio + p.incremento * sesion;
                        for (let i = 0; i < p.reps.length; i++) {
                            // Las series posteriores caen un poco: la fatiga existe.
                            const peso = p.inicio === 0 ? 0
                                : Math.max(0, Math.round((base * (1 - i * 0.04) + (azar() - 0.5) * 1.5) * 2) / 2);
                            const reps = Math.max(1, p.reps[i] - (azar() < 0.25 ? 1 : 0));
                            const rpe = Math.round((6.5 + i * 0.7 + azar() * 0.8) * 2) / 2;

                            await pool.query(
                                `INSERT INTO series
                                   (id_local, usuario_id, ejercicio_id, serie_num,
                                    repeticiones, peso_kg, rpe, realizada_en)
                                 VALUES ($1,$2,$3,$4,$5,$6,$7, NOW() - ($8::int || ' days')::interval)
                                 ON CONFLICT (usuario_id, id_local) DO NOTHING`,
                                [`seed-${usuarioId}-${sesion}-${ej.id}-${i}`, usuarioId, ej.id,
                                 i + 1, reps, peso, Math.min(rpe, 10), diasAtras]
                            );
                            nSeries++;
                        }
                    }
                }
            }
            log(`  series de historial: ${nSeries}`);

            // Marcas derivadas del historial recién creado.
            const combinaciones = await pool.query(
                "SELECT DISTINCT usuario_id, ejercicio_id FROM series WHERE peso_kg > 0"
            );
            for (const c of combinaciones.rows) {
                const s = await pool.query(
                    `SELECT peso_kg, repeticiones FROM series
                      WHERE usuario_id = $1 AND ejercicio_id = $2 AND peso_kg > 0`,
                    [c.usuario_id, c.ejercicio_id]
                );
                let m1 = 0, mp = 0, mr = 0;
                for (const x of s.rows) {
                    const e = estimar1RM(x.peso_kg, x.repeticiones);
                    if (e && e.valor > m1) m1 = e.valor;
                    if (Number(x.peso_kg) > mp) { mp = Number(x.peso_kg); mr = x.repeticiones; }
                }
                await pool.query(
                    `INSERT INTO marcas (usuario_id, ejercicio_id, mejor_1rm, mejor_peso, mejor_reps, ultima_fecha, sesiones)
                     VALUES ($1,$2,$3,$4,$5,CURRENT_DATE,$6)
                     ON CONFLICT (usuario_id, ejercicio_id) DO NOTHING`,
                    [c.usuario_id, c.ejercicio_id, Math.round(m1 * 10) / 10, mp, mr, s.rowCount]
                );
            }
            log("  marcas personales calculadas");

            // Puntos coherentes con ese historial.
            for (const nombre of Object.keys(PROGRESIONES)) {
                const id = idUsr[nombre];
                if (!id) continue;
                for (let s = 0; s < SESIONES; s++) {
                    await pool.query(
                        `INSERT INTO puntos (usuario_id, tipo, puntos, detalle, referencia, fecha)
                         VALUES ($1,'sesion_completada',50,'Sesión completada',$2,
                                 CURRENT_DATE - $3::int)
                         ON CONFLICT (usuario_id, tipo, referencia) DO NOTHING`,
                        [id, `hist-${s}`, (SESIONES - s) * 3 - 1]
                    );
                }
            }
            log("  puntos otorgados");
        }

        // ── Resumen ───────────────────────────────────────────────
        const t = await pool.query(`
            SELECT (SELECT COUNT(*) FROM usuarios)::int   usuarios,
                   (SELECT COUNT(*) FROM ejercicios)::int ejercicios,
                   (SELECT COUNT(*) FROM series)::int     series,
                   (SELECT COUNT(*) FROM mediciones)::int mediciones
        `);
        const x = t.rows[0];
        log(`\nBase lista · ${x.usuarios} cuentas · ${x.ejercicios} ejercicios · ${x.series} series · ${x.mediciones} mediciones`);

    } catch (err) {
        console.error("\nError preparando la base:", err.message);
        process.exitCode = 1;
        throw err;
    } finally {
        if (cerrarPool) await pool.end();
    }
}

if (require.main === module) main().catch(() => {});

module.exports = { main };
