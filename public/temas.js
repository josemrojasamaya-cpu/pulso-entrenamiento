/**
 * public/temas.js — paletas de color.
 *
 * Cada paleta cambia SEIS variables. Todo lo demás —bordes, textos
 * secundarios, sombras— se calcula a partir de esas seis, y por eso una
 * paleta nueva son seis líneas y no una hoja de estilos entera.
 *
 * Dos decisiones que importan:
 *
 *   1. El tema se aplica ANTES de que la página pinte, leyéndolo del
 *      almacenamiento local. Si se aplicara al terminar de cargar, cada
 *      pantalla arrancaría en azul y saltaría al color elegido: un
 *      parpadeo en cada navegación que se ve barato.
 *
 *   2. Se guarda también en el servidor, pero el que manda para pintar
 *      es el local. Esperar a la red para saber de qué color va la
 *      pantalla sería esperar a la red para dibujar.
 *
 * Los temas de pago se comprueban en el servidor al guardarlos. Acá se
 * aplican sin preguntar: alguien que fuerce uno desde la consola del
 * navegador se pinta su propia pantalla de otro color, y eso no le quita
 * nada a nadie. Lo que no puede es guardarlo.
 */

const TEMAS = {
    acero: {
        nombre: "Acero", gratis: true,
        descripcion: "Gris y azul. El de siempre.",
        c: { fondo:"#0e1216", sup:"#131920", borde:"#2a3541",
             ac:"#3d7fd6", ac2:"#2b74c4", tx:"#e8eef4" }
    },
    carbon: {
        nombre: "Carbón", gratis: true,
        descripcion: "Casi negro. Menos brillo para entrenar de noche.",
        c: { fondo:"#08090b", sup:"#101215", borde:"#22262c",
             ac:"#8b93a0", ac2:"#6b7382", tx:"#e6e8ec" }
    },
    brasa: {
        nombre: "Brasa", gratis: false,
        descripcion: "Naranja sobre negro. Para quien entrena fuerte.",
        c: { fondo:"#100c09", sup:"#191310", borde:"#33261c",
             ac:"#e07a3c", ac2:"#c4622a", tx:"#f2ebe5" }
    },
    selva: {
        nombre: "Selva", gratis: false,
        descripcion: "Verde profundo. Descansa la vista.",
        c: { fondo:"#0a1210", sup:"#101a17", borde:"#1f3229",
             ac:"#3fb27f", ac2:"#2d8f64", tx:"#e5f0ea" }
    },
    vino: {
        nombre: "Vino", gratis: false,
        descripcion: "Granate. Serio y poco común.",
        c: { fondo:"#120a0d", sup:"#1c1015", borde:"#361f28",
             ac:"#c9455f", ac2:"#a63549", tx:"#f2e5e9" }
    },
    indigo: {
        nombre: "Índigo", gratis: false,
        descripcion: "Violeta oscuro. El más nocturno.",
        c: { fondo:"#0c0a14", sup:"#14111f", borde:"#282139",
             ac:"#7c6ce0", ac2:"#6355c4", tx:"#e9e6f4" }
    },
    hielo: {
        nombre: "Hielo", gratis: false,
        descripcion: "Claro. Para quien no soporta las pantallas oscuras.",
        claro: true,
        c: { fondo:"#f4f6f9", sup:"#ffffff", borde:"#dde3ea",
             ac:"#2b6fc4", ac2:"#1f5aa8", tx:"#111820" }
    },
    arena: {
        nombre: "Arena", gratis: false,
        descripcion: "Claro y cálido. Menos frío que el blanco puro.",
        claro: true,
        c: { fondo:"#f7f4ef", sup:"#fffdfa", borde:"#e6ded2",
             ac:"#b06a2c", ac2:"#94571f", tx:"#1c1712" }
    }
};

