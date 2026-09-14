# tarjetero-webhook-server

Reemplaza el webhook + apertura de puerta que antes hacía la app Android.
Recibe el POST que manda la placa Hikvision al `httpHost`, consulta contra la
API TSM Contas si la tarjeta leída tiene un consumo abierto, abre la puerta
correspondiente y muestra el resultado en una web app simple.

En cada lectura de tarjeta se llama a la API TSM Contas
(`IsCartaoConsumoAberto`, con `CodigoEmpresa` e `IdIdentificacaoCartao`)
pasando el número de tarjeta leído. Si responde que la tarjeta tiene un
consumo abierto se abre `PUERTA_TARJETA_DENEGADA`; si responde que está al
día se abren `PUERTA_TARJETA_HABILITADA` y `PUERTA_MOLINETE`. Si la consulta
falla o responde algo inesperado, se abre `PUERTA_TARJETA_DENEGADA` por
seguridad (denegar por defecto).

En los dos casos de denegación (deuda o fallo de la consulta) se pulsa
además `PUERTA_LED_ROJO`, un relé más de la placa que enciende el LED rojo
del molinete: el rechazo se ve desde lejos y no solo en la pantalla del
tótem. Es señalización, no parte de la decisión -- si ese pulso falla se
loguea y se sigue, para que un error del LED no tape en pantalla el motivo
real del rechazo.

Esa API requiere un token (`GetToken`, login con `TSM_USUARIO`/`TSM_SENHA`)
que se manda como `Authorization: Bearer <token>`. El cliente lo cachea hasta
que vence (campo `validate` de la respuesta de login) y pide uno nuevo
automáticamente cuando corresponde o si la API devuelve 401.

Se movió acá (en vez de en la app Android) porque el receptor HTTP embebido
en el tablet (NanoHTTPD sobre un rk3288) pierde eventos cuando la placa manda
varios seguidos en poco tiempo (lo que pasa siempre que alguien pasa una
tarjeta: puerta destrabada + verificación + puerta trabada, ~3 eventos en
5 segundos). Un servidor Node en la misma red nunca perdió ninguno en las
pruebas.

## Uso

```
npm install
cp .env.example .env   # completar HIKVISION_PASSWORD y lo que haga falta
npm start
```

Abrí `http://<ip-de-este-server>:<PORT>/` en un navegador para ver el estado
en vivo.

Los mensajes del tótem usan Poppins (la tipografía del "Resto Café" del
logo), servida desde `public/fonts/` en vez de Google Fonts: el tablet corre
en kiosco y no se puede depender de que tenga internet justo cuando hay que
mostrar si la salida está autorizada. Si esos `.woff2` se borran, la pantalla
cae al `system-ui` del tablet y sigue funcionando.

## Registrar el webhook en la placa

Esto pasa solo: en cada arranque el servidor se registra como `httpHost` en
la placa (PUT a `httpHosts/1`), así no depende de que alguien se acuerde de
hacerlo a mano después de reinstalar, cambiar de IP o un reset de la placa.
La IP con la que se anuncia sale de `SERVER_IP` si está fijada en `.env`, o
si no se autodetecta preguntándole al sistema operativo por qué IP local
saldría un paquete hacia `HIKVISION_IP` (funciona bien aunque haya VPNs,
WSL u otros adaptadores virtuales de por medio -- fijar `SERVER_IP` a mano
solo si esa autodetección da una IP incorrecta). Si la placa no responde al
arrancar (red/placa todavía no lista), reintenta unas pocas veces con espera
entre intentos y despues sigue: un fallo acá no tira abajo el servidor, pero
sin este registro la placa no va a mandar eventos, así que conviene mirar
`logs/error.log` si el tótem no reacciona a las tarjetas tras un arranque.

