/* =====================================================================
   comun.js — sesión, llamadas a la API y utilidades compartidas.
   ===================================================================== */

const Sesion = {
  guardar(token, usuario) {
    localStorage.setItem("pulso_token", token);
    localStorage.setItem("pulso_usuario", JSON.stringify(usuario));
    // Con sesión nueva se vuelve a habilitar el envío: si había series
    // esperando porque la anterior había vencido, salen ahora.
    if (window.Almacen) {
      Almacen.reanudar();
      Almacen.sincronizar().catch(() => {});
    }
  },
  token()   { return localStorage.getItem("pulso_token"); },
  usuario() {
    try { return JSON.parse(localStorage.getItem("pulso_usuario") || "null"); }
    catch { return null; }
  },
  /**
   * Cierra la sesión limpiando lo que es personal.
   *
   * Las series sin enviar NO se borran: son trabajo real que nadie puede
   * reconstruir. Quedan atadas a su dueño y salen cuando esa persona
   * vuelva a entrar. Si hay alguna, se avisa antes: en un teléfono
   * compartido, cerrar sesión sin señal es exactamente el momento en que
   * se perderían.
   */
  async cerrar() {
    if (window.Almacen) {
      const pendientes = await Almacen.cerrarSesion().catch(() => 0);
      if (pendientes > 0) {
        const seguir = confirm(
          `Tenés ${pendientes} serie${pendientes === 1 ? "" : "s"} sin enviar al servidor.\n\n` +
          "Quedan guardadas en este teléfono y se envían solas cuando vuelvas a entrar " +
          "con tu cuenta. ¿Cerrar sesión igual?"
        );
        if (!seguir) return;
      }
    }
    localStorage.removeItem("pulso_token");
    localStorage.removeItem("pulso_usuario");
    location.href = "login.html";
  },
  exigir() {
    const u = this.usuario();
    if (!this.token() || !u) { location.href = "login.html"; return null; }
    return u;
  }
};

/**
 * Llamada a la API.
 *
 * Sin conexión no lanza un error críptico: devuelve una señal que la
 * pantalla puede usar para mostrar lo que tenga guardado en el teléfono,
 * que es justo lo que hace falta en un gimnasio sin señal.
 */
async function api(ruta, opciones = {}) {
  const cfg = {
    method: opciones.method || "GET",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + (Sesion.token() || "")
    }
  };
  if (opciones.body !== undefined) cfg.body = JSON.stringify(opciones.body);

  let res;
  try {
    res = await fetch("/api" + ruta, cfg);
  } catch {
    const e = new Error("Sin conexión.");
    e.sinRed = true;
    throw e;
  }

  if (res.status === 401) {
    await Sesion.cerrar();
    throw new Error("Sesión vencida.");
  }

  const datos = await res.json().catch(() => ({}));

  if (res.status === 503 && datos._sinRed) {
    const e = new Error(datos.message || "Sin conexión.");
    e.sinRed = true;
    throw e;
  }
  if (!res.ok) throw new Error(datos.message || `Error ${res.status}.`);

  return datos;
}

/* ── Formato ──────────────────────────────────────────────────────── */

