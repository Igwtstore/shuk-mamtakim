// ============================================================================
//  FICHA DE TIENDA  ·  white-label (multi-tienda)
//  ---------------------------------------------------------------------------
//  Todo lo específico de UNA tienda vive acá. Para dar de alta otra tienda:
//  copiar este archivo y cambiar estos valores (nada de tocar el código).
//  Shuk Mamtakim = "tienda 0" (la original). Ver PLAN-PLANTILLA.md.
//
//  NOTA seguridad: todo lo de acá ya es PÚBLICO del frontend (la URL del backend,
//  el anon key de Supabase, el cloud de Cloudinary, el appId de OneSignal son
//  identificadores públicos por diseño). Los secretos de verdad (SERVICE_ROLE,
//  BOT_SECRET, etc.) viven en el backend (Edge Function), NUNCA acá.
//
//  ⚙️ Backend: desde el switch del 2026-07-02 el motor es una Edge Function de
//     Supabase. En el código la constante sigue llamándose APPS_SCRIPT_URL por
//     herencia (cientos de usos) — apunta a infra.backendUrl de acá.
// ============================================================================
(function () {
  var ANON = 'sb_publishable_aAZNID-NdaGERYQWe9Uk6w_rmlYSCj2';   // anon/publishable key (público)
  var SB_URL = 'https://soarkknjewgcewryxqac.supabase.co';

  window.TIENDA_CONFIG = {
    id: 'shuk',

    // — Identidad / marca —
    marca: {
      nombre:  'Shuk Mamtakim',
      emoji:   '🍬',
      tagline: 'Dulces Tradicionales · Frutos Secos',
      // base de imágenes del repo (logos, banners servidos desde GitHub)
      baseImg: 'https://raw.githubusercontent.com/Igwtstore/shuk-mamtakim/main/',
    },

    // — Contacto —
    contacto: {
      whatsapp:      '5491131754540',        // número principal (avisos / pedidos)
      whatsappAlt:   '972527596202',         // número secundario (Israel)
      whatsappExtra: ['5491150987261', '5491171046383'],   // otros números del aviso
      // teléfonos de los vendedores (para catálogos por dueño). Se conectan en el próximo hito.
      telefonos: { jony: '5491131754540', meir: '5491171046383', iosi: '5491150987261' },
    },

    // — Infraestructura del cliente (identificadores públicos del frontend) —
    infra: {
      backendUrl:     SB_URL + '/functions/v1/api',      // motor (Edge Function Supabase)
      supabase:       { url: SB_URL, anonKey: ANON },
      cloudinary:     { cloud: 'dq2boloyp', preset: 'shuk_upload' },
      oneSignalAppId: '0e4a5058-d7a1-405b-86c9-86ae42940ab4',
    },

    // — Módulo Candy (la tienda de los chicos): marca propia dentro del mismo tenant —
    candy: {
      nombre: 'Candy Shop',
      emoji:  '🍬',
      // logo/banner (se usa en manifest PWA, prompt de Gemini y og de la tienda de los chicos)
      logo:   'https://res.cloudinary.com/dq2boloyp/image/upload/w_512,h_512,c_pad,b_rgb:b14cff/website_banner_rhyfih.png',
      cloudinaryPreset: 'candyshop',   // preset propio de subida (mismo cloud que infra.cloudinary)
    },

    // — Reglas de negocio (los % siguen hardcodeados en los cálculos de plata;
    //    se conectan en un hito posterior, con tests, por ser sensibles) —
    negocio: {
      comisionSocio: 0.15,            // % del socio (Miri) sobre lo que vende del otro (Jony)
      maaser:        0.10,            // % del Maaser (diezmo)
      socios:        ['Jony', 'Miri'],
    },
  };
})();
