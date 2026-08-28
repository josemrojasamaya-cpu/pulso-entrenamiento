# Forja — entrenador adaptativo

Aplicación web instalable (PWA) que **arma la rutina de cada día** según las
medidas corporales, las condiciones de salud y el objetivo de cada persona.
Funciona sin conexión, porque los gimnasios suelen estar en sótanos.

**[Ver funcionando](https://forja-entrenamiento.onrender.com)** · cuentas de
demostración en la propia pantalla de acceso.

---

## Qué la diferencia de un registro de entrenamiento

Casi todas las aplicaciones de gimnasio son cuadernos digitales: vos anotás
qué hiciste. Esta decide **qué hacer** y **con cuánto peso**, que es
justamente lo que uno le paga a un entrenador.

### 1. No guarda rutinas: las genera

Cada día se arma una sesión distinta a partir de plantillas de patrones de
movimiento (empuje horizontal, dominante de cadera, tracción vertical…), no
de listas fijas de ejercicios.

Es **determinista por día**: la semilla del generador es `usuario + fecha`,
así que recargar la pantalla diez veces devuelve exactamente la misma
rutina, pero mañana es otra. Con `Math.random()` la rutina cambiaría cada
vez que se corta la señal y vuelve, y nadie podría confiar en ella.

La elección no es azar puro. Cada candidato se puntúa por nivel, por si es
compuesto, por si hay historial para calcular el peso y por cuándo se hizo
por última vez; después se sortea **entre los mejores**. Sin esa
puntuación, a alguien de nivel intermedio con barra disponible le tocaban
flexiones inclinadas como movimiento principal del día.

### 2. Se adapta a las condiciones de salud, y eso se aplica antes de elegir

Once condiciones —hipertensión, diabetes, cardiopatía, lesión lumbar,
hernia, embarazo, asma, artritis, lesión de rodilla, lesión de hombro,
sobrepeso importante— con sus propios límites de intensidad, rango de
repeticiones, descanso mínimo, patrones excluidos y avisos.

Tres decisiones de diseño:

- **Las reglas son deterministas, no salen de un modelo de lenguaje.** Una
  persona con cardiopatía no puede recibir una recomendación que cambia
  entre dos ejecuciones. Un modelo puede *explicar* lo que estas reglas ya
  decidieron; no decidirlo.
- **Ante varias condiciones manda siempre la más severa.** Si una permite
  llegar al 85% de la carga máxima y otra al 60%, se aplica el 60%.
  Promediar restricciones de seguridad no tiene sentido.
- **El filtro corre antes de elegir, no después.** Filtrar al final deja la
  puerta abierta a que un caso raro cuele lo que había que excluir.

Hay una prueba automatizada que recorre las once condiciones y las
combinaciones múltiples, genera catorce días de rutinas para cada una, y
verifica que ningún ejercicio contraindicado se haya colado.

### 3. Calcula cuánto peso poner hoy

La cadena es: series registradas → carga máxima estimada (fórmula de Epley)
→ peso para el rango de repeticiones de hoy → ajuste por el esfuerzo
percibido que reportaste → tope por condiciones de salud → redondeo a
incrementos que **existen en un gimnasio real** (2,5 kg en barra, de a 2 en
mancuernas por encima de 12 kg).

Sugerir 43,7 kg es inútil: no hay forma de armar ese peso.

También detecta estancamiento comparando la mejor carga estimada de las
sesiones recientes contra las anteriores, y propone descarga o cambio de
variante.

### 4. Funciona sin señal, de verdad

La rutina del día siguiente se descarga por adelantado. Lo que se registra
en el gimnasio se guarda **primero en el teléfono** (IndexedDB) y recién
después se intenta enviar. Al revés —intentar la red y guardar local sólo
si falla— se pierden datos cuando el servidor acepta pero la respuesta no
vuelve.

Cada serie lleva un identificador generado en el dispositivo, y el servidor
lo usa para no duplicar. Sin eso, un mal momento de señal convierte tres
series en seis. Verificado de punta a punta: se corta la red, se registra,
se restaura la red, se sincroniza, y un reenvío del mismo dato se reconoce
como duplicado en vez de insertarse otra vez.

El service worker usa dos estrategias distintas a propósito: la interfaz se
sirve desde caché primero (abre al instante), y los datos van a la red
primero (mostrar la rutina de ayer como si fuera la de hoy sería grave).

### 5. Medidas corporales segmentadas

Diecisiete medidas, con **izquierda y derecha por separado** en brazos y
piernas: las asimetrías son información real y promediarlas la borra.

La comparación entre dos tomas sabe qué significa cada cambio: bajar grasa
o cintura se muestra como logro, perder bíceps como pérdida, y el peso en
gris, porque subir o bajar no es bueno ni malo por sí mismo.

### 6. Ranking por constancia, no por kilos

Un ranking por peso levantado lo gana siempre quien lleva diez años
entrenando; quien empieza no tiene ninguna posibilidad y abandona. Los
puntos se ganan apareciendo, sosteniendo la racha y midiéndose.

---

## Stack

`Node.js` · `Express 5` · `PostgreSQL` · `JWT` · `bcrypt` · `IndexedDB` ·
`Service Worker` · JavaScript sin framework en el frontend

Sin librerías de gráficos: los SVG se generan a mano.

## Correrlo

```bash
npm install
DATABASE_URL=postgres://usuario:clave@localhost:5432/forja npm run setup
DATABASE_URL=postgres://usuario:clave@localhost:5432/forja npm start
```

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | Conexión a PostgreSQL. Sin ella, usa localhost. |
| `JWT_SECRET` | Firma de los tokens. **Definirla en producción.** |
| `DB_SCHEMA` | Esquema de las tablas (por omisión `forja`). |
| `PORT` | Puerto del servidor. |

Si la base está vacía al arrancar, el servidor aplica el esquema y carga el
catálogo y los datos de ejemplo solo. En planes sin acceso a consola es la
única forma de instalarlo.

## Pruebas

```bash
node pruebas/motor.js
```

46 comprobaciones sobre el motor, sin necesidad de base de datos. Cubren
seguridad clínica, reproducibilidad, cobertura de patrones en sesiones
cortas, unidades por tipo de ejercicio, cálculo de cargas y robustez ante
entradas absurdas.

## Sobre los videos

Cada ejercicio enlaza a una **búsqueda** en YouTube, no a un video
concreto. Es deliberado: un identificador apunta a un video que puede
borrarse o volverse privado, y un catálogo de sesenta enlaces muertos es
peor que no tener videos. Una búsqueda nunca devuelve 404 y además mejora
sola con el tiempo.

## Aviso

Sistema de demostración. Las personas y sus datos son ficticios. Las reglas
de adaptación por condición de salud siguen criterios generales de
seguridad y **no sustituyen la indicación de un profesional**.

---

Desarrollado por **José Miguel Rojas Amaya** ·
[Portafolio](https://josemrojas.netlify.app)
