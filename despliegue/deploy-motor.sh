#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  🚀 PUBLICAR EL MOTOR (la Edge Function `api` de Supabase)
#
#  Ojo: `git push` publica las PANTALLAS. El motor va aparte, y si no se corre
#  esto se atrasa en silencio: el 7/9/2026 se descubrió que llevaba 10 días
#  atrasado y el botón "ponerle nombre al anónimo" estaba roto en producción.
#
#  Uso:  bash despliegue/deploy-motor.sh
#  (la clave de despliegue se lee sola del archivo de memoria; nunca se imprime)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO="/Users/antoniojsetton/shuk-mamtakim"
PROJECT_REF="soarkknjewgcewryxqac"
API="https://${PROJECT_REF}.supabase.co/functions/v1/api"
CLAVE_EN="${HOME}/.claude/projects/-Users-antoniojsetton-shuk-mamtakim/memory/project_estado_2026_07_06.md"

cd "$REPO"

# La clave de despliegue (sbp_…) vive en la memoria del proyecto, no en el repo.
TOKEN="${SUPABASE_ACCESS_TOKEN:-$(grep -ohE 'sbp_[A-Za-z0-9_]{20,}' "$CLAVE_EN" | head -1)}"
if [ -z "$TOKEN" ]; then
  echo "❌ No encontré la clave de despliegue en:"
  echo "   $CLAVE_EN"
  echo "   Podés pasarla a mano:  SUPABASE_ACCESS_TOKEN=sbp_... bash despliegue/deploy-motor.sh"
  exit 1
fi

echo "🚀 Publicando el motor (Edge Function 'api')…"
SUPABASE_ACCESS_TOKEN="$TOKEN" npx --yes supabase functions deploy api \
  --project-ref "$PROJECT_REF" --no-verify-jwt

# ── Verificación: que el motor VIVO conteste, no que el deploy "haya salido bien".
# Se le pregunta por una acción que existe; el portero contesta antes de mirarla,
# así que sirve como señal de vida del motor recién publicado.
echo ""
echo "🔎 Comprobando que el motor esté vivo…"
RESP="$(curl -s --max-time 20 "${API}?accion=getEstadoTienda" || true)"
case "$RESP" in
  *estado*) echo "✅ El motor contesta.";;
  *)        echo "⚠️ El motor no contestó como se esperaba: ${RESP:0:120}";;
esac

echo ""
echo "✅ Listo. Recordá que las PANTALLAS se publican aparte, con git push."
