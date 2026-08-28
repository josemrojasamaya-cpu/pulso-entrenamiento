/* =====================================================================
   almacen.js — guardado local y sincronización.

   El problema que resuelve: la persona termina una serie en el gimnasio,
   sin señal, y toca "guardar". Ese dato NO se puede perder. No hay forma
   de recuperarlo después: nadie recuerda cuántas repeticiones hizo en la
   tercera serie de hace dos semanas.

   Reglas que se siguen acá:

   1. Se escribe SIEMPRE en local primero, y recién después se intenta
      mandar al servidor. Al revés -intentar la red y guardar local sólo
      si falla- pierde datos cuando la red acepta la petición pero la
      respuesta no vuelve.

   2. Cada serie lleva un identificador propio generado en el teléfono.
      Si el envío se corta y se reintenta, el servidor reconoce el
      identificador y no duplica.

   3. Todo lo guardado lleva DUEÑO. Un teléfono lo usa más de una
      persona: sin esta marca, la cola de uno se envía con la sesión del
      siguiente, y el entrenamiento termina en el historial equivocado.

   4. Lo local sólo se borra cuando el servidor confirma que lo tiene. Y
      si lo RECHAZA, no se borra en silencio: se marca y se avisa. Un
      dato descartado sin que nadie se entere es peor que un error
      visible, porque la persona ve la confirmación y no vuelve a
      anotarlo.
   ===================================================================== */

const BD_NOMBRE = "pulso";
const BD_VERSION = 2;

// Tamaño máximo por envío. El servidor rechaza lotes grandes con un
// error global, así que una cola larga -varias sesiones sin señal- no
// salía nunca y se quedaba trabada para siempre.
const TAMANO_LOTE = 100;

let bd = null;

function abrirBD() {
    if (bd) return Promise.resolve(bd);
    return new Promise((resolver, rechazar) => {
        const p = indexedDB.open(BD_NOMBRE, BD_VERSION);

        p.onupgradeneeded = (e) => {
            const d = e.target.result;

            if (!d.objectStoreNames.contains("pendientes")) {
                const s = d.createObjectStore("pendientes", { keyPath: "id_local" });
                s.createIndex("por_fecha", "realizada_en");
                s.createIndex("por_dueno", "usuario_id");
            } else if (e.oldVersion < 2) {
                const s = p.transaction.objectStore("pendientes");
                if (!s.indexNames.contains("por_dueno")) s.createIndex("por_dueno", "usuario_id");
            }

            // Las rutinas se guardan por (usuario, fecha). Antes la clave
            // era sólo la fecha, así que la rutina de una persona pisaba
            // la de la anterior en el mismo teléfono.
            if (d.objectStoreNames.contains("rutinas") && e.oldVersion < 2) {
                d.deleteObjectStore("rutinas");
            }
            if (!d.objectStoreNames.contains("rutinas")) {
                d.createObjectStore("rutinas", { keyPath: "clave" });
            }

            if (!d.objectStoreNames.contains("cache")) {
                d.createObjectStore("cache", { keyPath: "clave" });
            }
        };

        p.onsuccess = () => { bd = p.result; resolver(bd); };
        p.onerror = () => rechazar(p.error);
        // Con dos pestañas abiertas, una migración de esquema queda
        // bloqueada. Sin este manejo, la promesa no se resolvía nunca.
        p.onblocked = () => rechazar(new Error("Hay otra pestaña de Pulso abierta. Cerrala y volvé a intentar."));
    });
}

function tx(almacen, modo, operacion) {
    return abrirBD().then(d => new Promise((resolver, rechazar) => {
        const t = d.transaction(almacen, modo);
        const s = t.objectStore(almacen);
        const pedido = operacion(s);
        t.oncomplete = () => resolver(pedido ? pedido.result : undefined);
        t.onerror = () => rechazar(t.error);
        // Una transacción abortada -presión de cuota, navegación a mitad-
        // dejaba la promesa colgada para siempre.
        t.onabort = () => rechazar(t.error || new Error("Transacción cancelada."));
    }));
}

function nuevoIdLocal() {
    const azar = crypto.getRandomValues(new Uint32Array(2));
    return `${Date.now().toString(36)}-${azar[0].toString(36)}${azar[1].toString(36)}`;
}

