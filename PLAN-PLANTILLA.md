# Plan — Plantilla multi-tienda (white-label) a partir de Shuk Mamtakim

> Objetivo: convertir este proyecto en un **molde reutilizable** que se pueda ofrecer a otros
> negocios. Vos (integrador) lo configurás para cada cliente desde un **panel Super Admin** donde
> ves todas las tiendas y prendés/apagás funciones por cada una. (Autoservicio del cliente = etapa futura.)

Fecha: 2026-06-09 · Estado: PLAN (sin código todavía)

---

## 1. Decisiones ya tomadas
- **Quién configura:** vos/tu equipo (no el cliente, por ahora). El autoservicio queda como etapa futura.
- **Alcance:** todo el sistema (catálogo mayorista+minorista, panel, caja, socios, pedidos, bot).
- **Extra clave:** **Panel Super Admin** — una tienda maestra donde ves todas las tiendas y tenés
  switches ON/OFF de las funciones que le ofrecés a cada una.
- **Primer entregable:** este documento de plan.

---

## 2. Conceptos

- **Tenant (tienda):** cada cliente = una tienda con su propia config, sus datos y sus funciones habilitadas.
- **CONFIG:** todos los datos hoy "pegados" en el código, sacados a un solo lugar por tienda
  (nombre, colores, socios, %, claves, números, etc.).
- **Feature flags:** booleanos por tienda que prenden/apagan módulos (caja sí/no, socios sí/no, bot sí/no…).
- **Registro maestro:** una base central (planilla/Apps Script "maestro") que lista todas las tiendas
  con su config y sus flags. El Super Admin lee/escribe acá.

---

## 3. Decisión arquitectónica central — backend compartido vs aislado

Es la decisión más importante. Cada tienda necesita guardar sus datos (productos, ventas, caja).

| | **Compartido** (1 planilla/Apps Script con columna `tienda`) | **Aislado** (cada tienda su planilla + Apps Script) |
|---|---|---|
| Alta de tienda | Agregar una fila en el registro maestro (rápido) | Crear planilla + deployar Apps Script por tienda (manual) |
| Super Admin "ver todo" | Trivial (todo en un lugar) | Hay que consultar tienda por tienda |
| Privacidad/escala | Datos mezclados; ojo con volumen | Cada cliente dueño de SUS datos; más pro |
| Esfuerzo de build | Refactor grande (todo lleva `tienda_id`) | Menos refactor de datos, más trabajo de onboarding |

**Recomendación:** arrancar **compartido** (onboarding instantáneo y Super Admin natural), con la
opción de "graduar" una tienda grande a infra aislada más adelante. Es la vía que mejor encaja con
la idea del Super Admin viendo todo.

> ⚠️ Decisión abierta #A — confirmar compartido vs aislado antes de la Fase 3.

---

## 4. Modelo de datos — Registro maestro

Planilla/Apps Script "maestro" con una hoja **Tiendas**:

| Campo | Ejemplo |
|---|---|
| id | `shuk` |
| nombre | `Shuk Mamtakim` |
| dominio/slug | `shuk` (→ `shuk.tudominio.com` o `/t/shuk`) |
| estado | `activa` / `pausada` |
| config (JSON) | ver sección 5 |
| flags (JSON) | ver sección 6 |
| creada / plan | fecha, plan contratado |

(En backend compartido, las hojas de datos —Productos, Ventas, Caja— llevan una columna `tienda`.)

---

## 5. CONFIG por tienda (lo que se parametriza)

Todo esto hoy está hardcodeado y hay que extraerlo:

- **Identidad:** nombre, logo, favicon, colores, textos/leyendas (ej. reserva 7 días).
- **Moneda y formato:** ARS/USD, símbolos, si usa tipo de cambio automático.
- **Socios:** lista de socios con nombre, sus cajas y su % de comisión. (O "sin socios".)
- **Cajas / medios de pago:** nombres de columnas (MP, EFT, transferencia, cta cte…).
- **Diezmo / aportes:** % y si aplica.
- **Infra del cliente:** Supabase (url, anon key, usuarios admin), Cloudinary cloud,
  Apps Script URL + Sheet ID (o backend compartido), OneSignal app id.
- **Contacto:** números de WhatsApp.
- **Bot de ventas:** token Telegram, IDs de usuarios (o desactivado).
- **Secretos:** hash de URL admin, BOT_SECRET, etc.

