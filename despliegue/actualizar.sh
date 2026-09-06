#!/usr/bin/env bash
# El "auto-deploy" que antes hacía Vercel: cada 2 minutos (cron) mira si main tiene commits
# nuevos. Si los hay, los baja; si cambió algo del servidor (despliegue/sitio, api/, middleware.js,
# vercel.json), reconstruye el contenedor; si cambió el sitio del proxy (shuk.caddy), lo recarga.
# Un cambio de HTML se ve al instante (el repo está montado adentro del contenedor).
# Escribe una línea por actualización en ~/shuk-actualizar.log.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
git fetch -q origin main
LOCAL=$(git rev-parse HEAD)
REMOTO=$(git rev-parse origin/main)
[ "$LOCAL" = "$REMOTO" ] && exit 0
CAMBIOS=$(git diff --name-only "$LOCAL" "$REMOTO")
git reset -q --hard origin/main
echo "$(date '+%F %T') ${LOCAL:0:7} → ${REMOTO:0:7}: $(echo "$CAMBIOS" | wc -l | tr -d ' ') archivos"
if echo "$CAMBIOS" | grep -qE '^(despliegue/sitio/|api/|middleware\.js$|vercel\.json$)'; then
  docker compose -f despliegue/docker-compose.yml up -d --build 2>&1 | tail -2
  echo "$(date '+%F %T') servidor reconstruido"
fi
if ! cmp -s despliegue/shuk.caddy /srv/proxy/sites/shuk.caddy; then
  cp despliegue/shuk.caddy /srv/proxy/sites/shuk.caddy
  docker kill -s USR1 proxy >/dev/null
  echo "$(date '+%F %T') proxy recargado"
fi
