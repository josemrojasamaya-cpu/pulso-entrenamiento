/**
 * db/ejercicios.js — catálogo de ejercicios.
 *
 * Cada entrada:
 *   [nombre, grupo, patron, equipo, nivel, unilateral, compuesto,
 *    exigencia, terminoVideo, instrucciones, contraindicadoEn]
 *
 * Sobre los videos: se guarda un TÉRMINO DE BÚSQUEDA, no el id de un
 * video concreto. Es deliberado. Un id apunta a un video que puede
 * borrarse, volverse privado o cambiar de dueño, y un catálogo de
 * sesenta enlaces muertos es peor que no tener video. Una búsqueda en
 * YouTube nunca devuelve 404 y además envejece bien: el resultado
 * mejora solo con el tiempo.
 *
 * `contraindicadoEn` lleva los códigos de condición que descartan el
 * ejercicio. No son sugerencias: el motor los usa para excluir, y esa
 * exclusión es la diferencia entre un generador de rutinas y un
 * repartidor de ejercicios al azar.
 */

const EJERCICIOS = [
  // ── PECHO ────────────────────────────────────────────────────────
  ["Press de banca con barra", "pecho", "empuje_horizontal", "barra", "intermedio", false, true, 4,
   "press de banca tecnica correcta",
   "Acostado, escápulas retraídas y pies firmes. Bajá la barra al pecho controlando, y empujá sin despegar la espalda del banco.",
   ["lesion_hombro", "hipertension", "embarazo"]],

  ["Press de banca con mancuernas", "pecho", "empuje_horizontal", "mancuernas", "principiante", false, true, 3,
   "press banca mancuernas tecnica",
   "Mancuernas a los lados del pecho, codos a unos 45 grados. Empujá hacia arriba juntándolas levemente sin chocarlas.",
   ["lesion_hombro", "embarazo"]],

  ["Press inclinado con mancuernas", "pecho", "empuje_horizontal", "mancuernas", "intermedio", false, true, 3,
   "press inclinado mancuernas tecnica",
   "Banco a 30 grados. Trabaja la parte alta del pecho. No subas el banco más de 45 grados o pasa a ser hombro.",
   ["lesion_hombro", "embarazo"]],

  ["Aperturas con mancuernas", "pecho", "aislamiento", "mancuernas", "principiante", false, false, 2,
   "aperturas mancuernas pecho tecnica",
   "Codos levemente flexionados y fijos. Abrí en arco amplio sin bajar de la línea del hombro.",
   ["lesion_hombro", "embarazo"]],

  ["Flexiones de brazos", "pecho", "empuje_horizontal", "peso_corporal", "principiante", false, true, 2,
   "flexiones de brazos tecnica correcta",
   "Cuerpo en línea recta de cabeza a talones. Bajá hasta que el pecho casi toque el piso.",
   ["lesion_hombro"]],

  ["Flexiones inclinadas", "pecho", "empuje_horizontal", "peso_corporal", "principiante", false, true, 1,
   "flexiones inclinadas principiantes",
   "Manos sobre un banco o pared. Cuanto más alto el apoyo, más fácil. Ideal para empezar.",
   []],

  ["Press en máquina de pecho", "pecho", "empuje_horizontal", "maquina", "principiante", false, true, 2,
   "press pecho maquina tecnica",
   "La máquina fija la trayectoria, así que exige menos control. Buena opción para empezar o para cerrar la sesión.",
   []],

  ["Fondos en paralelas", "pecho", "empuje_horizontal", "peso_corporal", "avanzado", false, true, 4,
   "fondos en paralelas tecnica",
   "Inclinate hacia adelante para cargar el pecho. Bajá hasta que el hombro quede a la altura del codo, no más.",
   ["lesion_hombro", "hipertension", "cardiopatia"]],

  // ── ESPALDA ──────────────────────────────────────────────────────
  ["Dominadas", "espalda", "traccion_vertical", "peso_corporal", "avanzado", false, true, 4,
   "dominadas tecnica correcta",
   "Agarre algo más ancho que los hombros. Llevá el pecho a la barra pensando en bajar los codos, no en tirar con los brazos.",
   ["lesion_hombro"]],

  ["Jalón al pecho en polea", "espalda", "traccion_vertical", "polea", "principiante", false, true, 3,
   "jalon al pecho polea tecnica",
   "Pecho arriba y barra al esternón. Nunca por detrás de la nuca: esa variante castiga el hombro sin dar nada a cambio.",
   []],

  ["Remo con barra", "espalda", "traccion_horizontal", "barra", "intermedio", false, true, 4,
   "remo con barra tecnica correcta",
   "Tronco inclinado 45 grados, espalda neutra. Llevá la barra al ombligo sin balancear el cuerpo.",
   ["lesion_lumbar", "hernia", "embarazo"]],

  ["Remo con mancuerna a una mano", "espalda", "traccion_horizontal", "mancuernas", "principiante", true, true, 2,
   "remo mancuerna una mano tecnica",
   "Apoyá rodilla y mano en el banco. Tirá del codo hacia la cadera manteniendo la espalda plana.",
   []],

  ["Remo en máquina sentado", "espalda", "traccion_horizontal", "maquina", "principiante", false, true, 2,
   "remo sentado maquina tecnica",
   "Pecho apoyado o espalda firme. Juntá las escápulas al final del recorrido.",
   []],

  ["Remo con banda elástica", "espalda", "traccion_horizontal", "banda", "principiante", false, true, 1,
   "remo con banda elastica tecnica",
   "Banda anclada al frente. Tirá llevando los codos atrás y pegados al cuerpo.",
   []],

  ["Peso muerto convencional", "espalda", "dominante_cadera", "barra", "avanzado", false, true, 5,
   "peso muerto tecnica correcta",
   "Barra pegada a las piernas, espalda neutra, empujá el piso con los pies. Es el ejercicio que más castiga un fallo de técnica.",
   ["lesion_lumbar", "hernia", "hipertension", "cardiopatia", "embarazo"]],

  ["Peso muerto rumano con mancuernas", "femoral", "dominante_cadera", "mancuernas", "intermedio", false, true, 3,
   "peso muerto rumano mancuernas tecnica",
   "Rodillas casi rectas, cadera hacia atrás. Bajá hasta sentir el femoral, no hasta tocar el piso.",
   ["lesion_lumbar", "hernia", "embarazo"]],

  ["Pull-over con mancuerna", "espalda", "aislamiento", "mancuernas", "intermedio", false, false, 2,
   "pullover mancuerna tecnica",
   "Acostado en el banco, llevá la mancuerna por detrás de la cabeza en arco, con los codos apenas flexionados.",
   ["lesion_hombro", "embarazo"]],

  // ── HOMBROS ──────────────────────────────────────────────────────
  ["Press militar con barra", "hombros", "empuje_vertical", "barra", "intermedio", false, true, 4,
   "press militar tecnica correcta",
   "De pie, glúteo y abdomen apretados. Empujá arriba llevando la cabeza levemente adelante al pasar la barra.",
   ["lesion_hombro", "hipertension", "cardiopatia", "lesion_lumbar"]],

  ["Press de hombros con mancuernas", "hombros", "empuje_vertical", "mancuernas", "principiante", false, true, 3,
   "press hombro mancuernas sentado tecnica",
   "Sentado con respaldo. Bajá hasta que el codo quede a la altura del hombro y empujá sin bloquear de golpe.",
   ["lesion_hombro", "hipertension"]],

  ["Elevaciones laterales", "hombros", "aislamiento", "mancuernas", "principiante", false, false, 1,
   "elevaciones laterales tecnica correcta",
   "Peso liviano. Subí hasta la línea del hombro guiando con el codo, sin encoger el trapecio.",
   []],

  ["Elevaciones frontales", "hombros", "aislamiento", "mancuernas", "principiante", false, false, 1,
   "elevaciones frontales mancuernas tecnica",
   "Subí al frente hasta la altura de los ojos. Sin impulso de cadera.",
   // Pasar los 90 grados de flexión es la posición de pinzamiento. Las
   // elevaciones laterales paran en la línea del hombro y son seguras;
   // esta no.
   ["lesion_hombro"]],

  ["Pájaros para deltoide posterior", "hombros", "aislamiento", "mancuernas", "principiante", false, false, 1,
   "pajaros deltoide posterior tecnica",
   "Tronco inclinado, abrí los brazos en arco. Es el trabajo que compensa tantas horas de hombro adelantado.",
   ["lesion_lumbar"]],

  ["Face pull en polea", "hombros", "traccion_horizontal", "polea", "principiante", false, false, 1,
   "face pull tecnica correcta",
   "Polea a la altura de la cara. Tirá hacia la frente separando las manos. Excelente para la salud del hombro.",
   []],

  // ── BÍCEPS ───────────────────────────────────────────────────────
  ["Curl con mancuernas", "biceps", "aislamiento", "mancuernas", "principiante", false, false, 1,
   "curl biceps mancuernas tecnica",
   "Codos pegados al cuerpo y fijos. Subí sin balancear el tronco.",
   []],

  ["Curl con barra", "biceps", "aislamiento", "barra", "principiante", false, false, 2,
   "curl con barra tecnica correcta",
   "Agarre al ancho de hombros. Si tenés que impulsar con la espalda, es demasiado peso.",
   ["lesion_lumbar"]],

  ["Curl martillo", "biceps", "aislamiento", "mancuernas", "principiante", false, false, 1,
   "curl martillo tecnica",
   "Palmas enfrentadas todo el recorrido. Trabaja el braquial y engrosa el antebrazo.",
   []],

  ["Curl con banda elástica", "biceps", "aislamiento", "banda", "principiante", false, false, 1,
   "curl biceps banda elastica",
   "Pisá la banda y subí. La tensión aumenta al final, justo donde el bíceps es más fuerte.",
   []],

  // ── TRÍCEPS ──────────────────────────────────────────────────────
  ["Extensión de tríceps en polea", "triceps", "aislamiento", "polea", "principiante", false, false, 1,
   "extension triceps polea tecnica",
   "Codos pegados al cuerpo, sólo se mueve el antebrazo. Extendé del todo abajo.",
   []],

  ["Press francés con mancuernas", "triceps", "aislamiento", "mancuernas", "intermedio", false, false, 2,
   "press frances mancuernas tecnica",
   "Acostado, bajá las mancuernas hacia la frente flexionando sólo el codo.",
   ["lesion_hombro"]],

  ["Fondos entre bancos", "triceps", "empuje_horizontal", "peso_corporal", "principiante", false, false, 2,
   "fondos entre bancos triceps",
   "Manos en el banco detrás tuyo. Bajá hasta 90 grados de codo, no más: por debajo castiga el hombro.",
   ["lesion_hombro"]],

  ["Patada de tríceps con mancuerna", "triceps", "aislamiento", "mancuernas", "principiante", true, false, 1,
   "patada triceps mancuerna tecnica",
   "Tronco inclinado, brazo pegado al costado. Extendé hacia atrás y sostené un segundo.",
   ["lesion_lumbar"]],

  // ── CUÁDRICEPS Y PIERNA ──────────────────────────────────────────
  ["Sentadilla con barra", "cuadriceps", "dominante_rodilla", "barra", "avanzado", false, true, 5,
   "sentadilla con barra tecnica correcta",
   "Barra en el trapecio, pies al ancho de hombros. Bajá con el pecho arriba hasta que el muslo quede paralelo al piso.",
   ["lesion_rodilla", "lesion_lumbar", "hipertension", "cardiopatia", "hernia", "embarazo"]],

  ["Sentadilla goblet", "cuadriceps", "dominante_rodilla", "mancuernas", "principiante", false, true, 3,
   "sentadilla goblet tecnica",
   "Mancuerna contra el pecho. El contrapeso te ayuda a mantener el tronco erguido: la mejor sentadilla para aprender.",
   ["lesion_rodilla"]],

  ["Sentadilla libre", "cuadriceps", "dominante_rodilla", "peso_corporal", "principiante", false, true, 2,
   "sentadilla sin peso tecnica correcta",
   "Sin peso. Bajá controlando, rodillas siguiendo la dirección de los pies.",
   []],

  ["Prensa de piernas", "cuadriceps", "dominante_rodilla", "maquina", "principiante", false, true, 3,
   "prensa de piernas tecnica",
   "No bloquees la rodilla arriba ni dejes que la cadera se despegue abajo.",
   // En el fondo del recorrido la pelvis rota hacia atrás con la lumbar
   // apoyada contra el respaldo y la carga empujando hacia la flexión.
   // Es peor que en sentadilla libre, porque el respaldo impide la
   // compensación natural del tronco.
   ["lesion_rodilla", "hipertension", "lesion_lumbar", "hernia", "embarazo"]],

  ["Estocadas con mancuernas", "cuadriceps", "dominante_rodilla", "mancuernas", "intermedio", true, true, 3,
   "estocadas mancuernas tecnica",
   "Paso largo, rodilla de atrás casi al piso. Trabaja también el equilibrio y corrige asimetrías.",
   ["lesion_rodilla", "lesion_lumbar"]],

  ["Extensión de cuádriceps", "cuadriceps", "aislamiento", "maquina", "principiante", false, false, 2,
   "extension cuadriceps maquina tecnica",
   "Subí controlando y sostené arriba. Evitá el impulso de cadera.",
   ["lesion_rodilla"]],

  ["Curl femoral acostado", "femoral", "aislamiento", "maquina", "principiante", false, false, 2,
   "curl femoral maquina tecnica",
   "Cadera pegada al banco. Llevá el talón al glúteo sin despegar la pelvis.",
   []],

  ["Puente de glúteos", "gluteos", "dominante_cadera", "peso_corporal", "principiante", false, false, 1,
   "puente de gluteos tecnica",
   "Acostado, pies apoyados. Empujá con los talones y apretá el glúteo arriba dos segundos.",
   []],

  ["Hip thrust con barra", "gluteos", "dominante_cadera", "barra", "intermedio", false, true, 3,
   "hip thrust tecnica correcta",
   "Espalda alta apoyada en un banco. El mejor ejercicio para glúteo con carga.",
   // Extensión de cadera con carga máxima y una barra sobre la pelvis:
   // de los movimientos del catálogo más asociados a aguantar la
   // respiración haciendo fuerza.
   ["hernia", "embarazo", "hipertension", "cardiopatia"]],

  ["Elevación de talones", "pantorrilla", "aislamiento", "peso_corporal", "principiante", false, false, 1,
   "elevacion de talones pantorrilla",
   "Subí lo más alto posible y bajá lento. Recorrido completo o no sirve de nada.",
   []],

  ["Sentadilla búlgara", "cuadriceps", "dominante_rodilla", "mancuernas", "avanzado", true, true, 4,
   "sentadilla bulgara tecnica",
   "Pie de atrás sobre un banco. Brutal para pierna y para detectar asimetrías entre lados.",
   ["lesion_rodilla"]],

  // ── CORE ─────────────────────────────────────────────────────────
  ["Plancha abdominal", "core", "core", "peso_corporal", "principiante", false, false, 1,
   "plancha abdominal tecnica correcta",
   "Antebrazos y punta de pies. Cuerpo en línea, glúteo y abdomen apretados. Si la cadera se cae, terminá la serie.",
   ["hipertension"]],

  ["Plancha lateral", "core", "core", "peso_corporal", "principiante", true, false, 1,
   "plancha lateral tecnica",
   "Apoyo en un antebrazo, cadera arriba. Trabaja el oblicuo y estabiliza la columna.",
   // Mismo mecanismo que la plancha frontal -isométrico sostenido con
   // respuesta presora- y con más tendencia a la apnea, porque la
   // posición es menos estable. Si una está bloqueada, la otra también.
   ["hipertension"]],

  ["Elevación de piernas colgado", "core", "core", "peso_corporal", "avanzado", false, false, 3,
   "elevacion piernas colgado tecnica",
   "Colgado de la barra, subí las piernas sin balancearte. Muy exigente.",
   ["lesion_hombro", "hernia", "lesion_lumbar", "hipertension", "embarazo"]],

  ["Dead bug", "core", "core", "peso_corporal", "principiante", false, false, 1,
   "dead bug ejercicio tecnica",
   "Boca arriba, lumbar pegada al piso. Extendé brazo y pierna opuestos sin arquear la espalda.",
   []],

  ["Bird dog", "core", "core", "peso_corporal", "principiante", false, false, 1,
   "bird dog ejercicio tecnica",
   "En cuatro apoyos, extendé brazo y pierna contrarios. Seguro incluso con molestia lumbar.",
   []],

  ["Rueda abdominal", "core", "core", "peso_corporal", "avanzado", false, false, 4,
   "rueda abdominal tecnica",
   "Sólo si ya sostenés una plancha de un minuto sin que la cadera se caiga.",
   ["lesion_lumbar", "hernia", "embarazo"]],

  // ── CARDIO ───────────────────────────────────────────────────────
  ["Caminata rápida", "cardio", "cardio", "peso_corporal", "principiante", false, false, 1,
   "caminata rapida para bajar de peso",
   "Ritmo al que podés hablar pero no cantar. La base de todo, y la más subestimada.",
   []],

  ["Bicicleta estática", "cardio", "cardio", "maquina", "principiante", false, false, 2,
   "bicicleta estatica rutina principiantes",
   "Sin impacto en las articulaciones. Ajustá el asiento para que la rodilla quede casi extendida abajo.",
   []],

  ["Elíptica", "cardio", "cardio", "maquina", "principiante", false, false, 2,
   "eliptica tecnica correcta",
   "Movimiento sin impacto. Usá los brazos en vez de colgarte del manubrio.",
   []],

  ["Remo en máquina de remo", "cardio", "cardio", "maquina", "intermedio", false, true, 3,
   "maquina de remo tecnica correcta",
   "Orden del movimiento: piernas, tronco, brazos. Y al revés para volver.",
   ["lesion_lumbar"]],

  ["Cuerda para saltar", "cardio", "cardio", "peso_corporal", "intermedio", false, false, 3,
   "saltar la cuerda tecnica principiantes",
   "Saltos bajos, aterrizando en la punta del pie. Alta demanda cardiovascular en poco espacio.",
   ["lesion_rodilla", "artritis", "obesidad", "embarazo", "lesion_lumbar", "hernia", "cardiopatia"]],

  ["Burpees", "cuerpo_completo", "cardio", "peso_corporal", "avanzado", false, true, 5,
   "burpees tecnica correcta",
   "Sentadilla, plancha, flexión, salto. El ejercicio con peor relación entre lo que cuesta y lo que la gente lo disfruta.",
   // Se declaran explícitamente aunque la exigencia 5 ya los excluya de
   // casi todos: depender de un umbral numérico significa que cambiarlo
   // desbloquea ejercicios contraindicados sin que nadie se entere.
   ["lesion_rodilla", "lesion_hombro", "cardiopatia", "hipertension", "artritis", "obesidad", "embarazo", "asma", "lesion_lumbar", "hernia"]],

  // Estaba clasificado en el grupo `core`, y TODAS las plantillas tienen
  // una ranura de core: por eso aparecía todos los días seguidos, incluso
  // en la cuenta con hernia lumbar. Es trabajo cardiovascular, no core:
  // cuando el core se fatiga, la pelvis cae y cada repetición la absorbe
  // la zona lumbar. Contradecía el propio aviso de esa condición, que
  // dice que el core se trabaja resistiendo el movimiento, no doblando
  // la espalda.
  ["Escalador (mountain climbers)", "cardio", "cardio", "peso_corporal", "intermedio", false, false, 3,
   "mountain climbers tecnica",
   "En plancha, llevá las rodillas al pecho alternando. Cadera baja todo el tiempo.",
   ["lesion_hombro", "lesion_rodilla", "lesion_lumbar", "hernia", "embarazo", "obesidad"]],

  ["Swing con kettlebell", "gluteos", "dominante_cadera", "kettlebell", "intermedio", false, true, 4,
   "swing kettlebell tecnica correcta",
   "El impulso sale de la cadera, no de los brazos. La pesa flota, no se levanta.",
   ["lesion_lumbar", "hernia", "hipertension", "embarazo"]],

  // ── MOVILIDAD Y ACCESORIOS SEGUROS ───────────────────────────────
  ["Movilidad de cadera", "cuerpo_completo", "core", "peso_corporal", "principiante", false, false, 1,
   "movilidad de cadera rutina",
   "Serie de movimientos suaves para preparar la cadera. Sirve como entrada en calor.",
   []],

  ["Estiramiento de isquiotibiales", "femoral", "core", "peso_corporal", "principiante", false, false, 1,
   "estiramiento isquiotibiales correcto",
   "Sostené 30 segundos sin rebotes. Al final de la sesión, nunca antes de cargar peso.",
   []],

  ["Gato-camello", "core", "core", "peso_corporal", "principiante", false, false, 1,
   "gato camello ejercicio lumbar",
   "En cuatro apoyos, alterná arquear y redondear la espalda. Movilidad segura para la columna.",
   []],

  // ═══════════════════════════════════════════════════════════════════
  //  CASA Y CALISTENIA
  //
  //  Sin equipo, o con lo que hay en cualquier casa: una silla, una
  //  pared, una mochila con libros. Existe porque la razón más común
  //  para abandonar no es la falta de ganas: es no poder ir al gimnasio
  //  ese día y no tener ninguna alternativa a mano.
  // ═══════════════════════════════════════════════════════════════════

  // ── Empuje ───────────────────────────────────────────────────────
  ["Flexiones en rodillas", "pecho", "empuje_horizontal", "peso_corporal", "principiante", false, true, 1,
   "flexiones de rodillas tecnica",
   "Apoyando las rodillas en vez de los pies. Cuerpo recto de la cabeza a las rodillas.",
   ["lesion_hombro"]],

  ["Flexiones contra la pared", "pecho", "empuje_horizontal", "peso_corporal", "principiante", false, true, 1,
   "flexiones de pared principiantes",
   "De pie frente a una pared, manos apoyadas a la altura del pecho. La versión más suave que existe: para empezar de cero.",
   []],

  ["Flexiones diamante", "triceps", "empuje_horizontal", "peso_corporal", "avanzado", false, true, 3,
   "flexiones diamante tecnica",
   "Manos juntas formando un rombo bajo el pecho. Carga el tríceps mucho más que la flexión normal.",
   ["lesion_hombro"]],

  ["Flexiones declinadas", "pecho", "empuje_horizontal", "peso_corporal", "avanzado", false, true, 3,
   "flexiones declinadas tecnica",
   "Pies sobre una silla o el sofá. Cuanto más alto el apoyo, más carga sobre el pecho alto y el hombro.",
   ["lesion_hombro", "hipertension"]],

  ["Flexión en pica", "hombros", "empuje_vertical", "peso_corporal", "avanzado", false, true, 4,
   "pike push up tecnica",
   "Cadera en alto formando una V invertida, bajás la cabeza hacia el piso. Es el press de hombros sin pesas.",
   ["lesion_hombro", "hipertension", "cardiopatia", "embarazo"]],

  // ── Tracción ─────────────────────────────────────────────────────
  ["Remo invertido bajo una mesa", "espalda", "traccion_horizontal", "peso_corporal", "intermedio", false, true, 2,
   "remo invertido bajo mesa casa",
   "Acostado bajo una mesa firme, te agarrás del borde y tirás del pecho hacia arriba. El mejor tirón sin equipo.",
   []],

  ["Remo con mochila", "espalda", "traccion_horizontal", "peso_corporal", "principiante", true, true, 2,
   "remo con mochila en casa",
   "Una mochila con libros o botellas hace de mancuerna. Apoyá una mano en una silla y tirá del codo hacia la cadera.",
   []],

  ["Superman", "espalda", "core", "peso_corporal", "principiante", false, false, 1,
   "superman ejercicio espalda tecnica",
   "Boca abajo, levantás brazos y piernas a la vez y sostenés. Fortalece toda la cadena posterior.",
   ["embarazo"]],

  ["Retracción de escápulas", "espalda", "traccion_horizontal", "peso_corporal", "principiante", false, false, 1,
   "retraccion escapular ejercicio casa",
   "Juntá los omóplatos como si sostuvieras un lápiz entre ellos. Compensa las horas de escritorio.",
   []],

  // ── Pierna ───────────────────────────────────────────────────────
  ["Sentadilla búlgara con silla", "cuadriceps", "dominante_rodilla", "peso_corporal", "intermedio", true, true, 3,
   "sentadilla bulgara en casa silla",
   "Pie de atrás sobre una silla. Brutal para la pierna y sin necesidad de ningún peso.",
   ["lesion_rodilla"]],

  ["Sentadilla a una pierna asistida", "cuadriceps", "dominante_rodilla", "peso_corporal", "avanzado", true, true, 4,
   "pistol squat asistida tecnica",
   "Bajás con una sola pierna sosteniéndote de una puerta. El paso previo a la sentadilla a una pierna completa.",
   ["lesion_rodilla", "artritis", "obesidad"]],

  ["Sentadilla isométrica en la pared", "cuadriceps", "dominante_rodilla", "peso_corporal", "principiante", false, false, 2,
   "sentadilla isometrica pared tecnica",
   "Espalda contra la pared, rodillas a noventa grados, y sostenés. Quema sin castigar la articulación.",
   ["lesion_rodilla", "hipertension", "cardiopatia"]],

  ["Zancadas caminando", "cuadriceps", "dominante_rodilla", "peso_corporal", "principiante", true, true, 2,
   "zancadas caminando tecnica",
   "Un paso largo tras otro, bajando la rodilla de atrás casi al piso. Alcanza con un pasillo.",
   ["lesion_rodilla"]],

  ["Puente de glúteos a una pierna", "gluteos", "dominante_cadera", "peso_corporal", "intermedio", true, false, 2,
   "puente gluteo una pierna tecnica",
   "El puente normal pero apoyando un solo pie. Excelente para corregir diferencias entre lados.",
   ["embarazo"]],

  ["Bisagra de cadera sin peso", "femoral", "dominante_cadera", "peso_corporal", "principiante", false, false, 1,
   "bisagra de cadera hip hinge tecnica",
   "De pie, llevás la cadera hacia atrás manteniendo la espalda recta. Enseña el movimiento del peso muerto sin riesgo.",
   ["lesion_lumbar", "hernia"]],

  ["Elevación de talones a una pierna", "pantorrilla", "aislamiento", "peso_corporal", "intermedio", true, false, 1,
   "elevacion talon una pierna tecnica",
   "De pie sobre un escalón, con una sola pierna. Sube mucho la carga sin agregar peso.",
   []],

  ["Sentadilla con salto", "cuadriceps", "cardio", "peso_corporal", "avanzado", false, true, 4,
   "sentadilla con salto tecnica",
   "Sentadilla y explotás hacia arriba. Aterrizá suave, primero con la punta del pie.",
   ["lesion_rodilla", "lesion_lumbar", "artritis", "obesidad", "embarazo", "cardiopatia", "hipertension", "hernia"]],

  // ── Core ─────────────────────────────────────────────────────────
  ["Plancha con toque de hombro", "core", "core", "peso_corporal", "intermedio", false, false, 2,
   "plancha toque de hombro tecnica",
   "En plancha, tocás el hombro contrario alternando sin que la cadera se mueva. Trabajo anti-rotación.",
   ["lesion_hombro"]],

  ["Hueco abdominal", "core", "core", "peso_corporal", "intermedio", false, false, 2,
   "hollow hold tecnica correcta",
   "Boca arriba, lumbar pegada al piso, brazos y piernas estirados sin tocar el suelo. La base del core en calistenia.",
   ["lesion_lumbar", "hernia", "embarazo"]],

  ["Elevación de piernas acostado", "core", "core", "peso_corporal", "principiante", false, false, 2,
   "elevacion de piernas acostado tecnica",
   "Boca arriba, subís las piernas rectas sin despegar la lumbar. Si se despega, doblá un poco las rodillas.",
   ["lesion_lumbar", "hernia", "embarazo"]],

  ["Escalador lento", "core", "core", "peso_corporal", "principiante", false, false, 1,
   "mountain climber lento tecnica",
   "El escalador pero despacio y con control, sin salto. Trabaja el core sin el impacto de la versión rápida.",
   ["lesion_hombro"]],

  ["Plancha lateral con rodilla apoyada", "core", "core", "peso_corporal", "principiante", true, false, 1,
   "plancha lateral rodilla apoyada",
   "Plancha lateral apoyando la rodilla de abajo. La entrada natural cuando la completa todavía no sale.",
   []],

  // ── Cardio en casa ───────────────────────────────────────────────
  ["Marcha en el lugar", "cardio", "cardio", "peso_corporal", "principiante", false, false, 1,
   "marcha en el lugar ejercicio casa",
   "Caminar sin moverte del sitio, levantando bien las rodillas. Sin impacto y en un metro cuadrado.",
   []],

  ["Subir y bajar escalón", "cardio", "cardio", "peso_corporal", "principiante", false, true, 2,
   "step ups escalon ejercicio casa",
   "Un escalón o un banquito firme. Subí y bajá alternando la pierna. Cardio sin impacto con trabajo de pierna.",
   ["lesion_rodilla"]],

  ["Sombra de boxeo", "cardio", "cardio", "peso_corporal", "principiante", false, false, 2,
   "shadow boxing principiantes rutina",
   "Golpes al aire moviendo los pies. Sube el pulso, es entretenido y no necesita nada.",
   []],

  // ── Movilidad ────────────────────────────────────────────────────
  ["Estiramiento de flexores de cadera", "cuerpo_completo", "core", "peso_corporal", "principiante", true, false, 1,
   "estiramiento flexor cadera tecnica",
   "Una rodilla en el piso y empujás la cadera hacia adelante. Lo que compensa las horas sentado.",
   []],

  ["Movilidad de hombro con toalla", "hombros", "core", "peso_corporal", "principiante", false, false, 1,
   "movilidad hombro con toalla",
   "Una toalla agarrada con las dos manos, pasándola de adelante hacia atrás por encima de la cabeza.",
   []],

  ["Rotación torácica en cuadrupedia", "cuerpo_completo", "core", "peso_corporal", "principiante", true, false, 1,
   "rotacion toracica cuadrupedia",
   "En cuatro apoyos, una mano en la nuca y abrís el codo hacia el techo. Devuelve movilidad a la espalda alta.",
   []],
];

