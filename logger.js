// Log de errores a archivo, para poder revisarlos después sin depender de
// tener la consola del proceso a la vista (el server suele correr como
// servicio, sin terminal interactiva).

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'error.log');
const LOG_FILE_OLD = path.join(LOG_DIR, 'error.log.old');

// Tope de tamaño para no crecer sin límite: al llegar a MAX_LOG_SIZE_BYTES,
// el archivo actual pasa a error.log.old (pisando el anterior) y arranca
// uno nuevo. Deja como máximo ~2x MAX_LOG_SIZE_BYTES en disco entre los dos.
const MAX_LOG_SIZE_BYTES = 5 * 1024 * 1024;

fs.mkdirSync(LOG_DIR, { recursive: true });

function rotateIfNeeded() {
  try {
    if (fs.statSync(LOG_FILE).size >= MAX_LOG_SIZE_BYTES) {
      fs.renameSync(LOG_FILE, LOG_FILE_OLD);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

// new Date().toISOString() siempre da la hora en UTC -- acá se arma en hora
// local del server (con offset explícito) para que coincida con lo que ve
// el personal del local al leer el archivo.
function formatLocalTimestamp(date) {
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const offsetH = pad(Math.floor(Math.abs(offsetMin) / 60));
  const offsetM = pad(Math.abs(offsetMin) % 60);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `.${pad(date.getMilliseconds(), 3)}${sign}${offsetH}:${offsetM}`
  );
}

function logError(context, err) {
  const detail = err && err.cause ? `${err.message} (cause: ${err.cause})` : (err && err.message) || String(err);
  console.error(`${context}:`, detail);
  try {
    rotateIfNeeded();
    fs.appendFileSync(LOG_FILE, `[${formatLocalTimestamp(new Date())}] ${context}: ${detail}\n`);
  } catch (writeErr) {
    console.error('No se pudo escribir en el log de errores:', writeErr.message);
  }
}

module.exports = { logError, LOG_FILE, formatLocalTimestamp };