---

## 6. Feature flags (módulos ON/OFF por tienda)

Derivados de lo que ya existe:

- Catálogo mayorista · Catálogo minorista · Tipo de cambio USD automático
- Panel admin · Dashboard/métricas · Trazar producto · Stock con fotos
- Caja · Sistema de socios (split) · Comisión/diezmo · Pago a cuenta · Cuenta corriente
- Reserva de pedidos (7 días) · Ofertas y packs · Lista de espera · Notificaciones push · Remito PDF
- Bot de ventas (Telegram) · Registro de clientes

Cada flag, al estar OFF, oculta su UI y desactiva su backend para esa tienda.

---

## 7. Panel Super Admin

Vista exclusiva tuya (login propio). Funciones:
- **Lista de todas las tiendas** con estado, plan y atajos.
- **Crear tienda** → lanza el asistente (sección 8).
- **Editar config** de una tienda.
- **Switches de feature flags** por tienda (prender/apagar módulos en vivo).
- **Pausar/activar** una tienda.
- (Futuro) métricas globales: cuántas ventas/uso por tienda.

---

## 8. Asistente de alta de tienda (wizard)

Al crear una tienda, te hace las preguntas necesarias y arma su CONFIG + flags. Pasos:
1. Identidad (nombre, logo, colores).
2. Rubro y catálogo (¿mayorista/minorista?, ¿USD?).
3. Socios y comisiones (o sin socios).
4. Cajas / medios de pago.
5. Módulos a habilitar (los flags).
6. Infra: pegar claves (Supabase, Cloudinary, etc.) **o** usar las compartidas.
7. Contacto y bot.

Al final: guarda la tienda en el registro maestro y muestra una **checklist** de lo que falta crear
afuera (planilla, usuarios Supabase, etc.) si la tienda es aislada.

> Nota: el asistente **junta datos y deja checklist**; no puede crear cuentas de Google/Supabase solo.

---

## 9. Identificación de tienda (cuál config carga la app)

Opciones: subdominio (`cliente.tudominio.com`, lo más pro), path (`/t/cliente`), o parámetro.
La app, al cargar, detecta la tienda → pide su config+flags al registro maestro → se pinta acorde.

> ⚠️ Decisión abierta #B — subdominio vs path.

---

## 10. Hoja de ruta por fases

- **Fase 0 — Preparación (sin romper Shuk):** trabajar sobre una copia; Shuk sigue en producción.
- **Fase 1 — Extraer CONFIG:** sacar todos los datos de Shuk a un objeto CONFIG; la app lee de ahí.
  Shuk pasa a ser "tienda 0". *(Fundacional, sin cambios visibles.)*
- **Fase 2 — Feature flags:** cada módulo respeta su flag (mostrar/ocultar). Probar con Shuk.
- **Fase 3 — Registro maestro + carga por tienda:** la app carga config+flags según la tienda.
- **Fase 4 — Panel Super Admin:** ver tiendas + switches + editar config.
- **Fase 5 — Asistente de alta + checklist de infra.**
- **Fase 6 — Backend multi-tienda** (compartido con `tienda_id`, o aislado) según decisión #A.
- **Fase 7 (futuro) — Autoservicio** del cliente, planes/cobros, métricas globales.

---

## 11. Decisiones abiertas (para definir antes de codear)
- **#A** Backend compartido vs aislado (sección 3). *Recomendado: compartido para arrancar.*
- **#B** Identificación de tienda: subdominio vs path (sección 9).
- **#C** ¿Dónde vive el registro maestro? (planilla Google + Apps Script, o Supabase).
- **#D** ¿La plantilla es un repo NUEVO (copia de Shuk) o Shuk se convierte en la plantilla?
  *Recomendado: repo nuevo, así Shuk-producción no corre riesgo.*

---

## 12. Riesgos / notas honestas
- Es un proyecto **grande** (varias semanas de trabajo iterativo), no un fin de semana.
- El paso 1 (extraer CONFIG) es la mitad del valor y se puede hacer ya, sin riesgo para Shuk.
- La infra por cliente (cuentas externas) siempre tendrá una parte manual.
- Conviene NO tocar el Shuk de producción: hacer todo sobre una copia/repo nuevo.
