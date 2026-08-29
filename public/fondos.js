/**
 * public/fondos.js — fondos de pantalla.
 *
 * Los fondos se GENERAN acá, en SVG, en vez de descargarse de un banco
 * de imágenes. Tres razones, en orden de importancia:
 *
 *   1. Son nuestros. Una foto de un banco gratuito puede cambiar de
 *      licencia, desaparecer, o resultar que quien la subió no tenía
 *      derecho a hacerlo. Ese problema aparece cuando la aplicación ya
 *      está publicada y es carísimo de arreglar.
 *
 *   2. Pesan nada. Un SVG de estos ocupa dos o tres kilobytes; una foto
 *      decente, dos megas. En un teléfono con datos móviles, esa
 *      diferencia es la aplicación abriendo al instante o tardando.
 *
 *   3. Se tiñen con la paleta. Cada fondo usa el color de acento del
 *      tema elegido, así que ocho paletas por siete fondos no son
 *      cincuenta y seis imágenes: son siete dibujos que cambian de
 *      color solos.
 *
 * La foto propia es aparte: se guarda en el teléfono de la persona, no
 * se sube a ningún lado. Quien elige la foto de su hijo como fondo no
 * espera que viaje a un servidor, y no tiene por qué viajar.
 */

const FONDOS = {

    silueta: {
        nombre: "Atleta", gratis: true,
        descripcion: "El original. Silueta a contraluz.",
        archivo: "/fondo.svg"
    },

    liso: {
        nombre: "Liso", gratis: true,
        descripcion: "Sin nada. Máxima legibilidad.",
        svg: (c) => `<rect width="100" height="100" fill="${c.fondo}"/>`
    },

    trazo: {
        nombre: "Pulso", gratis: true,
        descripcion: "La línea del latido, muy tenue.",
        svg: (c) => `
            <rect width="1200" height="800" fill="${c.fondo}"/>
            <path d="M-50 400 H200 L260 250 L340 560 L420 190 L500 480 L560 400 H1250"
                  fill="none" stroke="${c.ac}" stroke-width="3.5" opacity=".30"
                  stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M-50 430 H180 L245 300 L330 580 L410 240 L490 500 L545 430 H1250"
                  fill="none" stroke="${c.ac}" stroke-width="2" opacity=".16"
                  stroke-linecap="round"/>`,
        caja: "0 0 1200 800"
    },

    rejilla: {
        nombre: "Rejilla", gratis: false,
        descripcion: "Cuadrícula fina. Ordenado y técnico.",
        svg: (c) => `
            <rect width="800" height="800" fill="${c.fondo}"/>
            <defs>
              <pattern id="rej" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M40 0 L0 0 0 40" fill="none" stroke="${c.ac}"
                      stroke-width="1" opacity=".26"/>
              </pattern>
              <radialGradient id="foco-rej" cx="50%" cy="35%" r="72%">
                <stop offset="0%" stop-color="${c.ac}" stop-opacity=".24"/>
                <stop offset="100%" stop-color="${c.ac}" stop-opacity="0"/>
              </radialGradient>
            </defs>
            <rect width="800" height="800" fill="url(#rej)"/>
            <rect width="800" height="800" fill="url(#foco-rej)"/>`,
        caja: "0 0 800 800"
    },

    ondas: {
        nombre: "Ondas", gratis: false,
        descripcion: "Curvas suaves. Menos rígido.",
        svg: (c) => `
            <rect width="1200" height="900" fill="${c.fondo}"/>
            ${[0,1,2,3,4,5].map(i => `
              <path d="M-100 ${180 + i * 130} C 250 ${100 + i * 130}, 500 ${290 + i * 130},
                       800 ${190 + i * 130} S 1150 ${110 + i * 130}, 1350 ${215 + i * 130}"
                    fill="none" stroke="${c.ac}" stroke-width="${2.4 - i * 0.22}"
                    opacity="${0.32 - i * 0.038}"/>`).join("")}`,
        caja: "0 0 1200 900"
    },

    montana: {
        nombre: "Montaña", gratis: false,
        descripcion: "Cumbres al fondo. Para quien corre afuera.",
        svg: (c) => `
            <defs>
              <linearGradient id="cielo" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="${c.ac}" stop-opacity=".30"/>
                <stop offset="70%" stop-color="${c.fondo}" stop-opacity="0"/>
              </linearGradient>
            </defs>
            <rect width="1200" height="800" fill="${c.fondo}"/>
            <rect width="1200" height="800" fill="url(#cielo)"/>
            <path d="M0 800 L0 560 L180 400 L330 520 L520 300 L700 480 L880 350
                     L1050 500 L1200 420 L1200 800 Z"
                  fill="${c.ac}" opacity=".22"/>
            <path d="M0 800 L0 660 L200 540 L400 640 L600 480 L820 620 L1000 530
                     L1200 610 L1200 800 Z"
                  fill="${c.ac}" opacity=".14"/>`,
        caja: "0 0 1200 800"
    },

    discos: {
        nombre: "Discos", gratis: false,
        descripcion: "Discos de barra, apenas insinuados.",
        svg: (c) => `
            <rect width="900" height="900" fill="${c.fondo}"/>
            ${[[180,220,110],[640,180,80],[420,520,150],[760,640,95],[140,700,70]]
              .map(([x,y,r]) => `
                <circle cx="${x}" cy="${y}" r="${r}" fill="none"
                        stroke="${c.ac}" stroke-width="2.6" opacity=".24"/>
                <circle cx="${x}" cy="${y}" r="${r * 0.42}" fill="none"
                        stroke="${c.ac}" stroke-width="1.8" opacity=".16"/>`).join("")}`,
        caja: "0 0 900 900"
    },

    aurora: {
        nombre: "Aurora", gratis: false,
        descripcion: "Manchas de luz difusa. El más suave.",
        svg: (c) => `
            <defs>
              <radialGradient id="a1" cx="22%" cy="22%" r="52%">
                <stop offset="0%" stop-color="${c.ac}" stop-opacity=".46"/>
                <stop offset="100%" stop-color="${c.ac}" stop-opacity="0"/>
              </radialGradient>
              <radialGradient id="a2" cx="82%" cy="68%" r="48%">
                <stop offset="0%" stop-color="${c.ac2}" stop-opacity=".38"/>
                <stop offset="100%" stop-color="${c.ac2}" stop-opacity="0"/>
              </radialGradient>
              <radialGradient id="a3" cx="52%" cy="92%" r="42%">
                <stop offset="0%" stop-color="${c.ac}" stop-opacity=".13"/>
                <stop offset="100%" stop-color="${c.ac}" stop-opacity="0"/>
              </radialGradient>
            </defs>
            <rect width="1000" height="1000" fill="${c.fondo}"/>
            <rect width="1000" height="1000" fill="url(#a1)"/>
            <rect width="1000" height="1000" fill="url(#a2)"/>
            <rect width="1000" height="1000" fill="url(#a3)"/>`,
        caja: "0 0 1000 1000"
    }
};

