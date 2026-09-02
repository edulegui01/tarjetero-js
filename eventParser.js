// Parseo del body que manda la placa Hikvision al httpHost.
// Puerto directo de la lógica ya validada en NfcWebhookServer.kt: en la
// práctica la placa siempre manda JSON (aunque el httpHost esté registrado
// con parameterFormatType XML), así que se prioriza JSON.parse y se deja un
// fallback simple por regex para XML por si algún día cambia.

function findField(obj, key) {
  if (obj === null || typeof obj !== 'object') return null;
  if (key in obj && obj[key]) return String(obj[key]);
  for (const value of Object.values(obj)) {
    if (value !== null && typeof value === 'object') {
      const found = findField(value, key);
      if (found) return found;
    }
  }
  return null;
}

function findFieldXml(xml, tagName) {
  const match = xml.match(new RegExp(`<${tagName}>([^<]*)</${tagName}>`));
  return match ? match[1].trim() : null;
}

/**
 * Parsea el body crudo del webhook.
 * Devuelve { eventType, cardCode, dateTime } o null si el body no es
 * reconocible (heartbeat vacío, formato desconocido, etc.).
 */
function parseEvent(rawBody) {
  const trimmed = rawBody.trim();
  if (!trimmed) return null;

  let eventType = null;
  let cardCode = null;
  let dateTime = null;

  if (trimmed.startsWith('{')) {
    let json;
    try {
      json = JSON.parse(trimmed);
    } catch {
      return null;
    }
    eventType = json.eventType || null;
    dateTime = json.dateTime || null;
    cardCode = findField(json, 'cardNo') || findField(json, 'employeeNoString');
  } else if (trimmed.startsWith('<')) {
    eventType = findFieldXml(trimmed, 'eventType');
    dateTime = findFieldXml(trimmed, 'dateTime');
    cardCode = findFieldXml(trimmed, 'cardNo') || findFieldXml(trimmed, 'employeeNoString');
  } else {
    return null;
  }

  return { eventType, cardCode, dateTime };
}

/** true si el evento es demasiado viejo como para ser una lectura real (backlog histórico). */
function isStale(dateTime, maxAgeSeconds) {
  if (!dateTime) return false;
  const eventTime = Date.parse(dateTime);
  if (Number.isNaN(eventTime)) return false;
  const ageSeconds = (Date.now() - eventTime) / 1000;
  return ageSeconds > maxAgeSeconds;
}

module.exports = { parseEvent, isStale, findField, findFieldXml };
