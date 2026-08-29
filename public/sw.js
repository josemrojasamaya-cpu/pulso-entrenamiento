/* =====================================================================
   sw.js — service worker.

   Es lo que permite abrir la aplicación sin señal, que es el caso normal:
   los gimnasios suelen estar en sótanos o detrás de paredes de concreto.

   Una decisión que vale la pena explicar, porque va contra lo que suele
   hacerse:

   **Las respuestas de la API NO se guardan acá.**

   La caché del navegador indexa por dirección, y `/api/entrenamiento/dia/
   2026-08-27` es la misma dirección para todo el mundo. En un teléfono
   que usan dos personas —o cuando alguien cierra sesión y entra con otra
   cuenta— eso significa servirle a una persona la rutina de la otra. En
   esta aplicación ese fallo es grave de verdad: la rutina de alguien sin
   condiciones de salud, mostrada a alguien con hipertensión y sin
   ninguno de sus avisos.

   Los datos para trabajar sin conexión viven en IndexedDB, donde cada
   registro lleva su dueño y se puede filtrar por él. La caché del service
   worker se ocupa sólo de la interfaz, que es igual para todos.
   ===================================================================== */

// La versión se cambia a mano en cada despliegue que toque estos
// archivos. Si no cambia, `activate` no borra las cachés viejas y la
// corrección desplegada nunca llega.
const VERSION = "pulso-v21";
const CACHE_APP = `${VERSION}-app`;

const ARCHIVOS = [
    "/",
    "/index.html",
    "/hoy.html",
    "/sesion.html",
    "/actividad.html",
    "/mapa.js",
    "/lib/leaflet.js",
    "/lib/leaflet.css",
    "/medidas.html",
    "/progreso.html",
    "/perfil.html",
    "/ranking.html",
    "/grupos.html",
    "/salud.html",
    "/entrenador.html",
    "/login.html",
    "/terminos.html",
    "/estilos.css",
    "/comun.js",
    "/almacen.js",
    "/qr.js",
    "/vendor-qrcode.js",
    "/manifest.json",
    "/icono.svg",
    "/fondo.svg?v=3"
];

self.addEventListener("install", (e) => {
    e.waitUntil(
        caches.open(CACHE_APP)
            // addAll falla entero si un solo archivo falla. Se guarda uno
            // por uno, y se pide sin caché del navegador para no sembrar
            // el service worker con copias ya viejas.
            .then(c => Promise.allSettled(
                ARCHIVOS.map(a => fetch(a, { cache: "reload" }).then(r => r.ok && c.put(a, r)))
            ))
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

    // Sólo lo propio: nada de interceptar peticiones a otros dominios,
    // como los enlaces de video.
    if (url.origin !== self.location.origin) return;

    if (e.request.method !== "GET") return;

    // La API va siempre a la red, sin caché de por medio. Ver la nota de
    // arriba: una respuesta guardada acá no tiene dueño.
    if (url.pathname.startsWith("/api/")) return;

    e.respondWith(interfaz(e.request));
});

/**
 * La interfaz se sirve de caché y se refresca por detrás.
 *
 * Abre al instante y funciona sin señal. El precio es que una versión
 * nueva llega en la siguiente carga; para los archivos de la interfaz es
 * un intercambio razonable, y por eso los datos no siguen esta ruta.
 */
async function interfaz(peticion) {
    const guardada = await caches.match(peticion);

    if (guardada) {
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
        // Sin red y sin copia: se devuelve el índice, que decide a dónde
        // mandar a cada quien según su rol. Devolver directamente la
        // pantalla de atleta dejaba a un entrenador en una página que no
        // le corresponde.
        const indice = await caches.match("/index.html") || await caches.match("/");
        if (indice) return indice;

        return new Response("Sin conexión y sin copia guardada.", {
            status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" }
        });
    }
}

self.addEventListener("message", (e) => {
    if (e.data === "actualizar") self.skipWaiting();
});
