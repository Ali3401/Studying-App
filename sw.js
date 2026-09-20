/* Lucid — offline support. The whole app is static, so we can simply keep a
   copy of it. Notes live in IndexedDB and are never touched here. */

const VERSION = 'lucid-v1';
const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './styles/tokens.css',
  './styles/icons.css',
  './styles/base.css',
  './styles/components.css',
  './styles/library.css',
  './styles/reader.css',
  './styles/editor.css',
  './styles/panels.css',
  './styles/print.css',
  './src/main.js',
  './src/core/util.js',
  './src/core/db.js',
  './src/core/store.js',
  './src/core/settings.js',
  './src/core/router.js',
  './src/core/highlights.js',
  './src/core/prompt.js',
  './src/core/sample.js',
  './src/parse/lmd.js',
  './src/parse/render.js',
  './src/ui/ui.js',
  './src/ui/palette.js',
  './src/ui/appearance.js',
  './src/ui/exporter.js',
  './src/views/library.js',
  './src/views/reader.js',
  './src/views/editor.js',
  './src/views/study.js',
  './src/views/importer.js',
  './src/views/guide.js',
  './src/import/tidy.js',
  './src/import/pdf.js',
  './src/import/office.js',
  './vendor/pdf.min.mjs',
  './vendor/pdf.worker.min.mjs',
  './vendor/jszip.min.js',
  './assets/icons/icon.svg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await Promise.allSettled(CORE.map(u => cache.add(new Request(u, { cache: 'reload' }))));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // navigations: try the network, fall back to the cached shell
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(VERSION);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch {
        return (await caches.match('./index.html')) || (await caches.match('./')) || Response.error();
      }
    })());
    return;
  }

  // everything else: cache first, then refresh in the background
  e.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: false });
    const network = fetch(req).then(res => {
      if (res && res.ok && res.type === 'basic') {
        caches.open(VERSION).then(c => c.put(req, res.clone()));
      }
      return res;
    }).catch(() => null);
    return cached || (await network) || Response.error();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting();
});
