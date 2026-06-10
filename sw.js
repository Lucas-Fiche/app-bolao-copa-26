// Service worker mínimo: existe apenas para o app ser instalável (PWA).
// Sem handler de respondWith, todas as requisições seguem direto para a
// rede — nada é cacheado aqui, evitando telas desatualizadas.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
