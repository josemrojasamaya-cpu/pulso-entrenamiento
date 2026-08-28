-- =====================================================================
--  Pulso · esquema de base de datos
--
--  Idempotente: se puede correr sobre una base vacía o sobre una ya
--  instalada sin perder datos.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS pulso;
SET search_path TO pulso, public;


-- ---------------------------------------------------------------------
--  Cuentas
--
--  Un atleta puede tener entrenador o no. Si lo tiene, ese entrenador ve
--  su progreso y puede ajustarle el plan; si no, el sistema es su
--  entrenador. Las dos formas de uso conviven.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
    id             SERIAL PRIMARY KEY,
    username       VARCHAR(60)  NOT NULL UNIQUE,
    password_hash  VARCHAR(200) NOT NULL,
    rol            VARCHAR(20)  NOT NULL DEFAULT 'atleta',  -- admin | entrenador | atleta
    entrenador_id  INTEGER REFERENCES usuarios(id),
    nombre         VARCHAR(120) NOT NULL,
    email          VARCHAR(160),
    activo         BOOLEAN      NOT NULL DEFAULT TRUE,
    ultimo_acceso  TIMESTAMPTZ,
    creado_en      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usr_entrenador ON usuarios (entrenador_id);

-- Datos del registro. El correo es único: es la forma de recuperar una
-- cuenta y de evitar que la misma persona se registre dos veces.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS telefono VARCHAR(40);
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS plan VARCHAR(20) NOT NULL DEFAULT 'gratis';
    -- gratis | mensual | trimestral
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS plan_vence DATE;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS codigo_invitacion VARCHAR(12);
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS invitado_por INTEGER REFERENCES usuarios(id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_usr_email
    ON usuarios (LOWER(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_usr_codigo
    ON usuarios (codigo_invitacion) WHERE codigo_invitacion IS NOT NULL;

-- ---------------------------------------------------------------------
--  Consentimientos
--
--  Qué versión de los términos aceptó cada persona y cuándo. Se guarda
--  como registro aparte y no como un booleano en la cuenta: si los
--  términos cambian, hay que poder demostrar qué texto aceptó cada quien
--  y en qué momento. Un `acepto = true` no responde ninguna de las dos
--  preguntas.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS consentimientos (
    id          SERIAL PRIMARY KEY,
    usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    documento   VARCHAR(40) NOT NULL,      -- terminos | privacidad | salud
    version     VARCHAR(20) NOT NULL,
    aceptado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ip          VARCHAR(60),
    UNIQUE (usuario_id, documento, version)
);


-- ---------------------------------------------------------------------
--  Perfil de entrenamiento
--
--  Es la entrada del motor de rutinas: sin esto no se puede generar
--  nada sensato. Cada campo existe porque cambia la rutina resultante.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perfiles (
    usuario_id        INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
    fecha_nacimiento  DATE,
    sexo              VARCHAR(20),
    altura_cm         NUMERIC(5,1),
    objetivo          VARCHAR(30) NOT NULL DEFAULT 'salud',
        -- perder_grasa | ganar_musculo | fuerza | resistencia | salud
    nivel             VARCHAR(20) NOT NULL DEFAULT 'principiante',
        -- principiante | intermedio | avanzado
    dias_por_semana   INTEGER     NOT NULL DEFAULT 3,
    minutos_sesion    INTEGER     NOT NULL DEFAULT 45,
    lugar             VARCHAR(20) NOT NULL DEFAULT 'gimnasio',  -- gimnasio | casa | mixto
    -- Qué equipo tiene realmente a mano. Sin esto el sistema recomienda
    -- ejercicios que la persona no puede hacer, que es la forma más
    -- rápida de que abandone.
    equipo            JSONB       NOT NULL DEFAULT '["peso_corporal"]'::jsonb,
    -- Días de la semana que puede entrenar: 1=lunes … 7=domingo
    dias_disponibles  JSONB       NOT NULL DEFAULT '[1,3,5]'::jsonb,
    actualizado_en    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Qué hay disponible en casa, que casi nunca es lo mismo que en el
-- gimnasio. Sin este dato, "hoy entreno en casa" tendría que adivinar.
ALTER TABLE perfiles
    ADD COLUMN IF NOT EXISTS equipo_casa JSONB NOT NULL DEFAULT '["peso_corporal"]'::jsonb;

-- Dónde se entrena HOY, que puede no ser lo habitual. Se guarda por
-- rutina y no en el perfil: cambiar de lugar un día no debería
-- reescribir la preferencia de siempre.
ALTER TABLE rutinas
    ADD COLUMN IF NOT EXISTS lugar VARCHAR(20) NOT NULL DEFAULT 'gimnasio';


-- ---------------------------------------------------------------------
--  Condiciones de salud
--
--  Determinan qué ejercicios se excluyen y qué avisos se muestran. Son
--  la razón por la que este sistema no puede limitarse a repartir
--  ejercicios al azar.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS condiciones (
    id          SERIAL PRIMARY KEY,
    usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    codigo      VARCHAR(40) NOT NULL,
        -- diabetes | hipertension | cardiopatia | lesion_lumbar | lesion_hombro
        -- lesion_rodilla | asma | embarazo | obesidad | artritis | hernia
    detalle     TEXT,
    severidad   VARCHAR(20) DEFAULT 'moderada',   -- leve | moderada | alta
    activa      BOOLEAN NOT NULL DEFAULT TRUE,
    registrada  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (usuario_id, codigo)
);


-- ---------------------------------------------------------------------
--  Mediciones corporales
--
--  El eje de la aplicación: la persona se mide, entrena, y meses después
--  se vuelve a medir. La comparación es la que responde si el
--  entrenamiento sirvió, y ninguna sensación subjetiva la sustituye.
--
--  Las medidas van en columnas explícitas y no en una tabla de
--  atributos: son un conjunto cerrado y estable, y así graficar una
--  serie es una consulta directa en vez de un pivote.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mediciones (
    id             SERIAL PRIMARY KEY,
    usuario_id     INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    fecha          DATE NOT NULL DEFAULT CURRENT_DATE,

    peso_kg        NUMERIC(5,2),
    grasa_pct      NUMERIC(4,1),
    musculo_kg     NUMERIC(5,2),
    agua_pct       NUMERIC(4,1),

    -- Perímetros en centímetros. Izquierda y derecha por separado:
    -- las asimetrías son información real, y promediarlas la borra.
    cuello         NUMERIC(4,1),
    hombros        NUMERIC(5,1),
    pecho          NUMERIC(5,1),
    biceps_izq     NUMERIC(4,1),
    biceps_der     NUMERIC(4,1),
    antebrazo_izq  NUMERIC(4,1),
    antebrazo_der  NUMERIC(4,1),
    cintura        NUMERIC(5,1),
    abdomen        NUMERIC(5,1),
    cadera         NUMERIC(5,1),
    muslo_izq      NUMERIC(4,1),
    muslo_der      NUMERIC(4,1),
    pantorrilla_izq NUMERIC(4,1),
    pantorrilla_der NUMERIC(4,1),

    notas          TEXT,
    creado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Una sola medición por día y persona: medirse dos veces el mismo
    -- día produce diferencias que son ruido de la cinta métrica, no
    -- progreso, y ensucian todas las curvas.
    UNIQUE (usuario_id, fecha)
);

CREATE INDEX IF NOT EXISTS idx_med_usuario ON mediciones (usuario_id, fecha DESC);


-- ---------------------------------------------------------------------
--  Catálogo de ejercicios
--
--  `contraindicado_en` lleva los códigos de condición que descartan el
--  ejercicio. El motor lo consulta antes de proponer nada.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ejercicios (
    id                SERIAL PRIMARY KEY,
    nombre            VARCHAR(120) NOT NULL UNIQUE,
    grupo             VARCHAR(30)  NOT NULL,
        -- pecho | espalda | hombros | biceps | triceps | cuadriceps
        -- femoral | gluteos | pantorrilla | core | cardio | cuerpo_completo
    patron            VARCHAR(30)  NOT NULL,
        -- empuje_horizontal | empuje_vertical | traccion_horizontal
        -- traccion_vertical | dominante_rodilla | dominante_cadera
        -- core | cardio | aislamiento
    equipo            VARCHAR(30)  NOT NULL,
        -- peso_corporal | mancuernas | barra | maquina | banda | kettlebell | polea
    nivel             VARCHAR(20)  NOT NULL DEFAULT 'principiante',
    unilateral        BOOLEAN      NOT NULL DEFAULT FALSE,
    compuesto         BOOLEAN      NOT NULL DEFAULT FALSE,
    -- Cuánto esfuerzo sistémico exige (1 a 5). Se usa para no encadenar
    -- varios ejercicios demoledores en la misma sesión.
    exigencia         INTEGER      NOT NULL DEFAULT 2,
    video_url         VARCHAR(200),
    instrucciones     TEXT,
    contraindicado_en JSONB        NOT NULL DEFAULT '[]'::jsonb,
    activo            BOOLEAN      NOT NULL DEFAULT TRUE
);

-- Un isométrico se sostiene, no se repite: la plancha va en segundos y
-- el trabajo cardiovascular continuo en minutos. Sin esta distinción la
-- rutina termina indicando "12 repeticiones de plancha".
ALTER TABLE ejercicios
    ADD COLUMN IF NOT EXISTS medida VARCHAR(15) NOT NULL DEFAULT 'repeticiones';
        -- repeticiones | segundos | minutos

-- Impacto: hay fase de vuelo o el pie golpea el piso repetidamente.
-- Siete de las once condiciones lo prohíben. Es una propiedad del
-- ejercicio, no algo que se pueda deducir de su nombre.
ALTER TABLE ejercicios
    ADD COLUMN IF NOT EXISTS impacto BOOLEAN NOT NULL DEFAULT FALSE;

-- Se hace acostado boca arriba. A partir del segundo trimestre el
-- decúbito supino sostenido comprime la vena cava.
ALTER TABLE ejercicios
    ADD COLUMN IF NOT EXISTS supino BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_ej_grupo  ON ejercicios (grupo);
CREATE INDEX IF NOT EXISTS idx_ej_equipo ON ejercicios (equipo);


-- ---------------------------------------------------------------------
--  Rutinas generadas
--
--  `justificacion` guarda por qué el motor eligió lo que eligió. Sin
--  eso, una recomendación que sorprende al usuario es indistinguible de
--  un error, y no hay forma de depurarla después.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rutinas (
    id                SERIAL PRIMARY KEY,
    usuario_id        INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    fecha             DATE NOT NULL,
    nombre            VARCHAR(120) NOT NULL,
    enfoque           VARCHAR(40)  NOT NULL,
    minutos_estimados INTEGER,
    estado            VARCHAR(20)  NOT NULL DEFAULT 'pendiente',
        -- pendiente | en_curso | completada | omitida
    justificacion     JSONB        NOT NULL DEFAULT '{}'::jsonb,
    generada_en       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    iniciada_en       TIMESTAMPTZ,
    terminada_en      TIMESTAMPTZ,

    -- Una rutina por persona y día: si no, la descarga anticipada del
    -- día anterior crearía duplicados cada vez que se ejecuta.
    UNIQUE (usuario_id, fecha)
);

CREATE INDEX IF NOT EXISTS idx_rut_usuario ON rutinas (usuario_id, fecha DESC);

CREATE TABLE IF NOT EXISTS rutina_ejercicios (
    id               SERIAL PRIMARY KEY,
    rutina_id        INTEGER NOT NULL REFERENCES rutinas(id) ON DELETE CASCADE,
    ejercicio_id     INTEGER NOT NULL REFERENCES ejercicios(id),
    orden            INTEGER NOT NULL,
    series           INTEGER NOT NULL,
    rep_min          INTEGER NOT NULL,
    rep_max          INTEGER NOT NULL,
    peso_sugerido_kg NUMERIC(6,2),
    descanso_seg     INTEGER NOT NULL DEFAULT 90,
    nota             TEXT
);

-- La unidad se guarda POR RUTINA y no se toma del catálogo al leer.
-- El mismo ejercicio puede prescribirse de dos formas -el escalador se
-- puede pedir por repeticiones o por minutos de trabajo continuo- y la
-- que vale es la que se decidió al armar la sesión. Sin esta columna, el
-- motor asignaba una unidad y la lectura la descartaba.
ALTER TABLE rutina_ejercicios
    ADD COLUMN IF NOT EXISTS medida VARCHAR(15) NOT NULL DEFAULT 'repeticiones';

CREATE INDEX IF NOT EXISTS idx_re_rutina ON rutina_ejercicios (rutina_id, orden);


-- ---------------------------------------------------------------------
--  Series realizadas
--
--  `id_local` es el identificador que genera el teléfono cuando está sin
--  señal. Al sincronizar se usa para no duplicar: la misma serie enviada
--  dos veces cae en el mismo renglón.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS series (
    id                  BIGSERIAL PRIMARY KEY,
    id_local            VARCHAR(60),
    usuario_id          INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    rutina_ejercicio_id INTEGER REFERENCES rutina_ejercicios(id) ON DELETE CASCADE,
    ejercicio_id        INTEGER NOT NULL REFERENCES ejercicios(id),
    serie_num           INTEGER NOT NULL,
    repeticiones        INTEGER NOT NULL,
    peso_kg             NUMERIC(6,2) NOT NULL DEFAULT 0,
    rpe                 NUMERIC(3,1),          -- esfuerzo percibido, 1 a 10
    realizada_en        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sincronizada_en     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (usuario_id, id_local)
);

CREATE INDEX IF NOT EXISTS idx_ser_usuario ON series (usuario_id, realizada_en DESC);
CREATE INDEX IF NOT EXISTS idx_ser_ej      ON series (usuario_id, ejercicio_id, realizada_en DESC);


-- ---------------------------------------------------------------------
--  Marcas personales
--
--  Se recalculan al registrar series. Tenerlas materializadas evita
--  recorrer el historial entero cada vez que hay que sugerir un peso.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marcas (
    usuario_id     INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    ejercicio_id   INTEGER NOT NULL REFERENCES ejercicios(id) ON DELETE CASCADE,
    mejor_1rm      NUMERIC(6,2),
    mejor_peso     NUMERIC(6,2),
    mejor_reps     INTEGER,
    ultima_fecha   DATE,
    sesiones       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (usuario_id, ejercicio_id)
);


-- ---------------------------------------------------------------------
--  Lecturas biométricas
--
--  Vienen del reloj, de un tensiómetro por Bluetooth, de un archivo
--  exportado o escritas a mano. `origen` lo distingue, porque un dato
--  medido y uno tecleado no merecen la misma confianza.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS biometria (
    id          BIGSERIAL PRIMARY KEY,
    usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    tipo        VARCHAR(30) NOT NULL,
        -- pulso | presion | pasos | calorias | sueno_min | spo2 | vo2max
    valor       NUMERIC(8,2) NOT NULL,
    valor2      NUMERIC(8,2),              -- diastólica, cuando tipo = presion
    origen      VARCHAR(20) NOT NULL DEFAULT 'manual',
        -- manual | bluetooth | archivo | reloj
    contexto    VARCHAR(30),               -- reposo | entrenamiento | post
    medido_en   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (usuario_id, tipo, medido_en)
);

CREATE INDEX IF NOT EXISTS idx_bio_usuario ON biometria (usuario_id, tipo, medido_en DESC);


-- ---------------------------------------------------------------------
--  Puntos y progresión de nivel
--
--  Cada evento se guarda por separado en vez de un contador: así el
--  total siempre se puede recalcular y auditar, y un error de conteo no
--  queda grabado para siempre.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS puntos (
    id          BIGSERIAL PRIMARY KEY,
    usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    tipo        VARCHAR(40) NOT NULL,
        -- sesion_completada | racha | marca_personal | medicion | constancia
    puntos      INTEGER NOT NULL,
    detalle     TEXT,
    referencia  VARCHAR(60),
    fecha       DATE NOT NULL DEFAULT CURRENT_DATE,
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Impide otorgar dos veces el mismo premio por el mismo hecho.
    UNIQUE (usuario_id, tipo, referencia)
);

CREATE INDEX IF NOT EXISTS idx_pts_usuario ON puntos (usuario_id, fecha DESC);


-- ---------------------------------------------------------------------
--  Mesociclos · planificación en bloques
--
--  Entrenar siempre igual deja de funcionar: el cuerpo se adapta a lo
--  que se repite. Un mesociclo organiza el esfuerzo en tres a cinco
--  semanas de carga creciente más una de descarga, que es cuando el
--  cuerpo asimila lo anterior.
--
--  Sólo se guarda el inicio y el modelo: en qué semana cae cada día se
--  CALCULA. Guardar la semana actual obligaría a un proceso que la
--  avance, y ese proceso se cae, se olvida o se ejecuta dos veces.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mesociclos (
    id          SERIAL PRIMARY KEY,
    usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    nombre      VARCHAR(120) NOT NULL,
    modelo      VARCHAR(30)  NOT NULL DEFAULT 'plano',
        -- volumen_creciente | intensidad_creciente | ondulante | plano
    inicio      DATE    NOT NULL DEFAULT CURRENT_DATE,
    activo      BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meso_usuario ON mesociclos (usuario_id, activo);

-- Un solo bloque activo por persona: dos planes a la vez no significan
-- nada, y el motor tendría que elegir uno arbitrariamente.
CREATE UNIQUE INDEX IF NOT EXISTS idx_meso_unico_activo
    ON mesociclos (usuario_id) WHERE activo;


-- ---------------------------------------------------------------------
--  Grupos
--
--  Dos formas de uso con la misma estructura: un grupo de amigos que se
--  arman entre ellos, y el grupo que un profesor arma con sus alumnos.
--  Lo que cambia es quién lo creó y qué rol tiene cada quien, no las
--  tablas.
--
--  El código es corto y sin caracteres que se confundan al dictarlo:
--  sirve para el enlace, para el QR y para decirlo en voz alta.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS grupos (
    id            SERIAL PRIMARY KEY,
    nombre        VARCHAR(80)  NOT NULL,
    descripcion   VARCHAR(200),
    creador_id    INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    codigo        VARCHAR(10)  NOT NULL UNIQUE,
    tipo          VARCHAR(20)  NOT NULL DEFAULT 'amigos',   -- amigos | equipo
    max_miembros  INTEGER      NOT NULL DEFAULT 3,
    activo        BOOLEAN      NOT NULL DEFAULT TRUE,
    creado_en     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_grupo_creador ON grupos (creador_id);

CREATE TABLE IF NOT EXISTS grupo_miembros (
    grupo_id    INTEGER NOT NULL REFERENCES grupos(id) ON DELETE CASCADE,
    usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    rol         VARCHAR(20) NOT NULL DEFAULT 'miembro',   -- dueño | miembro
    unido_en    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (grupo_id, usuario_id)
);

CREATE INDEX IF NOT EXISTS idx_miembro_usuario ON grupo_miembros (usuario_id);


-- ---------------------------------------------------------------------
--  Retos
--
--  Se miden con lo que el sistema YA registra: sesiones, días activos,
--  volumen movido, constancia. Nada que dependa de que alguien declare
--  a mano cuánto hizo, porque eso invita a inflarlo y arruina la
--  competencia para todos.
--
--  `meta` es opcional: sin meta gana quien más acumule; con meta, gana
--  quien la alcance primero.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS retos (
    id          SERIAL PRIMARY KEY,
    grupo_id    INTEGER REFERENCES grupos(id) ON DELETE CASCADE,
    creador_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    titulo      VARCHAR(120) NOT NULL,
    tipo        VARCHAR(30)  NOT NULL,
        -- sesiones | dias_activos | volumen | constancia | mediciones | pasos
    meta        NUMERIC(12,2),
    inicio      DATE NOT NULL DEFAULT CURRENT_DATE,
    fin         DATE NOT NULL,
    estado      VARCHAR(20) NOT NULL DEFAULT 'activo',   -- activo | cerrado
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT reto_fechas_coherentes CHECK (fin >= inicio)
);

CREATE INDEX IF NOT EXISTS idx_reto_grupo ON retos (grupo_id, estado);

CREATE TABLE IF NOT EXISTS reto_participantes (
    reto_id     INTEGER NOT NULL REFERENCES retos(id) ON DELETE CASCADE,
    usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    unido_en    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (reto_id, usuario_id)
);


-- ---------------------------------------------------------------------
--  Dispositivos vinculados
--
--  Guarda con qué se conectó la persona, no credenciales de terceros.
--  Los dos caminos que no dependen de nadie:
--
--    bluetooth  el navegador habla directo con el aparato por el
--               servicio estándar de Bluetooth. Sin claves, sin permisos
--               y sin costo.
--    archivo    la persona exporta sus datos de donde sea y los sube.
--               Todas las marcas permiten exportar; es un derecho, no
--               una concesión.
--
--  `oauth` queda declarado para el día que se pague el acceso de alguna
--  plataforma, pero hoy ninguna integración lo usa.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dispositivos (
    id           SERIAL PRIMARY KEY,
    usuario_id   INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    nombre       VARCHAR(120) NOT NULL,
    marca        VARCHAR(60),
    tipo         VARCHAR(30) NOT NULL,
        -- banda_pecho | pulsera | reloj | bascula | tensiometro | telefono | otro
    via          VARCHAR(20) NOT NULL DEFAULT 'bluetooth',
        -- bluetooth | archivo | oauth | manual
    identificador VARCHAR(120),
    ultima_lectura TIMESTAMPTZ,
    activo       BOOLEAN NOT NULL DEFAULT TRUE,
    vinculado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_disp_usuario ON dispositivos (usuario_id, activo);


-- ---------------------------------------------------------------------
--  Hidratación
--
--  Se registra en vasos y no en mililitros porque nadie sabe cuántos
--  mililitros tomó: sabe cuántos vasos. La equivalencia se guarda por
--  si alguien la quiere precisa.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hidratacion (
    id          BIGSERIAL PRIMARY KEY,
    usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    fecha       DATE NOT NULL DEFAULT CURRENT_DATE,
    ml          INTEGER NOT NULL,
    origen      VARCHAR(20) NOT NULL DEFAULT 'manual',
    registrado  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agua_usuario ON hidratacion (usuario_id, fecha DESC);

-- Meta diaria y recordatorios, en el perfil porque son preferencias.
ALTER TABLE perfiles ADD COLUMN IF NOT EXISTS meta_agua_ml INTEGER NOT NULL DEFAULT 2500;
ALTER TABLE perfiles ADD COLUMN IF NOT EXISTS vaso_ml INTEGER NOT NULL DEFAULT 250;
ALTER TABLE perfiles ADD COLUMN IF NOT EXISTS recordar_agua BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE perfiles ADD COLUMN IF NOT EXISTS recordar_cada_min INTEGER NOT NULL DEFAULT 90;


-- ---------------------------------------------------------------------
--  Galería de evolución
--
--  Las fotos se guardan como datos en la base y no como archivos en
--  disco: en un servidor que se reinicia y borra el disco -que es lo
--  normal en los planes gratuitos- un archivo se pierde y la fila
--  queda apuntando a la nada.
--
--  Son privadas. No se comparten con ningún grupo salvo que la persona
--  lo elija explícitamente, y eso está escrito en los términos.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fotos (
    id          SERIAL PRIMARY KEY,
    usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    fecha       DATE NOT NULL DEFAULT CURRENT_DATE,
    angulo      VARCHAR(20) NOT NULL DEFAULT 'frente',  -- frente | perfil | espalda
    imagen      TEXT NOT NULL,          -- data URI, ya reducida en el navegador
    peso_kg     NUMERIC(5,2),
    nota        VARCHAR(200),
    subida_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fotos_usuario ON fotos (usuario_id, fecha DESC);


-- ---------------------------------------------------------------------
--  Tiempos de la serie · el cronómetro del entrenamiento
--
--  Dos números por serie: cuánto duró el trabajo y cuánto descansó
--  después. Sirven para dos cosas distintas.
--
--  El TRABAJO dice cómo se está moviendo el peso. Diez repeticiones en
--  minuto y medio y diez repeticiones en cuarenta segundos son el mismo
--  registro en el papel y dos entrenamientos completamente distintos.
--  Cuando el mismo peso empieza a salir más rápido, la persona mejoró
--  aunque el número de kilos no se haya movido — y eso es justo lo que
--  hace abandonar a la gente que sólo mira los kilos.
--
--  El DESCANSO dice si de verdad respetó la pauta. Una rutina de fuerza
--  con noventa segundos de descanso hecha con veinte segundos entre
--  series no es esa rutina: es otra cosa, y explica por qué no avanza.
--
--  Ambos son opcionales: quien registre a mano sin cronómetro sigue
--  funcionando igual, con NULL en estas columnas.
-- ---------------------------------------------------------------------
ALTER TABLE series ADD COLUMN IF NOT EXISTS segundos_trabajo  INTEGER;
ALTER TABLE series ADD COLUMN IF NOT EXISTS segundos_descanso INTEGER;

-- Un límite de cordura: nadie hace una serie de dos horas. Si llega un
-- número así es que el cronómetro quedó corriendo con el teléfono en el
-- bolsillo, y guardarlo ensuciaría todas las comparaciones futuras.
ALTER TABLE series DROP CONSTRAINT IF EXISTS ck_seg_trabajo;
ALTER TABLE series ADD CONSTRAINT ck_seg_trabajo
    CHECK (segundos_trabajo IS NULL OR (segundos_trabajo >= 0 AND segundos_trabajo <= 3600));
ALTER TABLE series DROP CONSTRAINT IF EXISTS ck_seg_descanso;
ALTER TABLE series ADD CONSTRAINT ck_seg_descanso
    CHECK (segundos_descanso IS NULL OR (segundos_descanso >= 0 AND segundos_descanso <= 3600));
