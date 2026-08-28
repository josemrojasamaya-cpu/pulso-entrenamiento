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
      identificador y no duplica. Sin esto, un mal momento de señal
      convierte tres series en seis.

   3. Lo local no se borra hasta que el servidor confirma. La cola sólo
      se vacía con confirmación explícita.
   ===================================================================== */

const BD_NOMBRE = "forja";
const BD_VERSION = 1;

let bd = null;

function abrirBD() {
    if (bd) return Promise.resolve(bd);
    return new Promise((resolver, rechazar) => {
        const p = indexedDB.open(BD_NOMBRE, BD_VERSION);

        p.onupgradeneeded = (e) => {
            const d = e.target.result;
            // Cola de series pendientes de enviar.
            if (!d.objectStoreNames.contains("pendientes")) {
                const s = d.createObjectStore("pendientes", { keyPath: "id_local" });
                s.createIndex("por_fecha", "realizada_en");
            }
            // Rutinas descargadas para usar sin señal.
            if (!d.objectStoreNames.contains("rutinas")) {
                d.createObjectStore("rutinas", { keyPath: "fecha" });
            }
            // Datos sueltos: perfil, último paquete, marca de sincronización.
            if (!d.objectStoreNames.contains("cache")) {
                d.createObjectStore("cache", { keyPath: "clave" });
            }
        };

        p.onsuccess = () => { bd = p.result; resolver(bd); };
        p.onerror = () => rechazar(p.error);
    });
}

function tx(almacen, modo, operacion) {
    return abrirBD().then(d => new Promise((resolver, rechazar) => {
        const t = d.transaction(almacen, modo);
        const s = t.objectStore(almacen);
        const pedido = operacion(s);
        t.oncomplete = () => resolver(pedido ? pedido.result : undefined);
        t.onerror = () => rechazar(t.error);
    }));
}

/** Identificador único generado en el dispositivo. */
function nuevoIdLocal() {
    const azar = crypto.getRandomValues(new Uint32Array(2));
    return `${Date.now().toString(36)}-${azar[0].toString(36)}${azar[1].toString(36)}`;
}

/* ── Series ───────────────────────────────────────────────────────── */

