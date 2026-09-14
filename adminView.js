// Render de la página /admin: un form server-rendered para editar
// paramsStore.json en caliente. Sin frontend framework, a propósito -- es
// una sola página interna, no vale la pena el build step.

const { FIELD_TYPES } = require('./paramsStore');

const FIELD_LABELS = {
  successMessage: 'Mensaje de éxito',
  failureMessage: 'Mensaje de rechazo',
  connectionErrorMessage: 'Mensaje de error de conexión',
  messageDurationSeconds: 'Duración del mensaje en pantalla (segundos)',
  debounceSeconds: 'Debounce entre lecturas de la misma tarjeta (segundos)',
  maxEventAgeSeconds: 'Edad máxima de un evento antes de descartarlo (segundos)',
  puertaTarjetaDenegada: 'Puerta: tarjeta denegada',
  puertaTarjetaHabilitada: 'Puerta: tarjeta habilitada',
  puertaMolinete: 'Puerta: molinete',
  puertaLedRojo: 'Puerta: LED rojo del molinete',
  tsmCodigoEmpresa: 'TSM: código de empresa',
  tsmSerieCartao: 'TSM: serie de tarjeta',
  carouselSecondsPerImage: 'Carrusel: segundos por imagen',
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderAdminPage(params, { error, saved, carouselImages = [] } = {}) {
  const rows = Object.entries(FIELD_TYPES)
    .map(([key, type]) => {
      const label = FIELD_LABELS[key] || key;
      const value = escapeHtml(params[key]);
      const inputType = type === 'number' ? 'number' : 'text';
      return `
        <div class="field${type === 'string' ? ' wide' : ''}">
          <label for="${key}">${escapeHtml(label)}</label>
          <input type="${inputType}" id="${key}" name="${key}" value="${value}" ${type === 'number' ? 'step="1"' : ''} required />
        </div>
      `;
    })
    .join('\n');

  const imagesBySlot = new Map(carouselImages.map((img) => [img.slot, img]));
  const carouselRows = [1, 2, 3]
    .map((slot) => {
      const image = imagesBySlot.get(slot);
      const preview = image
        ? `<img class="thumb" src="${escapeHtml(image.url)}" alt="Imagen ${slot}" />
           <label class="checkbox"><input type="checkbox" name="removeCarouselImage${slot}" /> Quitar imagen</label>`
        : '<p class="thumb-empty">Sin imagen configurada</p>';
      return `
        <div class="carousel-slot">
          <label for="carouselImage${slot}">Imagen ${slot}</label>
          ${preview}
          <input type="file" id="carouselImage${slot}" name="carouselImage${slot}" accept="image/*" />
        </div>
      `;
    })
    .join('\n');

  const banner = error
    ? `<div class="banner error">${escapeHtml(error)}</div>`
    : saved
      ? `<div class="banner ok">Guardado. Los cambios ya están activos, no hace falta reiniciar el servidor.</div>`
      : '';

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Admin — Tarjetero</title>
<style>
  :root {
    --orange: #f97316;
    --orange-dark: #ea580c;
    --orange-light: #fff7ed;
    --ink: #1f2937;
    --muted: #6b7280;
    --border: #f3d5b5;
  }
  html, body {
    margin: 0;
    font-family: system-ui, sans-serif;
    background: var(--orange-light);
    color: var(--ink);
  }
  body {
    padding: 1.5rem;
    box-sizing: border-box;
  }
  .page {
    max-width: 32rem;
    margin: 0 auto;
  }
  header.top {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1.5rem;
  }
  header.top .badge {
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 0.65rem;
    background: var(--orange);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 800;
    font-size: 1.1rem;
    flex-shrink: 0;
  }
  h1 {
    font-size: 1.2rem;
    margin: 0;
    color: var(--ink);
  }
  .card {
    background: white;
    border: 1px solid var(--border);
    border-radius: 0.9rem;
    padding: 1.25rem 1.25rem 1.5rem;
    box-shadow: 0 1px 2px rgba(154, 88, 24, 0.06);
    margin-bottom: 1.25rem;
  }
  .fields {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 1.1rem 1.25rem;
  }
  .field.wide { grid-column: 1 / -1; }
  label {
    display: block;
    margin-bottom: 0.35rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--ink);
  }
  input {
    width: 100%;
    box-sizing: border-box;
    font-size: 1rem;
    font-family: inherit;
    background: white;
    color: var(--ink);
    border: 1.5px solid var(--border);
    border-radius: 0.5rem;
    padding: 0.6rem 0.7rem;
    transition: border-color 0.15s;
  }
  input:focus {
    outline: none;
    border-color: var(--orange);
  }
  button {
    margin-top: 1.5rem;
    width: 100%;
    font-size: 1.05rem;
    font-weight: 700;
    padding: 0.9rem;
    border: none;
    border-radius: 0.6rem;
    background: var(--orange);
    color: white;
    cursor: pointer;
    transition: background 0.15s;
  }
  button:hover { background: var(--orange-dark); }
  button:active { background: var(--orange-dark); }
  .banner {
    margin-bottom: 1.25rem;
    padding: 0.75rem 1rem;
    border-radius: 0.6rem;
    font-size: 0.9rem;
    font-weight: 600;
    border: 1px solid transparent;
  }
  .banner.ok {
    background: #ecfdf5;
    color: #166534;
    border-color: #a7f3d0;
  }
  .banner.error {
    background: #fef2f2;
    color: #991b1b;
    border-color: #fecaca;
  }
  h2 {
    font-size: 0.95rem;
    margin: 0 0 1rem;
    color: var(--orange-dark);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .carousel-slot {
    margin-top: 1rem;
    padding: 0.9rem;
    background: var(--orange-light);
    border: 1px solid var(--border);
    border-radius: 0.6rem;
  }
  .carousel-slot:first-of-type { margin-top: 0; }
  .carousel-slot label { margin-top: 0; }
  .thumb {
    display: block;
    max-width: 100%;
    max-height: 8rem;
    border-radius: 0.4rem;
    margin: 0.5rem 0;
    border: 1px solid var(--border);
  }
  .thumb-empty {
    color: var(--muted);
    font-size: 0.85rem;
    margin: 0.5rem 0;
  }
  .checkbox {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.85rem;
    color: var(--muted);
    font-weight: 400;
  }
  .checkbox input { width: auto; }
  input[type="file"] {
    width: 100%;
    box-sizing: border-box;
    font-size: 0.9rem;
    color: var(--ink);
    border-style: dashed;
  }
  @media (max-width: 480px) {
    .fields { grid-template-columns: 1fr; }
    .field.wide { grid-column: auto; }
  }
</style>
</head>
<body>
  <div class="page">
    <header class="top">
      <div class="badge">T</div>
      <h1>Parámetros del tarjetero</h1>
    </header>
    ${banner}
    <form method="POST" action="/admin/save" enctype="multipart/form-data">
      <div class="card">
        <div class="fields">
          ${rows}
        </div>
      </div>
      <div class="card">
        <h2>Carrusel de imágenes (pantalla de espera)</h2>
        ${carouselRows}
      </div>
      <button type="submit">Guardar</button>
    </form>
  </div>
</body>
</html>`;
}

module.exports = { renderAdminPage };
