// Parámetros operativos editables en caliente desde /admin (mensajes, IDs de
// puerta, timers, datos de empresa/serie para TSM). Los secretos y datos de
// conexión (contraseñas, host/puerto de la placa y de TSM) NO viven acá:
// siguen en .env, leídos una sola vez al arrancar.

const fs = require('fs');
const path = require('path');

const FILE_PATH = path.join(__dirname, 'params.json');

const DEFAULTS = {
  successMessage: 'Salida autorizada',
  failureMessage: 'Cuenta pendiente de pago',
  connectionErrorMessage: 'Error de conexión, avise al personal',
  messageDurationSeconds: 5,
  debounceSeconds: 5,
  maxEventAgeSeconds: 10,
  puertaTarjetaDenegada: 3,
  puertaTarjetaHabilitada: 4,
  puertaMolinete: 2,
  puertaLedRojo: 1,
  tsmCodigoEmpresa: 1,
  tsmSerieCartao: 1,
  carouselSecondsPerImage: 5,
};

// 'string' | 'number' -- determina cómo se parsea/valida cada campo al guardar.
const FIELD_TYPES = {
  successMessage: 'string',
  failureMessage: 'string',
  connectionErrorMessage: 'string',
  messageDurationSeconds: 'number',
  debounceSeconds: 'number',
  maxEventAgeSeconds: 'number',
  puertaTarjetaDenegada: 'number',
  puertaTarjetaHabilitada: 'number',
  puertaMolinete: 'number',
  puertaLedRojo: 'number',
  tsmCodigoEmpresa: 'number',
  tsmSerieCartao: 'number',
  carouselSecondsPerImage: 'number',
};

let cache = null;

function load() {
  if (cache) return cache;

  if (fs.existsSync(FILE_PATH)) {
    try {
      const raw = fs.readFileSync(FILE_PATH, 'utf8');
      cache = { ...DEFAULTS, ...JSON.parse(raw) };
      return cache;
    } catch (err) {
      console.error(`No se pudo leer ${FILE_PATH}, uso valores por defecto:`, err.message);
    }
  }

  cache = { ...DEFAULTS };
  return cache;
}

function getAll() {
  return { ...load() };
}

/**
 * Mergea newValues (típicamente req.body de un form) sobre los parámetros
 * actuales, valida/convierte según FIELD_TYPES, y persiste a disco con
 * escritura atómica (tmp + rename) para no dejar el archivo a medio
 * escribir si el proceso se cae en el medio.
 */
function save(newValues) {
  const merged = { ...load() };

  for (const [key, type] of Object.entries(FIELD_TYPES)) {
    if (!(key in newValues)) continue;
    const raw = newValues[key];

    if (type === 'number') {
      const num = Number(raw);
      if (!Number.isFinite(num)) {
        throw new Error(`Valor inválido para ${key}: "${raw}"`);
      }
      merged[key] = num;
    } else {
      const str = String(raw).trim();
      if (!str) {
        throw new Error(`${key} no puede estar vacío`);
      }
      merged[key] = str;
    }
  }

  const tmpPath = `${FILE_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(merged, null, 2));
  fs.renameSync(tmpPath, FILE_PATH);
  cache = merged;
  return getAll();
}

module.exports = { getAll, save, FIELD_TYPES, DEFAULTS };
