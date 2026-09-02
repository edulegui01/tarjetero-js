// Instala tarjetero-webhook-server como servicio de Windows.
// Uso (PowerShell, como Administrador): node deploy/windows/install-service.js
const path = require('path');
const { Service } = require('node-windows');

const svc = new Service({
  name: 'TarjeteroWebhookServer',
  description: 'Recibe el webhook de la placa Hikvision y abre la puerta correspondiente.',
  script: path.join(__dirname, '..', '..', 'server.js'),
  workingDirectory: path.join(__dirname, '..', '..'),
});

svc.on('alreadyinstalled', () => {
  console.log('El servicio ya estaba instalado.');
});

svc.on('install', () => {
  console.log('Servicio instalado. Iniciando...');
  svc.start();
});

svc.on('start', () => {
  console.log('Servicio iniciado. Revisalo en services.msc como "TarjeteroWebhookServer".');
});

svc.on('error', (err) => {
  console.error('Error instalando el servicio:', err);
});

svc.install();
