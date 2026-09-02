// Desinstala el servicio de Windows creado por install-service.js.
// Uso (PowerShell, como Administrador): node deploy/windows/uninstall-service.js
const path = require('path');
const { Service } = require('node-windows');

const svc = new Service({
  name: 'TarjeteroWebhookServer',
  script: path.join(__dirname, '..', '..', 'server.js'),
});

svc.on('uninstall', () => {
  console.log('Servicio desinstalado.');
});

svc.on('error', (err) => {
  console.error('Error desinstalando el servicio:', err);
});

svc.uninstall();