const Almacen = {

    /**
     * Guarda una serie. Devuelve apenas queda a salvo en el teléfono;
     * el envío al servidor ocurre después y puede fallar sin que se
     * pierda nada.
     */
    async guardarSerie(serie) {
        const registro = {
            ...serie,
            id_local: serie.id_local || nuevoIdLocal(),
            realizada_en: serie.realizada_en || new Date().toISOString(),
            enviada: false
        };
        await tx("pendientes", "readwrite", s => s.put(registro));

        // Se intenta enviar de inmediato, pero sin bloquear: si no hay
        // red, queda en la cola y se manda cuando vuelva.
        this.sincronizar().catch(() => {});
        return registro;
    },

    async pendientes() {
        const todas = await tx("pendientes", "readonly", s => s.getAll());
        return (todas || []).filter(s => !s.enviada);
    },

    async cuantasPendientes() {
        return (await this.pendientes()).length;
    },

    /**
     * Envía la cola al servidor.
     *
     * Las series se borran de la cola sólo cuando el servidor confirma,
     * y también cuando responde que ya las tenía: en ese caso el trabajo
     * está hecho y dejarlas en la cola las reenviaría para siempre.
     */
    async sincronizar() {
        if (!navigator.onLine) return { enviadas: 0, motivo: "sin conexión" };

        // Una sola sincronización a la vez.
        //
        // Tres cosas la disparan -recuperar conexión, volver a la
        // aplicación y guardar una serie- y pueden coincidir. Sin este
        // cerrojo, dos envíos simultáneos mandan el mismo lote; el
        // servidor no duplica gracias al identificador local, pero es
        // tráfico inútil desde un teléfono que suele estar con datos
        // móviles.
        if (this._sincronizando) return { enviadas: 0, motivo: "ya en curso" };

        // Sin sesión válida no tiene sentido reintentar: cada intento es
        // otro 401. Antes esto era un bucle que repetía la petición cada
        // pocos segundos indefinidamente.
        if (!localStorage.getItem("forja_token")) {
            return { enviadas: 0, motivo: "sin sesión" };
        }
        if (this._sesionRechazada) {
            return { enviadas: 0, motivo: "la sesión venció; los datos siguen guardados" };
        }

        const cola = await this.pendientes();
        if (cola.length === 0) return { enviadas: 0 };

        this._sincronizando = true;
        try {
            return await this._enviar(cola);
        } finally {
            this._sincronizando = false;
        }
    },

    /** Vuelve a habilitar el envío tras un inicio de sesión nuevo. */
    reanudar() {
        this._sesionRechazada = false;
    },

    async _enviar(cola) {

        const lote = cola.map(s => ({
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
                "Authorization": "Bearer " + (localStorage.getItem("forja_token") || "")
            },
            body: JSON.stringify({ series: lote })
        });

        // Un 401 no se reintenta: la cola queda intacta y el envío se
        // reanuda cuando la persona vuelva a entrar. Los datos no se
        // pierden, sólo esperan.
        if (res.status === 401) {
            this._sesionRechazada = true;
            return { enviadas: 0, motivo: "la sesión venció; los datos siguen guardados" };
        }
        if (!res.ok) throw new Error("El servidor rechazó el envío.");
        const datos = await res.json();

        // El servidor devuelve, por cada serie, si la guardó o si ya la
        // tenía. Las dos cuentan como resueltas.
        const resueltas = new Set(
            (datos.detalle || []).filter(d => d.id_local).map(d => d.id_local)
        );
        // Las rechazadas también salen de la cola: reintentarlas para
        // siempre no las va a hacer válidas, y se avisa aparte.
        const rechazadas = new Set((datos.rechazadas || []).map(r => r.id_local).filter(Boolean));

        await abrirBD().then(d => new Promise((resolver, rechazar) => {
            const t = d.transaction("pendientes", "readwrite");
            const s = t.objectStore("pendientes");
            for (const id of resueltas) s.delete(id);
            for (const id of rechazadas) s.delete(id);
            t.oncomplete = resolver;
            t.onerror = () => rechazar(t.error);
        }));

        await this.guardarDato("ultima_sincronizacion", new Date().toISOString());

        return {
            enviadas: datos.guardadas || 0,
            yaEstaban: datos.duplicadas || 0,
            rechazadas: (datos.rechazadas || []).length
        };
    },

    /* ── Rutinas descargadas ──────────────────────────────────────── */

    async guardarRutina(rutina) {
        const fecha = String(rutina.fecha).slice(0, 10);
        return tx("rutinas", "readwrite", s => s.put({ ...rutina, fecha }));
    },

    async guardarPaquete(paquete) {
        for (const r of paquete.rutinas || []) await this.guardarRutina(r);
        await this.guardarDato("avisos_salud", paquete.avisos || []);
        await this.guardarDato("paquete_descargado", new Date().toISOString());
        return (paquete.rutinas || []).length;
    },

    async rutinaDe(fecha) {
        return tx("rutinas", "readonly", s => s.get(String(fecha).slice(0, 10)));
    },

    /** Limpia rutinas viejas: no tiene sentido acumularlas para siempre. */
    async limpiarViejas(diasAtras = 14) {
        const corte = new Date();
        corte.setDate(corte.getDate() - diasAtras);
        const limite = corte.toISOString().slice(0, 10);

        const todas = await tx("rutinas", "readonly", s => s.getAll());
        const viejas = (todas || []).filter(r => r.fecha < limite).map(r => r.fecha);
        if (viejas.length === 0) return 0;

        await abrirBD().then(d => new Promise((resolver) => {
            const t = d.transaction("rutinas", "readwrite");
            const s = t.objectStore("rutinas");
            viejas.forEach(f => s.delete(f));
            t.oncomplete = resolver;
        }));
        return viejas.length;
    },

    /* ── Datos sueltos ────────────────────────────────────────────── */

    async guardarDato(clave, valor) {
        return tx("cache", "readwrite", s => s.put({ clave, valor }));
    },

    async leerDato(clave) {
        const r = await tx("cache", "readonly", s => s.get(clave));
        return r ? r.valor : null;
    },

    /** Borra todo. Se usa al cerrar sesión: los datos son personales. */
    async vaciar() {
        for (const almacen of ["pendientes", "rutinas", "cache"]) {
            await tx(almacen, "readwrite", s => s.clear()).catch(() => {});
        }
    }
};

/* ── Sincronización automática ────────────────────────────────────── */

// Al recuperar la conexión se manda lo pendiente sin que nadie lo pida.
window.addEventListener("online", () => {
    Almacen.sincronizar()
        .then(r => {
            if (r.enviadas > 0 && typeof window.alSincronizar === "function") {
                window.alSincronizar(r);
            }
        })
        .catch(() => {});
});

// Y también al volver a la aplicación, que es cuando la persona sale del
// gimnasio y recupera señal sin que el evento `online` llegue a dispararse.
document.addEventListener("visibilitychange", () => {
    if (!document.hidden) Almacen.sincronizar().catch(() => {});
});