const MESES = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
const DIAS  = ["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];

/** Convierte una fecha del servidor a Date sin corrimiento de zona. */
function aFecha(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  const s = String(v);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  // Una fecha pura interpretada como UTC se corre un día hacia atrás en
  // América. Se construye en hora local a propósito.
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  return new Date(s);
}

function fecha(v, conAnio = true) {
  const d = aFecha(v);
  if (!d || isNaN(d)) return "—";
  return `${d.getDate()} ${MESES[d.getMonth()]}${conAnio ? " " + d.getFullYear() : ""}`;
}

function diaSemana(v) {
  const d = aFecha(v);
  return d && !isNaN(d) ? DIAS[d.getDay()] : "";
}

function relativo(v) {
  const d = aFecha(v);
  if (!d || isNaN(d)) return "";
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const otra = new Date(d); otra.setHours(0,0,0,0);
  const dias = Math.round((otra - hoy) / 86400000);

  if (dias === 0)  return "hoy";
  if (dias === 1)  return "mañana";
  if (dias === -1) return "ayer";
  if (dias < 0) {
    const n = -dias;
    if (n < 30)  return `hace ${n} días`;
    if (n < 365) return `hace ${Math.round(n/30)} meses`;
    return `hace ${Math.floor(n/365)} año${n >= 730 ? "s" : ""}`;
  }
  if (dias < 30) return `en ${dias} días`;
  return `en ${Math.round(dias/30)} meses`;
}

function hoyISO(desplazamiento = 0) {
  const d = new Date();
  d.setDate(d.getDate() + desplazamiento);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function esc(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

function escLineas(s) { return esc(s).replace(/\n/g,"<br>"); }

/** "3 x 8-12 reps" o "2 x 20-35 seg". */
function formatoSerie(e) {
  const u = e.medida === "segundos" ? "seg"
          : e.medida === "minutos"  ? "min" : "reps";
  const rango = e.rep_min === e.rep_max ? `${e.rep_min}` : `${e.rep_min}-${e.rep_max}`;
  return e.medida === "minutos" ? `${rango} ${u}` : `${e.series} × ${rango} ${u}`;
}

const NOMBRE_EQUIPO = {
  peso_corporal:"Peso corporal", mancuernas:"Mancuernas", barra:"Barra",
  maquina:"Máquina", banda:"Banda elástica", kettlebell:"Kettlebell", polea:"Polea"
};
const NOMBRE_OBJETIVO = {
  perder_grasa:"Perder grasa", ganar_musculo:"Ganar masa muscular",
  fuerza:"Fuerza", resistencia:"Resistencia", salud:"Salud general"
};
const NOMBRE_GRUPO = {
  pecho:"Pecho", espalda:"Espalda", hombros:"Hombros", biceps:"Bíceps",
  triceps:"Tríceps", cuadriceps:"Cuádriceps", femoral:"Femoral",
  gluteos:"Glúteos", pantorrilla:"Pantorrilla", core:"Core",
  cardio:"Cardio", cuerpo_completo:"Cuerpo completo"
};

/* ── Estructura compartida ────────────────────────────────────────── */

const ICONOS = {
  hoy:      '<path d="M3 9h18M7 3v4M17 3v4M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/>',
  medidas:  '<path d="M2 8h20v8H2zM6 8v3M10 8v5M14 8v3M18 8v5"/>',
  progreso: '<path d="M3 3v18h18M7 15l4-5 3 3 5-7"/>',
  ranking:  '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
  grupos:   '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  perfil:   '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a7 7 0 0 1 14 0v1"/>'
};

function pintarEstructura(activo) {
  const u = Sesion.usuario();
  if (!u) return;

  const top = document.getElementById("top");
  if (top) {
    top.innerHTML = `
      <div class="top-in">
        <a class="marca" href="hoy.html">
          <img class="marca-i" src="/icono.svg" alt=""><b>Pulso</b>
        </a>
        <div class="der">
          <div class="usuario-chip">
            <span class="nombre">${esc(String(u.nombre).split(" ")[0])}</span>
            <span class="nivel-pin" id="pin-nivel">—</span>
          </div>
          <button class="salir" onclick="Sesion.cerrar()">Salir</button>
        </div>
      </div>`;
  }

  const tabs = document.getElementById("tabs");
  if (tabs) {
    // Cinco pestañas es el techo en un teléfono: con seis, cada una
    // queda tan angosta que el texto no entra y se toca la de al lado.
    // El ranking general vive dentro de Grupos, que es donde la
    // comparación tiene sentido — competir con desconocidos motiva
    // mucho menos que competir con tu gente.
    const enlaces = [
      { id:"hoy",      txt:"Hoy",      href:"hoy.html" },
      { id:"medidas",  txt:"Medidas",  href:"medidas.html" },
      { id:"progreso", txt:"Progreso", href:"progreso.html" },
      { id:"grupos",   txt:"Grupos",   href:"grupos.html" },
      { id:"perfil",   txt:"Perfil",   href:"perfil.html" }
    ];
    tabs.innerHTML = enlaces.map(e => `
      <a href="${e.href}" class="${e.id === activo ? "on" : ""}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-linecap="round" stroke-linejoin="round">${ICONOS[e.id]}</svg>
        ${e.txt}
      </a>`).join("");
  }

  mostrarNivel();
  vigilarConexion();
}

async function mostrarNivel() {
  const pin = document.getElementById("pin-nivel");
  if (!pin) return;
  const u = Sesion.usuario();
  try {
    const r = await api(`/progreso/${u.id}/resumen`);
    pin.textContent = `Nv ${r.nivel.nivel}`;
    pin.title = `${r.nivel.titulo} · ${r.nivel.puntos} puntos`;
  } catch {
    pin.style.display = "none";
  }
}

/* ── Conexión ─────────────────────────────────────────────────────── */

function vigilarConexion() {
  let barra = document.getElementById("sin-red");
  if (!barra) {
    barra = document.createElement("div");
    barra.id = "sin-red";
    barra.className = "sin-red";
    document.body.appendChild(barra);
  }

  async function refrescar() {
    if (!window.Almacen) { barra.classList.remove("visible"); return; }

    const pendientes = await Almacen.cuantasPendientes().catch(() => 0);
    const rechazadas = await Almacen.rechazadas().catch(() => []);

    // Lo rechazado va primero: es lo único que exige que la persona
    // haga algo. Antes se borraba en silencio y nadie se enteraba.
    if (rechazadas.length > 0) {
      barra.className = "sin-red visible problema";
      barra.innerHTML =
        `<span class="punto-alerta"></span> ${rechazadas.length} ` +
        `serie${rechazadas.length === 1 ? "" : "s"} sin guardar · tocá para revisar`;
      barra.onclick = () => mostrarRechazadas(rechazadas);
      return;
    }

    barra.onclick = null;
    barra.className = "sin-red";

    if (!navigator.onLine) {
      barra.innerHTML = `<span class="punto-alerta"></span> Sin conexión` +
        (pendientes ? ` · ${pendientes} serie${pendientes === 1 ? "" : "s"} en espera`
                    : " · podés seguir entrenando");
      barra.classList.add("visible");
    } else if (pendientes > 0) {
      barra.innerHTML = `<span class="punto-alerta"></span> Enviando ${pendientes}…`;
      barra.classList.add("visible");
    } else {
      barra.classList.remove("visible");
    }
  }

  /**
   * Reintento periódico.
   *
   * Los eventos `online` y `visibilitychange` no cubren el caso más
   * común: la wifi sigue asociada y lo que se cayó fue el enlace, así
   * que el navegador nunca dice que volvió la conexión. Sin este
   * intervalo, nada salía del teléfono mientras la persona siguiera
   * mirando la misma pantalla.
   */
  async function latido() {
    if (navigator.onLine && window.Almacen) {
      const r = await Almacen.sincronizar().catch(() => null);
      if (r && (r.enviadas > 0 || r.rechazadas > 0)) await refrescar();
    }
    await refrescar();
  }

  window.addEventListener("online", latido);
  window.addEventListener("offline", refrescar);
  window.alSincronizar = refrescar;
  setInterval(latido, 15000);
  latido();
}

/** Lista las series que el servidor no aceptó, con su motivo. */
async function mostrarRechazadas(lista) {
  const detalle = lista.map(s =>
    `· ${s.repeticiones} repeticiones` + (s.peso_kg ? ` con ${s.peso_kg} kg` : "") +
    `\n  ${s.motivo_rechazo || "el servidor no la aceptó"}`
  ).join("\n\n");

  const borrar = confirm(
    `Estas series no se pudieron guardar:\n\n${detalle}\n\n` +
    "Anotalas de nuevo con los valores correctos.\n\n¿Descartarlas de la lista?"
  );
  if (borrar) {
    for (const s of lista) await Almacen.descartar(s.id_local).catch(() => {});
    if (typeof window.alSincronizar === "function") window.alSincronizar();
  }
}

/* ── Service worker ───────────────────────────────────────────────── */

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Sin service worker la aplicación sigue funcionando con red; sólo
      // se pierde el modo sin conexión. No es motivo para molestar.
    });
  });
}

/* ── Modales ──────────────────────────────────────────────────────── */

function abrirModal(id)  { document.getElementById(id).classList.add("abierto"); }
function cerrarModal(id) { document.getElementById(id).classList.remove("abierto"); }

document.addEventListener("click", e => {
  if (e.target.classList && e.target.classList.contains("telon")) {
    e.target.classList.remove("abierto");
  }
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    document.querySelectorAll(".telon.abierto").forEach(t => t.classList.remove("abierto"));
  }
});