/** Quién está usando la aplicación ahora mismo. */
function duenoActual() {
    try {
        const u = JSON.parse(localStorage.getItem("pulso_usuario") || "null");
        return u && u.id ? Number(u.id) : null;
    } catch { return null; }
}

/* ── Validación ───────────────────────────────────────────────────── */

/**
 * Las mismas reglas que aplica el servidor, aplicadas antes de guardar.
 *
 * Duplicar la validación no es redundancia: el servidor tiene que
 * validar porque no puede confiar en el cliente, y el cliente tiene que
 * validar para poder AVISAR. Sin esto, todo lo que caía en el hueco
 * entre las dos validaciones se guardaba en el teléfono, se enviaba, el
 * servidor lo rechazaba, y se borraba sin que nadie lo viera.
 */
function validarSerie(s) {
    const peso = s.peso_kg === null || s.peso_kg === undefined ? 0 : Number(s.peso_kg);
    if (!Number.isFinite(peso) || peso < 0) return "El peso no puede ser negativo.";
    if (peso > 600) return "Ese peso no parece real. Revisá el número.";

    const reps = Number(s.repeticiones);
    if (!Number.isInteger(reps) || reps < 1) {
        return Number.isFinite(reps) && !Number.isInteger(reps)
            ? "Las repeticiones tienen que ser un número entero."
            : "Anotá cuántas repeticiones hiciste.";
    }

    const techo = peso > 0 ? 50 : 200;
    if (reps > techo) {
        return peso > 0
            ? `Con ${peso} kg, ${reps} repeticiones no parece real. ¿Sobró un cero?`
            : `${reps} es demasiado. Revisá el número.`;
    }

    const rpe = s.rpe === null || s.rpe === undefined || s.rpe === "" ? null : Number(s.rpe);
    if (rpe !== null && (!Number.isFinite(rpe) || rpe < 1 || rpe > 10)) {
        return "El esfuerzo va de 1 a 10.";
    }

    return null;
}

/* ── Almacén ──────────────────────────────────────────────────────── */

