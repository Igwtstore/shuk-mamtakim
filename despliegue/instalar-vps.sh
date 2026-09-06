#!/usr/bin/env bash
# Instalación (y reinstalación: es idempotente) del sitio del Shuk en el VPS.
# Correr como jony desde la carpeta del repo (/srv/shuk-mamtakim):  bash despliegue/instalar-vps.sh
# Requiere el proxy Caddy compartido del VPS en /srv/proxy (red docker "edge").
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

echo "▸ proxy compartido"
[ -d /srv/proxy/sites ] || { echo "  ✗ falta /srv/proxy (el Caddy compartido del VPS)"; exit 1; }
docker network inspect edge >/dev/null 2>&1 || docker network create edge >/dev/null

echo "▸ variables (despliegue/shuk.env)"
if [ ! -f despliegue/shuk.env ]; then
  cp despliegue/shuk.env.ejemplo despliegue/shuk.env; chmod 600 despliegue/shuk.env
  echo "  ⚠️ completar ANTHROPIC_API_KEY en despliegue/shuk.env y correr: docker compose -f despliegue/docker-compose.yml up -d"
fi

echo "▸ contenedor del sitio"
docker compose -f despliegue/docker-compose.yml up -d --build 2>&1 | tail -2

echo "▸ sitio en el proxy (Caddy)"
if ! cmp -s despliegue/shuk.caddy /srv/proxy/sites/shuk.caddy; then
  cp despliegue/shuk.caddy /srv/proxy/sites/shuk.caddy
  docker kill -s USR1 proxy >/dev/null      # Caddy recarga la config sin cortar nada
  sleep 2
fi

echo "▸ auto-deploy (cron cada 2 min)"
chmod +x despliegue/actualizar.sh
LINEA="*/2 * * * * flock -n /tmp/shuk-actualizar.lock $REPO/despliegue/actualizar.sh >> $HOME/shuk-actualizar.log 2>&1"
( crontab -l 2>/dev/null | grep -v "shuk-mamtakim/despliegue/actualizar.sh" ; echo "$LINEA" ) | crontab -

echo "▸ prueba"
sleep 2
docker compose -f despliegue/docker-compose.yml exec -T sitio wget -qO- http://127.0.0.1:3100/_salud && echo
curl -sS -o /dev/null -w "https://shuk.82-25-74-242.sslip.io/ → %{http_code}\n" https://shuk.82-25-74-242.sslip.io/ || echo "  (el certificado de sslip.io puede tardar unos segundos la primera vez)"
echo "✅ listo"
