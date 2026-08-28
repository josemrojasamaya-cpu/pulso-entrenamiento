# Cómo sacar la APK para probar en el teléfono

Pulso es una PWA, y una PWA se puede empaquetar como aplicación de
Android sin reescribir nada. El envoltorio se llama **TWA** (Trusted Web
Activity): por dentro es Chrome, pero sin barra de direcciones y con su
propio ícono en el cajón de aplicaciones. Es exactamente lo que hacen
Twitter Lite, Starbucks y muchas otras.

## Antes que nada: probar sin APK

**No hace falta una APK para instalarla en el teléfono.** Con la
aplicación desplegada en HTTPS:

1. Abrir la dirección en Chrome desde el teléfono.
2. Menú (tres puntos) → **Instalar aplicación** o **Añadir a pantalla de
   inicio**.
3. Queda con su ícono, a pantalla completa y funcionando sin conexión.

Esto ya funciona hoy y es lo primero que conviene probar. La APK sirve
para otra cosa: para pasarle el archivo a alguien por WhatsApp, o para
subirla a Google Play.

## Requisitos, y cuáles ya están cumplidos

| Requisito | Estado |
|---|---|
| `manifest.json` con `name`, `short_name`, `start_url`, `display: standalone` | listo |
| Ícono PNG de 192×192 | listo (`public/icono-192.png`) |
| Ícono PNG de 512×512 | listo (`public/icono-512.png`) |
| `theme_color` y `background_color` | listo |
| Service worker registrado | listo (`public/sw.js`) |
| Servida por **HTTPS** | falta: hace falta desplegarla |

El único paso que falta es el despliegue. Render da HTTPS solo.

## Camino corto: PWABuilder

El más rápido, y no hay que instalar nada.

1. Entrar a **https://www.pwabuilder.com**
2. Pegar la dirección de la aplicación desplegada.
3. Analiza el manifest y el service worker y da una puntuación.
4. **Package for stores** → **Android** → **Generate**.
5. Baja un ZIP con:
   - `app-release-signed.apk` — la que se instala directo en el teléfono
   - `app-release-bundle.aab` — la que pide Google Play
   - `signing.keystore` y `assetlinks.json`

**Guardar el keystore en un lugar seguro.** Es la llave de firma: sin
ella no se puede publicar una actualización de esa misma aplicación
nunca más, y no se puede regenerar.

## Instalarla en el teléfono

1. Pasar el `.apk` al teléfono (cable, correo, Drive).
2. Ajustes → Seguridad → permitir **instalar aplicaciones desconocidas**
   para la app desde la que se abra el archivo.
3. Tocar el archivo e instalar.

Android va a avisar que viene de fuera de Play Store. Es lo esperable en
una instalación propia.

## Quitar la barra de Chrome (Digital Asset Links)

Sin este paso, la aplicación abre con una franja fina arriba que dice
"funciona con Chrome". Para quitarla:

1. Del ZIP de PWABuilder, tomar `assetlinks.json`.
2. Publicarlo en `https://<el-dominio>/.well-known/assetlinks.json`.
3. Reinstalar la APK.

Ese archivo es la prueba de que el dominio y la aplicación pertenecen a
la misma persona. Android lo verifica al instalar.

Para servirlo desde este proyecto, dejar el archivo en
`public/.well-known/assetlinks.json` — Express ya sirve `public/` como
estático y lo va a entregar.

## Lo que la APK cambia y lo que no

**Sigue funcionando igual:** cronómetro, alarmas, GPS, Bluetooth, la
pantalla encendida, todo sin conexión. Un TWA es Chrome por dentro, así
que todo lo que anda en el navegador anda en la APK.

**Lo que se gana:** ícono propio, sin barra de navegador, se puede
compartir el archivo, y se puede subir a Google Play.

**Lo que no se gana:** un TWA no da acceso a APIs nativas de Android que
el navegador no tenga. En concreto:

- **Contador de pasos del sistema** (Health Connect). Desde la web se
  puede contar pasos con el acelerómetro mientras la aplicación esté
  abierta, pero no leer el contador del sistema. Para eso haría falta
  una aplicación nativa de verdad, no un TWA.
- **Notificaciones programadas con la aplicación cerrada.** Se pueden
  mandar desde un servidor con Web Push, que sí funciona en TWA.

## Camino largo: Bubblewrap (si se quiere control fino)

Requiere Java 17 y el SDK de Android instalados.

```bash
npm install -g @bubblewrap/cli
bubblewrap init --manifest https://<el-dominio>/manifest.json
bubblewrap build
```

Es la herramienta oficial de Google y hace lo mismo que PWABuilder, pero
deja tocar cada parámetro. Para la primera prueba no hace falta.
