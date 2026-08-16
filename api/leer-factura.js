// ============================================================================
// Lectura del ticket israelí — función de Vercel del sitio del Shuk.
//
// ⚠️ ARCHIVO GENERADO. No editar a mano: el esquema y las instrucciones salen de
//    ~/costos-israel/api/_lib/lectura.ts con scripts/generar-endpoint-shuk.ts.
//    Si se afina el prompt de un lado y el otro queda viejo, las dos lecturas
//    dejan de ser comparables y todo el control cruzado pierde sentido.
//
// Vive acá y no en la Edge Function de Supabase por una razón medida: la lectura
// del ticket real de 57 renglones tarda 193 s, y una Edge Function tiene 150 s
// para contestar (en Free y en Pro). Vercel Free da 300 s. Entra, con margen.
//
// Sin dependencias a propósito: el repo del Shuk es estático puro y meterle un
// package.json cambiaría cómo Vercel lo clasifica.
// ============================================================================

export const config = { maxDuration: 300 };

const ESQUEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    proveedor_he: { type: 'string', description: 'Nombre del comercio tal cual figura, en hebreo. "" si no aparece.' },
    proveedor_es: { type: 'string', description: 'El nombre del comercio transliterado al español.' },
    numero_factura: { type: 'string', description: 'Número de ticket, pedido o factura. "" si no aparece.' },
    fecha_factura: { type: 'string', description: 'Fecha en formato AAAA-MM-DD. "" si no aparece.' },
    subtotal_ils: { type: 'number', description: 'Subtotal impreso antes de descuentos generales. 0 si no aparece.' },
    descuento_general_ils: {
      type: 'number',
      description:
        'Descuento aplicado al total de la compra, no a un producto puntual, en positivo. 0 si no hay.',
    },
    redondeo_ils: {
      type: 'number',
      description:
        'Redondeo del pie ("עיגול חשבון" / "עיגול"), con su signo tal como figura. 0 si no aparece.',
    },
    total_ils: {
      type: 'number',
      description: 'TOTAL a pagar impreso ("לתשלום" / "סה"כ לתשלום"). 0 si no aparece.',
    },
    ahorro_total_ils: {
      type: 'number',
      description:
        'Ahorro total declarado al pie ("חסכת בקנייה זו"), en positivo. 0 si el ticket no lo declara.',
    },
    lineas_repetidas_omitidas: {
      type: 'integer',
      description:
        'Cuántas líneas de producto aparecían en más de una foto por el solapamiento y se contaron una sola vez.',
    },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          codigo_barras: { type: 'string', description: 'Código del producto que figura en su línea. "" si no lo trae.' },
          nombre_he: { type: 'string', description: 'Descripción del producto tal cual figura, en hebreo.' },
          nombre_es: { type: 'string', description: 'Traducción de la descripción al español, conservando la marca.' },
          cantidad: {
            type: 'number',
            description: 'El número que multiplica al precio: unidades, o kilos si la línea es por peso.',
          },
          unidad: {
            type: 'string',
            enum: ['unidad', 'kg'],
            description: '"kg" cuando la línea es por peso (dice ק"ג y la cantidad tiene decimales); si no, "unidad".',
          },
          precio_unitario_ils: {
            type: 'number',
            description: 'El precio que aparece después de la "x": por unidad, o por kilo si la línea es por peso.',
          },
          importe_linea_ils: {
            type: 'number',
            description: 'El importe de la línea tal cual está impreso, antes del descuento.',
          },
          descuento_linea_ils: {
            type: 'number',
            description:
              'Descuento de esa línea, TOTAL y en positivo (si está impreso como -11.40, poné 11.40). No incluye el crédito de envase. 0 si no hay.',
          },
          credito_envase_ils: {
            type: 'number',
            description:
              'Crédito de envase ("הנחת זיכוי אריזה") que figura debajo de esta línea, en positivo. 0 si no hay.',
          },
          es_oferta: { type: 'boolean', description: 'true si la línea tiene descuento o está marcada como promoción.' },
          oferta_he: { type: 'string', description: 'Texto de la promoción tal cual figura, en hebreo. "" si no hay.' },
          oferta_es: { type: 'string', description: 'Traducción del texto de la promoción. "" si no hay.' },
          peso_unit_g: {
            type: 'number',
            description:
              'Gramaje de UNA unidad si aparece en el nombre del producto (ej. "100 גרם" → 100, "במבה 150" → 150). 0 si no figura.',
          },
        },
        required: [
          'codigo_barras',
          'nombre_he',
          'nombre_es',
          'cantidad',
          'unidad',
          'precio_unitario_ils',
          'importe_linea_ils',
          'descuento_linea_ils',
          'credito_envase_ils',
          'es_oferta',
          'oferta_he',
          'oferta_es',
          'peso_unit_g',
        ],
      },
    },
  },
  required: [
    'proveedor_he',
    'proveedor_es',
    'numero_factura',
    'fecha_factura',
    'subtotal_ils',
    'descuento_general_ils',
    'redondeo_ils',
    'total_ils',
    'ahorro_total_ils',
    'lineas_repetidas_omitidas',
    'items',
  ],
};