const Temas = {
    TEMAS,

    /** Mezcla dos colores hex. Sirve para derivar toda la escala. */
    mezcla(a, b, p) {
        const h = (c) => [1,3,5].map(i => parseInt(c.slice(i, i+2), 16));
        const [r1,g1,b1] = h(a), [r2,g2,b2] = h(b);
        const m = (x, y) => Math.round(x + (y - x) * p).toString(16).padStart(2, "0");
        return `#${m(r1,r2)}${m(g1,g2)}${m(b1,b2)}`;
    },

    /**
     * Pinta un tema.
     *
     * De seis colores salen las veinte y pico variables que usa la
     * aplicación. Definirlas todas a mano en cada paleta sería garantizar
     * que la novena se olvide de dos y quede un texto invisible.
     */
    aplicar(codigo) {
        const t = TEMAS[codigo] || TEMAS.acero;
        const c = t.c;
        const r = document.documentElement.style;
        const esClaro = !!t.claro;
        // En un tema claro las mezclas van hacia el negro, no hacia el
        // blanco: al revés, todo quedaría lavado e ilegible.
        const contra = esClaro ? "#000000" : "#ffffff";
        const hacia  = esClaro ? "#ffffff" : "#000000";

        const set = (k, v) => r.setProperty(k, v);

        set("--bg", c.fondo);
        set("--sup", c.sup);
        set("--borde", c.borde);
        set("--az", c.ac);
        set("--az-2", c.ac2);
        set("--az-3", this.mezcla(c.ac, hacia, .55));
        set("--az-tenue", this.mezcla(c.ac, c.fondo, .84));
        set("--tx", c.tx);
        set("--tx2", this.mezcla(c.tx, c.fondo, .38));
        set("--tx3", this.mezcla(c.tx, c.fondo, .58));

        set("--gr-900", c.fondo);
        set("--gr-950", this.mezcla(c.fondo, hacia, .35));
        set("--gr-875", this.mezcla(c.fondo, c.sup, .5));
        set("--gr-850", c.sup);
        set("--gr-800", this.mezcla(c.sup, contra, .04));
        set("--gr-750", this.mezcla(c.sup, contra, .09));
        set("--gr-700", this.mezcla(c.sup, contra, .16));
        set("--gr-600", this.mezcla(c.sup, contra, .26));
        set("--gr-400", this.mezcla(c.tx, c.fondo, .55));
        set("--gr-300", this.mezcla(c.tx, c.fondo, .3));
        set("--gr-200", this.mezcla(c.tx, c.fondo, .18));
        set("--gr-100", this.mezcla(c.tx, c.fondo, .06));

        // Los colores de estado NO cambian con la paleta. Verde es
        // "salió bien" y rojo es "algo falló" en cualquier tema; teñirlos
        // de granate o de naranja para que combinen haría que un aviso de
        // error se lea como decoración.
        set("--ok", esClaro ? "#1d7a54" : "#3fb27f");
        set("--ok-tenue", this.mezcla(esClaro ? "#1d7a54" : "#3fb27f", c.fondo, .86));
        set("--ok-3", this.mezcla(esClaro ? "#1d7a54" : "#3fb27f", c.fondo, .6));
        set("--mal", esClaro ? "#b5322e" : "#d9534f");
        set("--mal-tenue", this.mezcla(esClaro ? "#b5322e" : "#d9534f", c.fondo, .86));
        set("--mal-3", this.mezcla(esClaro ? "#b5322e" : "#d9534f", c.fondo, .6));
        set("--alerta", esClaro ? "#a5701e" : "#d8973c");
        set("--alerta-tenue", this.mezcla(esClaro ? "#a5701e" : "#d8973c", c.fondo, .86));
        set("--adv", esClaro ? "#a5701e" : "#d8973c");
        set("--adv-tenue", this.mezcla(esClaro ? "#a5701e" : "#d8973c", c.fondo, .86));
        set("--adv-3", this.mezcla(esClaro ? "#a5701e" : "#d8973c", c.fondo, .6));
        set("--ac", esClaro ? "#a5701e" : "#d8973c");

        // Las superficies translúcidas: barra superior, tarjetas, velos.
        //
        // Estaban escritas como rgba fijos en la hoja de estilos, y por
        // eso al probar la primera paleta clara la pantalla seguía
        // oscura: las variables cambiaban y esos cinco colores no. Ahora
        // se calculan acá, así que una paleta nueva funciona sin tocar
        // el CSS.
        const rgba = (hex, a) => {
            const v = [1,3,5].map(i => parseInt(hex.slice(i, i+2), 16));
            return `rgba(${v[0]},${v[1]},${v[2]},${a})`;
        };
        set("--vidrio",     rgba(c.sup, esClaro ? .90 : .90));
        set("--vidrio-2",   rgba(this.mezcla(c.sup, contra, .045), esClaro ? .92 : .86));
        set("--velo-modal", rgba(c.fondo, esClaro ? .55 : .72));
        set("--velo-1",     rgba(c.fondo, esClaro ? .58 : .82));
        set("--velo-2",     rgba(c.fondo, esClaro ? .70 : .88));
        set("--velo-3",     rgba(c.fondo, esClaro ? .82 : .94));

        document.documentElement.dataset.tema = codigo;
        document.documentElement.dataset.claro = esClaro ? "1" : "0";

        // La barra del sistema en Android toma este color. Sin esto, la
        // aplicación instalada queda con una franja del color anterior.
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute("content", c.sup);
    },

    guardado() {
        try { return localStorage.getItem("pulso_tema") || "acero"; }
        catch (e) { return "acero"; }
    },

    /** Aplica lo guardado. Se llama lo antes posible, antes de pintar. */
    iniciar() { this.aplicar(this.guardado()); },

    /** Guarda y aplica. El servidor confirma después si el plan lo permite. */
    elegir(codigo) {
        if (!TEMAS[codigo]) return;
        try { localStorage.setItem("pulso_tema", codigo); } catch (e) {}
        this.aplicar(codigo);
    }
};

window.Temas = Temas;
Temas.iniciar();
