const CACHE = 'shuk-v6';
const STATIC = ['/', '/index.html', '/icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // VIDEOS → el navegador los maneja SOLO (piden rangos parciales; si el SW los intercepta,
  // iPhone los rechaza con ERROR 4 — bug cazado con el diagnóstico del usuario 2026-07-05).
  if (e.request.destination === 'video' || e.request.headers.has('range') ||
      url.pathname.includes('/video/') || /\.(mp4|webm|mov|m4v)$/i.test(url.pathname)) {
    return;
  }

  // OneSignal y APIs → siempre network, sin cache
  if (url.hostname.includes('onesignal') || url.pathname.includes('OneSignal') ||
      url.hostname.includes('script.google') || url.hostname.includes('googleapis')) {
    return;
  }

  // NUESTRAS APIs y Supabase → que el SW no se meta. La lectura de un ticket tarda ~3 minutos
  // y devuelve varios MB: si el SW la intercepta, la clona y trata de guardarla, no gana nada
  // y puede colgarla. Nada de esto se cachea nunca.
  if (url.pathname.startsWith('/api/') || url.hostname.includes('supabase.co') ||
      url.hostname.includes('anthropic.com')) {
    return;
  }

  // La calculadora empotrada se sirve de su propia carpeta: se deja pasar de largo para que
  // una versión nueva no quede pegada en el cache de un service worker viejo.
  if (url.pathname.startsWith('/ci-k7m2x9/')) return;

  // Imágenes Cloudinary → cache con revalidación
  if (url.hostname.includes('cloudinary') || url.hostname.includes('githubusercontent')) {
    e.respondWith(
      caches.open(CACHE).then(cache =>
        cache.match(e.request).then(cached => {
          const network = fetch(e.request).then(res => {
            cache.put(e.request, res.clone());
            return res;
          });
          return cached || network;
        })
      )
    );
    return;
  }

  // Página principal → SIEMPRE de la red, sin caché HTTP (así se ve la última versión). Cache solo offline.
  e.respondWith(
    fetch(e.request, { cache: 'no-store' })
      .then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