Si hace falta registrarlo a mano (por ejemplo para depurar, o si el
autoregistro falla de forma persistente), es un PUT a
`http://<ip-de-la-placa>/ISAPI/Event/notification/httpHosts/1` (Digest
Auth, usuario/contraseña de la placa) con:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<HttpHostNotificationList>
<HttpHostNotification>
<id>1</id>
<url>/webhook/nfc</url>
<protocolType>HTTP</protocolType>
<parameterFormatType>XML</parameterFormatType>
<addressingFormatType>ipaddress</addressingFormatType>
<ipAddress>IP-DE-ESTE-SERVIDOR</ipAddress>
<portNo>8091</portNo>
<httpAuthenticationMethod>none</httpAuthenticationMethod>
<SubscribeEvent>
<heartbeat>30</heartbeat>
<eventMode>list</eventMode>
<EventList>
<Event>
<type>AccessControllerEvent</type>
<minorAlarm>0x404,0x405,0x406,0x407,0x408,0x409,0x40a,0x40b,0x40c,0x415,0x417,0x447,0x448</minorAlarm>
<minorException>0x26,0x27,0x403,0x404,0x405,0x406,0x407,0x409,0x40a,0x46b,0x46c,0x42a,0x42b,0x44f,0x450</minorException>
<minorOperation>0x5a,0x70,0x71,0x79,0x7a,0x7b,0x7e,0x86,0x87,0xd6,0xd7,0xf1,0x137,0x138,0x401,0x402,0x403,0x404,0x405,0x407,0x40f,0x419,0x41a,0x41f,0x420,0x421,0x422,0x431,0x432,0x433,0x436,0x452,0x3002</minorOperation>
<minorEvent>0x9</minorEvent>
</Event>
</EventList>
</SubscribeEvent>
</HttpHostNotification>
</HttpHostNotificationList>
```

`eventMode` está en `list` en vez de `all` para que la placa solo mande lecturas de
tarjeta (`minorEvent=0x9`, confirmado empíricamente viendo el body real de una
lectura) y no el resto de ruido administrativo (eco de comandos de apertura,
cambios de estado de puerta, etc.). Los otros tres nodos (`minorAlarm`,
`minorException`, `minorOperation`) son obligatorios para la placa aunque no
nos interesen -- se les pasa la lista completa de códigos soportados (ver
`GET .../httpHosts/capabilities`) para no restringirlos más de lo que ya
estaban, salvo `0x400` (eco del propio comando de apertura remota de puerta,
confirmado viendo el body real: `majorEventType=3/2, subEventType=1024`), que
se sacó explícitamente de `minorException` y `minorOperation` porque era puro
ruido sin `cardNo`.

Ojo: el slot `id=1` puede estar en uso por otro sistema (visto en esta red:
`192.0.0.60`, path `/listener.php`). Si al consultar `GET` sobre ese mismo
endpoint aparece otra IP en vez de la de este servidor, algo más lo está
pisando — coordinar con quien administre ese otro sistema antes de asumir
que este servidor está roto. El autoregistro al arrancar hace ese mismo
`GET` antes de pisar el slot y loguea una advertencia si encuentra otra IP,
pero lo pisa igual (este servidor necesita el slot para funcionar) — revisar
la advertencia en la consola/`logs/error.log` si eso pasa.

## Reloj de la placa

Al arrancar (y cada 6 horas) el servidor compara su reloj con el de la placa
y, si difieren en más de 2 segundos, le escribe la hora del servidor (PUT a
`/ISAPI/System/time`, conservando el `timeZone` que la placa ya tenía). El
servidor es la fuente de verdad de la hora.

Esto importa porque cada evento que manda la placa trae su propio `dateTime`
y el servidor descarta los que superan `maxEventAgeSeconds` (ver
`isStale` en `eventParser.js`), para no procesar backlog viejo tras una
reconexión. Esa comparación cruza dos relojes: si la placa se atrasa más que
ese margen, **las lecturas legítimas se descartan por "viejas"** y el tótem
deja de reaccionar a las tarjetas sin ningún error visible. Pasó: la placa
llegó a acumular 9,5 segundos de atraso contra un margen de 10.

La placa no arregla esto sola. Viene en `timeMode: manual` y su servidor NTP
de fábrica apunta a `192.0.0.64`, una IP que no existe en esta red; además
tiene el DNS deshabilitado, así que tampoco podría usar un NTP por nombre.
Se podría configurar un NTP real (la placa lo soporta: `timeMode
opt="NTP,manual"`), pero requiere un servidor de tiempo alcanzable por IP
desde la placa, y sincronizarla contra este servidor resuelve el problema de
raíz: los dos relojes que `isStale` compara pasan a ser el mismo.

Si el reloj de este servidor estuviera mal, se lo propaga a la placa.

## Desplegar como servicio (arranca solo, se reinicia si crashea)

### Linux (systemd)

```
sudo ./deploy/linux/install.sh
```

Copia el repo a `/opt/tarjetero-webhook-server`, crea un usuario de sistema
`tarjetero`, instala dependencias y registra el servicio `tarjetero-webhook`.
Requiere que `/opt/tarjetero-webhook-server/.env` exista (copiarlo desde
`.env.example` y completarlo) — si no está, el script avisa pero igual
instala el servicio.

```
systemctl status tarjetero-webhook     # estado
journalctl -u tarjetero-webhook -f     # logs en vivo
sudo systemctl restart tarjetero-webhook
```

### Windows

Desde este mismo directorio, en PowerShell **como Administrador**:

```
npm install
npm run service:install:windows
```

Instala un Windows Service llamado `TarjeteroWebhookServer` (visible en
`services.msc`), configurado para arrancar solo con el sistema. Usa el
`.env` y el `node_modules` de este mismo directorio, así que no lo muevas
después de instalarlo sin volver a correr el script.

Para desinstalarlo:

```
npm run service:uninstall:windows
```