const Fondos = {
    FONDOS,

    /** El SVG completo, teñido con la paleta activa, como data URI. */
    generar(codigo, colores) {
        const f = FONDOS[codigo];
        if (!f || !f.svg) return null;

        const caja = f.caja || "0 0 100 100";
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${caja}" ` +
                    `preserveAspectRatio="xMidYMid slice">${f.svg(colores)}</svg>`;

        // encodeURIComponent y no base64: pesa menos, se lee al depurar y
        // no hay que preocuparse por caracteres de más de un byte.
        return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
    },

    /** Aplica el fondo guardado. Se llama al pintar el tema. */
    aplicar(codigo, colores) {
        document.documentElement.dataset.fondo = codigo;
        const f = FONDOS[codigo];
        const raiz = document.documentElement.style;

        if (codigo === "propio") {
            const url = this.fotoPropia();
            if (url) {
                raiz.setProperty("--fondo-img", `url("${url}")`);
                return;
            }
            // Sin foto guardada se cae al original en vez de quedar en
            // blanco: perder el fondo por vaciar el almacenamiento del
            // navegador sería un desperfecto sin explicación visible.
            codigo = "silueta";
        }

        if (!f || f.archivo) {
            raiz.setProperty("--fondo-img", `url('${(f && f.archivo) || "/fondo.svg"}?v=3')`);
            return;
        }

        raiz.setProperty("--fondo-img", this.generar(codigo, colores));
    },

    guardado() {
        try { return localStorage.getItem("pulso_fondo") || "silueta"; }
        catch (e) { return "silueta"; }
    },

    /**
     * La foto propia vive SÓLO en el teléfono.
     *
     * Nunca se sube. Quien pone la foto de su hijo o de su pareja como
     * fondo no espera que viaje a un servidor, y no tiene por qué.
     */
    fotoPropia() {
        try { return localStorage.getItem("pulso_fondo_foto"); }
        catch (e) { return null; }
    },

    guardarFoto(dataUrl) {
        try {
            localStorage.setItem("pulso_fondo_foto", dataUrl);
            return true;
        } catch (e) {
            // El almacenamiento local ronda los 5 MB. Una foto de teléfono
            // sin reducir se los come entera, y entonces falla ESTO y
            // también lo demás que guarda la aplicación.
            return false;
        }
    },

    elegir(codigo) {
        try { localStorage.setItem("pulso_fondo", codigo); } catch (e) {}
        if (window.Temas) window.Temas.aplicar(window.Temas.guardado());
    }
};

window.Fondos = Fondos;
