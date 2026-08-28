/* =====================================================================
   sw.js — service worker.

   Es lo que permite entrenar sin señal, que es el caso normal: los
   gimnasios suelen estar en sótanos o detrás de paredes de concreto, y
   una aplicación de entrenamiento que necesita internet para mostrarte
   la serie siguiente es inservible justo cuando hace falta.

   Dos estrategias distintas, a propósito:

   - La INTERFAZ (html, css, js) se sirve primero desde la caché. Es lo
     que hace que la aplicación abra al instante y sin red.

   - Los DATOS (todo lo que cuelga de /api) se piden primero a la red, y
     sólo si falla se sirve la última copia guardada. Al revés sería
     grave: mostraría la rutina de ayer como si fuera la de hoy.

   Lo que la persona registra sin señal NO pasa por acá: se guarda en
   IndexedDB desde la aplicación y se sincroniza después. Un service
   worker no es lugar para datos que no se pueden perder.
   ===================================================================== */

const VERSION = "forja-v1";
const CACHE_APP   = `${VERSION}-app`;
const CACHE_DATOS = `${VERSION}-datos`;

const ARCHIVOS = [
    "/hoy.html",
    "/entrenar.html",
    "/medidas.html",
    "/progreso.html",
    "/perfil.html",
    "/ranking.html",
    "/login.html",
    "/estilos.css",
    "/comun.js",
    "/almacen.js",
    "/manifest.json",
    "/icono.svg"
];

self.addEventListener("install", (e) => {
    e.waitUntil(
        caches.open(CACHE_APP)
            // addAll falla entero si un solo archivo falla, y eso dejaría
            // la aplicación sin caché por un detalle. Se guarda uno por uno.
            .then(c => Promise.allSettled(ARCHIVOS.map(a => c.add(a))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (e) => {
    e.waitUntil(
        caches.keys()
            .then(claves => Promise.all(
                claves.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", (e) => {
    const url = new URL(e.request.url);

    // Sólo se atiende lo propio: nada de interceptar peticiones a otros
    // dominios, como los enlaces de video.
    if (url.origin !== self.location.origin) return;

    // Las escrituras nunca se cachean ni se sirven desde caché: una
    // respuesta guardada a un POST sería una confirmación falsa de algo
    // que no se guardó.
    if (e.request.method !== "GET") return;

    if (url.pathname.startsWith("/api/")) {
        e.respondWith(redPrimero(e.request));
        return;
    }

    e.respondWith(cachePrimero(e.request));
});

/** Interfaz: caché primero, y se refresca por detrás para la próxima vez. */
async function cachePrimero(peticion) {
    const guardada = await caches.match(peticion);
    if (guardada) {
        // Actualización silenciosa: no bloquea la respuesta.
        fetch(peticion)
            .then(r => { if (r.ok) caches.open(CACHE_APP).then(c => c.put(peticion, r)); })
            .catch(() => {});
        return guardada;
    }

    try {
        const respuesta = await fetch(peticion);
        if (respuesta.ok) {
            const copia = respuesta.clone();
            caches.open(CACHE_APP).then(c => c.put(peticion, copia));
        }
        return respuesta;
    } catch {
        // Sin red y sin caché: si pedían una página, se devuelve la de
        // hoy, que es la que tiene sentido abrir.
        const alternativa = await caches.match("/hoy.html");
        if (alternativa) return alternativa;
        return new Response("Sin conexión y sin copia guardada.", {
            status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" }
        });
    }
}

/** Datos: red primero; la caché es sólo la red de contención. */
async function redPrimero(peticion) {
    try {
        const respuesta = await fetch(peticion);
        if (respuesta.ok) {
            const copia = respuesta.clone();
            caches.open(CACHE_DATOS).then(c => c.put(peticion, copia));
        }
        return respuesta;
    } catch {
        const guardada = await caches.match(peticion);
        if (guardada) {
            // Se marca la respuesta para que la interfaz pueda avisar que
            // lo que se está viendo puede no ser lo último.
            const cuerpo = await guardada.json().catch(() => null);
            if (cuerpo && typeof cuerpo === "object") {
                return new Response(JSON.stringify({ ...cuerpo, _desdeCache: true }), {
                    status: 200, headers: { "Content-Type": "application/json" }
                });
            }
            return guardada;
        }
        return new Response(
            JSON.stringify({ message: "Sin conexión y sin copia guardada de estos datos.", _sinRed: true }),
            { status: 503, headers: { "Content-Type": "application/json" } }
        );
    }
}

/** Permite que la aplicación fuerce la actualización del worker. */
self.addEventListener("message", (e) => {
    if (e.data === "actualizar") self.skipWaiting();
});