const Almacen = {

    _sincronizando: false,
    _sesionRechazada: false,

    /**
     * Guarda una serie. Lanza si los datos no son válidos, para que la
     * pantalla pueda decirlo en vez de fingir que guardó.
     */
    async guardarSerie(serie) {
        const error = validarSerie(serie);
        if (error) {
            const e = new Error(error);
            e.invalida = true;
            throw e;
        }

        const dueno = duenoActual();
        if (!dueno) throw new Error("No hay una sesión abierta.");

        const registro = {
            ...serie,
            id_local: serie.id_local || nuevoIdLocal(),
            usuario_id: dueno,
            realizada_en: serie.realizada_en || new Date().toISOString(),
            enviada: false
        };
        await tx("pendientes", "readwrite", s => s.put(registro));

        this.sincronizar().catch(() => {});
        return registro;
    },

    /** Sólo lo pendiente de la persona que tiene la sesión abierta. */
    async pendientes() {
        const dueno = duenoActual();
        const todas = await tx("pendientes", "readonly", s => s.getAll());
        return (todas || []).filter(s => !s.enviada && (dueno === null || s.usuario_id === dueno));
    },

    async cuantasPendientes() {
        try { return (await this.pendientes()).length; }
        catch { return 0; }
    },

    /** Series que el servidor rechazó y que la persona tendría que revisar. */
    async rechazadas() {
        const dueno = duenoActual();
        const todas = await tx("pendientes", "readonly", s => s.getAll());
        return (todas || []).filter(s => s.rechazada && (dueno === null || s.usuario_id === dueno));
    },

    /** Descarta una serie rechazada, una vez que la persona la vio. */
    async descartar(idLocal) {
        return tx("pendientes", "readwrite", s => s.delete(idLocal));
    },

    async sincronizar() {
        if (!navigator.onLine) return { enviadas: 0, motivo: "sin conexión" };

        // Una sola sincronización a la vez. Tres cosas la disparan
        // -recuperar conexión, volver a la aplicación y guardar una
        // serie- y pueden coincidir.
        //
        // Si ya hay una en curso, la solicitud no se descarta: se anota
        // para volver a intentar al terminar. Descartarla perdía la
        // última serie de la sesión, que es la que se registra justo
        // cuando la aplicación vuelve al primer plano.
        if (this._sincronizando) {
            this._pedidoPendiente = true;
            return { enviadas: 0, motivo: "ya en curso" };
        }

        if (!localStorage.getItem("pulso_token")) return { enviadas: 0, motivo: "sin sesión" };
        if (this._sesionRechazada) {
            return { enviadas: 0, motivo: "la sesión venció; los datos siguen guardados" };
        }

        const cola = await this.pendientes();
        if (cola.length === 0) return { enviadas: 0 };

        this._sincronizando = true;
        const total = { enviadas: 0, yaEstaban: 0, rechazadas: 0 };

        try {
            // La cola se manda por lotes: el servidor rechaza envíos
            // grandes de una sola vez, y una cola de varias sesiones sin
            // señal quedaba trabada para siempre.
            for (let i = 0; i < cola.length; i += TAMANO_LOTE) {
                const r = await this._enviar(cola.slice(i, i + TAMANO_LOTE));
                if (r.motivo) return { ...total, motivo: r.motivo };
                total.enviadas  += r.enviadas || 0;
                total.yaEstaban += r.yaEstaban || 0;
                total.rechazadas += r.rechazadas || 0;
            }
            await this.guardarDato("ultima_sincronizacion", new Date().toISOString());
            return total;
        } finally {
            this._sincronizando = false;

            // Si llegaron solicitudes mientras esto corría, se atienden
            // ahora. Sin `await` para no encadenar la espera del que
            // llamó primero.
            if (this._pedidoPendiente) {
                this._pedidoPendiente = false;
                setTimeout(() => this.sincronizar().catch(() => {}), 0);
            }
        }
    },

    async _enviar(lote) {
        const cuerpo = lote.map(s => ({
            id_local: s.id_local,
            ejercicio_id: s.ejercicio_id,
            rutina_ejercicio_id: s.rutina_ejercicio_id || null,
            serie_num: s.serie_num,
            repeticiones: s.repeticiones,
            peso_kg: s.peso_kg,
            rpe: s.rpe,
            realizada_en: s.realizada_en
        }));

        const res = await fetch("/api/entrenamiento/series", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + (localStorage.getItem("pulso_token") || "")
            },
            body: JSON.stringify({ series: cuerpo })
        });

        // Un 401 no se reintenta: la cola queda intacta y el envío se
        // reanuda cuando la persona vuelva a entrar.
        if (res.status === 401) {
            this._sesionRechazada = true;
            return { enviadas: 0, motivo: "la sesión venció; los datos siguen guardados" };
        }
        if (!res.ok) throw new Error("El servidor rechazó el envío.");

        const datos = await res.json();

        const aceptadas = new Set(
            (datos.detalle || []).filter(d => d.id_local).map(d => d.id_local)
        );
        const rechazadas = new Map(
            (datos.rechazadas || []).filter(r => r.id_local).map(r => [r.id_local, r.motivo])
        );

        await abrirBD().then(d => new Promise((resolver, rechazar) => {
            const t = d.transaction("pendientes", "readwrite");
            const s = t.objectStore("pendientes");

            // Las aceptadas salen de la cola.
            for (const id of aceptadas) s.delete(id);

            // Las rechazadas NO se borran: se marcan para que la
            // aplicación pueda mostrarlas. Borrarlas en silencio es
            // perder el dato y además mentir con el tilde de guardado.
            for (const [id, motivo] of rechazadas) {
                const original = lote.find(x => x.id_local === id);
                if (!original) continue;
                s.put({ ...original, rechazada: true, motivo_rechazo: motivo || "el servidor no la aceptó" });
            }

            t.oncomplete = resolver;
            t.onerror = () => rechazar(t.error);
            t.onabort = () => rechazar(t.error);
        }));

        return {
            enviadas: datos.guardadas || 0,
            yaEstaban: datos.duplicadas || 0,
            rechazadas: rechazadas.size
        };
    },

    reanudar() { this._sesionRechazada = false; },

    /* ── Rutinas descargadas ──────────────────────────────────────── */

    /** La clave lleva el dueño: dos personas en el mismo teléfono no se pisan. */
    _claveRutina(usuarioId, fecha) {
        return `${usuarioId}|${String(fecha).slice(0, 10)}`;
    },

    async guardarRutina(rutina) {
        const dueno = duenoActual();
        if (!dueno) return;
        const fecha = String(rutina.fecha).slice(0, 10);
        return tx("rutinas", "readwrite",
            s => s.put({ ...rutina, fecha, usuario_id: dueno, clave: this._claveRutina(dueno, fecha) }));
    },

    async guardarPaquete(paquete) {
        for (const r of paquete.rutinas || []) await this.guardarRutina(r);
        await this.guardarDato("avisos_salud", paquete.avisos || []);
        await this.guardarDato("paquete_descargado", new Date().toISOString());
        return (paquete.rutinas || []).length;
    },

    async rutinaDe(fecha) {
        const dueno = duenoActual();
        if (!dueno) return null;
        const r = await tx("rutinas", "readonly", s => s.get(this._claveRutina(dueno, fecha)));
        // Comprobación redundante a propósito: mostrarle a alguien la
        // rutina de otra persona -sin sus avisos de salud- es el peor
        // fallo posible en esta aplicación.
        return r && r.usuario_id === dueno ? r : null;
    },

    async limpiarViejas(diasAtras = 14) {
        const corte = new Date();
        corte.setDate(corte.getDate() - diasAtras);
        const limite = corte.toISOString().slice(0, 10);

        const todas = await tx("rutinas", "readonly", s => s.getAll());
        const viejas = (todas || []).filter(r => r.fecha < limite).map(r => r.clave);
        if (viejas.length === 0) return 0;

        await abrirBD().then(d => new Promise((resolver) => {
            const t = d.transaction("rutinas", "readwrite");
            const s = t.objectStore("rutinas");
            viejas.forEach(c => s.delete(c));
            t.oncomplete = resolver;
            t.onabort = resolver;
        }));
        return viejas.length;
    },

    /* ── Datos sueltos ────────────────────────────────────────────── */

    async guardarDato(clave, valor) {
        const dueno = duenoActual();
        return tx("cache", "readwrite", s => s.put({ clave: `${dueno}|${clave}`, valor }));
    },

    async leerDato(clave) {
        const dueno = duenoActual();
        const r = await tx("cache", "readonly", s => s.get(`${dueno}|${clave}`));
        return r ? r.valor : null;
    },

    /**
     * Borra los datos del dispositivo al cerrar sesión.
     *
     * Las series sin enviar NO se borran: son trabajo real que nadie
     * puede reconstruir. Se conservan atadas a su dueño y salen cuando
     * esa persona vuelva a entrar. Lo demás -rutinas, cachés- sí se
     * limpia, porque es lo que permitía que el siguiente en usar el
     * teléfono viera la rutina del anterior.
     */
    async cerrarSesion() {
        const quedan = await this.cuantasPendientes().catch(() => 0);

        await tx("rutinas", "readwrite", s => s.clear()).catch(() => {});
        await tx("cache", "readwrite", s => s.clear()).catch(() => {});

        // Las respuestas de la API guardadas por el service worker se
        // indexan sólo por dirección, así que son las mismas para
        // cualquiera que use el teléfono.
        if (window.caches) {
            const claves = await caches.keys().catch(() => []);
            await Promise.all(claves.filter(k => k.includes("datos")).map(k => caches.delete(k)))
                .catch(() => {});
        }

        this._sesionRechazada = false;
        return quedan;
    },

    /** Borra absolutamente todo. Sólo para depurar. */
    async vaciar() {
        for (const almacen of ["pendientes", "rutinas", "cache"]) {
            await tx(almacen, "readwrite", s => s.clear()).catch(() => {});
        }
    }
};

/* ── Exposición global ────────────────────────────────────────────── */

// `const` en el ámbito superior de un script clásico NO crea una
// propiedad en `window`. Sin esta línea, cada `if (window.Almacen)` del
// resto de la aplicación resultaba falso en silencio: el cierre de
// sesión no limpiaba nada y el contador de series pendientes marcaba
// siempre cero, que es justo lo que ocultaba los demás fallos.
window.Almacen = Almacen;

/* ── Sincronización automática ────────────────────────────────────── */

window.addEventListener("online", () => {
    Almacen.sincronizar()
        .then(r => { if (typeof window.alSincronizar === "function") window.alSincronizar(r); })
        .catch(() => {});
});

document.addEventListener("visibilitychange", () => {
    if (!document.hidden) Almacen.sincronizar().catch(() => {});
});
