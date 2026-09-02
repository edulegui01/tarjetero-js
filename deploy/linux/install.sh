#!/usr/bin/env bash
# Instala tarjetero-webhook-server como servicio systemd.
# Uso: sudo ./deploy/linux/install.sh [directorio-destino]
set -euo pipefail

TARGET_DIR="${1:-/opt/tarjetero-webhook-server}"
SERVICE_USER="tarjetero"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [[ $EUID -ne 0 ]]; then
  echo "Corré este script con sudo." >&2
  exit 1
fi

if ! id "$SERVICE_USER" &>/dev/null; then
  echo "Creando usuario de sistema '$SERVICE_USER'..."
  useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
fi

echo "Copiando archivos a $TARGET_DIR..."
mkdir -p "$TARGET_DIR"
rsync -a --exclude 'node_modules' --exclude '.git' --exclude 'deploy' "$REPO_ROOT"/ "$TARGET_DIR"/

if [[ ! -f "$TARGET_DIR/.env" ]]; then
  echo "No hay .env en $TARGET_DIR — copiá .env.example a .env y completalo antes de arrancar el servicio."
fi

echo "Instalando dependencias..."
cd "$TARGET_DIR"
npm install --omit=dev

chown -R "$SERVICE_USER:$SERVICE_USER" "$TARGET_DIR"

echo "Instalando unit de systemd..."
cp "$SCRIPT_DIR/tarjetero-webhook.service" /etc/systemd/system/tarjetero-webhook.service
systemctl daemon-reload
systemctl enable tarjetero-webhook.service
systemctl restart tarjetero-webhook.service

echo "Listo. Ver estado con: systemctl status tarjetero-webhook"
echo "Ver logs con: journalctl -u tarjetero-webhook -f"
