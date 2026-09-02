// Imágenes del carrusel que se muestra en la pantalla de espera del tótem.
// Se guardan en uploads/ con nombre fijo por slot (slot-1.<ext>, etc.) --
// no se persiste el nombre de archivo en params.json, la existencia de cada
// slot se resuelve escaneando el directorio.

const fs = require('fs');
const path = require('path');

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const SLOTS = [1, 2, 3];

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function findSlotFile(slot) {
  const prefix = `slot-${slot}.`;
  const match = fs.readdirSync(UPLOAD_DIR).find((name) => name.startsWith(prefix));
  return match ? path.join(UPLOAD_DIR, match) : null;
}

function listImages() {
  const images = [];
  for (const slot of SLOTS) {
    const filePath = findSlotFile(slot);
    if (filePath) {
      images.push({ slot, url: `/uploads/${path.basename(filePath)}` });
    }
  }
  return images;
}

function saveImage(slot, buffer, ext) {
  const existing = findSlotFile(slot);
  if (existing) fs.unlinkSync(existing);
  fs.writeFileSync(path.join(UPLOAD_DIR, `slot-${slot}${ext}`), buffer);
}

function deleteImage(slot) {
  const existing = findSlotFile(slot);
  if (existing) fs.unlinkSync(existing);
}

module.exports = { listImages, saveImage, deleteImage, SLOTS };
