const CACHE = 'kendu-v1'
const PRECACHE = [
  '/',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
]

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', e => {
  const { request } = e
  const url = new URL(request.url)

  // Never cache API / CSV calls — always go to network
  if (
    request.method !== 'GET' ||
    url.pathname.startsWith('/api/') ||
    url.hostname.includes('google') ||
    url.hostname.includes('dexscreener') ||
    url.hostname.includes('coingecko') ||
    url.hostname.includes('coinmarketcap') ||
    url.hostname.includes('alternative.me') ||
    url.hostname.includes('etherscan') ||
    url.hostname.includes('ethplorer')
  ) {
    return
  }

  // Cache-first for static assets (fonts, images, JS, CSS)
  if (
    url.pathname.startsWith('/fonts/') ||
    url.pathname.startsWith('/assets/') ||
    /\.(png|svg|ico|woff2?|otf|ttf)$/.test(url.pathname)
  ) {
    e.respondWith(
      caches.match(request).then(cached => cached || fetch(request).then(res => {
        const clone = res.clone()
        caches.open(CACHE).then(c => c.put(request, clone))
        return res
      }))
    )
    return
  }

  // Network-first for HTML / navigation — fall back to cached shell
  e.respondWith(
    fetch(request).catch(() => caches.match('/'))
  )
})