/**
 * Ejercicios de IMPACTO: hay una fase de vuelo, o el pie golpea el piso
 * repetidamente.
 *
 * Siete de las once condiciones exigen evitarlos. Antes esto se decidía
 * con una expresión regular sobre el nombre del ejercicio, dentro del
 * bloque de cardio, y fallaba de dos formas: "Escalador" no contiene
 * ninguna de las palabras buscadas, y los ejercicios de impacto que no
 * están en el grupo `cardio` ni siquiera pasaban por ese bloque.
 *
 * Una propiedad del ejercicio no se escapa por el nombre.
 */
const DE_IMPACTO = new Set([
    "Cuerda para saltar",
    "Burpees",
    "Escalador (mountain climbers)",
    "Sentadilla con salto"
]);

/**
 * Ejercicios que se hacen ACOSTADO BOCA ARRIBA.
 *
 * A partir del segundo trimestre el decúbito supino sostenido comprime
 * la vena cava. El aviso de embarazo ya afirmaba que se quitaban, así
 * que el sistema decía una cosa y hacía otra.
 */
const EN_SUPINO = new Set([
    "Press de banca con barra",
    "Press de banca con mancuernas",
    "Aperturas con mancuernas",
    "Press francés con mancuernas",
    "Pull-over con mancuerna",
    "Puente de glúteos",
    "Dead bug",
    "Curl femoral acostado",
    "Hip thrust con barra",
    "Puente de glúteos a una pierna",
    "Hueco abdominal",
    "Elevación de piernas acostado"
]);

