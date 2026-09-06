# 🏠 El sitio del Shuk en casa (VPS de Hostinger)

Esta carpeta reemplaza a **Vercel**. Nada más: **Supabase sigue igual** (la base, el auth, la
Edge Function `api`, el cron horario, los backups). Lo que se mudó es lo que hacía Vercel:

| Lo hacía Vercel | Ahora lo hace |
|---|---|
| Servir `index.html`, `tienda.html`, `candyshop.html`, fotos, `ci-k7m2x9/`… | `sitio/servidor.mjs` (Node) desde el repo montado en el contenedor |
| `vercel.json` (reescrituras `/tienda`, `/candyshop/meir`… y cabeceras de caché) | el mismo `vercel.json`: el servidor **lo lee** (una sola verdad) |
| `middleware.js` (candado geográfico Mercosur, `/_geocheck`, pase) | el mismo `middleware.js`, importado tal cual; el país lo da `geoip-lite` en vez de la cabecera de Vercel |
| `api/leer-factura.js` (lector de tickets de Israel, 300 s) | el mismo archivo en `/api/leer-factura`, sin tope de tiempo |
| Certificado, HTTP→HTTPS, `www` → apex | el **proxy Caddy compartido** del VPS (`/srv/proxy`, archivo `shuk.caddy`) |
| Deploy automático con cada `git push` | `actualizar.sh` por cron cada 2 minutos |

## Dónde vive en el VPS

- Repo: `/srv/shuk-mamtakim` (clon de `main`, siempre igual a GitHub: `actualizar.sh` hace `reset --hard`).
- Contenedor: `shuk-sitio` (`docker compose -f despliegue/docker-compose.yml …`), en la red `edge`,
  sin puertos publicados: solo se entra por Caddy.
- Sitio del proxy: `/srv/proxy/sites/shuk.caddy` (copia de `despliegue/shuk.caddy`).
- Variables: `despliegue/shuk.env` (no va al repo). Hoy una sola: `ANTHROPIC_API_KEY`.
- Log del auto-deploy: `~/shuk-actualizar.log`. Log del servidor: `docker logs shuk-sitio`.

## Direcciones

- **Prueba (ya anda):** https://shuk.82-25-74-242.sslip.io — mismo sitio, certificado real.
- **Definitiva:** https://shukmamtakim.com.ar — cuando el DNS apunte al VPS (ver abajo).

## 🚦 El día del corte (DNS)

El dominio está en NIC.AR y **delegado a los nameservers de Vercel**. NIC.AR no deja cargar
registros, solo delegar → hace falta un DNS que sí los tenga. Dos opciones:

1. **Cloudflare (gratis, recomendado)**: crear cuenta → *Add a site* → `shukmamtakim.com.ar` →
   cargar `A @ 82.25.74.242` y `A www 82.25.74.242` (nube **gris**, "DNS only") → Cloudflare da
   dos nameservers → en NIC.AR (Clave Fiscal → Delegaciones) reemplazar los `ns1/ns2.vercel-dns.com`
   por esos dos. Propaga en minutos-horas.
2. **Hostinger**: en hPanel → DNS → agregar el dominio externo con los mismos dos registros A y
   delegar en NIC.AR a los nameservers que indique Hostinger.

No hay que tocar nada en el VPS: Caddy saca el certificado de Let's Encrypt **solo, con la
primera visita** (`on_demand`). Para verificar: `curl -sI https://shukmamtakim.com.ar/_salud`.

**Volver atrás**: volver a poner los nameservers de Vercel en NIC.AR. Vercel sigue publicando
`main` como siempre (`shuk-mamtakim.vercel.app` no se da de baja: los links viejos siguen vivos).

## Operación diaria

| Qué | Cómo |
|---|---|
| Publicar una versión | `git push` a `main` y esperar ≤2 min (igual que con Vercel) |
| Ver que se publicó | `tail ~/shuk-actualizar.log` en el VPS, o `curl -s https://shukmamtakim.com.ar/_salud` |
| Forzar ahora | `bash /srv/shuk-mamtakim/despliegue/actualizar.sh` |
| Cambió la clave de la IA | editar `despliegue/shuk.env` y `docker compose -f despliegue/docker-compose.yml up -d` |
| Reinstalar todo | `bash despliegue/instalar-vps.sh` (idempotente) |
| Logs del sitio | `docker logs -f shuk-sitio` (solo errores, 4xx/5xx y llamadas a `/api/`) |

## Qué es distinto de Vercel (a propósito)

- Los archivos de infra (`despliegue/`, `api/`, `supabase/`, `middleware.js`, `vercel.json`, `*.sql`)
  devuelven 404: no hay por qué servirlos.
- El país del candado sale de `geoip-lite` (base MaxMind embebida) y no de Vercel. Misma regla de oro:
  ante la duda, **deja pasar**. Nadie puede mandar la cabecera `x-vercel-ip-country` desde afuera: se pisa.
- El lector de tickets ya no tiene el tope de 300 s de Vercel (Node no corta; Caddy tampoco).
