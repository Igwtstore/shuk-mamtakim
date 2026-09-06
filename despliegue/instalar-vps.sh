#!/usr/bin/env bash
# Instalación (y reinstalación: es idempotente) del sitio del Shuk en el VPS.
# Correr como el usuario con sudo (jony) desde la carpeta del repo:  bash despliegue/instalar-vps.sh
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

echo "▸ nginx + certbot"
if ! command -v nginx >/dev/null; then
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nginx certbot python3-certbot-nginx >/dev/null
fi
sudo mkdir -p /var/www/certbot /etc/nginx/ssl/shuk /etc/nginx/snippets

echo "▸ certificado autofirmado (provisorio, hasta que el DNS apunte acá y corra certbot)"
if [ ! -f /etc/nginx/ssl/shuk/autofirmado.pem ]; then
  sudo openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
    -subj "/CN=shukmamtakim.com.ar" -addext "subjectAltName=DNS:shukmamtakim.com.ar,DNS:www.shukmamtakim.com.ar" \
    -keyout /etc/nginx/ssl/shuk/autofirmado.key -out /etc/nginx/ssl/shuk/autofirmado.pem 2>/dev/null
fi

echo "▸ rangos de Cloudflare (por si algún día se pone adelante; hoy no se usa)"
{ curl -fsS https://www.cloudflare.com/ips-v4; echo; curl -fsS https://www.cloudflare.com/ips-v6; echo; } 2>/dev/null \
  | awk 'NF {print "set_real_ip_from " $1 ";"}' | sudo tee /etc/nginx/snippets/cloudflare-ips.conf >/dev/null || true

echo "▸ sitio de nginx"
if [ ! -f /etc/nginx/sites-available/shuk ] || ! sudo grep -q "managed by Certbot" /etc/nginx/sites-available/shuk; then
  sudo cp despliegue/nginx-shuk.conf /etc/nginx/sites-available/shuk
else
  echo "  (ya tiene el certificado de certbot: no se pisa)"
fi
sudo ln -sf /etc/nginx/sites-available/shuk /etc/nginx/sites-enabled/shuk
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl enable -q nginx
sudo systemctl restart nginx

echo "▸ variables (despliegue/shuk.env)"
if [ ! -f despliegue/shuk.env ]; then cp despliegue/shuk.env.ejemplo despliegue/shuk.env; chmod 600 despliegue/shuk.env; echo "  ⚠️ completar ANTHROPIC_API_KEY en despliegue/shuk.env y correr: docker compose -f despliegue/docker-compose.yml up -d"; fi

echo "▸ contenedor del sitio"
docker compose -f despliegue/docker-compose.yml up -d --build 2>&1 | tail -2

echo "▸ auto-deploy (cron cada 2 min)"
chmod +x despliegue/actualizar.sh
LINEA="*/2 * * * * flock -n /tmp/shuk-actualizar.lock $REPO/despliegue/actualizar.sh >> $HOME/shuk-actualizar.log 2>&1"
( crontab -l 2>/dev/null | grep -v "shuk-mamtakim/despliegue/actualizar.sh" ; echo "$LINEA" ) | crontab -

echo "▸ prueba"
sleep 2
curl -fsS http://127.0.0.1:3100/_salud && echo
curl -ksS -o /dev/null -w "https local → %{http_code}\n" -H "Host: shukmamtakim.com.ar" https://127.0.0.1/
echo "✅ listo"