const INSTRUCCIONES = `Las imágenes son las páginas de UN MISMO ticket o factura de un comercio israelí, en hebreo, en orden.

FOTOS SOLAPADAS: los tickets son largos y se fotografían por tramos que se pisan, así que el final de una foto vuelve a aparecer al principio de la siguiente. Una línea de producto que ya contaste no se cuenta de nuevo. Contá cuántas líneas omitiste por esta razón y ponelo en lineas_repetidas_omitidas.

CÓMO ES CADA LÍNEA: el texto en hebreo va a la derecha y los números a la izquierda. Una línea de producto ocupa dos o tres renglones:
- el código del producto,
- el importe de la línea, la cantidad, la palabra יחידה (unidad) o ק"ג (kilo), y el precio unitario, junto al nombre del producto,
- si hay descuento, un renglón con el importe en negativo.

Ejemplo: un renglón que dice "41.70   3 x יחידה 13.90" con "-2.80" debajo se registra como cantidad 3, unidad "unidad", precio_unitario_ils 13.90, importe_linea_ils 41.70 y descuento_linea_ils 2.80.

UNA SOLA UNIDAD: cuando la línea muestra un único importe y no dice "N x", es que se compró una unidad. En ese caso cantidad es 1 y precio_unitario_ils es ese mismo importe. Nunca dejes cantidad o precio_unitario_ils en 0 en una línea de producto.

LÍNEAS POR PESO: cuando dice ק"ג la cantidad son kilos y el precio es por kilo. "0.190 x ק"ג 29.90" con importe 5.68 se registra como cantidad 0.190, unidad "kg", precio_unitario_ils 29.90, importe_linea_ils 5.68.

COPIAR, NO CALCULAR: importe_linea_ils, precio_unitario_ils, cantidad y los totales son los números IMPRESOS, tal cual. No los recalcules ni los corrijas aunque no cierren: la app los verifica después y necesita ver lo que realmente dice el papel.

DESCUENTOS: el descuento que aparece debajo de una línea pertenece a esa línea, es el TOTAL de la línea (no por unidad) y se anota en positivo. Un descuento que se aplica a toda la compra va en descuento_general_ils.

CRÉDITO DE ENVASE: el renglón "הנחת זיכוי אריזה" es la devolución del depósito del envase. Pertenece a la línea del producto que está encima y va en su credito_envase_ils. NO es una línea de producto: no le crees una entrada propia en items, y no lo sumes a descuento_linea_ils.

PIE DEL TICKET: total_ils es lo que dice לתשלום (a pagar). redondeo_ils es עיגול חשבון con su signo. ahorro_total_ils es el ahorro declarado al pie (חסכת בקנייה זו) si figura. No confundas el total a pagar con el efectivo entregado (מזומן) ni con el vuelto (עודף).

PESO: si el nombre del producto incluye un gramaje — "100 גרם", "במבה 150", "רפאלו 240 גרם" — ponelo en peso_unit_g. Si no figura, 0.

Lo que no está impreso se deja en 0 o en "": no completes con estimaciones.`;

const SB_URL = 'https://soarkknjewgcewryxqac.supabase.co';
const SB_ANON = 'sb_publishable_aAZNID-NdaGERYQWe9Uk6w_rmlYSCj2';
const MAIL_JONY = 'admin@shukmamtakim.com';

