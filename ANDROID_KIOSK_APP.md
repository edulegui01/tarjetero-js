# App Android: kiosco WebView para el tarjetero

## Contexto

Este repo (`tarjetero-webhook-server`) es un servidor Node que reemplaza la
lógica que antes vivía en una app Android (`NfcWebhookServer.kt` /
`HikvisionApi.kt`, ya no forman parte de este proyecto). El server:

- Recibe el POST que manda la placa Hikvision cuando alguien pasa una
  tarjeta (`/webhook/nfc`).
- Abre la puerta correspondiente contra la placa (vía ISAPI, digest auth).
- Expone una página web (`public/index.html`, servida en
  `http://<ip-del-server>:<PORT>/`, default puerto `8091`) que muestra en
  vivo el resultado (autorizado / no pagado / error de conexión) vía
  Server-Sent Events (`GET /events`), con colores de fondo por estado y una
  voz en español (Web Speech API `speechSynthesis`) que lee el mensaje.

**Toda la lógica de negocio ya está resuelta en el server y en esa página
web.** Lo que falta es solo la parte de "pantalla física": una app Android
que actúe como kiosco — un WebView a pantalla completa apuntando a esa URL,
sin barra de navegador, que no se pueda cerrar por accidente, con la
pantalla siempre encendida.

No hace falta reimplementar nada de la lógica de tarjetas/puertas en
Android. Es exclusivamente un navegador kiosco configurable.

## Qué tiene que hacer la app

1. **WebView de pantalla completa** que carga una URL configurable por el
   usuario (no hardcodeada en el código — la placa/tablet puede apuntar a
   distintos servers según el local).
   - Guardar la URL en `SharedPreferences`.
   - Si no hay URL guardada, mostrar un diálogo simple para ingresarla al
     arrancar.
   - Dejar alguna forma de volver a cambiarla después (por ejemplo,
     long-press en la pantalla abre el mismo diálogo).
2. **Modo kiosco**:
   - Ocultar status bar y barra de navegación (immersive sticky mode).
   - `FLAG_KEEP_SCREEN_ON` para que la pantalla no se apague nunca.
   - Ignorar el botón "atrás" (no debe poder salirse de la app tocando por
     error). Screen pinning / lock task es un nice-to-have, no bloqueante.
3. **Reproducción de audio sin gesto del usuario**:
   - `webView.settings.mediaPlaybackRequiresUserGesture = false` — la
     página ya maneja un flujo de "tocar para activar sonido" por las dudas
     (ver `public/index.html`), pero si el WebView lo permite sin gesto,
     mejor: el tablet queda desatendido y no depende de que alguien lo
     toque al bootear.
4. **Resiliencia de red**: si falla la carga de la página (server caído,
   sin red), reintentar cargar cada pocos segundos en vez de quedarse en
   una pantalla de error en blanco. Cuando la red vuelve, debería
   reconectar solo (la página ya usa `EventSource`, que reconecta solo una
   vez cargada; lo que hay que resolver a nivel app es la carga inicial de
   la página en sí).
5. **Arranque automático** (nice-to-have): que la app se abra sola al
   encender el tablet (`BOOT_COMPLETED` + `RECEIVE_BOOT_COMPLETED`
   permission), útil si el tablet queda fijo instalado en un local y se
   corta la luz.

## Fuera de alcance

- No hace falta hablar con la placa Hikvision directamente desde Android
  (eso ya lo hace `hikvisionClient.js` en el server).
- No hace falta parsear eventos NFC ni manejar debounce (ya está en
  `eventParser.js` / `debounce.js`).
- No hace falta implementar la UI de mensajes/colores/voz — eso ya está en
  `public/index.html`, la app solo la muestra.

## Cómo probar

1. Levantar el server Node en la misma red (`npm start` en la raíz de este
   repo, puerto `8091` por default).
2. Configurar la URL en la app: `http://<ip-del-server>:8091/`.
3. Simular una lectura de tarjeta con un POST de prueba al webhook (ver
   `README.md` de este repo) y confirmar que la app cambia de color, muestra
   el mensaje y lo lee en voz alta, sin que haya hecho falta tocar la
   pantalla.
