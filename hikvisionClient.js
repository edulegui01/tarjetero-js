// Cliente ISAPI de la placa Hikvision (autenticación HTTP Digest).
// Equivalente a HikvisionApi.kt, solo la parte de abrir puerta.

// digest-fetch es un módulo ESM ("export default"); al hacer require() desde
// CommonJS, el constructor queda bajo `.default`.
const DigestFetch = require('digest-fetch').default;

// Si la placa no responde en este tiempo (colgada, cable de red suelto,
// etc.) se corta en vez de dejar a la persona esperando en el tótem sin
// límite. Cubre el handshake digest completo (dos round-trips).
const HTTP_TIMEOUT_MS = 60 * 1000;

// Códigos soportados que la placa exige en el registro del httpHost aunque
// no nos interesen todos -- ver README ("Registrar el webhook en la placa")
// para el detalle de por qué son estos y no otros.
const HTTP_HOST_ID = 1;
const MINOR_ALARM =
  '0x404,0x405,0x406,0x407,0x408,0x409,0x40a,0x40b,0x40c,0x415,0x417,0x447,0x448';
const MINOR_EXCEPTION =
  '0x26,0x27,0x403,0x404,0x405,0x406,0x407,0x409,0x40a,0x46b,0x46c,0x42a,0x42b,0x44f,0x450';
const MINOR_OPERATION =
  '0x5a,0x70,0x71,0x79,0x7a,0x7b,0x7e,0x86,0x87,0xd6,0xd7,0xf1,0x137,0x138,0x401,0x402,0x403,0x404,0x405,0x407,0x40f,0x419,0x41a,0x41f,0x420,0x421,0x422,0x431,0x432,0x433,0x436,0x452,0x3002';
const MINOR_EVENT = '0x9';

// Hora en el formato que espera ISAPI: hora local con offset explícito y sin
// milisegundos (`2026-08-14T13:25:22-03:00`).
function formatIsapiTime(date) {
  const pad = (n) => String(n).padStart(2, '0');
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(Math.abs(offsetMin) / 60))}:${pad(Math.abs(offsetMin) % 60)}`
  );
}

function findFieldXml(xml, tagName) {
  const match = xml.match(new RegExp(`<${tagName}>([^<]*)</${tagName}>`));
  return match ? match[1].trim() : null;
}

class HikvisionClient {
  constructor({ ip, port, username, password }) {
    this.baseUrl = `http://${ip}:${port}`;
    this.username = username;
    this.password = password;
  }

  // Nuevo DigestFetch por request: ver comentario en openDoor sobre por qué
  // no se reusa entre llamadas (nc reutilizado -> "badAuthorization").
  _digestClient() {
    return new DigestFetch(this.username, this.password);
  }

  // Lee la config actual del slot httpHosts/1 (para poder loguear, antes de
  // pisarlo, si lo tiene tomado otro sistema -- ver README).
  async getWebhookRegistration() {
    const url = `${this.baseUrl}/ISAPI/Event/notification/httpHosts/${HTTP_HOST_ID}`;
    const response = await this._digestClient().fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`GET httpHosts/${HTTP_HOST_ID} falló: HTTP ${response.status} - ${body}`);
    }
    return body;
  }

  // Registra este servidor como receptor de eventos de la placa (PUT a
  // httpHosts/1), igual al paso manual documentado en el README.
  async registerWebhook({ serverIp, serverPort, webhookPath }) {
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<HttpHostNotificationList>
<HttpHostNotification>
<id>${HTTP_HOST_ID}</id>
<url>${webhookPath}</url>
<protocolType>HTTP</protocolType>
<parameterFormatType>XML</parameterFormatType>
<addressingFormatType>ipaddress</addressingFormatType>
<ipAddress>${serverIp}</ipAddress>
<portNo>${serverPort}</portNo>
<httpAuthenticationMethod>none</httpAuthenticationMethod>
<SubscribeEvent>
<heartbeat>30</heartbeat>
<eventMode>list</eventMode>
<EventList>
<Event>
<type>AccessControllerEvent</type>
<minorAlarm>${MINOR_ALARM}</minorAlarm>
<minorException>${MINOR_EXCEPTION}</minorException>
<minorOperation>${MINOR_OPERATION}</minorOperation>
<minorEvent>${MINOR_EVENT}</minorEvent>
</Event>
</EventList>
</SubscribeEvent>
</HttpHostNotification>
</HttpHostNotificationList>`;

    const url = `${this.baseUrl}/ISAPI/Event/notification/httpHosts/${HTTP_HOST_ID}`;
    let response;
    try {
      response = await this._digestClient().fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/xml' },
        body,
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
    } catch (err) {
      if (err.name === 'TimeoutError') {
        throw new Error(`Registro de webhook falló: la placa no respondió en ${HTTP_TIMEOUT_MS}ms`);
      }
      throw err;
    }

    const responseBody = await response.text();
    if (!response.ok) {
      throw new Error(`Registro de webhook falló: HTTP ${response.status} - ${responseBody}`);
    }
    return responseBody;
  }

  // Hora que tiene la placa ahora mismo. Devuelve { localTime, timeZone }
  // tal cual los reporta ISAPI.
  async getTime() {
    const url = `${this.baseUrl}/ISAPI/System/time`;
    const response = await this._digestClient().fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`GET System/time falló: HTTP ${response.status} - ${body}`);
    }
    const localTime = findFieldXml(body, 'localTime');
    if (!localTime) {
      throw new Error(`Respuesta de System/time sin localTime: ${body}`);
    }
    return { localTime, timeZone: findFieldXml(body, 'timeZone') };
  }

  // Le pone a la placa la hora de este servidor. El `timeZone` se pasa tal
  // cual lo tenía la placa: acá solo se corrige el reloj, no se le cambia la
  // zona horaria configurada.
  async setTime(date, timeZone) {
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<Time xmlns="http://www.isapi.org/ver20/XMLSchema" version="2.0">
<timeMode>manual</timeMode>
<localTime>${formatIsapiTime(date)}</localTime>
${timeZone ? `<timeZone>${timeZone}</timeZone>` : ''}
</Time>`;

    const url = `${this.baseUrl}/ISAPI/System/time`;
    const response = await this._digestClient().fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/xml' },
      body,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    const responseBody = await response.text();
    if (!response.ok) {
      throw new Error(`PUT System/time falló: HTTP ${response.status} - ${responseBody}`);
    }
    return responseBody;
  }

  async openDoor(doorId) {
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<RemoteControlDoor>
    <cmd>open</cmd>
</RemoteControlDoor>`;

    const url = `${this.baseUrl}/ISAPI/AccessControl/RemoteControl/door/${doorId}`;
    // Cliente Digest nuevo por request: DigestFetch cachea el nonce/nc entre
    // llamadas para evitar el round-trip extra, pero esta placa rechaza el nc
    // reutilizado en el segundo request en adelante ("badAuthorization").
    // Forzar un handshake completo cada vez (como hace curl --digest) evita
    // el problema al costo de un round-trip extra, insignificante acá.
    let response;
    try {
      response = await this._digestClient().fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/xml' },
        body,
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
    } catch (err) {
      if (err.name === 'TimeoutError') {
        throw new Error(`Apertura de puerta falló: la placa no respondió en ${HTTP_TIMEOUT_MS}ms`);
      }
      throw err;
    }

    const responseBody = await response.text();
    if (!response.ok) {
      throw new Error(`Apertura de puerta falló: HTTP ${response.status} - ${responseBody}`);
    }
    return responseBody;
  }
}

module.exports = { HikvisionClient };