/** Quién está llamando. Falla CERRADO: sin usuario válido, no se lee nada. */
async function usuarioDe(token) {
  if (!token) return null;
  try {
    const r = await fetch(SB_URL + '/auth/v1/user', {
      headers: { Authorization: 'Bearer ' + token, apikey: SB_ANON },
    });
    if (!r.ok) return null;
    const u = await r.json();
    return String((u && u.email) || '').trim().toLowerCase();
  } catch { return null; }
}

/** Junta el JSON de un stream SSE de Anthropic. */
function textoDelStream(crudo) {
  let texto = '';
  let motivo = '';
  for (const linea of crudo.split('\n')) {
    if (!linea.startsWith('data:')) continue;
    const cuerpo = linea.slice(5).trim();
    if (!cuerpo || cuerpo === '[DONE]') continue;
    let ev;
    try { ev = JSON.parse(cuerpo); } catch { continue; }
    if (ev.type === 'content_block_delta' && ev.delta && typeof ev.delta.text === 'string') texto += ev.delta.text;
    if (ev.type === 'message_delta' && ev.delta && ev.delta.stop_reason) motivo = ev.delta.stop_reason;
    if (ev.type === 'error') throw new Error((ev.error && ev.error.message) || 'error del modelo');
  }
  return { texto, motivo };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const bruto = req.headers.authorization || '';
  const token = String(Array.isArray(bruto) ? bruto[0] : bruto).replace(/^Bearer /i, '');
  const mail = await usuarioDe(token);
  if (!mail) return res.status(401).json({ error: 'no autorizado' });
  // 🔒 Solo Jony: leer un ticket cuesta plata y las compras de Israel son suyas.
  if (mail !== MAIL_JONY) return res.status(403).json({ error: 'no autorizado' });

  const clave = process.env.ANTHROPIC_API_KEY;
  if (!clave) {
    return res.status(500).json({
      error: 'Falta configurar la clave de la IA (ANTHROPIC_API_KEY) en las variables de entorno de Vercel.',
    });
  }

  const adjuntos = (req.body && req.body.adjuntos) || [];
  if (!Array.isArray(adjuntos) || adjuntos.length === 0) {
    return res.status(400).json({ error: 'No llegó ninguna foto para leer.' });
  }
  if (adjuntos.length > 12) {
    return res.status(400).json({ error: 'Son demasiadas fotos para una sola lectura (máximo 12).' });
  }

  const contenido = adjuntos.map((a) =>
    a.mediaType === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.base64 } }
      : { type: 'image', source: { type: 'base64', media_type: a.mediaType || 'image/jpeg', data: a.base64 } },
  );
  contenido.push({ type: 'text', text: INSTRUCCIONES });

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': clave,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-opus-5',
        max_tokens: 32000,
        stream: true,
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: ESQUEMA } },
        messages: [{ role: 'user', content: contenido }],
      }),
    });

    if (!r.ok) {
      const detalle = (await r.text()).slice(0, 300);
      // Los que se arreglan esperando se distinguen de los que no.
      if (r.status === 429 || r.status === 529) {
        return res.status(503).json({ error: 'El servicio está saturado en este momento. Probá de nuevo en un minuto.' });
      }
      return res.status(502).json({ error: 'La IA rechazó la lectura (' + r.status + '): ' + detalle });
    }

    const { texto, motivo } = textoDelStream(await r.text());
    if (motivo === 'refusal') return res.status(422).json({ error: 'El modelo no pudo procesar estas imágenes.' });
    if (motivo === 'max_tokens') {
      return res.status(422).json({ error: 'El ticket es más largo de lo que entra en una lectura. Probá subiendo menos fotos por vez.' });
    }
    if (!texto.trim()) return res.status(502).json({ error: 'La IA no devolvió nada.' });

    let datos;
    try { datos = JSON.parse(texto); }
    catch { return res.status(502).json({ error: 'La IA devolvió algo que no se pudo leer.' }); }
    return res.status(200).json(datos);
  } catch (e) {
    return res.status(500).json({ error: 'No se pudo leer la factura: ' + (e && e.message ? e.message : String(e)) });
  }
}
# Redeploy 16/08/2026 12:57 — para que Vercel tome ANTHROPIC_API_KEY (las variables nuevas solo se aplican en el build siguiente).
