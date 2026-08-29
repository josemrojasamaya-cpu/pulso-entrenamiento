# Plan · dos días para dejarla lista

Escrito el 29 de agosto de 2026, para ejecutar la semana siguiente.

**El objetivo real de todo esto es conseguir trabajo.** Eso ordena las
prioridades: lo que un reclutador puede ver y comprobar en cinco minutos
vale más que lo que sólo se nota usando la aplicación tres semanas.

---

## 1. Cobros

### Lo que NO sirve

- **Stripe directo** — no acepta cuentas de Costa Rica para recibir
  pagos. Es el estándar de la industria y no está disponible.
- **PayPal** — descartado por decisión del dueño.
- **Cobrar dentro de la app en Play Store** — Google exige su sistema y
  se lleva el 15%.

### Lo que hay que verificar el martes

**Lemon Squeezy** es la candidata. Funciona como *merchant of record*:
ellos son quienes venden legalmente, cobran con cualquier tarjeta del
mundo, manejan los impuestos de cada país, y depositan a una cuenta
bancaria. Comisión alrededor de 5% + 50¢.

Fue comprada por Stripe, así que tiene respaldo — y a la vez conviene
confirmar que sigue aceptando países que Stripe directo no acepta, que
es justo la razón para usarla.

**Antes de escribir una línea de código hay que confirmar tres cosas:**

1. Que acepta registrarse desde Costa Rica.
2. A qué tipo de cuenta deposita (banco local, Wise, Payoneer).
3. Qué pide para verificar la identidad.

Si Lemon Squeezy no acepta, las alternativas en orden: **Polar.sh**
(más nuevo, mismo modelo), **Paddle** (mismo modelo, suele pedir
volumen mínimo), **Gumroad** (más simple, comisión más alta).

### Cómo se conecta, cuando esté elegida

El modelo que evita la comisión de Google: **cobrar desde la web, no
dentro de la aplicación**.

1. La persona compra en `entrenapulso.netlify.app`.
2. La pasarela avisa al servidor con un *webhook*.
3. El servidor marca la cuenta como pagada.

La infraestructura para el paso 3 **ya existe**: es exactamente lo que
hacen los cupones. Un pago exitoso hace lo mismo que un canje. Eso
significa que conectar la pasarela es un día, no una semana.

**Lo que hay que cuidar:** el webhook debe verificar la firma del
mensaje. Sin eso, cualquiera que descubra la dirección puede enviar un
"pago confirmado" falso y darse el plan completo gratis.

---

## 2. Auditoría con agentes

Tres auditores en paralelo, cada uno con un encargo distinto, y un
cuarto que juzga lo que los tres encontraron.

El cuarto tiene que ser **fresco**, sin el contexto de los tres
primeros. Un agente que hereda el razonamiento de otro hereda también
su punto ciego.

### Auditor 1 · Dinero y permisos

Busca las formas de tener el plan completo sin pagarlo:

- Canjear el mismo cupón dos veces, o desde dos cuentas a la vez.
- Llamar a las rutas del plan completo con un token de cuenta gratuita.
- Cambiar `plan` o `plan_vence` desde alguna ruta que no debería
  permitirlo.
- Guardar un tema o un fondo de pago sin tener el plan.
- Importar archivos sin plan, saltándose la pantalla.
- Falsificar el webhook de pago cuando exista.

### Auditor 2 · Datos de otras personas

Busca ver o modificar lo que no es suyo:

- Leer la rutina, las medidas, las fotos o las actividades de otro
  usuario cambiando el identificador en la dirección.
- Entrar al panel de entrenador sin ser entrenador.
- Ver los alumnos de otro entrenador.
- Registrarse con `rol: "admin"`.
- Inyección de SQL en cualquier campo de texto.
- Subir un SVG con scripts como foto de perfil.

### Auditor 3 · Uso real, buscando lo que molesta

Se comporta como una persona entrenando tres semanas:

- Registra sesiones, actividades, agua, medidas.
- Prueba en teléfono y con conexión mala.
- Anota **cada** paso que sobra, cada texto que no se entiende, cada
  pantalla donde no sabe qué hacer.

Este es el que más valor tiene y el que más fácil se subestima. Los dos
primeros buscan fallos que rompen; éste busca los que hacen abandonar,
que son los que de verdad matan una aplicación.

### El juez

Recibe los tres informes sin el contexto de cómo se produjeron y decide:

- Qué hallazgos son reales y cuáles son ruido.
- Cuáles bloquean el lanzamiento y cuáles pueden esperar.
- Qué se arregla en los dos días y qué queda anotado.

### Pruebas de carga

Aparte de la auditoría: simular varias personas entrenando a la vez y
sincronizando series. Lo que se mide es si el plan gratuito de Render
aguanta y en qué punto empieza a fallar.

---

## 3. Proteger el código y las cuentas

- **GitHub**: verificación en dos pasos, revisar que no haya secretos en
  el historial de commits (no sólo en los archivos actuales), y decidir
  si el repositorio sigue público.
- **Render**: verificación en dos pasos, y confirmar que `JWT_SECRET` la
  genera Render y no está escrita en ningún archivo.
- **Netlify**: verificación en dos pasos.
- **La llave de firma de la APK**: ya está en OneDrive, y conviene una
  segunda copia en otro lado.

**Sobre "que no nos roben el código":** conviene ser realista. Cualquier
código que se ejecuta en el navegador se puede leer, sin excepción y sin
remedio. Lo que sí se protege de verdad es el servidor: las reglas de
negocio, la base de datos y las claves. Y eso ya está del lado correcto.

Lo que hace difícil de copiar a esta aplicación no es el código: es
saber por qué cada decisión está tomada así. Eso está en los comentarios
y en los mensajes de commit, y es también lo que un reclutador va a
mirar.

---

## 4. Las dos aplicaciones nuevas

Sólo después de que ésta esté cerrada. Una aplicación terminada vale más
que tres a medias, y un reclutador nota la diferencia en un minuto.

Cada una con su propia página, como ésta.

---

## Orden sugerido para los dos días

**Día 1**
1. Confirmar la pasarela de pagos (una hora, y condiciona todo lo demás).
2. Lanzar la auditoría de los tres agentes.
3. Mientras corren: simplificar la pantalla de aplicaciones y mejorar
   los fondos, que son los dos pendientes visibles.
4. Leer el veredicto del juez.

**Día 2**
5. Arreglar lo que el juez marcó como bloqueante.
6. Conectar la pasarela.
7. Pruebas de carga.
8. Verificación en dos pasos en las tres cuentas.

Lo que no entre, queda anotado. Es mejor una lista honesta de pendientes
que una lista de tareas dadas por hechas.
