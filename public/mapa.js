/**
 * public/mapa.js — mapa real, con calles, sobre OpenStreetMap.
 *
 * Por qué OpenStreetMap y no Google Maps:
 *
 *   Google Maps cobra por carga pasado un tope, y para usarlo hay que
 *   dejar una tarjeta de crédito registrada. Una aplicación con
 *   publicidad puede recibir un pico de visitas cualquier día, y ese
 *   pico llega como una factura.
 *
 *   OpenStreetMap es cartografía abierta. Las mismas calles, los mismos
 *   nombres, sin clave, sin tarjeta y sin sorpresa. La condición es
 *   mostrar la atribución -que se muestra- y no abusar del servidor
 *   público de teselas. Si algún día el volumen crece, se cambia la
 *   dirección de las teselas por la de un proveedor propio: una línea.
 *
 * Leaflet se sirve desde nuestro propio servidor y no desde un CDN. Así
 * el mapa también carga dentro de la aplicación instalada, y no queda
 * en manos de que un tercero siga publicando ese archivo.
 */

const Mapa = {

    /** Teselas y atribución. Cambiar de proveedor es cambiar esto. */
    TESELAS: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    CREDITO: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',

    /**
     * Mapa que sigue a la persona mientras se mueve.
     *
     * Devuelve un objeto con `mover(puntos)` y `soltar()`. Quien lo usa
     * no toca Leaflet: si mañana se cambia de librería, se cambia acá y
     * la pantalla de actividad no se entera.
     */
    enVivo(contenedor, opciones) {
        const o = opciones || {};
        const mapa = L.map(contenedor, {
            zoomControl: false,
            attributionControl: true,
            // Un dedo arrastrando la pantalla mientras se corre movería
            // el mapa sin querer. Se sigue a la persona y punto.
            dragging: !!o.manipulable,
            scrollWheelZoom: !!o.manipulable,
            touchZoom: !!o.manipulable,
            doubleClickZoom: false
        });

        L.tileLayer(this.TESELAS, {
            maxZoom: 19, attribution: this.CREDITO,
            // Sin esto, cada movimiento del mapa pide teselas nuevas y en
            // datos móviles eso se nota en la factura y en la batería.
            keepBuffer: 3, updateWhenIdle: true
        }).addTo(mapa);

        const linea = L.polyline([], {
            color: "#4a8ee0", weight: 5, opacity: .9,
            lineJoin: "round", lineCap: "round"
        }).addTo(mapa);

        // El punto de la persona: un círculo con halo, como el de
        // cualquier navegador. Se ve de un vistazo y no tapa la calle.
        const halo = L.circleMarker([0, 0], {
            radius: 13, color: "transparent", fillColor: "#4a8ee0", fillOpacity: .22
        }).addTo(mapa);
        const yo = L.circleMarker([0, 0], {
            radius: 7, color: "#ffffff", weight: 2.5,
            fillColor: "#2b74c4", fillOpacity: 1
        }).addTo(mapa);

        let salida = null;
        let centrado = true;
        mapa.setView([9.9333, -84.0833], 15);   // hasta el primer punto real

        // Si la persona toca el mapa, deja de perseguirla: puede querer
        // mirar hacia adelante. Vuelve a centrarse con el botón.
        if (o.manipulable) mapa.on("dragstart", () => { centrado = false; });

        return {
            mapa,

            mover(puntos) {
                const p = (puntos || []).filter(x =>
                    Number.isFinite(x.lat) && Number.isFinite(x.lon) &&
                    (!Number.isFinite(x.precision) || x.precision <= 50));
                if (p.length === 0) return;

                linea.setLatLngs(p.map(x => [x.lat, x.lon]));

                const u = p[p.length - 1];
                yo.setLatLng([u.lat, u.lon]);
                halo.setLatLng([u.lat, u.lon]);
                // El halo dibuja la precisión real del GPS. Es honesto:
                // cuando el teléfono no sabe bien dónde está, se ve.
                halo.setRadius(Math.max(11, Math.min(40, (u.precision || 10))));

                if (!salida) {
                    salida = L.circleMarker([p[0].lat, p[0].lon], {
                        radius: 6, color: "#0e1620", weight: 2,
                        fillColor: "#268a60", fillOpacity: 1
                    }).addTo(mapa).bindTooltip("Salida");
                }

                if (centrado) mapa.setView([u.lat, u.lon], mapa.getZoom() || 15, { animate: true });
            },

            centrar() {
                centrado = true;
                const c = linea.getLatLngs();
                if (c.length) mapa.setView(c[c.length - 1], 17, { animate: true });
            },

            /** Encuadra el recorrido entero. Para el resumen del final. */
            encuadrar() {
                const c = linea.getLatLngs();
                if (c.length > 1) mapa.fitBounds(linea.getBounds(), { padding: [28, 28] });
            },

            soltar() { mapa.remove(); }
        };
    },

    /**
     * Mapa fijo de un recorrido ya terminado, para el historial.
     *
     * Empieza encuadrado en la ruta entera y se puede tocar: quien mira
     * una carrera vieja sí quiere acercarse a ver por dónde pasó.
     */
    recorrido(contenedor, puntos) {
        const p = (puntos || []).filter(x => Number.isFinite(x.lat) && Number.isFinite(x.lon));
        if (p.length < 2) return null;

        const mapa = L.map(contenedor, { zoomControl: true, doubleClickZoom: true });
        L.tileLayer(this.TESELAS, { maxZoom: 19, attribution: this.CREDITO }).addTo(mapa);

        // Dos trazos: uno ancho y translúcido debajo, otro fino encima.
        // Sobre un mapa con calles, una línea sola se pierde entre ellas.
        const coords = p.map(x => [x.lat, x.lon]);
        L.polyline(coords, { color: "#0e1620", weight: 8, opacity: .45 }).addTo(mapa);
        const ruta = L.polyline(coords, { color: "#4a8ee0", weight: 4, opacity: 1 }).addTo(mapa);

        L.circleMarker(coords[0], { radius: 7, color: "#fff", weight: 2.5,
            fillColor: "#268a60", fillOpacity: 1 }).addTo(mapa).bindTooltip("Salida");
        L.circleMarker(coords[coords.length - 1], { radius: 7, color: "#fff", weight: 2.5,
            fillColor: "#c9603c", fillOpacity: 1 }).addTo(mapa).bindTooltip("Llegada");

        mapa.fitBounds(ruta.getBounds(), { padding: [24, 24] });
        return mapa;
    }
};

window.Mapa = Mapa;
