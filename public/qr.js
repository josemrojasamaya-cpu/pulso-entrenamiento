/* =====================================================================
   qr.js — códigos QR para sumar gente a un grupo o a un reto.

   Sobre la implementación, y por qué NO es propia:

   Escribí un generador desde cero. Pasaba todas las comprobaciones de
   estructura —patrones de posición, separadores, tiempo, proporción de
   módulos, determinismo— y **ningún lector lo podía decodificar**. La
   diferencia entre "parece un QR" y "es un QR" está en detalles del
   estándar que sólo se detectan intentando leerlo de verdad.

   Así que se usa `qrcode-generator`, que es la implementación de
   referencia de Kazuhiko Arase: pequeña, sin dependencias y probada
   durante quince años. Se sirve desde este mismo servidor, no desde un
   CDN, porque el QR se muestra en el gimnasio y ahí puede no haber
   señal.

   La lección, que vale para cualquier cosa: una prueba que sólo mira la
   forma no prueba que funcione. La que sirve es la que usa el resultado
   como lo va a usar el mundo real.
   ===================================================================== */

(function (global) {
  "use strict";

  if (typeof qrcode !== "function") {
    console.error("[QR] falta vendor-qrcode.js");
    return;
  }

  /**
   * Matriz de módulos (true = oscuro).
   *
   * Versión 0 = automática: elige la más chica que entre. Nivel M
   * corrige hasta un 15% del código, que es el equilibrio razonable
   * entre tamaño y tolerancia a que la pantalla tenga reflejos o el
   * teléfono tiemble.
   */
  function generar(texto) {
    const qr = qrcode(0, "M");
    qr.addData(String(texto));
    qr.make();

    const n = qr.getModuleCount();
    const m = [];
    for (let f = 0; f < n; f++) {
      const fila = [];
      for (let c = 0; c < n; c++) fila.push(qr.isDark(f, c));
      m.push(fila);
    }
    return m;
  }

  /**
   * QR como SVG.
   *
   * En SVG y no en canvas para que se vea nítido en cualquier pantalla y
   * al imprimirlo. El margen de cuatro módulos no es decoración: sin esa
   * zona en blanco alrededor, muchos lectores no encuentran el código.
   */
  function svg(texto, opciones = {}) {
    const m = generar(texto);
    const n = m.length;
    const margen = opciones.margen === undefined ? 4 : opciones.margen;
    const total = n + margen * 2;

    let camino = "";
    for (let f = 0; f < n; f++) {
      for (let c = 0; c < n; c++) {
        if (m[f][c]) camino += `M${c + margen} ${f + margen}h1v1h-1z`;
      }
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}"
      shape-rendering="crispEdges" role="img" aria-label="Código QR">
      <rect width="${total}" height="${total}" fill="${opciones.claro || "#ffffff"}"/>
      <path d="${camino}" fill="${opciones.oscuro || "#000000"}"/>
    </svg>`;
  }

  global.QR = { generar, svg };

})(typeof window !== "undefined" ? window : globalThis);