/**
 * Ejercicios que se miden en SEGUNDOS, no en repeticiones.
 *
 * Un isométrico no tiene repeticiones: se sostiene. Una aplicación que
 * indica "12 repeticiones de plancha" pierde toda credibilidad ante
 * cualquiera que haya pisado un gimnasio, y con razón.
 */
const POR_TIEMPO = new Set([
    "Plancha abdominal",
    "Plancha lateral",
    "Plancha lateral con rodilla apoyada",
    "Sentadilla isométrica en la pared",
    "Hueco abdominal",
    "Superman",
    "Retracción de escápulas",
    "Estiramiento de isquiotibiales",
    "Estiramiento de flexores de cadera",
    "Movilidad de cadera",
    "Movilidad de hombro con toalla"
]);

/** Ejercicios que se miden en MINUTOS (trabajo cardiovascular continuo). */
const POR_MINUTOS = new Set([
    "Marcha en el lugar",
    "Sombra de boxeo",
    "Caminata rápida",
    "Bicicleta estática",
    "Elíptica",
    "Remo en máquina de remo",
    "Cuerda para saltar"
]);

function medidaDe(nombre) {
    if (POR_TIEMPO.has(nombre))  return "segundos";
    if (POR_MINUTOS.has(nombre)) return "minutos";
    return "repeticiones";
}

/** Enlace de búsqueda en YouTube. Nunca queda muerto. */
function enlaceVideo(termino) {
    return "https://www.youtube.com/results?search_query=" + encodeURIComponent(termino);
}

module.exports = {
    EJERCICIOS, enlaceVideo, medidaDe,
    POR_TIEMPO, POR_MINUTOS, DE_IMPACTO, EN_SUPINO
};
